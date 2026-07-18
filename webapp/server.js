const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const TOPO_FILE = path.join(DATA_DIR, 'topologie.json');
const MAP_FILE = path.join(DATA_DIR, 'kaart.png');
const LOGO_FILE = path.join(DATA_DIR, 'logo.png');
const DEFAULT_TOPO = path.join(__dirname, 'default_topologie.json');
const TEST_TOPO = path.join(__dirname, 'test_topologie.json');

const INFLUX_URL = process.env.INFLUX_URL || 'http://influxdb:8086';
const INFLUX_TOKEN = process.env.INFLUX_TOKEN;
const INFLUX_ORG = process.env.INFLUX_ORG || 'festival';
const INFLUX_BUCKET = process.env.INFLUX_BUCKET || 'stroomdata';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TOPO_FILE)) fs.copyFileSync(DEFAULT_TOPO, TOPO_FILE);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readTopo() { return JSON.parse(fs.readFileSync(TOPO_FILE, 'utf8')); }
function writeTopo(data) { fs.writeFileSync(TOPO_FILE, JSON.stringify(data, null, 2), 'utf8'); }

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
app.post('/api/generators', (req, res) => {
  const { naam, vermogen_kva } = req.body || {};
  if (!naam || !vermogen_kva) return res.status(400).json({ error: 'naam en vermogen_kva zijn verplicht' });
  const data = readTopo();
  const alleIds = [...data.generators.map(g => g.id), ...data.kasten.map(k => k.id)];
  const id = uniekeId(slugify(naam), alleIds);
  const gen = { id, naam, vermogen_kva: Number(vermogen_kva), positie: { x_pct: null, y_pct: null } };
  data.generators.push(gen);
  writeTopo(data);
  res.json({ ok: true, generator: gen });
});

app.put('/api/generators/:id', (req, res) => {
  const data = readTopo();
  const gen = data.generators.find(g => g.id === req.params.id);
  if (!gen) return res.status(404).json({ error: 'generator niet gevonden' });
  const { naam, vermogen_kva } = req.body || {};
  if (naam) gen.naam = naam;
  if (vermogen_kva) gen.vermogen_kva = Number(vermogen_kva);
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
app.post('/api/kasten', (req, res) => {
  const { naam, rating_a, generator, parent, afkorting } = req.body || {};
  if (!naam || !rating_a || !generator) return res.status(400).json({ error: 'naam, rating_a en generator zijn verplicht' });
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
  const { naam, rating_a, generator, parent, afkorting } = req.body || {};

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
// Bedoeld om de werking te demonstreren tijdens de testfase. Zet dit, net als de
// simulator (zie docker-compose.yml), na de testfase achter de "simulator"-profile-flag
// zodat 'm niet per ongeluk tijdens een echt evenement gebruikt kan worden.
app.post('/api/topology/test-data', (req, res) => {
  const test = JSON.parse(fs.readFileSync(TEST_TOPO, 'utf8'));
  writeTopo(test);
  res.json({ ok: true });
});

// ---------- simulatie-meetdata wissen ----------
// Wist alle meetdata (stroom/spanning/vermogen) uit InfluxDB — niet de topologie. Handig om na
// een korte test met een schone lei te beginnen. Hoort, net als de simulator en de testtopologie-
// knop hierboven, alleen tijdens de testfase beschikbaar te zijn (zie backlog in event_dashboard.md).
app.post('/api/metingen/reset', async (req, res) => {
  if (!INFLUX_TOKEN) return res.status(500).json({ error: 'INFLUX_TOKEN niet geconfigureerd op de webapp-service' });
  try {
    const url = INFLUX_URL + '/api/v2/delete?org=' + encodeURIComponent(INFLUX_ORG) + '&bucket=' + encodeURIComponent(INFLUX_BUCKET);
    const influxRes = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Token ' + INFLUX_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: '1970-01-01T00:00:00Z', stop: new Date(Date.now() + 1000).toISOString() }),
    });
    if (!influxRes.ok) {
      const text = await influxRes.text();
      return res.status(502).json({ error: 'InfluxDB gaf een fout (' + influxRes.status + '): ' + text });
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
