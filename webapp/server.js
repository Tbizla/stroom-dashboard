const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const archiver = require('archiver');
const AdmZip = require('adm-zip');

const DATA_DIR = process.env.DATA_DIR || '/data';
const TOPO_FILE = path.join(DATA_DIR, 'topologie.json');
const INSTELLINGEN_FILE = path.join(DATA_DIR, 'instellingen.json');
const MAP_BASENAME = path.join(DATA_DIR, 'kaart');
const LOGO_BASENAME = path.join(DATA_DIR, 'logo');
const DEFAULT_TOPO = path.join(__dirname, 'default_topologie.json');
const TEST_TOPO_SIMPEL = path.join(__dirname, 'test_topologie_simpel.json');
const TEST_TOPO_UITGEBREID = path.join(__dirname, 'test_topologie_uitgebreid.json');

const INFLUX_URL = process.env.INFLUX_URL || 'http://influxdb:8086';
const INFLUX_TOKEN = process.env.INFLUX_TOKEN;
const INFLUX_ORG = process.env.INFLUX_ORG || 'site';
const INFLUX_BUCKET = process.env.INFLUX_BUCKET || 'stroomdata';
// klein, apart servicetje (telegraf-herstarter/) dat de échte /var/run/docker.sock heeft en
// precies één actie aanbiedt: telegraf herstarten met nieuwe EVENT_NAME/EVENT_EDITION-waarden —
// zie specs/single-use-vs-edities-diagnose.md §B1. De webapp zelf heeft nooit Docker-toegang.
const TELEGRAF_HERSTARTER_URL = process.env.TELEGRAF_HERSTARTER_URL;

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
// eerste-opstart-default komt uit de .env-variabelen (zelfde als Telegraf nu al gebruikt); wordt
// hierna uitsluitend via Beheer/`/api/instellingen` beheerd, zie specs/single-use-vs-edities-diagnose.md
if (!fs.existsSync(INSTELLINGEN_FILE)) {
  fs.writeFileSync(INSTELLINGEN_FILE, JSON.stringify({
    event_name: veiligeTagWaarde(process.env.EVENT_NAME),
    event_edition: veiligeTagWaarde(process.env.EVENT_EDITION),
  }, null, 2), 'utf8');
}

// niet-persistent: staat na elke herstart van de webapp weer standaard uit, zodat een
// vergeten aan-gezette simulator nooit per ongeluk blijft doorlopen na een herstart.
let simulatorEnabled = false;

const app = express();
app.use(express.json());
// tijdens actieve ontwikkeling wordt index.html regelmatig aangepast; zonder no-store kan de browser
// een oude versie blijven hergebruiken (ook na een gewone F5) totdat er een harde refresh gebeurt,
// wat verwarrend is bij het testen van fixes
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res) => res.set('Cache-Control', 'no-store') }));

// migreert oudere topologieën waarin generators/leden nog geen `mqtt_topic_prefix` (generators) of
// `id`/`mqtt_topic_prefix` (leden van een groep) hebben — zie specs/generator-em-rework-plan.md §1.
// Draait bij elke read, is een no-op zodra alles al gemigreerd is (geen aparte migratiestap nodig).
function migreerGeneratorsEnLeden(data) {
  let gewijzigd = false;
  data.generators.forEach(gen => {
    if (!gen.mqtt_topic_prefix) { gen.mqtt_topic_prefix = mqttPrefix(gen.id, gen.id); gewijzigd = true; }
    if (gen.type === 'groep' && Array.isArray(gen.leden) && gen.leden.some(l => !l.id || !l.mqtt_topic_prefix)) {
      voorzieLedenVanIdEnPrefix(gen, data);
      gewijzigd = true;
    }
  });
  return gewijzigd;
}
function readTopo() {
  const data = JSON.parse(fs.readFileSync(TOPO_FILE, 'utf8'));
  if (migreerGeneratorsEnLeden(data)) fs.writeFileSync(TOPO_FILE, JSON.stringify(data, null, 2), 'utf8');
  return data;
}
function writeTopo(data) {
  fs.writeFileSync(TOPO_FILE, JSON.stringify(data, null, 2), 'utf8');
  syncTopologyToInflux(data).catch((e) => console.error('kon topologie niet naar InfluxDB syncen:', e.message));
}

// Schrijft de parent/child-structuur (welke kast op welke kast/generator hangt) als losse
// punten naar InfluxDB, zodat Grafana de live vermogensdata kan koppelen aan de actuele
// topologie voor bijv. een multi-level Sankey-diagram — zonder dat er iets aan de Shelly's
// (MQTT-prefix) hoeft te veranderen. Getagd met de huidige editie+evenement (uit instellingen.json,
// zie /api/instellingen) en de delete-predicate is daartoe beperkt — zodat oudere edities/
// evenementen (bijv. teruggezet via het restore-endpoint) niet worden weggegooid bij een
// live Beheer-wijziging van de huidige editie. InfluxDB is append-only en "kast" is een tag, dus
// een kast die ooit bestond (hernoemd/verwijderd/oude testtopologie) blijft anders voor altijd als
// losse reeks staan binnen de huidige editie — vandaar eerst de scoped delete en daarna de actuele
// set opnieuw schrijven, ook na "Alles wissen" (dan blijft er na de delete niets over om te
// herschrijven). Best effort: als InfluxDB niet bereikbaar is, faalt de topologie-opslag zelf niet mee.
async function syncTopologyToInflux(data) {
  if (!INFLUX_TOKEN) return;
  const { event_name, event_edition } = readInstellingen();
  if (!event_name || !event_edition) return; // nog geen (geldige) instellingen: niets te taggen
  const deleteUrl = INFLUX_URL + '/api/v2/delete?org=' + encodeURIComponent(INFLUX_ORG) + '&bucket=' + encodeURIComponent(INFLUX_BUCKET);
  const deleteRes = await fetch(deleteUrl, {
    method: 'POST',
    headers: { Authorization: 'Token ' + INFLUX_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: '1970-01-01T00:00:00Z',
      stop: new Date(Date.now() + 1000).toISOString(),
      predicate: '_measurement="topology_edges" AND editie="' + event_edition + '" AND evenement="' + event_name + '"',
    }),
  });
  if (!deleteRes.ok) throw new Error('InfluxDB delete (topology_edges) gaf ' + deleteRes.status + ': ' + (await deleteRes.text()));
  if (!data.kasten.length) return;
  const lines = data.kasten.map((k) => {
    const parent = k.parent || k.generator;
    return 'topology_edges,kast=' + k.id + ',parent=' + parent + ',generator=' + k.generator +
      ',editie=' + event_edition + ',evenement=' + event_name + ' value=1';
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
function mqttPrefix(generatorId, kastId) { return 'site/' + generatorId + '/' + kastId; }

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

// ---------- instellingen: event_name/event_edition, bewerkbaar vanuit Beheer i.p.v. alleen via
// .env — enige bron van waarheid aan de webapp-kant voor de editie/evenement-tags die
// syncTopologyToInflux() (topology_edges) en het restore-endpoint (collision-check) gebruiken.
// Zie specs/single-use-vs-edities-diagnose.md §A4. ----------
function readInstellingen() { return JSON.parse(fs.readFileSync(INSTELLINGEN_FILE, 'utf8')); }
function writeInstellingen(data) { fs.writeFileSync(INSTELLINGEN_FILE, JSON.stringify(data, null, 2), 'utf8'); }

app.get('/api/instellingen', (req, res) => res.json(readInstellingen()));
app.put('/api/instellingen', (req, res) => {
  const { event_name, event_edition } = req.body || {};
  if (!veiligeTagWaarde(event_name) || !veiligeTagWaarde(event_edition)) {
    return res.status(400).json({ error: 'evenementnaam en editie zijn verplicht en mogen alleen letters, cijfers, "_" of "-" bevatten' });
  }
  writeInstellingen({ event_name, event_edition });
  res.json({ ok: true });
});

// ---------- Telegraf herstarten na een instellingen-wijziging (Deel B, §B1/§B2) ----------
// Telegraf leest EVENT_NAME/EVENT_EDITION als env var, alleen ingelezen bij het *aanmaken* van het
// container (niet bij een kale restart) — dus na een wijziging is een recreate nodig. Die recreate
// (inspect/stop/remove/create/start) gebeurt niet hier maar in het losse telegraf-herstarter-
// servicetje, dat wél de echte Docker-socket heeft; de webapp roept alleen diens ene endpoint aan.
async function herstartTelegrafMetNieuweInstellingen(event_name, event_edition) {
  if (!TELEGRAF_HERSTARTER_URL) throw new Error('TELEGRAF_HERSTARTER_URL is niet ingesteld');
  const res = await fetch(TELEGRAF_HERSTARTER_URL + '/herstart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_name, event_edition }),
  });
  if (!res.ok) throw new Error('telegraf-herstarter gaf ' + res.status + ': ' + (await res.text()));
}

// zelfde conventie als rapportJob/backupJob/herstelJob hierboven/hieronder
let telegrafHerstartJob = { status: 'idle', gestartOp: null, klaarOp: null, foutmelding: null };

app.post('/api/instellingen/telegraf-herstart', (req, res) => {
  if (telegrafHerstartJob.status === 'bezig') return res.status(409).json({ error: 'er loopt al een herstart' });
  const { event_name, event_edition } = readInstellingen();
  if (!event_name || !event_edition) return res.status(400).json({ error: 'sla eerst geldige instellingen op via PUT /api/instellingen' });

  telegrafHerstartJob = { status: 'bezig', gestartOp: new Date().toISOString(), klaarOp: null, foutmelding: null };
  res.json({ ok: true });

  herstartTelegrafMetNieuweInstellingen(event_name, event_edition).then(() => {
    telegrafHerstartJob = { ...telegrafHerstartJob, status: 'klaar', klaarOp: new Date().toISOString() };
  }).catch((e) => {
    telegrafHerstartJob = { ...telegrafHerstartJob, status: 'fout', foutmelding: e.message };
    console.error('telegraf-herstart mislukt:', e.message);
  });
});

app.get('/api/instellingen/telegraf-herstart/status', (req, res) => res.json(telegrafHerstartJob));

// zodat de webapp-UI het Testdata-tabblad alleen toont als de bijbehorende endpoints ook echt werken
app.get('/api/test-mode', async (req, res) => res.json({ testMode: await isTestMode() }));

// ---------- i18n: platte dot-key vertaalbestanden, gedeeld client (fetch) + server (require voor
// het PDF-rapport) — één bron van waarheid, zie specs/rebuild-plan-v2.md §11.2 ----------
const I18N_TALEN = { nl: require('./i18n/nl.json'), en: require('./i18n/en.json') };
app.get('/api/i18n/:taal', (req, res) => {
  const dict = I18N_TALEN[req.params.taal];
  if (!dict) return res.status(404).json({ error: 'onbekende taal' });
  res.json(dict);
});

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
// in het veld ook uitziet (één aansluitpunt, intern beheerd). Een lid heeft naam/kVA/type, en sinds de
// generator-EM-rework (specs/generator-em-rework-plan.md §1) ook een eigen stabiele `id` +
// `mqtt_topic_prefix` (site/<generator_id>/<lid_id>) en optionele `rating_a` — net als bij een generator
// alleen relevant als dat lid ook echt via een eigen Shelly+CT-klem wordt uitgelezen. Leden zijn nog
// steeds geen losse topologie-nodes: ze worden niet los geplaatst op de plattegrond.
const GEN_TYPES = ['generator', 'batterij', 'groep'];
const GROEP_SOORTEN = ['parallel', 'backup', 'hybride'];

function valideerLeden(leden) {
  if (!Array.isArray(leden)) return null;
  for (const lid of leden) {
    if (!lid || typeof lid.naam !== 'string' || !lid.naam.trim()) return 'elk lid heeft een naam nodig';
    if (lid.vermogen_kva !== undefined && lid.vermogen_kva !== null && isNaN(Number(lid.vermogen_kva))) return 'ongeldig vermogen_kva bij lid ' + lid.naam;
    if (lid.type && !['generator', 'batterij'].includes(lid.type)) return 'ongeldig type bij lid ' + lid.naam;
    if (lid.rating_a !== undefined && lid.rating_a !== null && lid.rating_a !== '' && isNaN(Number(lid.rating_a))) return 'ongeldige rating_a bij lid ' + lid.naam;
  }
  return null;
}
// bewaart een reeds bestaand `id` (meegestuurd door de client, zie huidigeLeden() in
// render-beheer.js) zodat een lid zijn MQTT-prefix niet verliest bij een simpele naam/kVA-edit —
// alleen een nieuw lid (zonder id) krijgt er hierna via voorzieLedenVanIdEnPrefix() een toegewezen
function normaliseerLeden(leden) {
  return leden.map(l => {
    const lid = {
      naam: l.naam.trim(),
      vermogen_kva: l.vermogen_kva != null ? Number(l.vermogen_kva) : null,
      type: l.type === 'batterij' ? 'batterij' : 'generator',
      // net als bij een generator: optioneel, alleen gezet als dit lid ook echt een eigen
      // Shelly+CT-klem heeft (zie specs/generator-em-rework-plan.md §2)
      rating_a: (l.rating_a != null && l.rating_a !== '') ? Number(l.rating_a) : null,
    };
    if (l.id) lid.id = l.id;
    return lid;
  });
}
// wijst elk lid zonder `id` een stabiele id + `mqtt_topic_prefix` toe (zelfde patroon als
// mqttPrefix() voor kasten: site/<generator_id>/<lid_id>) — id blijft staan bij volgende edits
// omdat normaliseerLeden() 'm doorgeeft, dus dit is idempotent voor al gemigreerde leden
function voorzieLedenVanIdEnPrefix(gen, data) {
  const alleIds = [...data.generators.map(g => g.id), ...data.kasten.map(k => k.id)];
  data.generators.forEach(g => (g.leden || []).forEach(l => { if (l.id) alleIds.push(l.id); }));
  (gen.leden || []).forEach(lid => {
    if (!lid.id) {
      lid.id = uniekeId(slugify(lid.naam), alleIds);
      alleIds.push(lid.id);
    }
    lid.mqtt_topic_prefix = mqttPrefix(gen.id, lid.id);
  });
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
    // topic is zelfreferentieel (site/<id>/<id>/status/em:0): een generator is voor de meetpijplijn
    // gewoon zijn eigen "kast", geen apart telegraf/InfluxDB-schema nodig.
    rating_a: rating_a ? Number(rating_a) : null,
    mqtt_topic_prefix: mqttPrefix(id, id),
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
    voorzieLedenVanIdEnPrefix(gen, data);
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

// zelfde als influxQuery(), maar zonder de Flux-annotatieregels (#datatype/#group/#default) —
// alleen bruikbaar als de query zelf al is opgezet (pivot(), group()) om precies één tabel met
// een stabiel kolomschema terug te geven, zodat csvNaarLineProtocol() een simpele header + rijen
// kan aannemen i.p.v. een volwaardige multi-tabel-Flux-CSV-parser nodig te hebben. Zie §A3,
// specs/single-use-vs-edities-diagnose.md.
async function influxQueryPlatteCsv(flux) {
  const res = await fetch(INFLUX_URL + '/api/v2/query?org=' + encodeURIComponent(INFLUX_ORG), {
    method: 'POST',
    headers: { Authorization: 'Token ' + INFLUX_TOKEN, 'Content-Type': 'application/json', Accept: 'application/csv' },
    body: JSON.stringify({ query: flux, dialect: { annotations: [], header: true, delimiter: ',' } }),
  });
  if (!res.ok) throw new Error('InfluxDB-query gaf ' + res.status + ': ' + (await res.text()));
  return res.text();
}

// welke kolomnamen van een measurement daadwerkelijk tags zijn (i.p.v. een hardcoded lijst, die
// zou breken zodra Telegraf ooit een tag toevoegt die we niet kennen — bijv. `host`/`topic`, die
// de mqtt_consumer-input er zelf al bij zet naast de tags uit topic_parsing). Ongefilterde
// schema.tagKeys() geeft ook een paar altijd-aanwezige pseudo-kolommen terug die geen echte tag
// zijn, die eruit filteren.
async function haalTagKolommenOp(measurement) {
  const csv = await influxQuery(
    'import "influxdata/influxdb/schema"\n' +
    'schema.tagKeys(bucket: "' + INFLUX_BUCKET + '", predicate: (r) => r._measurement == "' + measurement + '")'
  );
  const geenEchteTag = new Set(['_start', '_stop', '_field', '_measurement']);
  return new Set(csvKolomWaarden(csv, '_value').filter((k) => !geenEchteTag.has(k)));
}

// zet een platte (pivot()+group()) InfluxDB-CSV-respons om naar line-protocol-regels voor
// `meetdata.lp` — de machine-leesbare tegenhanger van `meetdata.csv`, zodat het restore-endpoint
// (§A5) niet zelf een Flux-CSV-parser hoeft te schrijven om teruggeschreven te kunnen worden.
// Kast-/generator-/editie-/evenementwaarden bevatten door veiligeTagWaarde()/uniekeId() nooit
// komma's of spaties, dus een simpele split(',') per regel is hier veilig (zelfde aanname als
// csvKolomWaarden() elders in dit bestand). Numerieke Shelly-velden hebben geen quoting nodig;
// eventuele niet-tag string-kolommen (bijv. Telegraf's eigen `topic`) worden overgeslagen i.p.v.
// als ongequote (en dus ongeldige) line-protocol-string-field weggeschreven.
function csvNaarLineProtocol(csv, measurement, tagKolommen) {
  const regels = csv.replace(/\r\n/g, '\n').trim().split('\n').filter((r) => r.trim());
  if (regels.length < 2) return [];
  const kolommen = regels[0].split(',');
  const tijdIdx = kolommen.indexOf('_time');
  if (tijdIdx === -1) return [];
  return regels.slice(1).map((regel) => {
    const waarden = regel.split(',');
    const tags = [];
    const velden = [];
    kolommen.forEach((kolom, i) => {
      if (kolom === '_time' || kolom === 'result' || kolom === 'table') return;
      const waarde = waarden[i];
      if (waarde === undefined || waarde === '') return;
      if (tagKolommen.has(kolom)) { tags.push(kolom + '=' + waarde); return; }
      if (isNaN(Number(waarde))) return; // niet-numerieke, niet-tag-kolom: negeren i.p.v. ongequote wegschrijven
      velden.push(kolom + '=' + waarde);
    });
    if (!velden.length) return null;
    const ts = Math.floor(new Date(waarden[tijdIdx]).getTime() / 1000);
    return measurement + ',' + tags.join(',') + ' ' + velden.join(',') + ' ' + ts;
  }).filter(Boolean);
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

// alleen simpele, veilige tekens toegestaan in een waarde die in een Flux-querystring óf een
// InfluxDB line-protocol-tag terechtkomt (voorkomt Flux-/line-protocol-injectie) — matcht hoe
// edities/evenementnamen er in de praktijk uitzien (jaartallen/korte namen zonder spaties/komma's,
// zie EVENT_EDITION/EVENT_NAME in .env.example). Gebruikt voor editie, evenement, en de
// instellingen-velden (§A4, specs/single-use-vs-edities-diagnose.md) — allemaal dezelfde soort waarde.
function veiligeTagWaarde(waarde) {
  if (!waarde || !/^[a-zA-Z0-9_-]+$/.test(waarde)) return null;
  return waarde;
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
  const editie = req.query.editie === '__alle__' ? null : veiligeTagWaarde(req.query.editie);
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

// ---------- Overzicht-subtab (Rapportages-tab, roadmap-item 6 / §11.3 optie B): periode-kWh-totalen
// per generator/groep, hergebruikt influxQuery() net als het PDF-rapport hierboven. Zelfde principe
// als het "Totaal energieverbruik $generator"-paneel in Grafana (zie event_dashboard.md sectie
// Grafana-dashboards / README.md sectie 5): alleen de kasten met parent:null bij een generator
// optellen, downstream-kasten NIET meetellen (hun verbruik zit al in de bovenliggende meting) ----------
app.get('/api/overzicht/energie', async (req, res) => {
  const { van, tot } = req.query;
  if (!van || !tot || isNaN(Date.parse(van)) || isNaN(Date.parse(tot))) {
    return res.status(400).json({ error: 'van en tot zijn verplicht en moeten geldige datums zijn' });
  }
  // genormaliseerd naar toISOString(): alleen cijfers/-/:/T/Z, dus veilig om direct in de
  // Flux-querystring te zetten (geen Flux-injectie mogelijk via deze query-params)
  const range = 'range(start: ' + new Date(van).toISOString() + ', stop: ' + new Date(tot).toISOString() + ')';
  const data = readTopo();
  try {
    const resultaten = await Promise.all(data.generators.map(async (g) => {
      const directeKasten = data.kasten.filter((k) => !k.parent && k.generator === g.id);
      if (!directeKasten.length) return [g.id, 0];
      const kastFilter = directeKasten.map((k) => 'r.kast == "' + k.id + '"').join(' or ');
      const flux =
        'from(bucket: "' + INFLUX_BUCKET + '")\n' +
        '  |> ' + range + '\n' +
        '  |> filter(fn: (r) => r._measurement == "shelly_em")\n' +
        '  |> filter(fn: (r) => r._field == "total_act_power")\n' +
        '  |> filter(fn: (r) => ' + kastFilter + ')\n' +
        '  |> group(columns: ["kast"])\n' +
        '  |> integral(unit: 1h)\n' +
        '  |> group()\n' +
        '  |> sum()\n' +
        '  |> keep(columns: ["_value"])';
      const csv = await influxQuery(flux);
      const waarde = parseFloat(csvKolomWaarden(csv, '_value')[0]);
      return [g.id, isNaN(waarde) ? 0 : waarde / 1000];
    }));
    res.json(Object.fromEntries(resultaten));
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

// ---------- PDF-rapport opmaak (Fase E): coverpagina, voettekststrook, herstylede alarmenpagina,
// licht/print-vriendelijk thema i.p.v. het donkere webapp-thema — bewuste afwijking, zie
// specs/mockups/pdf-rapport-mockup.html en de toelichting in pdf-rapport-formatting-review.md.
// De Grafana-paneelpagina's zelf blijven ongewijzigd; alleen een dunne voettekststrook erover via
// pdf-lib na copyPages(). i18n: dezelfde nl.json/en.json als de webapp-UI, taal meegegeven vanuit
// de client (huidige UI-taal op het moment van genereren), niet als aparte instelling.
const RAPPORT_KLEUR = {
  inkt: rgb(0.11, 0.13, 0.15),
  inkt2: rgb(0.36, 0.39, 0.44),
  inkt3: rgb(0.55, 0.58, 0.63),
  lijn: rgb(0.87, 0.89, 0.91),
  papier2: rgb(0.96, 0.96, 0.97),
  accent: rgb(0.055, 0.56, 0.49),
  amberBg: rgb(0.99, 0.91, 0.78),
  amberFg: rgb(0.66, 0.38, 0.04),
};

function rapportTaal(taal) { return I18N_TALEN[taal] || I18N_TALEN.nl; }
function formatteerRapportDatum(iso, taal) {
  return new Date(iso).toLocaleString(taal === 'nl' ? 'nl-NL' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function voegCoverPaginaToe(pdf, { editie, van, tot, onderdelen, taal }) {
  const d = rapportTaal(taal);
  const pagina = pdf.addPage([842, 595]);
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // logo alleen embedden als het een PNG is — pdf-lib kan geen BMP/SVG direct embedden en een
  // conversie-dependency erbij trekken voor dit relatief zeldzame geval is de moeite niet waard
  const logoBestand = bestaandAfbeeldingsbestand(LOGO_BASENAME);
  let logoHoogteOffset = 0;
  if (logoBestand && logoBestand.toLowerCase().endsWith('.png')) {
    try {
      const logoImg = await pdf.embedPng(fs.readFileSync(logoBestand));
      const logoH = 44, logoW = logoImg.width * (logoH / logoImg.height);
      pagina.drawImage(logoImg, { x: 64, y: 595 - 56 - logoH + 8, width: logoW, height: logoH });
      logoHoogteOffset = logoH + 10;
    } catch (e) { /* corrupt of onleesbaar logobestand: rapport gaat door zonder logo op de cover */ }
  }

  let y = 595 - 56 - logoHoogteOffset - 30;
  pagina.drawText(d['rapport.pdfTitel'], { x: 64, y, size: 26, font: fontBold, color: RAPPORT_KLEUR.inkt });

  y -= 28;
  const editieLabel = editie === '__alle__' ? d['rapport.alleEdities'] : editie;
  const metaTekst =
    d['rapport.pdfEditieLabel'] + ' ' + editieLabel + '   ·   ' +
    d['rapport.pdfPeriodeLabel'] + ' ' + formatteerRapportDatum(van, taal) + ' – ' + formatteerRapportDatum(tot, taal) + '   ·   ' +
    d['rapport.pdfGegenereerdLabel'] + ' ' + formatteerRapportDatum(new Date().toISOString(), taal);
  pagina.drawText(metaTekst, { x: 64, y, size: 12, font: fontRegular, color: RAPPORT_KLEUR.inkt2 });

  y -= 30;
  pagina.drawLine({ start: { x: 64, y }, end: { x: 842 - 64, y }, thickness: 1, color: RAPPORT_KLEUR.lijn });
  y -= 28;

  const onderdeelItems = [
    { key: 'generatorTotalen', label: d['rapport.chkGeneratorTotalen'] },
    { key: 'kastPerFase', label: d['rapport.chkKastPerFase'] },
    { key: 'sankey', label: d['rapport.chkSankey'] },
    { key: 'alarmen', label: d['rapport.chkAlarmen'] },
  ];
  let nummer = 1;
  onderdeelItems.forEach((item) => {
    const aangevinkt = !!onderdelen[item.key];
    const nummerTekst = aangevinkt ? String(nummer).padStart(2, '0') : '—';
    pagina.drawText(nummerTekst, { x: 64, y, size: 12, font: fontBold, color: aangevinkt ? RAPPORT_KLEUR.accent : RAPPORT_KLEUR.inkt3 });
    const label = item.label + (aangevinkt ? '' : ' (' + d['rapport.pdfNietAangevinkt'] + ')');
    pagina.drawText(label, { x: 64 + 30, y, size: 12, font: fontRegular, color: aangevinkt ? RAPPORT_KLEUR.inkt : RAPPORT_KLEUR.inkt3 });
    if (aangevinkt) nummer++;
    y -= 24;
  });

  pagina.drawLine({ start: { x: 64, y: 56 }, end: { x: 842 - 64, y: 56 }, thickness: 1, color: RAPPORT_KLEUR.lijn });
  pagina.drawText(d['rapport.pdfFooter'], { x: 64, y: 40, size: 10, font: fontRegular, color: RAPPORT_KLEUR.inkt3 });
}

async function voegAlarmenPaginaToe(pdf, taal) {
  const d = rapportTaal(taal);
  const pagina = pdf.addPage([842, 595]);
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  pagina.drawText(d['rapport.pdfAlarmenTitel'], { x: 64, y: 595 - 56 - 18, size: 18, font: fontBold, color: RAPPORT_KLEUR.inkt });

  const boxX = 64, boxY = 595 - 56 - 18 - 26 - 100, boxW = 842 - 128, boxH = 100;
  pagina.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, color: RAPPORT_KLEUR.papier2, borderColor: RAPPORT_KLEUR.lijn, borderWidth: 1 });
  pagina.drawRectangle({ x: boxX + 20, y: boxY + boxH - 20 - 28, width: 28, height: 28, color: RAPPORT_KLEUR.amberBg });
  pagina.drawText('!', { x: boxX + 20 + 11, y: boxY + boxH - 20 - 20, size: 14, font: fontBold, color: RAPPORT_KLEUR.amberFg });

  const tekstX = boxX + 20 + 28 + 16;
  const regels = splitsTekstInRegels(d['rapport.pdfAlarmenTekst'], fontRegular, 13, boxW - (tekstX - boxX) - 20);
  let tekstY = boxY + boxH - 24;
  regels.forEach((regel) => {
    pagina.drawText(regel, { x: tekstX, y: tekstY, size: 13, font: fontRegular, color: RAPPORT_KLEUR.inkt2 });
    tekstY -= 19;
  });
}

// eenvoudige woord-voor-woord regelafbreking, precies genoeg voor de vaste alarmen-tekst hierboven —
// geen algemene tekst-layout-engine nodig voor dit ene stuk statische copy
function splitsTekstInRegels(tekst, font, size, maxWidth) {
  const woorden = tekst.split(' ');
  const regels = [];
  let huidige = '';
  woorden.forEach((woord) => {
    const kandidaat = huidige ? huidige + ' ' + woord : woord;
    if (font.widthOfTextAtSize(kandidaat, size) > maxWidth && huidige) {
      regels.push(huidige);
      huidige = woord;
    } else {
      huidige = kandidaat;
    }
  });
  if (huidige) regels.push(huidige);
  return regels;
}

async function voegVoettekstToe(pdf, taal, editie) {
  const d = rapportTaal(taal);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const logoBestand = bestaandAfbeeldingsbestand(LOGO_BASENAME);
  let logoImg = null;
  if (logoBestand && logoBestand.toLowerCase().endsWith('.png')) {
    try { logoImg = await pdf.embedPng(fs.readFileSync(logoBestand)); } catch (e) { /* zie voegCoverPaginaToe */ }
  }
  const editieLabel = editie === '__alle__' ? d['rapport.alleEdities'] : editie;
  const eventTekst = 'Stroomdashboard · ' + d['rapport.pdfEditieLabel'].toLowerCase() + ' ' + editieLabel;

  const paginas = pdf.getPages();
  const totaal = paginas.length;
  // pagina 0 is de cover, die heeft al zijn eigen (ongenummerde) footer — pas de genummerde
  // voettekststrook toe op alle overige pagina's, ongeacht hun eigen afmeting (Grafana-paneel-
  // pagina's hebben geen vast A4-formaat, dus per pagina de eigen width/height opvragen)
  for (let i = 1; i < paginas.length; i++) {
    const pagina = paginas[i];
    const { width } = pagina.getSize();
    pagina.drawRectangle({ x: 0, y: 0, width, height: 44, color: rgb(1, 1, 1) });
    pagina.drawLine({ start: { x: 0, y: 44 }, end: { x: width, y: 44 }, thickness: 1, color: RAPPORT_KLEUR.lijn });
    let tekstX = 24;
    if (logoImg) {
      const logoH = 18, logoW = logoImg.width * (logoH / logoImg.height);
      pagina.drawImage(logoImg, { x: 24, y: 13, width: logoW, height: logoH });
      tekstX = 24 + logoW + 10;
    }
    pagina.drawText(eventTekst, { x: tekstX, y: 20, size: 10, font, color: RAPPORT_KLEUR.inkt2 });
    const pnumTekst = (i + 1) + ' / ' + totaal;
    const pnumWidth = font.widthOfTextAtSize(pnumTekst, 10);
    pagina.drawText(pnumTekst, { x: width - 24 - pnumWidth, y: 20, size: 10, font, color: RAPPORT_KLEUR.inkt2 });
  }
}

async function voegPlaceholderPaginaToe(pdf, tekst) {
  const pagina = pdf.addPage([842, 595]); // A4 liggend, past bij de rest van het rapport
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pagina.drawText(tekst, { x: 64, y: 545, size: 14, font, color: RAPPORT_KLEUR.inkt2, maxWidth: 842 - 128 });
}

async function voerRapportGeneratieUit(job) {
  const { editie, van, tot, onderdelen, taal } = job;
  const editieVar = editie === '__alle__' ? null : editie;
  const dest = await PDFDocument.create();

  await voegCoverPaginaToe(dest, { editie, van, tot, onderdelen, taal });
  const inhoudStartIndex = dest.getPageCount();

  for (const key of ['generatorTotalen', 'kastPerFase', 'sankey']) {
    if (!onderdelen[key]) continue;
    const afmeting = RAPPORT_PANEL_AFMETING[key];
    const buf = await haalPaneelPdfOp(RAPPORT_PANEL_IDS[key], { van, tot, editie: editieVar, ...afmeting });
    const bron = await PDFDocument.load(buf);
    const paginas = await dest.copyPages(bron, bron.getPageIndices());
    paginas.forEach((p) => dest.addPage(p));
  }

  if (onderdelen.alarmen) {
    await voegAlarmenPaginaToe(dest, taal);
  }

  if (dest.getPageCount() === inhoudStartIndex) {
    await voegPlaceholderPaginaToe(dest, rapportTaal(taal)['rapport.pdfGeenOnderdelen']);
  }

  await voegVoettekstToe(dest, taal, editie);

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
  const { editie, van, tot, onderdelen, taal } = req.body || {};
  if (!editie || !van || !tot || !onderdelen) return res.status(400).json({ error: 'editie, van, tot en onderdelen zijn verplicht' });
  if (editie !== '__alle__' && !veiligeTagWaarde(editie)) return res.status(400).json({ error: 'ongeldige editie' });

  rapportJob = {
    status: 'bezig', editie, van, tot, onderdelen, taal: I18N_TALEN[taal] ? taal : 'nl',
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

// ---------- Back-up (roadmap-item 8, Back-up-subtab in de Rapportages-tab): topologie + media
// altijd, meetdata optioneel met periode — zie specs/rebuild-plan-v2.md §11.4 ----------
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// zelfde conventie als rapportJob hierboven: module-scoped, niet-persistent, één back-up tegelijk
let backupJob = {
  status: 'idle', // 'idle' | 'bezig' | 'klaar' | 'fout'
  gestartOp: null, klaarOp: null,
  bestandsnaam: null, bestandsgrootte: null, foutmelding: null,
};

// levert de twee vormen van "meetdata" voor een back-up: `meetdata.csv` (leesbaar, ongewijzigd
// gedrag: alleen shelly_em/shelly_emdata over de gekozen periode) en `meetdata.lp` (line-protocol,
// inclusief topology_edges, bedoeld om via het restore-endpoint terug te schrijven — zie §A3,
// specs/single-use-vs-edities-diagnose.md). topology_edges wordt niet over de gekozen periode
// bevraagd (het is een structuur-snapshot, geen tijdreeks) maar als laatste-bekende-stand per
// kast, zelfde patroon als de `edges`-subquery in het Grafana-Sankey-paneel.
async function genereerMeetdataBestanden(meetdataPeriode) {
  const van = new Date(meetdataPeriode.van).toISOString();
  const tot = new Date(meetdataPeriode.tot).toISOString();
  const pivot = '|> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")\n' +
    '  |> drop(columns: ["_start", "_stop", "_measurement"])\n  |> group()';

  const csvPromise = influxQuery(
    'from(bucket: "' + INFLUX_BUCKET + '")\n' +
    '  |> range(start: ' + van + ', stop: ' + tot + ')\n' +
    '  |> filter(fn: (r) => r._measurement == "shelly_em" or r._measurement == "shelly_emdata")'
  );

  const { event_name, event_edition } = readInstellingen();
  const lpQueries = [
    { measurement: 'shelly_em', flux: 'from(bucket: "' + INFLUX_BUCKET + '")\n' +
      '  |> range(start: ' + van + ', stop: ' + tot + ')\n' +
      '  |> filter(fn: (r) => r._measurement == "shelly_em")\n  ' + pivot },
    { measurement: 'shelly_emdata', flux: 'from(bucket: "' + INFLUX_BUCKET + '")\n' +
      '  |> range(start: ' + van + ', stop: ' + tot + ')\n' +
      '  |> filter(fn: (r) => r._measurement == "shelly_emdata")\n  ' + pivot },
  ];
  if (event_name && event_edition) {
    // geen pivot() hier: topology_edges heeft toch al maar één veld (`value`), en group(columns:
    // ["kast"]) vóór last() (nodig om per kast alleen de laatste bekende stand te pakken, zelfde
    // patroon als de `edges`-subquery in het Grafana-Sankey-paneel) haalt generator/parent/editie/
    // evenement al uit de group-key — pivot() zou die kolommen daarna alsnog laten vallen (het
    // bewaart alleen rowKey- en group-key-kolommen), dus hier alleen hernoemen/opschonen i.p.v. pivotten.
    lpQueries.push({ measurement: 'topology_edges', flux:
      'from(bucket: "' + INFLUX_BUCKET + '")\n' +
      '  |> range(start: -30d)\n' +
      '  |> filter(fn: (r) => r._measurement == "topology_edges" and r.editie == "' + event_edition + '" and r.evenement == "' + event_name + '")\n' +
      '  |> group(columns: ["kast"])\n  |> last()\n' +
      '  |> rename(columns: {_value: "value"})\n' +
      '  |> drop(columns: ["_start", "_stop", "_field", "_measurement"])\n  |> group()' });
  }

  const [csv, lpCsvs, tagKolommenPerMeasurement] = await Promise.all([
    csvPromise,
    Promise.all(lpQueries.map((q) => influxQueryPlatteCsv(q.flux))),
    Promise.all(lpQueries.map((q) => haalTagKolommenOp(q.measurement))),
  ]);
  const lp = lpQueries.flatMap((q, i) => csvNaarLineProtocol(lpCsvs[i], q.measurement, tagKolommenPerMeasurement[i]));
  return { csv, lp };
}

async function voerBackupGeneratieUit(meetdataPeriode) {
  const bestandsnaam = 'backup_stroomdashboard_' + Date.now() + '.zip';
  const bestandspad = path.join(BACKUP_DIR, bestandsnaam);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(bestandspad);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    archive.append(JSON.stringify(readTopo(), null, 2), { name: 'topologie.json' });
    const kaartBestand = bestaandAfbeeldingsbestand(MAP_BASENAME);
    if (kaartBestand) archive.file(kaartBestand, { name: 'plattegrond' + path.extname(kaartBestand) });
    const logoBestand = bestaandAfbeeldingsbestand(LOGO_BASENAME);
    if (logoBestand) archive.file(logoBestand, { name: 'logo' + path.extname(logoBestand) });

    if (!meetdataPeriode) { archive.finalize(); return; }
    // meetdata pas ná de synchrone entries toevoegen: archiver serialiseert intern, en de
    // async influxQuery() mag de finalize() niet vóór zijn (anders mist de zip dit onderdeel)
    genereerMeetdataBestanden(meetdataPeriode).then(({ csv, lp }) => {
      archive.append(csv, { name: 'meetdata.csv' });
      archive.append(lp.join('\n'), { name: 'meetdata.lp' });
      archive.finalize();
    }).catch((e) => {
      archive.append('kon meetdata niet ophalen: ' + e.message, { name: 'meetdata_FOUT.txt' });
      archive.finalize();
    });
  });

  const stat = fs.statSync(bestandspad);
  backupJob = { ...backupJob, status: 'klaar', klaarOp: new Date().toISOString(), bestandsnaam, bestandsgrootte: stat.size };
}

app.post('/api/backup/genereer', (req, res) => {
  if (backupJob.status === 'bezig') return res.status(409).json({ error: 'er loopt al een back-up' });
  const { meetdata } = req.body || {};
  let meetdataPeriode = null;
  if (meetdata) {
    const { van, tot } = meetdata;
    if (!van || !tot || isNaN(Date.parse(van)) || isNaN(Date.parse(tot))) {
      return res.status(400).json({ error: 'meetdata.van en meetdata.tot zijn verplicht en moeten geldige datums zijn' });
    }
    meetdataPeriode = { van, tot };
  }

  backupJob = {
    status: 'bezig', gestartOp: new Date().toISOString(), klaarOp: null,
    bestandsnaam: null, bestandsgrootte: null, foutmelding: null,
  };
  res.json({ ok: true });

  voerBackupGeneratieUit(meetdataPeriode).catch((e) => {
    backupJob = { ...backupJob, status: 'fout', foutmelding: e.message };
    console.error('back-up mislukt:', e.message);
  });
});

app.get('/api/backup/status', (req, res) => res.json(backupJob));

app.get('/api/backup/download', (req, res) => {
  if (backupJob.status !== 'klaar' || !backupJob.bestandsnaam) return res.status(404).json({ error: 'geen back-up beschikbaar' });
  res.download(path.join(BACKUP_DIR, backupJob.bestandsnaam), backupJob.bestandsnaam);
});

// ---------- Back-up herstellen (restore, tegenhanger van hierboven) — zie
// specs/single-use-vs-edities-diagnose.md §A5. Twee modi: "volledig" (verse/lege instance, alle
// onderdelen) of "editie_toevoegen" (alleen meetdata, geblokkeerd bij een editie/evenement-
// naamsbotsing met wat er al in deze instance staat). ----------
function isZipBestand(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
}
function zipFileFilter(req, file, cb) {
  if (path.extname(file.originalname).toLowerCase() !== '.zip') return cb(new Error('alleen .zip-bestanden zijn toegestaan'));
  cb(null, true);
}
// grotere limiet dan de afbeeldingsupload: een back-up met meetdata over een lange periode kan
// een stuk groter zijn dan een plattegrond/logo
const zipUpload = multer({ dest: DATA_DIR, limits: { fileSize: 500 * 1024 * 1024 }, fileFilter: zipFileFilter });

// leest de tags van de eerste line-protocol-regel (alle regels in één back-up delen dezelfde
// editie/evenement, want een back-up wordt altijd van één op dat moment actieve instance gemaakt)
function tagsUitLineProtocolRegel(regel) {
  const tagsDeel = regel.split(' ')[0].split(',').slice(1);
  const tags = {};
  tagsDeel.forEach((deel) => { const i = deel.indexOf('='); if (i > -1) tags[deel.slice(0, i)] = deel.slice(i + 1); });
  return tags;
}

async function schrijfLineProtocol(regels) {
  if (!regels.length) return;
  const writeUrl = INFLUX_URL + '/api/v2/write?org=' + encodeURIComponent(INFLUX_ORG) + '&bucket=' + encodeURIComponent(INFLUX_BUCKET) + '&precision=s';
  const res = await fetch(writeUrl, {
    method: 'POST',
    headers: { Authorization: 'Token ' + INFLUX_TOKEN, 'Content-Type': 'text/plain; charset=utf-8' },
    body: regels.join('\n'),
  });
  if (!res.ok) throw new Error('InfluxDB write gaf ' + res.status + ': ' + (await res.text()));
}

// levert { onderdelen: ['topologie'|'media'|'meetdata', ...] } i.p.v. een kant-en-klare zin — de
// client stelt zelf de (vertaalde) melding samen uit deze keys, zie backup.js/i18n
async function voerHerstelUit(modus, zip, lpRegels) {
  const onderdelen = [];
  if (modus === 'volledig') {
    const topoEntry = zip.getEntries().find((e) => e.entryName === 'topologie.json');
    const data = JSON.parse(zip.readAsText(topoEntry));
    if (!Array.isArray(data.kasten) || !Array.isArray(data.generators)) throw new Error('topologie.json in de back-up is ongeldig');
    writeTopo(data);
    onderdelen.push('topologie');

    let mediaTeruggezet = false;
    ['plattegrond', 'logo'].forEach((naam) => {
      const mediaEntry = zip.getEntries().find((e) => e.entryName.startsWith(naam + '.'));
      if (!mediaEntry) return;
      const buffer = mediaEntry.getData();
      const type = detecteerAfbeeldingType(buffer);
      if (!type) return; // ongeldig media-bestand in de back-up: sla dit onderdeel over, blokkeer niet de rest van het herstel
      const basename = naam === 'plattegrond' ? MAP_BASENAME : LOGO_BASENAME;
      verwijderAfbeeldingsbestanden(basename);
      fs.writeFileSync(basename + AFBEELDING_EXT_BY_TYPE[type], buffer);
      mediaTeruggezet = true;
    });
    if (mediaTeruggezet) onderdelen.push('media');
  }

  await schrijfLineProtocol(lpRegels);
  onderdelen.push('meetdata');
  return { onderdelen };
}

// zelfde conventie als rapportJob/backupJob hierboven
let herstelJob = {
  status: 'idle', // 'idle' | 'bezig' | 'klaar' | 'fout'
  gestartOp: null, klaarOp: null,
  resultaat: null, foutmelding: null,
};

app.post('/api/backup/herstel', metUploadFoutafhandeling(zipUpload.single('backup')), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'geen bestand ontvangen (veldnaam moet "backup" zijn)' });
  const opruimen = () => fs.unlink(req.file.path, () => {});

  if (herstelJob.status === 'bezig') { opruimen(); return res.status(409).json({ error: 'er loopt al een herstel' }); }
  const modus = req.body.modus === 'editie_toevoegen' ? 'editie_toevoegen' : 'volledig';

  const buffer = fs.readFileSync(req.file.path);
  if (!isZipBestand(buffer)) { opruimen(); return res.status(400).json({ error: 'bestand is geen geldig zip-archief' }); }

  let zip;
  try { zip = new AdmZip(buffer); } catch (e) { opruimen(); return res.status(400).json({ error: 'kon zip-bestand niet lezen: ' + e.message }); }

  const entries = zip.getEntries();
  if (modus === 'volledig' && !entries.some((e) => e.entryName === 'topologie.json')) {
    opruimen();
    return res.status(400).json({ error: 'back-up bevat geen topologie.json' });
  }
  const lpEntry = entries.find((e) => e.entryName === 'meetdata.lp');
  if (!lpEntry) {
    opruimen();
    return res.status(400).json({ error: 'back-up bevat geen meetdata (meetdata.lp) — is deze back-up gemaakt zonder de meetdata-optie?' });
  }
  const lpRegels = zip.readAsText(lpEntry).split('\n').map((r) => r.trim()).filter(Boolean);
  if (!lpRegels.length) { opruimen(); return res.status(400).json({ error: 'meetdata.lp in deze back-up is leeg' }); }
  const tags = tagsUitLineProtocolRegel(lpRegels[0]);
  if (!tags.editie || !tags.evenement) { opruimen(); return res.status(400).json({ error: 'kon editie/evenement niet uit de back-up herleiden' }); }

  if (modus === 'editie_toevoegen') {
    try {
      const csv = await influxQuery(
        'import "influxdata/influxdb/schema"\n' +
        'schema.tagValues(bucket: "' + INFLUX_BUCKET + '", tag: "editie", predicate: (r) => r.evenement == "' + tags.evenement + '")'
      );
      if (csvKolomWaarden(csv, '_value').includes(tags.editie)) {
        opruimen();
        return res.status(409).json({ error: 'editie "' + tags.editie + '" bestaat al binnen evenement "' + tags.evenement + '" in deze instance — toevoegen geblokkeerd om bestaande data niet te vermengen' });
      }
    } catch (e) {
      opruimen();
      return res.status(502).json({ error: 'kon bestaande edities niet controleren: ' + e.message });
    }
  }

  herstelJob = { status: 'bezig', gestartOp: new Date().toISOString(), klaarOp: null, resultaat: null, foutmelding: null };
  res.json({ ok: true });

  voerHerstelUit(modus, zip, lpRegels).then((resultaat) => {
    herstelJob = { ...herstelJob, status: 'klaar', klaarOp: new Date().toISOString(), resultaat: { ...resultaat, editie: tags.editie, evenement: tags.evenement } };
  }).catch((e) => {
    herstelJob = { ...herstelJob, status: 'fout', foutmelding: e.message };
    console.error('herstel mislukt:', e.message);
  }).finally(opruimen);
});

app.get('/api/backup/herstel/status', (req, res) => res.json(herstelJob));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Stroomdashboard luistert op poort ' + PORT));
