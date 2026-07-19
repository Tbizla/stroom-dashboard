const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const dns = require('dns');

const DATA_DIR = process.env.DATA_DIR || '/data';
const TOPO_FILE = path.join(DATA_DIR, 'topologie.json');
const MAP_FILE = path.join(DATA_DIR, 'kaart.png');
const LOGO_FILE = path.join(DATA_DIR, 'logo.png');
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
// (MQTT-prefix) hoeft te veranderen. Best effort: als InfluxDB niet bereikbaar is, faalt de
// topologie-opslag zelf niet mee.
async function syncTopologyToInflux(data) {
  if (!INFLUX_TOKEN || !data.kasten.length) return;
  const lines = data.kasten.map((k) => {
    const parent = k.parent || k.generator;
    return 'topology_edges,kast=' + k.id + ',parent=' + parent + ',generator=' + k.generator + ' value=1';
  });
  const url = INFLUX_URL + '/api/v2/write?org=' + encodeURIComponent(INFLUX_ORG) + '&bucket=' + encodeURIComponent(INFLUX_BUCKET) + '&precision=s';
  const res = await fetch(url, {
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
  const { naam, vermogen_kva, type } = req.body || {};
  if (!naam || !vermogen_kva) return res.status(400).json({ error: 'naam en vermogen_kva zijn verplicht' });
  if (type !== undefined && !GEN_TYPES.includes(type)) return res.status(400).json({ error: 'ongeldig type' });
  const data = readTopo();
  const alleIds = [...data.generators.map(g => g.id), ...data.kasten.map(k => k.id)];
  const id = uniekeId(slugify(naam), alleIds);
  const gen = {
    id, naam, vermogen_kva: Number(vermogen_kva), positie: { x_pct: null, y_pct: null },
    type: type || 'generator', groep_soort: null, leden: []
  };
  data.generators.push(gen);
  writeTopo(data);
  res.json({ ok: true, generator: gen });
});

app.put('/api/generators/:id', (req, res) => {
  const data = readTopo();
  const gen = data.generators.find(g => g.id === req.params.id);
  if (!gen) return res.status(404).json({ error: 'generator niet gevonden' });
  const { naam, vermogen_kva, type, groep_soort, leden } = req.body || {};
  if (naam) gen.naam = naam;
  if (vermogen_kva) gen.vermogen_kva = Number(vermogen_kva);
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

  const n = data.generators.length;
  data.generators.forEach((g, i) => {
    const y = n > 1 ? 12 + i * (76 / (n - 1)) : 50;
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

// ---------- plattegrond ----------
const upload = multer({ dest: DATA_DIR, limits: { fileSize: 25 * 1024 * 1024 } });
app.post('/api/map', upload.single('kaart'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'geen bestand ontvangen (veldnaam moet "kaart" zijn)' });
  fs.renameSync(req.file.path, MAP_FILE);
  res.json({ ok: true });
});
app.get('/api/map', (req, res) => {
  if (!fs.existsSync(MAP_FILE)) return res.status(404).send('nog geen plattegrond geupload');
  res.sendFile(MAP_FILE);
});

// ---------- evenementlogo ----------
app.post('/api/logo', upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'geen bestand ontvangen (veldnaam moet "logo" zijn)' });
  fs.renameSync(req.file.path, LOGO_FILE);
  res.json({ ok: true });
});
app.get('/api/logo', (req, res) => {
  if (!fs.existsSync(LOGO_FILE)) return res.status(404).send('nog geen logo geupload');
  res.sendFile(LOGO_FILE);
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Stroomdashboard luistert op poort ' + PORT));
