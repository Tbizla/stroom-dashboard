const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const DATA_DIR = process.env.DATA_DIR || '/data';
const TOPO_FILE = path.join(DATA_DIR, 'topologie.json');
const MAP_BASENAME = path.join(DATA_DIR, 'kaart');
const LOGO_BASENAME = path.join(DATA_DIR, 'logo');
const DEFAULT_TOPO = path.join(__dirname, 'default_topologie.json');
const TEST_TOPO_SIMPEL = path.join(__dirname, 'test_topologie_simpel.json');
const TEST_TOPO_UITGEBREID = path.join(__dirname, 'test_topologie_uitgebreid.json');

const INFLUX_URL = process.env.INFLUX_URL || 'http://influxdb:8086';
const INFLUX_TOKEN = process.env.INFLUX_TOKEN;
const INFLUX_ORG = process.env.INFLUX_ORG || 'festival';
const INFLUX_BUCKET = process.env.INFLUX_BUCKET || 'stroomdata';

// staat testtopologie/simulator/meetdata-wissen toe. Geen aparte env-var om aan te zetten: de
// `simulator`-service bestaat alleen op het docker-netwerk als de stack met `--profile test`
// gestart is (zie docker-compose.yml), dus of die hostnaam oplosbaar is, is precies het signaal
// of we in testmodus draaien — één commando (`docker compose --profile test up -d`) is genoeg,
// er hoeft nergens in .env iets apart aangezet te worden. Kort gecached, want dit draait per request.
let testModeCache = { value: false, checkedAt: 0 };
function isTestMode() {
  const now = Date.now();
  if (now - testModeCache.checkedAt < 5000) return Promise.resolve(testModeCache.value);
  return new Promise((resolve) => {
    dns.lookup('simulator', (err) => {
      const value = !err;
      testModeCache = { value, checkedAt: Date.now() };
      resolve(value);
    });
  });
}
async function alleenInTestmodus(req, res, next) {
  if (!(await isTestMode())) return res.status(404).json({ error: 'alleen beschikbaar in testmodus (gestart met --profile test)' });
  next();
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TOPO_FILE)) fs.copyFileSync(DEFAULT_TOPO, TOPO_FILE);

// niet-persistent: staat na elke herstart van de webapp weer standaard uit, zodat een
// vergeten aan-gezette simulator nooit per ongeluk blijft doorlopen na een herstart.
let simulatorEnabled = false;

const app = express();
app.use(express.json());
// tijdens actieve ontwikkeling wordt index.html regelmatig aangepast; zonder no-store kan de browser
// een oude versie blijven hergebruiken (ook na een gewone F5) totdat er een harde refresh gebeurt,
// wat verwarrend is bij het testen van fixes
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res) => res.set('Cache-Control', 'no-store') }));

function readTopo() { return JSON.parse(fs.readFileSync(TOPO_FILE, 'utf8')); }
function writeTopo(data) {
  fs.writeFileSync(TOPO_FILE, JSON.stringify(data, null, 2), 'utf8');
  syncTopologyToInflux(data).catch((e) => console.error('kon topologie niet naar InfluxDB syncen:', e.message));
}

// Schrijft de parent/child-structuur (welke kast op welke kast/generator hangt) als losse
// punten naar InfluxDB, zodat Grafana de live vermogensdata kan koppelen aan de actuele
// topologie voor bijv. een multi-level Sankey-diagram — zonder dat er iets aan de Shelly's
// (MQTT-prefix) hoeft te veranderen. InfluxDB is append-only en "kast" is een tag, dus een kast
// die ooit bestond (hernoemd/verwijderd/oude testtopologie) blijft anders voor altijd als losse
// reeks staan — vandaar eerst de hele measurement wissen en daarna de actuele set opnieuw
// schrijven, zodat topology_edges altijd precies (en alleen) de huidige topologie weerspiegelt,
// ook na "Alles wissen" (dan blijft er na de delete gewoon niets over om te herschrijven).
// Best effort: als InfluxDB niet bereikbaar is, faalt de topologie-opslag zelf niet mee.
async function syncTopologyToInflux(data) {
  if (!INFLUX_TOKEN) return;
  const deleteUrl = INFLUX_URL + '/api/v2/delete?org=' + encodeURIComponent(INFLUX_ORG) + '&bucket=' + encodeURIComponent(INFLUX_BUCKET);
  const deleteRes = await fetch(deleteUrl, {
    method: 'POST',
    headers: { Authorization: 'Token ' + INFLUX_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: '1970-01-01T00:00:00Z',
      stop: new Date(Date.now() + 1000).toISOString(),
      predicate: '_measurement="topology_edges"',
    }),
  });
  if (!deleteRes.ok) throw new Error('InfluxDB delete (topology_edges) gaf ' + deleteRes.status + ': ' + (await deleteRes.text()));
  if (!data.kasten.length) return;
  const lines = data.kasten.map((k) => {
    const parent = k.parent || k.generator;
    return 'topology_edges,kast=' + k.id + ',parent=' + parent + ',generator=' + k.generator + ' value=1';
  });
  const writeUrl = INFLUX_URL + '/api/v2/write?org=' + encodeURIComponent(INFLUX_ORG) + '&bucket=' + encodeURIComponent(INFLUX_BUCKET) + '&precision=s';
  const res = await fetch(writeUrl, {
    method: 'POST',
    headers: { Authorization: 'Token ' + INFLUX_TOKEN, 'Content-Type': 'text/plain; charset=utf-8' },
    body: lines.join('\n'),
  });
  if (!res.ok) throw new Error('InfluxDB write gaf ' + res.status + ': ' + (await res.text()));
}

function slugify(naam) {
  return (naam || '')
    .toString().trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'item';
}
function uniekeId(basis, bestaandeIds) {
  let id = basis, n = 2;
  while (bestaandeIds.includes(id)) { id = basis + '_' + n; n++; }
  return id;
}
function mqttPrefix(generatorId, kastId) { return 'fest/' + generatorId + '/' + kastId; }

// true als het instellen van kast[kastId].parent = nieuweParentId een cyclus zou maken
function maaktCyclus(data, kastId, nieuweParentId) {
  if (!nieuweParentId) return false;
  if (nieuweParentId === kastId) return true;
  let cur = data.kasten.find(k => k.id === nieuweParentId);
  while (cur) {
    if (cur.id === kastId) return true;
    cur = cur.parent ? data.kasten.find(k => k.id === cur.parent) : null;
  }
  return false;
}

// ---------- topologie ophalen ----------
app.get('/api/topology', (req, res) => res.json(readTopo()));

// zodat de webapp-UI het Testdata-tabblad alleen toont als de bijbehorende endpoints ook echt werken
app.get('/api/test-mode', async (req, res) => res.json({ testMode: await isTestMode() }));

// ---------- positie bijwerken (kalibratiemodus) ----------
app.post('/api/topology/positie', (req, res) => {
  const { id, x_pct, y_pct } = req.body || {};
  if (!id || x_pct == null || y_pct == null) return res.status(400).json({ error: 'id, x_pct en y_pct zijn verplicht' });
  const data = readTopo();
  const node = data.generators.find(n => n.id === id) || data.kasten.find(n => n.id === id);
  if (!node) return res.status(404).json({ error: 'onbekende id: ' + id });
  node.positie = { x_pct, y_pct };
  writeTopo(data);
  res.json({ ok: true, node });
});

// ---------- generators beheren ----------
// een generator-node is normaal gesproken één aggregaat ('generator') of accu ('batterij'), maar kan ook
// een 'groep' zijn: één logische krachtbron die intern uit meerdere generators/accu's bestaat (bijv. een
// centrale met 6 aggregaten + een CAT-batterijcontainer die onderling load-sharen of elkaar back-uppen met
// automatische start). Kasten koppelen dan aan de groep zelf, niet aan een los lid — precies zoals het er
// in het veld ook uitziet (één aansluitpunt, intern beheerd). De leden zijn puur beschrijvend (naam/kVA/type)
// en geen eigen topologie-nodes: ze worden niet los gemonitord of geplaatst.
const GEN_TYPES = ['generator', 'batterij', 'groep'];
const GROEP_SOORTEN = ['parallel', 'backup', 'hybride'];

function valideerLeden(leden) {
  if (!Array.isArray(leden)) return null;
  for (const lid of leden) {
    if (!lid || typeof lid.naam !== 'string' || !lid.naam.trim()) return 'elk lid heeft een naam nodig';
    if (lid.vermogen_kva !== undefined && lid.vermogen_kva !== null && isNaN(Number(lid.vermogen_kva))) return 'ongeldig vermogen_kva bij lid ' + lid.naam;
    if (lid.type && !['generator', 'batterij'].includes(lid.type)) return 'ongeldig type bij lid ' + lid.naam;
  }
  return null;
}
function normaliseerLeden(leden) {
  return leden.map(l => ({ naam: l.naam.trim(), vermogen_kva: l.vermogen_kva != null ? Number(l.vermogen_kva) : null, type: l.type === 'batterij' ? 'batterij' : 'generator' }));
}

app.post('/api/generators', (req, res) => {
  const { naam, vermogen_kva, type, rating_a } = req.body || {};
  if (!naam || !vermogen_kva) return res.status(400).json({ error: 'naam en vermogen_kva zijn verplicht' });
  if (type !== undefined && !GEN_TYPES.includes(type)) return res.status(400).json({ error: 'ongeldig type' });
  const data = readTopo();
  const alleIds = [...data.generators.map(g => g.id), ...data.kasten.map(k => k.id)];
  const id = uniekeId(slugify(naam), alleIds);
  const gen = {
    id, naam, vermogen_kva: Number(vermogen_kva), positie: { x_pct: null, y_pct: null },
    type: type || 'generator', groep_soort: null, leden: [],
    // niet elke generator is uit te lezen (sommige krijgen alsnog een Shelly met CT-klem erbij,
    // andere (nog) niet) — rating_a is dus, anders dan bij een kast, optioneel; zonder rating_a
    // kan er geen belastingspercentage/status berekend worden, ook al komt er wel meetdata binnen.
    // topic is zelfreferentieel (fest/<id>/<id>/status/em:0): een generator is voor de meetpijplijn
    // gewoon zijn eigen "kast", geen apart telegraf/InfluxDB-schema nodig.
    rating_a: rating_a ? Number(rating_a) : null,
  };
  data.generators.push(gen);
  writeTopo(data);
  res.json({ ok: true, generator: gen });
});

app.put('/api/generators/:id', (req, res) => {
  const data = readTopo();
  const gen = data.generators.find(g => g.id === req.params.id);
  if (!gen) return res.status(404).json({ error: 'generator niet gevonden' });
  const { naam, vermogen_kva, type, groep_soort, leden, rating_a } = req.body || {};
  if (naam) gen.naam = naam;
  if (vermogen_kva) gen.vermogen_kva = Number(vermogen_kva);
  if (rating_a !== undefined) gen.rating_a = rating_a === '' || rating_a === null ? null : Number(rating_a);
  // oudere generators (aangemaakt vóór dit veld bestond, bijv. via een testtopologie-JSON) missen
  // groep_soort/leden nog helemaal — die ontbreken dus niet alleen wanneer je van 'groep' wég schakelt,
  // ook de eerste keer dat je ze juist ÍN 'groep' zet moeten ze een geldige (lege) startwaarde krijgen
  if (!Array.isArray(gen.leden)) gen.leden = [];
  if (gen.groep_soort === undefined) gen.groep_soort = null;
  if (type !== undefined) {
    if (!GEN_TYPES.includes(type)) return res.status(400).json({ error: 'ongeldig type' });
    gen.type = type;
    if (type !== 'groep') { gen.groep_soort = null; gen.leden = []; }
  }
  if (groep_soort !== undefined) {
    if (groep_soort && !GROEP_SOORTEN.includes(groep_soort)) return res.status(400).json({ error: 'ongeldig groep_soort' });
    gen.groep_soort = groep_soort || null;
  }
  if (leden !== undefined) {
    const fout = valideerLeden(leden);
    if (fout) return res.status(400).json({ error: fout });
    gen.leden = normaliseerLeden(leden);
  }
  writeTopo(data);
  res.json({ ok: true, generator: gen });
});

app.delete('/api/generators/:id', (req, res) => {
  const data = readTopo();
  const gekoppeld = data.kasten.filter(k => k.generator === req.params.id);
  if (gekoppeld.length) return res.status(400).json({ error: gekoppeld.length + ' kast(en) hangen nog aan deze generator; verwijder of verplaats die eerst' });
  const voor = data.generators.length;
  data.generators = data.generators.filter(g => g.id !== req.params.id);
  if (data.generators.length === voor) return res.status(404).json({ error: 'generator niet gevonden' });
  writeTopo(data);
  res.json({ ok: true });
});

// ---------- kasten beheren ----------
// een kast is normaal een verdeelkast, maar kan ook een batterij/piekscheerder zijn die tussen een
// generator(groep) en de eronder hangende kasten in zit (parent/child werkt al precies zo). Bij overbelasting
// bypassen sommige van dit soort systemen (bijv. CAT Zeppelin) zichzelf en gaat het vermogen rechtstreeks
// door naar het afgaande veld — dat kan de app niet live detecteren (geen telemetrie daarvoor), maar wel
// als vaste eigenschap vastleggen zodat het zichtbaar is voor wie de topologie beheert.
const KAST_TYPES = ['kast', 'batterij'];

app.post('/api/kasten', (req, res) => {
  const { naam, rating_a, generator, parent, afkorting, type, heeft_bypass } = req.body || {};
  if (!naam || !rating_a || !generator) return res.status(400).json({ error: 'naam, rating_a en generator zijn verplicht' });
  if (type !== undefined && !KAST_TYPES.includes(type)) return res.status(400).json({ error: 'ongeldig type' });
  const data = readTopo();
  if (!data.generators.find(g => g.id === generator)) return res.status(400).json({ error: 'onbekende generator: ' + generator });
  if (parent) {
    const p = data.kasten.find(k => k.id === parent);
    if (!p) return res.status(400).json({ error: 'onbekende parent: ' + parent });
    if (p.generator !== generator) return res.status(400).json({ error: 'parent moet aan dezelfde generator hangen' });
  }
  const alleIds = [...data.generators.map(g => g.id), ...data.kasten.map(k => k.id)];
  const id = uniekeId(slugify(naam), alleIds);
  const kast = {
    id, naam, rating_a: Number(rating_a), generator, parent: parent || null,
    afkorting: afkorting || undefined, shelly_ip: null,
    type: type || 'kast', heeft_bypass: (type === 'batterij') && !!heeft_bypass,
    mqtt_topic_prefix: mqttPrefix(generator, id),
    positie: { x_pct: null, y_pct: null },
  };
  data.kasten.push(kast);
  writeTopo(data);
  res.json({ ok: true, kast });
});

app.put('/api/kasten/:id', (req, res) => {
  const data = readTopo();
  const kast = data.kasten.find(k => k.id === req.params.id);
  if (!kast) return res.status(404).json({ error: 'kast niet gevonden' });
  const { naam, rating_a, generator, parent, afkorting, type, heeft_bypass } = req.body || {};

  const nieuweGenerator = generator || kast.generator;
  if (generator && !data.generators.find(g => g.id === generator)) return res.status(400).json({ error: 'onbekende generator: ' + generator });

  let nieuweParent = parent === undefined ? kast.parent : (parent || null);
  if (nieuweParent) {
    const p = data.kasten.find(k => k.id === nieuweParent);
    if (!p) return res.status(400).json({ error: 'onbekende parent: ' + nieuweParent });
    if (p.generator !== nieuweGenerator) return res.status(400).json({ error: 'parent moet aan dezelfde generator hangen' });
    if (maaktCyclus(data, kast.id, nieuweParent)) return res.status(400).json({ error: 'deze koppeling zou een lus/cyclus in de stroomketen maken' });
  }

  if (naam) kast.naam = naam;
  if (rating_a) kast.rating_a = Number(rating_a);
  if (afkorting !== undefined) kast.afkorting = afkorting || undefined;
  if (type !== undefined) {
    if (!KAST_TYPES.includes(type)) return res.status(400).json({ error: 'ongeldig type' });
    kast.type = type;
    if (type !== 'batterij') kast.heeft_bypass = false;
  }
  if (heeft_bypass !== undefined) kast.heeft_bypass = (kast.type === 'batterij') && !!heeft_bypass;
  kast.generator = nieuweGenerator;
  kast.parent = nieuweParent;
  kast.mqtt_topic_prefix = mqttPrefix(kast.generator, kast.id);

  writeTopo(data);
  res.json({ ok: true, kast });
});

app.delete('/api/kasten/:id', (req, res) => {
  const data = readTopo();
  const kast = data.kasten.find(k => k.id === req.params.id);
  if (!kast) return res.status(404).json({ error: 'kast niet gevonden' });
  // kinderen van deze kast koppelen we door naar de parent van de verwijderde kast,
  // zodat de stroomketen intact blijft (net zoals je in het echt een kast zou overslaan)
  data.kasten.forEach(k => { if (k.parent === kast.id) k.parent = kast.parent; });
  data.kasten = data.kasten.filter(k => k.id !== req.params.id);
  writeTopo(data);
  res.json({ ok: true });
});

// ---------- alles wissen ----------
app.post('/api/reset', (req, res) => {
  writeTopo({ generators: [], kasten: [], toelichting: readTopo().toelichting });
  res.json({ ok: true });
});

// ---------- testtopologie laden ----------
// Bedoeld om de werking te demonstreren tijdens de testfase. Alleen bereikbaar als de stack met
// --profile test gestart is (zie isTestMode() hierboven), zodat 'm niet per ongeluk tijdens een
// echt evenement gebruikt kan worden.
// "simpel": 2 generators, 6 kasten, 3 niveaus — voor een snelle demo.
// "uitgebreid": 5 generators, 80 kasten, tot 10 niveaus diep per generator — stresstest voor de UI (lijst, schema,
// plattegrond, Sankey), Telegraf/InfluxDB-doorvoer en de simulator onder een realistische belasting.

// zet meteen bruikbare posities op de plattegrond, zodat je na het laden van een testtopologie niet
// eerst 80 kasten met de hand hoeft te slepen: groepen/generators/batterijen komen links onder elkaar
// te staan, en elke stroomketen loopt vandaar in een rechte lijn naar rechts — bij een vertakking
// waaieren de takken symmetrisch uit rond de ouder (en lopen zelf weer recht door), zodat je de lijnen
// goed kunt volgen zonder dat het overvol wordt.
function autoPositioneerTestTopologie(data) {
  const X_START = 6, X_STEP = 8, Y_STEP = 3;
  const round1 = (n) => Math.round(n * 10) / 10;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  // vaste, behapbare afstand tussen generators i.p.v. ze altijd over het hele werkgebied (8%-88%)
  // uit te smeren — bij bijv. maar 2 generators stonden ze anders in de uiterste hoeken, zo ver uit
  // elkaar dat je moest inzoomen om ze allebei tegelijk te zien. Bij veel generators (die niet allemaal
  // met deze afstand zouden passen) krimpt de afstand juist in, zodat het binnen het werkgebied blijft.
  // Begint bovendien bovenin (i.p.v. verticaal gecentreerd): het canvas is groot genoeg voor de
  // uitgebreide stresstest-topologie, maar percentages daarvan gecentreerd rond 50% vallen voor een
  // kleine topologie alsnog ver buiten het zichtbare gebied bij 100% zoom zonder te scrollen.
  const n = data.generators.length;
  const IDEAAL_GEN_GAP = 18, MAX_SPREAD = 80, GEN_START_Y = 8;
  const genGap = n > 1 ? Math.min(IDEAAL_GEN_GAP, MAX_SPREAD / (n - 1)) : 0;
  data.generators.forEach((g, i) => {
    const y = n > 1 ? GEN_START_Y + i * genGap : GEN_START_Y;
    g.positie = { x_pct: X_START, y_pct: round1(y) };
  });

  function kinderenVan(id, isGenerator) {
    return data.kasten.filter((k) => (isGenerator ? k.generator === id && !k.parent : k.parent === id));
  }

  function plaats(id, isGenerator, x, y) {
    const kinderen = kinderenVan(id, isGenerator);
    if (!kinderen.length) return;
    const spread = (kinderen.length - 1) * Y_STEP;
    const startY = y - spread / 2;
    kinderen.forEach((kind, i) => {
      const kindY = kinderen.length === 1 ? y : startY + i * Y_STEP;
      const kindX = x + X_STEP;
      kind.positie = { x_pct: round1(clamp(kindX, 0, 100)), y_pct: round1(clamp(kindY, 2, 98)) };
      plaats(kind.id, false, kindX, kindY);
    });
  }

  data.generators.forEach((g) => plaats(g.id, true, g.positie.x_pct, g.positie.y_pct));
}

app.post('/api/topology/test-data/simpel', alleenInTestmodus, (req, res) => {
  const test = JSON.parse(fs.readFileSync(TEST_TOPO_SIMPEL, 'utf8'));
  autoPositioneerTestTopologie(test);
  writeTopo(test);
  res.json({ ok: true });
});
app.post('/api/topology/test-data/uitgebreid', alleenInTestmodus, (req, res) => {
  const test = JSON.parse(fs.readFileSync(TEST_TOPO_UITGEBREID, 'utf8'));
  autoPositioneerTestTopologie(test);
  writeTopo(test);
  res.json({ ok: true });
});

// ---------- simulator aan/uit ----------
// De simulator-container draait continu (zolang die met --profile test gestart is), maar
// publiceert alleen fake meetdata zolang dit hier op "aan" staat (hij polt dit endpoint). Zo is
// de simulator vanuit de webapp te starten/stoppen zonder dat de webapp de container zelf hoeft
// te beheren. /status blijft ongeguard (alleen-lezen, nodig voor de simulator-container zelf, en
// sowieso onschadelijk als de simulator niet eens draait); start/stop zijn wél testmodus-only.
app.get('/api/simulator/status', (req, res) => res.json({ enabled: simulatorEnabled }));
app.post('/api/simulator/start', alleenInTestmodus, (req, res) => { simulatorEnabled = true; res.json({ ok: true, enabled: true }); });
app.post('/api/simulator/stop', alleenInTestmodus, (req, res) => { simulatorEnabled = false; res.json({ ok: true, enabled: false }); });

// ---------- simulatie-meetdata wissen ----------
// Wist alleen de meetdata (stroom/spanning/vermogen) uit InfluxDB — niet de topologie, en dus
// ook niet de 'topology_edges'-reeks die de webapp bijhoudt voor Grafana (zie syncTopologyToInflux
// hierboven), vandaar de predicate. Handig om na een korte test met een schone lei te beginnen.
// Hoort, net als de simulator en de testtopologie-knop hierboven, alleen tijdens de testfase
// beschikbaar te zijn.
app.post('/api/metingen/reset', alleenInTestmodus, async (req, res) => {
  if (!INFLUX_TOKEN) return res.status(500).json({ error: 'INFLUX_TOKEN niet geconfigureerd op de webapp-service' });
  try {
    const url = INFLUX_URL + '/api/v2/delete?org=' + encodeURIComponent(INFLUX_ORG) + '&bucket=' + encodeURIComponent(INFLUX_BUCKET);
    // InfluxDB's delete-predicate ondersteunt geen "or", dus twee losse calls (één per measurement)
    for (const measurement of ['shelly_em', 'shelly_emdata']) {
      const influxRes = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Token ' + INFLUX_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: '1970-01-01T00:00:00Z',
          stop: new Date(Date.now() + 1000).toISOString(),
          predicate: '_measurement="' + measurement + '"',
        }),
      });
      if (!influxRes.ok) {
        const text = await influxRes.text();
        return res.status(502).json({ error: 'InfluxDB gaf een fout (' + influxRes.status + '): ' + text });
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: 'kon InfluxDB niet bereiken: ' + e.message });
  }
});

// ---------- afbeeldingsuploads (plattegrond, logo): alleen .png/.bmp/.svg ----------
// De bestandsnaam-extensie en de Content-Type die de browser meestuurt zijn allebei door de
// client te vervalsen, dus die tellen alleen als eerste, snelle filter. De echte controle is
// het herkennen van het bestandstype aan de daadwerkelijke bytes na de upload.
const AFBEELDING_EXT = new Set(['.png', '.bmp', '.svg']);
const AFBEELDING_MIME = new Set(['image/png', 'image/bmp', 'image/x-ms-bmp', 'image/svg+xml']);
const AFBEELDING_EXT_BY_TYPE = { png: '.png', bmp: '.bmp', svg: '.svg' };

function afbeeldingFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!AFBEELDING_EXT.has(ext) || !AFBEELDING_MIME.has(file.mimetype)) {
    return cb(new Error('alleen .png, .bmp of .svg bestanden zijn toegestaan'));
  }
  cb(null, true);
}

function detecteerAfbeeldingType(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'bmp';
  const head = buffer.slice(0, 1024).toString('utf8');
  if (/<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

function bestaandAfbeeldingsbestand(basename) {
  for (const ext of Object.values(AFBEELDING_EXT_BY_TYPE)) {
    const p = basename + ext;
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function verwijderAfbeeldingsbestanden(basename) {
  for (const ext of Object.values(AFBEELDING_EXT_BY_TYPE)) {
    const p = basename + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function verwerkAfbeeldingUpload(req, res, basename) {
  const buffer = fs.readFileSync(req.file.path);
  const type = detecteerAfbeeldingType(buffer);
  if (!type) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'bestand is geen geldige .png, .bmp of .svg afbeelding' });
  }
  verwijderAfbeeldingsbestanden(basename);
  fs.renameSync(req.file.path, basename + AFBEELDING_EXT_BY_TYPE[type]);
  res.json({ ok: true });
}

const upload = multer({ dest: DATA_DIR, limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: afbeeldingFileFilter });
// multer geeft een fileFilter-afwijzing door aan de Express-errorhandler; die hier meteen
// als nette 400 afvangen voorkomt dat de upload eindigt in een generieke 500.
function metUploadFoutafhandeling(middleware) {
  return (req, res, next) => middleware(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

// ---------- plattegrond ----------
app.post('/api/map', metUploadFoutafhandeling(upload.single('kaart')), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'geen bestand ontvangen (veldnaam moet "kaart" zijn)' });
  verwerkAfbeeldingUpload(req, res, MAP_BASENAME);
});
app.get('/api/map', (req, res) => {
  const bestand = bestaandAfbeeldingsbestand(MAP_BASENAME);
  if (!bestand) return res.status(404).send('nog geen plattegrond geupload');
  res.sendFile(bestand);
});

// ---------- evenementlogo ----------
app.post('/api/logo', metUploadFoutafhandeling(upload.single('logo')), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'geen bestand ontvangen (veldnaam moet "logo" zijn)' });
  verwerkAfbeeldingUpload(req, res, LOGO_BASENAME);
});
app.get('/api/logo', (req, res) => {
  const bestand = bestaandAfbeeldingsbestand(LOGO_BASENAME);
  if (!bestand) return res.status(404).send('nog geen logo geupload');
  res.sendFile(bestand);
});

// ---------- export / import ----------
app.get('/api/export', (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="stroomtopologie_export.json"');
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(readTopo(), null, 2));
});
app.post('/api/import', (req, res) => {
  const data = req.body;
  if (!data || !data.kasten || !data.generators) return res.status(400).json({ error: 'ongeldig topologie-bestand' });
  writeTopo(data);
  res.json({ ok: true });
});

// ---------- rapport exporteren (PDF) ----------
const GRAFANA_URL = process.env.GRAFANA_URL || 'http://grafana:3000';
const GRAFANA_DASHBOARD_UID = process.env.GRAFANA_DASHBOARD_UID || 'stroomdashboard-overzicht';
const GRAFANA_REPORT_TOKEN = process.env.GRAFANA_REPORT_TOKEN;
const RAPPORT_DIR = path.join(DATA_DIR, 'rapporten');
if (!fs.existsSync(RAPPORT_DIR)) fs.mkdirSync(RAPPORT_DIR, { recursive: true });

// paneel-id's in grafana/dashboards/stroomdashboard.json, per aanvinkbaar rapportonderdeel —
// "alarmen" heeft geen paneel (nog geen alert-geschiedenis, zie event_dashboard.md-roadmap),
// die sectie wordt in de PDF zelf als losse placeholder-pagina toegevoegd i.p.v. via Grafana
const RAPPORT_PANEL_IDS = { generatorTotalen: 8, kastPerFase: 4, sankey: 6 };
const RAPPORT_PANEL_AFMETING = {
  generatorTotalen: { width: 1400, height: 260 },
  kastPerFase: { width: 1400, height: 650 },
  sankey: { width: 1400, height: 750 },
};

// module-scoped, niet-persistent — zelfde conventie als simulatorEnabled hierboven: één
// generatie tegelijk, status verdwijnt bij een herstart (er is dan toch geen lopende job meer)
let rapportJob = {
  status: 'idle', // 'idle' | 'bezig' | 'klaar' | 'fout'
  editie: null, van: null, tot: null, onderdelen: null,
  gestartOp: null, klaarOp: null,
  bestandsnaam: null, bestandsgrootte: null, foutmelding: null,
};

async function influxQuery(flux) {
  const res = await fetch(INFLUX_URL + '/api/v2/query?org=' + encodeURIComponent(INFLUX_ORG), {
    method: 'POST',
    headers: { Authorization: 'Token ' + INFLUX_TOKEN, 'Content-Type': 'application/vnd.flux', Accept: 'application/csv' },
    body: flux,
  });
  if (!res.ok) throw new Error('InfluxDB-query gaf ' + res.status + ': ' + (await res.text()));
  return res.text();
}

// bewust geen generieke CSV-parser: leest alleen de ene kolom die de twee queries hieronder
// nodig hebben, en faalt duidelijk (lege lijst) bij iets onverwachts i.p.v. te gokken
function csvKolomWaarden(csv, kolom) {
  // InfluxDB's CSV-respons gebruikt \r\n-regeleindes; zonder normaliseren blijft dat \r aan de
  // laatste kolomnaam/waarde van elke regel hangen (bijv. "_value\r"), waardoor indexOf(kolom)
  // nooit matcht en dit altijd een lege lijst teruggeeft
  const regels = csv.replace(/\r\n/g, '\n').trim().split('\n').filter((r) => r.trim());
  if (!regels.length) return [];
  const header = regels[0].split(',');
  const idx = header.indexOf(kolom);
  if (idx === -1) return [];
  return regels.slice(1).map((r) => r.split(',')[idx]).filter((v) => v !== undefined && v !== '');
}

// alleen simpele, veilige tekens toegestaan in een editie-waarde die in een Flux-querystring
// terechtkomt (voorkomt Flux-injectie via de query-param) — matcht hoe edities er in de praktijk
// uitzien (jaartallen/korte namen, zie EVENT_EDITION in .env.example)
function veiligeEditie(editie) {
  if (!editie || !/^[a-zA-Z0-9_-]+$/.test(editie)) return null;
  return editie;
}

app.get('/api/rapport/edities', async (req, res) => {
  try {
    const csv = await influxQuery('import "influxdata/influxdb/schema"\nschema.tagValues(bucket: "' + INFLUX_BUCKET + '", tag: "editie")');
    res.json({ edities: csvKolomWaarden(csv, '_value') });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/rapport/periode', async (req, res) => {
  const editie = req.query.editie === '__alle__' ? null : veiligeEditie(req.query.editie);
  if (req.query.editie && req.query.editie !== '__alle__' && !editie) return res.status(400).json({ error: 'ongeldige editie' });
  const filter = editie ? '|> filter(fn: (r) => r.editie == "' + editie + '")' : '';
  const basis =
    'from(bucket: "' + INFLUX_BUCKET + '")\n' +
    '  |> range(start: -10y)\n' +
    '  |> filter(fn: (r) => r._measurement == "shelly_em")\n' +
    '  ' + filter + '\n' +
    '  |> group()\n';
  try {
    const [csvVan, csvTot] = await Promise.all([
      influxQuery(basis + '  |> min(column: "_time")\n  |> keep(columns: ["_time"])\n  |> limit(n: 1)'),
      influxQuery(basis + '  |> max(column: "_time")\n  |> keep(columns: ["_time"])\n  |> limit(n: 1)'),
    ]);
    res.json({ van: csvKolomWaarden(csvVan, '_time')[0] || null, tot: csvKolomWaarden(csvTot, '_time')[0] || null });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// haalt één paneel als PDF op bij Grafana's eigen /render-endpoint (via grafana-image-renderer) —
// ondanks een misleidende "image/png"-Content-Type-header staat er een echte PDF in de body
// (geverifieerd op byte-niveau tijdens implementatie, zie specs/rapport-pdf-export-spec.md)
async function haalPaneelPdfOp(panelId, { van, tot, editie, breedte, hoogte }) {
  const params = new URLSearchParams({
    panelId: String(panelId),
    width: String(breedte),
    height: String(hoogte),
    from: String(new Date(van).getTime()),
    to: String(new Date(tot).getTime()),
  });
  if (editie) params.set('var-editie', editie);
  const url = GRAFANA_URL + '/render/d-solo/' + GRAFANA_DASHBOARD_UID + '/_?' + params.toString();
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer ' + GRAFANA_REPORT_TOKEN },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error('Grafana-render gaf ' + res.status + ' voor paneel ' + panelId);
  const buf = Buffer.from(await res.arrayBuffer());
  // de Content-Type-header van dit endpoint claimt altijd "image/png", ook als de body écht een
  // PDF is (geverifieerd tijdens implementatie) — dus alleen op de daadwerkelijke magic bytes
  // afgaan. Bij bijv. een ongeldig token rendert Grafana intern een foutpagina die keurig als
  // 200 OK terugkomt maar geen PDF is; zonder deze check krijg je hier een cryptische
  // pdf-lib-parsefout in plaats van een begrijpelijke melding.
  if (buf.length < 4 || buf.toString('ascii', 0, 4) !== '%PDF') {
    throw new Error('Grafana gaf geen geldige PDF terug voor paneel ' + panelId + ' (controleer GRAFANA_REPORT_TOKEN)');
  }
  return buf;
}

async function voegPlaceholderPaginaToe(pdf, tekst) {
  const pagina = pdf.addPage([842, 595]); // A4 liggend, past bij de rest van het rapport
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pagina.drawText(tekst, { x: 50, y: 545, size: 14, font, color: rgb(0.2, 0.2, 0.2), maxWidth: 740 });
}

async function voerRapportGeneratieUit(job) {
  const { editie, van, tot, onderdelen } = job;
  const editieVar = editie === '__alle__' ? null : editie;
  const dest = await PDFDocument.create();

  for (const key of ['generatorTotalen', 'kastPerFase', 'sankey']) {
    if (!onderdelen[key]) continue;
    const afmeting = RAPPORT_PANEL_AFMETING[key];
    const buf = await haalPaneelPdfOp(RAPPORT_PANEL_IDS[key], { van, tot, editie: editieVar, ...afmeting });
    const bron = await PDFDocument.load(buf);
    const paginas = await dest.copyPages(bron, bron.getPageIndices());
    paginas.forEach((p) => dest.addPage(p));
  }

  if (onderdelen.alarmen) {
    await voegPlaceholderPaginaToe(
      dest,
      'Overschrijdingen & alarmen: nog geen alert-geschiedenis beschikbaar voor deze periode ' +
        '(notificatiekanaal staat nog op de roadmap, zie event_dashboard.md).'
    );
  }

  if (dest.getPageCount() === 0) {
    await voegPlaceholderPaginaToe(dest, 'Geen rapportonderdelen geselecteerd.');
  }

  const bytes = await dest.save();
  const bestandsnaam = 'rapport_stroomdashboard_' + editie + '.pdf';
  fs.writeFileSync(path.join(RAPPORT_DIR, bestandsnaam), bytes);

  rapportJob = {
    ...rapportJob,
    status: 'klaar',
    klaarOp: new Date().toISOString(),
    bestandsnaam,
    bestandsgrootte: bytes.length,
  };
}

app.post('/api/rapport/genereer', (req, res) => {
  if (!GRAFANA_REPORT_TOKEN) return res.status(400).json({ error: 'GRAFANA_REPORT_TOKEN is niet ingesteld (zie .env.example)' });
  if (rapportJob.status === 'bezig') return res.status(409).json({ error: 'er loopt al een rapportgeneratie' });
  const { editie, van, tot, onderdelen } = req.body || {};
  if (!editie || !van || !tot || !onderdelen) return res.status(400).json({ error: 'editie, van, tot en onderdelen zijn verplicht' });
  if (editie !== '__alle__' && !veiligeEditie(editie)) return res.status(400).json({ error: 'ongeldige editie' });

  rapportJob = {
    status: 'bezig', editie, van, tot, onderdelen,
    gestartOp: new Date().toISOString(), klaarOp: null,
    bestandsnaam: null, bestandsgrootte: null, foutmelding: null,
  };
  res.json({ ok: true });

  voerRapportGeneratieUit(rapportJob).catch((e) => {
    rapportJob = { ...rapportJob, status: 'fout', foutmelding: e.message };
    console.error('rapportgeneratie mislukt:', e.message);
  });
});

app.get('/api/rapport/status', (req, res) => res.json(rapportJob));

app.get('/api/rapport/download', (req, res) => {
  if (rapportJob.status !== 'klaar' || !rapportJob.bestandsnaam) return res.status(404).json({ error: 'geen rapport beschikbaar' });
  res.download(path.join(RAPPORT_DIR, rapportJob.bestandsnaam), rapportJob.bestandsnaam);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Stroomdashboard luistert op poort ' + PORT));
