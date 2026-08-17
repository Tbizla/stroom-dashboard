const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { createProxyMiddleware } = require('http-proxy-middleware');
const rateLimit = require('express-rate-limit');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const sharp = require('sharp');
const { configureerShelly } = require('./shelly-rpc');
const meetfactorRelay = require('./meetfactor-relay');

// letterlijke placeholder-waarde uit .env.example voor elke "vul zelf een random string in"-
// env-var (SESSION_SECRET/INTERNAL_API_TOKEN) — een installatie die 'm per ongeluk laat staan mag
// 'm nooit als een echt geheim gebruiken (zie vervolgticket-toegang-van-buitenaf-ronde2.md §1)
const ENV_PLACEHOLDER = 'kies-een-lange-random-string';

const DATA_DIR = process.env.DATA_DIR || '/data';
const TOPO_FILE = path.join(DATA_DIR, 'topologie.json');
const INSTELLINGEN_FILE = path.join(DATA_DIR, 'instellingen.json');
const MAP_BASENAME = path.join(DATA_DIR, 'kaart');
// specs/plattegrond-tile-based-plan.md: prefix voor de sharp/libvips Deep-Zoom-tegel-piramide van
// een grote plattegrond — sharp schrijft hiernaast '<TILES_PREFIX>.dzi' (XML-afmetingen) en een
// '<TILES_PREFIX>_files/<niveau>/<kolom>_<rij>.png'-boom. Een plattegrond is óf getiled (dit
// bestandenpaar) óf plat (kaart.png/.bmp/.svg hierboven) — nooit allebei tegelijk.
const TILES_PREFIX = path.join(DATA_DIR, 'kaart-tiles');
const LOGO_BASENAME = path.join(DATA_DIR, 'logo');
const DEFAULT_TOPO = path.join(__dirname, 'default_topologie.json');
const TEST_TOPO_SIMPEL = path.join(__dirname, 'test_topologie_simpel.json');
const TEST_TOPO_UITGEBREID = path.join(__dirname, 'test_topologie_uitgebreid.json');
// specs/shelly-auto-configuratie-plan.md: bind-mount (docker-compose.yml), niet gedupliceerd in
// webapp/ — één bronbestand, altijd actueel
const SHELLY_SCRIPT_FILE = '/shelly-script/em-fast-publish.js';

const INFLUX_URL = process.env.INFLUX_URL || 'http://influxdb:8086';
const INFLUX_TOKEN = process.env.INFLUX_TOKEN;
const INFLUX_ORG = process.env.INFLUX_ORG || 'site';
const INFLUX_BUCKET = process.env.INFLUX_BUCKET || 'stroomdata';
// klein, apart servicetje (telegraf-herstarter/) dat de échte /var/run/docker.sock heeft en
// precies één actie aanbiedt: telegraf herstarten met nieuwe EVENT_NAME/EVENT_EDITION-waarden —
// de webapp zelf heeft nooit Docker-toegang.
const TELEGRAF_HERSTARTER_URL = process.env.TELEGRAF_HERSTARTER_URL;
const GRAFANA_URL = process.env.GRAFANA_URL || 'http://grafana:3000';
const GRAFANA_DASHBOARD_UID = process.env.GRAFANA_DASHBOARD_UID || 'stroom-dashboard-overzicht';
const GRAFANA_REPORT_TOKEN = process.env.GRAFANA_REPORT_TOKEN;
// admin-wachtwoord van de Grafana-instance zelf (zelfde GRAFANA_PASSWORD als de grafana-service
// gebruikt) — nodig voor de contact-point-/notification-policy-provisioning-API, die een hogere
// rol dan de Viewer-scoped GRAFANA_REPORT_TOKEN vereist (zie /api/instellingen/notificaties)
const GRAFANA_ADMIN_PASSWORD = process.env.GRAFANA_PASSWORD;

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
// hierna uitsluitend via Beheer/`/api/instellingen` beheerd
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
// vervolgticket-toegang-van-buitenaf.md §1 (kritiek): zonder dit routeert Express `/API/topology`
// gewoon naar de lowercase-geregistreerde `/api/topology`-handler — de auth-gate hieronder gebruikt
// zelf ook een hoofdletterongevoelige vergelijking (de kern van de fix), dit is een tweede,
// onafhankelijke laag die dezelfde klasse fouten voorkomt op Express-routeringsniveau.
app.set('case sensitive routing', true);
// specs/caddy-herstel-plan.md: `trust proxy` staat weer aan — Caddy (caddy/Caddyfile) is de enige
// vertrouwde hop vóór deze instance en zet X-Forwarded-Proto/-For zelf correct, dus geen risico
// meer dat een cliënt die header zelf vervalst (dat risico gold kortstondig tijdens de per-ongeluk
// verwijderde Caddy-periode, zie git-geschiedenis rond commits f567e17/a13b913 — zónder een echte
// proxy ervoor maakte `trust proxy` de IP-rate-limiters hieronder actief omzeilbaar). Nodig voor de
// secure-cookie-vlag hieronder (via req.secure, zie de comment daar) en voor correcte client-IP's
// bij de rate-limiters wanneer verkeer via Caddy binnenkomt.
app.set('trust proxy', 1);
app.use(express.json());
// tijdens actieve ontwikkeling wordt index.html regelmatig aangepast; zonder no-store kan de browser
// een oude versie blijven hergebruiken (ook na een gewone F5) totdat er een harde refresh gebeurt,
// wat verwarrend is bij het testen van fixes
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res) => res.set('Cache-Control', 'no-store') }));

// ---------- Accounts + sessies (specs/toegang-van-buitenaf-diagnose.md): login-laag voor de hele
// app. Losse accounts per persoon (geen gedeeld wachtwoord), wachtwoorden altijd gehashed
// (bcryptjs — pure JS, geen native compile-stap nodig; webapp/Dockerfile heeft geen build-tools).
// Sessie leeft in een signed+encrypted cookie (cookie-session), geen server-side sessieopslag nodig
// — past bij de rest van deze app, die ook geen database heeft en alles in platte JSON-bestanden
// in DATA_DIR bewaart. ----------
const bcrypt = require('bcryptjs');
const cookieSession = require('cookie-session');

const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
// vervolgticket-toegang-van-buitenaf.md §2: geen hardcoded fallback-string meer (die stond gewoon
// in de repo, dus publiek bekend) — ontbreekt SESSION_SECRET in .env, dan wordt er bij de allereerste
// opstart een willekeurig secret gegenereerd en weggeschreven (zelfde eenmalige-generatie-patroon
// als het admin-wachtwoord hieronder), zodat sessies daarna consistent ondertekend blijven.
const SESSION_SECRET_FILE = path.join(DATA_DIR, 'session_secret.txt');
function bepaalSessionSecret() {
  // vervolgticket-toegang-van-buitenaf-ronde2.md §1: dezelfde placeholder-klasse-bug als
  // INTERNAL_API_TOKEN was hier ook mogelijk (.env.example gebruikt letterlijk dezelfde
  // placeholder-tekst voor beide) — een niet-overschreven placeholder telt hier als "niet
  // ingesteld", zodat er alsnog een echt willekeurig secret gegenereerd wordt.
  if (process.env.SESSION_SECRET === ENV_PLACEHOLDER) {
    console.warn('SESSION_SECRET staat nog op de placeholder-waarde uit .env.example — genegeerd, er wordt automatisch een eigen secret gegenereerd.');
  } else if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }
  if (fs.existsSync(SESSION_SECRET_FILE)) return fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
  const gegenereerd = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SESSION_SECRET_FILE, gegenereerd, 'utf8');
  return gegenereerd;
}
const SESSION_SECRET = bepaalSessionSecret();

app.use(cookieSession({
  name: 'stroomdash_sessie',
  secret: SESSION_SECRET,
  // crew werkt de hele dag door met de app en moet niet steeds opnieuw hoeven inloggen — 30 dagen
  // overleeft ruim een heel evenement, `sameSite:'lax'` laat de QR-deeplink (een normale navigatie
  // vanaf de camera-app, geen cross-site POST) de cookie gewoon meesturen
  maxAge: 30 * 24 * 3600 * 1000,
  sameSite: 'lax',
  // vervolgticket-toegang-van-buitenaf-ronde2.md §3: NIET statisch aan PUBLIC_DOMEIN koppelen —
  // zodra die env-var gezet is (publieke Caddy-uitrol), kreeg een crew-telefoon die gewoon
  // rechtstreeks via http://<lan-ip>:8080 verbindt (nog steeds de bedoeling op het festivalnetwerk,
  // zie ports-comment bij de webapp-service in docker-compose.yml) nooit een Set-Cookie: inloggen
  // "lukte", maar zonder cookie bleef /api/session 401'en en stuurde de frontend eindeloos terug
  // naar het loginscherm. `secure` wordt hieronder per-request overschreven (zie
  // req.sessionOptions hieronder) i.p.v. hier statisch vastgezet.
  secure: false,
}));

// cookie-session bewaart de cookie-opties per request in req.sessionOptions (een fresh
// Object.create(opts) per binnenkomende request — zie node_modules/cookie-session/index.js) en
// leest die pas uit bij het daadwerkelijk zetten van de Set-Cookie-header, ná de hele
// middleware-/route-keten. Dat maakt dit de officiële manier om `secure` per request dynamisch te
// bepalen i.p.v. één keer statisch bij het opzetten van de middleware: `req.secure` volgt met
// `trust proxy` (hierboven) correct Caddy's `X-Forwarded-Proto`-header als die er is, en is anders
// gewoon `false` voor een rechtstreekse HTTP-request op 8080 — dus altijd correct, voor beide
// toegangswegen tegelijk, zonder een globale PUBLIC_DOMEIN-aan/uit-schakelaar.
app.use((req, res, next) => { req.sessionOptions.secure = req.secure; next(); });

function readAccounts() {
  if (!fs.existsSync(ACCOUNTS_FILE)) return [];
  return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
}
function writeAccounts(data) { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2), 'utf8'); }
// specs/rolverdeling-plan.md: bestaande accounts van vóór dit veld migreren naar 'editor' als
// default — niemands bestaande rechten mogen ongevraagd inkrimpen bij deze upgrade. Toegepast bij
// elke lezing i.p.v. een eenmalige schrijf-migratie (zelfde stijl als de al bestaande
// groep_soort/leden-defaults elders in dit bestand).
function bepaalRol(account) { return account.rol === 'viewer' ? 'viewer' : 'editor'; }

// leesbaar, willekeurig wachtwoord (bijv. "bK4-mQz9-Rvt2", zie de accounts-beheer-mockup) —
// crypto.randomBytes i.p.v. Math.random, geen onderling verwarrende tekens (0/O/l/1) om
// typefouten te voorkomen bij het handmatig overtikken/doorgeven van een gegenereerd wachtwoord
const WACHTWOORD_ALFABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function genereerWachtwoord() {
  const groep = () => Array.from(crypto.randomBytes(4)).map((b) => WACHTWOORD_ALFABET[b % WACHTWOORD_ALFABET.length]).join('');
  return [groep(), groep(), groep()].join('-');
}

// eerste-opstart-bootstrap: zonder dit is er geen kip-of-ei-uitweg — er bestaat bewust geen publiek
// registratieformulier, alleen een al-ingelogde editor kan via het Accounts-scherm een account
// aanmaken (zie specs/toegang-van-buitenaf-diagnose.md). specs/eerste-admin-standaardwachtwoord-
// plan.md: vast admin/admin i.p.v. een willekeurig wachtwoord in de container-log — makkelijker te
// onthouden/documenteren, met als bewuste afweging dat dit een publiek bekend, geraden default-
// wachtwoord is zolang het nog niet gewijzigd is (vergelijkbaar met veel apparaten/routers). Dat is
// alleen aanvaardbaar omdat moet_wachtwoord_wijzigen hieronder server-side (niet alleen een
// overslaanbaar UI-schermpje) afgedwongen wordt tot het admin-account een eigen wachtwoord heeft.
// Bestaande installaties met al een accounts.json raakt dit niet (length===0-check).
if (readAccounts().length === 0) {
  writeAccounts([{
    id: crypto.randomUUID(),
    naam: 'admin',
    email: '',
    wachtwoord_hash: bcrypt.hashSync('admin', 10),
    moet_wachtwoord_wijzigen: true,
    // specs/rolverdeling-plan.md: het enige account bij een verse installatie, moet alles kunnen
    // instellen
    rol: 'editor',
    aangemaakt: new Date().toISOString(),
    laatst_ingelogd: null,
  }]);
  console.log('Geen accounts gevonden — eerste admin-account aangemaakt: admin / admin');
  console.log('  Verplicht bij de eerste keer inloggen: er wordt direct om een nieuw wachtwoord gevraagd.');
}

// vervolgticket-toegang-van-buitenaf.md §6: simpele rate-limiters op de twee routes die straks ook
// zonder sessie/van buitenaf te bereiken zijn — /api/login (brute-force/scan-tegengas, wachtwoorden
// zijn wel al 12 tekens random maar een limiter is op een publiek endpoint sowieso op zijn plek) en
// /api/hq-status (elke aanvraag triggert een InfluxDB-query, zonder limiet een goedkope DoS-hefboom).
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const hqStatusLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

app.post('/api/login', loginLimiter, (req, res) => {
  const { naam, wachtwoord } = req.body || {};
  const account = readAccounts().find((a) => a.naam === naam);
  if (!account || !bcrypt.compareSync(wachtwoord || '', account.wachtwoord_hash)) {
    return res.status(401).json({ error: 'onjuiste gebruikersnaam of wachtwoord' });
  }
  req.session.accountId = account.id;
  const accounts = readAccounts();
  const idx = accounts.findIndex((a) => a.id === account.id);
  accounts[idx].laatst_ingelogd = new Date().toISOString();
  writeAccounts(accounts);
  res.json({ ok: true, naam: account.naam, moet_wachtwoord_wijzigen: !!account.moet_wachtwoord_wijzigen, rol: bepaalRol(account) });
});
app.post('/api/logout', (req, res) => { req.session = null; res.json({ ok: true }); });
app.get('/api/session', (req, res) => {
  const account = req.session && req.session.accountId ? readAccounts().find((a) => a.id === req.session.accountId) : null;
  if (!account) return res.status(401).json({ error: 'niet ingelogd' });
  res.json({ naam: account.naam, email: account.email, moet_wachtwoord_wijzigen: !!account.moet_wachtwoord_wijzigen, rol: bepaalRol(account) });
});

// gate alle /api/*-routes hierna (én /mqtt zelf, zie vervolgticket-toegang-van-buitenaf.md §5)
// achter een geldige sessie, behalve login/logout/session zelf, het publieke HQ-statusendpoint
// (geeft alleen tellingen terug, geen gevoelige data — zie de HQ-Locaties-pagina verderop), en
// /api/i18n/:taal — i18n.js laadt de vertaaldictionary via een top-level await vóórdat main.js de
// sessie ooit checkt, dus óók het loginscherm zelf heeft deze nodig (anders: kip-en-ei, geen
// vertaalde labels op het scherm dat je moet gebruiken om in te loggen). Statische bestanden
// (index.html/JS/CSS, hierboven al geregistreerd) blijven bewust ongegate'd: de frontend blokkeert
// zelf de UI (zie auth.js) tot een sessie bevestigd is, en er staat toch geen gevoelige data in de
// JS-bundle zelf.
// Ook een geldig X-Internal-Token- (simulator) of "Authorization: Bearer <token>"-header
// (Grafana's webhook-contact-point, zie GRAFANA_CONTACTPOINT_UIDS.ntfy hieronder) telt als
// geauthenticeerd — beide zijn machine-naar-machine-aanroepen zonder browser-sessie. Zelfde soort
// service-secret-patroon als INFLUX_TOKEN/GRAFANA_REPORT_TOKEN hierboven, i.p.v. deze endpoints
// voor iedereen publiek te laten.
// vervolgticket-toegang-van-buitenaf.md §1 (kritiek): req.path hierbeneden expliciet lowercasen
// vóór elke vergelijking — Express routeert standaard case-insensitive (`/API/topology` matchte
// eerst wél de handler maar niet deze startsWith-check, een volledige bypass van de hele login-laag,
// zie ook `case sensitive routing` hierboven als tweede, onafhankelijke hardeningslaag).
// vervolgticket-toegang-van-buitenaf-ronde2.md §1 (kritiek): .env.example levert een placeholder-
// waarde voor INTERNAL_API_TOKEN — een installatie die 'm niet overschrijft, geeft anders een
// publiek-in-de-repo-bekende bypass-waarde weg. Die placeholder wordt hieronder als "niet
// ingesteld" behandeld (bypass staat dan gewoon uit, net als wanneer de variabele leeg is), i.p.v.
// hem te accepteren. Bewust GEEN test-modus-only-beperking (wat het ticket ook oppert): dit token
// wordt sinds §4 ook gebruikt door Grafana's eigen ntfy-webhook, die net zo goed buiten testmodus
// (een echt evenement) moet werken.
const AUTH_UITGEZONDERD = new Set(['/api/login', '/api/logout', '/api/session', '/api/hq-status']);
const INTERNAL_API_TOKEN_RAW = process.env.INTERNAL_API_TOKEN || '';
if (INTERNAL_API_TOKEN_RAW === ENV_PLACEHOLDER) {
  console.warn('INTERNAL_API_TOKEN staat nog op de placeholder-waarde uit .env.example — genegeerd. ' +
    'Simulator (testmodus) en de ntfy-Grafana-koppeling werken hierdoor niet totdat je in .env een eigen random string invult.');
}
const INTERNAL_API_TOKEN = INTERNAL_API_TOKEN_RAW && INTERNAL_API_TOKEN_RAW !== ENV_PLACEHOLDER ? INTERNAL_API_TOKEN_RAW : '';
function heeftGeldigInternToken(req) {
  if (!INTERNAL_API_TOKEN) return false;
  if (req.get('X-Internal-Token') === INTERNAL_API_TOKEN) return true;
  return req.get('Authorization') === 'Bearer ' + INTERNAL_API_TOKEN;
}
// specs/eerste-admin-standaardwachtwoord-plan.md: routes die zelfs een net-ingelogd, nog-op-admin/
// admin-staand account moet kunnen bereiken om van de verplichte-wijziging af te komen (of uit te
// loggen) — zonder dit zou iemand het wijzigingsscherm gewoon kunnen negeren en met de sessie die
// de login al gaf rechtstreeks andere /api/...-routes aanroepen, wat de hele maatregel zinloos zou
// maken.
const WACHTWOORDWIJZIGING_UITGEZONDERD = new Set(['/api/logout', '/api/session', '/api/wachtwoord-wijzigen']);
// specs/rolverdeling-plan.md: routes die horen bij de vier Beheer-sub-tabs, Kalibreren en Testdata
// — een viewer-rol mag deze nooit bereiken, ook niet via een rechtstreekse API-aanroep buiten de UI
// om. Gate per "eigenaar-tabblad", niet per HTTP-methode (geen granulaire matrix, zie de spec) —
// GET /api/map en GET /api/logo zijn de enige twee uitzonderingen: die tónen alleen de plattegrond/
// het logo (nodig in Live/Schema, en het logo ook gewoon in de header voor iedereen), alleen de
// POST-upload-varianten (Kalibreren resp. Instellingen) zijn editor-only.
const EDITOR_ONLY_PREFIXEN = [
  '/api/generators', // aanmaken/wijzigen/verwijderen/groeperen — Beheer/Topologie
  '/api/kasten', // Beheer/Topologie
  '/api/reset', // "Alles wissen" — Beheer/Topologie
  '/api/shelly/configureren', // Beheer/Topologie
  '/api/instellingen', // Systeeminstellingen/Alert-notificaties/Automatische back-up — Beheer/Instellingen
  '/api/accounts', // Beheer/Accounts
  '/api/logo', // upload — Beheer/Instellingen (GET blijft hieronder expliciet uitgezonderd)
  '/api/map', // upload — Kalibreren (GET blijft hieronder expliciet uitgezonderd)
  '/api/export', // Kalibreren-header
  '/api/import', // Kalibreren-header
  '/api/topology/positie', // Kalibreren
  '/api/topology/knikpunten', // Kalibreren
  '/api/topology/viewport', // Kalibreren — specs/live-viewport-grote-monitor-plan.md, fase 3
  '/api/topology/test-data', // Testdata
  '/api/simulator', // Testdata
  '/api/metingen/reset', // Testdata
  '/api/backup', // Beheer/Back-up
  '/api/locaties', // Rapportages/Locaties — aanmaken/verwijderen (GET blijft hieronder expliciet uitgezonderd)
];
function isEditorOnlyRoute(req, pad) {
  // /api/map/meta en /api/map/tiles/... (specs/plattegrond-tile-based-plan.md) horen bij dezelfde
  // "lezen mag altijd"-uitzondering als /api/map zelf — een viewer-sessie moet een getilede
  // plattegrond op Live/Schema net zo kunnen zien als een platte
  if ((pad === '/api/map' || pad.startsWith('/api/map/') || pad === '/api/logo' || pad === '/api/locaties') && req.method === 'GET') return false;
  return EDITOR_ONLY_PREFIXEN.some((prefix) => pad === prefix || pad.startsWith(prefix + '/'));
}
app.use((req, res, next) => {
  const pad = req.path.toLowerCase();
  // ronde2 §5: /mqtt zelf mount als prefix (createProxyMiddleware), dus ook een trailing-slash-
  // of extra-segment-variant (/mqtt/, /mqtt/foo) hoort hier als gevoelig pad te gelden
  const gevoeligPad = pad.startsWith('/api/') || pad === '/mqtt' || pad.startsWith('/mqtt/');
  if (!gevoeligPad || AUTH_UITGEZONDERD.has(pad) || pad.startsWith('/api/i18n/')) return next();
  if (heeftGeldigInternToken(req)) return next();
  if (!req.session || !req.session.accountId) return res.status(401).json({ error: 'niet ingelogd' });
  const account = readAccounts().find((a) => a.id === req.session.accountId);
  if (!account) return res.status(401).json({ error: 'niet ingelogd' });
  if (account.moet_wachtwoord_wijzigen && !WACHTWOORDWIJZIGING_UITGEZONDERD.has(pad) && !pad.startsWith('/api/i18n/')) {
    return res.status(403).json({ error: 'wachtwoord_wijzigen_vereist' });
  }
  if (bepaalRol(account) !== 'editor' && isEditorOnlyRoute(req, pad)) {
    return res.status(403).json({ error: 'onvoldoende rechten' });
  }
  next();
});

const ROLLEN = ['editor', 'viewer'];
app.get('/api/accounts', (req, res) => {
  res.json(readAccounts().map(({ wachtwoord_hash, ...rest }) => ({ ...rest, rol: bepaalRol(rest) })));
});
app.post('/api/accounts', (req, res) => {
  const { naam, email, rol } = req.body || {};
  if (!naam || typeof naam !== 'string' || !naam.trim()) return res.status(400).json({ error: 'naam is verplicht' });
  if (!ROLLEN.includes(rol)) return res.status(400).json({ error: 'rol is verplicht (editor of viewer)' });
  const accounts = readAccounts();
  // naam is de inlog-identifier (zie /api/login: find op naam) — een dubbele naam zou onvoorspelbaar
  // altijd het eerst-aangemaakte account raken, de nieuwere zou nooit meer inlogbaar zijn
  if (accounts.some((a) => a.naam.toLowerCase() === naam.trim().toLowerCase())) {
    return res.status(400).json({ error: 'er bestaat al een account met deze naam' });
  }
  const wachtwoord = genereerWachtwoord();
  accounts.push({
    id: crypto.randomUUID(), naam: naam.trim(), email: (email || '').trim(), rol,
    wachtwoord_hash: bcrypt.hashSync(wachtwoord, 10),
    aangemaakt: new Date().toISOString(), laatst_ingelogd: null,
  });
  writeAccounts(accounts);
  res.json({ ok: true, wachtwoord });
});
// specs/rolverdeling-plan.md: rol van een bestaand account wijzigen (het accountsbeheer-mockup
// toont een inline-bewerkbare rol-dropdown per rij, niet alleen bij het aanmaken)
app.put('/api/accounts/:id', (req, res) => {
  const { rol } = req.body || {};
  if (!ROLLEN.includes(rol)) return res.status(400).json({ error: 'ongeldige rol' });
  const accounts = readAccounts();
  const idx = accounts.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'account niet gevonden' });
  accounts[idx].rol = rol;
  writeAccounts(accounts);
  const { wachtwoord_hash, ...rest } = accounts[idx];
  res.json({ ok: true, account: rest });
});
app.post('/api/accounts/:id/reset-wachtwoord', (req, res) => {
  const accounts = readAccounts();
  const idx = accounts.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'account niet gevonden' });
  const wachtwoord = genereerWachtwoord();
  accounts[idx].wachtwoord_hash = bcrypt.hashSync(wachtwoord, 10);
  writeAccounts(accounts);
  res.json({ ok: true, wachtwoord });
});
// specs/eerste-admin-standaardwachtwoord-plan.md: zelf-service wachtwoord wijzigen — werkt altijd op
// het eigen, ingelogde account (req.session.accountId), geen los :id-pad-argument nodig, dus geen
// apart autorisatievraagstuk (iedereen mag alleen zijn eigen wachtwoord op deze manier zetten). Dit
// is de route waarmee een net met admin/admin ingelogd account van de verplichte-wijziging-gate
// hieronder afkomt.
app.post('/api/wachtwoord-wijzigen', (req, res) => {
  const { wachtwoord } = req.body || {};
  if (!wachtwoord || typeof wachtwoord !== 'string' || wachtwoord.length < 8) {
    return res.status(400).json({ error: 'wachtwoord moet minstens 8 tekens zijn' });
  }
  if (wachtwoord.toLowerCase() === 'admin') {
    return res.status(400).json({ error: 'kies een ander wachtwoord dan het standaardwachtwoord' });
  }
  const accounts = readAccounts();
  const idx = accounts.findIndex((a) => a.id === req.session.accountId);
  if (idx === -1) return res.status(401).json({ error: 'niet ingelogd' });
  accounts[idx].wachtwoord_hash = bcrypt.hashSync(wachtwoord, 10);
  accounts[idx].moet_wachtwoord_wijzigen = false;
  writeAccounts(accounts);
  res.json({ ok: true });
});
app.delete('/api/accounts/:id', (req, res) => {
  const accounts = readAccounts();
  const overgebleven = accounts.filter((a) => a.id !== req.params.id);
  if (overgebleven.length === accounts.length) return res.status(404).json({ error: 'account niet gevonden' });
  if (!overgebleven.length) return res.status(400).json({ error: 'laatste account kan niet verwijderd worden' });
  writeAccounts(overgebleven);
  res.json({ ok: true });
});

// ---------- MQTT-ticket (specs/toegang-van-buitenaf-diagnose.md bevinding #2) ----------
// De websocket-upgrade voor /mqtt hieronder loopt buiten Express' normale request-pipeline om (een
// http.Server 'upgrade'-event, geen gewone request), dus cookie-session's req.session is daar niet
// zomaar beschikbaar — cookie-session's eigen signing-formaat handmatig naspelen in de upgrade-
// handler zou fragiel zijn (een fout daarin zou stil te strict óf te soepel kunnen verifiëren). In
// plaats daarvan: dit endpoint (loopt wél door de gewone auth-middleware hierboven, dus al
// geverifieerd) geeft een kortlevend, willekeurig ticket terug; de browser plakt dat als
// querystring-param achter de /mqtt-URL, de upgrade-handler valideert alleen dát ticket.
// vervolgticket-toegang-van-buitenaf.md §4: eenmalig bruikbaar (verwijderd bij gebruik, zie de
// upgrade-handler hieronder) en een korte TTL — `mqtt.js` vraagt tegenwoordig zelf een vers ticket
// op bij elke (her)verbinding i.p.v. hetzelfde ticket te laten hergebruiken door mqtt.js' ingebouwde
// reconnect-logica (die zou na 15 minuten of een webapp-herstart eindeloos tegen een verlopen/
// niet-meer-bestaand ticket aan blijven lopen zonder dat de gebruiker iets ziet gebeuren).
const mqttTickets = new Map(); // ticket -> { accountId, verlooptOm }
const MQTT_TICKET_TTL_MS = 30 * 1000;
app.get('/api/mqtt-ticket', (req, res) => {
  const nu = Date.now();
  Array.from(mqttTickets.entries()).forEach(([tk, v]) => { if (v.verlooptOm < nu) mqttTickets.delete(tk); });
  const ticket = crypto.randomUUID();
  mqttTickets.set(ticket, { accountId: req.session.accountId, verlooptOm: nu + MQTT_TICKET_TTL_MS });
  res.json({ ticket });
});

// ---------- HQ-Locaties (specs/toegang-van-buitenaf-diagnose.md, uitgangspunt 1: meerdere locaties
// tegelijk zien) — handmatige locatielijst + een publiek, minimaal statusendpoint per instance. ----------
const LOCATIES_FILE = path.join(DATA_DIR, 'locaties.json');
function readLocaties() {
  if (!fs.existsSync(LOCATIES_FILE)) return [];
  return JSON.parse(fs.readFileSync(LOCATIES_FILE, 'utf8'));
}
function writeLocaties(data) { fs.writeFileSync(LOCATIES_FILE, JSON.stringify(data, null, 2), 'utf8'); }

app.get('/api/locaties', (req, res) => res.json(readLocaties()));
// vervolgticket-toegang-van-buitenaf.md §7: milde SSRF-noot — dit endpoint (alleen ingelogd
// bereikbaar) accepteert elke http(s)-URL en /api/hq-locaties-status fetcht die server-side. Bewust
// niet verder dichtgetimmerd (geen allowlist/geen block op interne IP-ranges): het is precies de
// bedoeling dat een operator hier een willekeurig, zelf gekozen locatie-adres invoert, en de respons
// blijft sowieso beperkt tot online/offline + tellingen (zie /api/hq-status) — laag risico, alleen
// door een al-ingelogde editor te misbruiken.
app.post('/api/locaties', (req, res) => {
  const { naam, url } = req.body || {};
  if (!naam || typeof naam !== 'string' || !naam.trim() || !url || typeof url !== 'string') {
    return res.status(400).json({ error: 'naam en url zijn verplicht' });
  }
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch (e) { return res.status(400).json({ error: 'ongeldige URL' }); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) return res.status(400).json({ error: 'url moet met http(s):// beginnen' });
  const locaties = readLocaties();
  locaties.push({ id: crypto.randomUUID(), naam: naam.trim(), url: url.trim().replace(/\/$/, '') });
  writeLocaties(locaties);
  res.json({ ok: true });
});
app.delete('/api/locaties/:id', (req, res) => {
  const locaties = readLocaties();
  const overgebleven = locaties.filter((l) => l.id !== req.params.id);
  if (overgebleven.length === locaties.length) return res.status(404).json({ error: 'locatie niet gevonden' });
  writeLocaties(overgebleven);
  res.json({ ok: true });
});

// publiek endpoint (zie AUTH_UITGEZONDERD hierboven) — geeft bewust alleen tellingen terug, geen
// namen/IP's/topologie. "amber/rood" is hier de zwaarst-belaste-fase-vergelijking t.o.v. rating_a,
// zelfde conventie als overal elders (topology.js: statusOf()) — maar client-side bestaat die check
// alleen (leest de browser's eigen MQTT-liveData); dit endpoint berekent 'm hier opnieuw server-side
// via de laatste bekende meting per kast in InfluxDB (een venster van 10 minuten: recent genoeg om
// "huidige status" te heten, ruim genoeg om een gemiste meting niet meteen als "geen data" te tonen).
app.get('/api/hq-status', hqStatusLimiter, async (req, res) => {
  try {
    const data = readTopo();
    const kastIds = data.kasten.map((k) => k.id).filter(veiligeTagWaarde);
    if (!kastIds.length) return res.json({ kasten: 0, amberRood: 0, ts: Date.now() });
    const kastFilter = kastIds.map((id) => 'r.kast == "' + id + '"').join(' or ');
    const flux =
      'from(bucket: "' + INFLUX_BUCKET + '")\n' +
      '  |> range(start: -10m)\n' +
      '  |> filter(fn: (r) => r._measurement == "shelly_em")\n' +
      '  |> filter(fn: (r) => r._field == "a_current" or r._field == "b_current" or r._field == "c_current")\n' +
      '  |> filter(fn: (r) => ' + kastFilter + ')\n' +
      '  |> group(columns: ["kast", "_field"])\n' +
      '  |> last()\n' +
      '  |> keep(columns: ["kast", "_field", "_value"])';
    const csv = await influxQueryPlatteCsv(flux);
    const perKast = grafiekenAggregaatCsvGroeperen(csv, ['a_current', 'b_current', 'c_current']);
    let amberRood = 0;
    data.kasten.forEach((k) => {
      const veldMap = perKast.get(k.id);
      if (!veldMap || !veldMap.size || k.rating_a == null) return;
      const pct = (Math.max(...veldMap.values()) / k.rating_a) * 100;
      if (pct >= 70) amberRood++;
    });
    res.json({ kasten: data.kasten.length, amberRood, ts: Date.now() });
  } catch (e) {
    // vervolgticket-toegang-van-buitenaf.md §6: geen ruwe Influx-foutmelding naar een anonieme
    // aanroeper lekken (dit endpoint is bewust ongeauthenticeerd) — wel gewoon loggen server-side
    console.error('fout in /api/hq-status:', e.message);
    res.status(502).json({ error: 'status tijdelijk niet beschikbaar' });
  }
});

// fan-out naar elke bekende locatie — elke fetch vangt zijn eigen fout/timeout af en resolvet altijd
// (nooit reject), zodat één trage/onbereikbare locatie de rest niet blokkeert (expliciete eis uit de
// diagnose); result.offline=true + geen tellingen is dan het signaal voor de grijze "—"-kaart.
app.get('/api/hq-locaties-status', async (req, res) => {
  const locaties = readLocaties();
  const resultaten = await Promise.all(locaties.map(async (loc) => {
    try {
      const r = await fetch(loc.url + '/api/hq-status', { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error('status ' + r.status);
      const d = await r.json();
      return { id: loc.id, naam: loc.naam, url: loc.url, offline: false, kasten: d.kasten, amberRood: d.amberRood };
    } catch (e) {
      return { id: loc.id, naam: loc.naam, url: loc.url, offline: true };
    }
  }));
  res.json(resultaten);
});

// migreert oudere topologieën waarin generators/leden nog geen `mqtt_topic_prefix` (generators) of
// `id`/`mqtt_topic_prefix` (leden van een groep) hebben.
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
  meetfactorRelay.meldTopologieWijziging(data);
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
// syncTopologyToInflux() (topology_edges) en het restore-endpoint (collision-check) gebruiken. ----------
// oudere instellingen.json-bestanden (van vóór het notificatiekanaal-item) missen 'notificaties' nog
// — read-time default, geen aparte migratiestap nodig (zelfde patroon als g.leden elders)
const NOTIFICATIE_KANALEN_DEFAULT = {
  telegram: { aan: false, bot_token: '', chat_id: '' },
  pushover: { aan: false, user_key: '', api_token: '' },
  ntfy: { aan: false, topic: '', server_url: '' },
  email: { aan: false, ontvangers: '', smtp_host: '', smtp_poort: '', smtp_gebruiker: '', smtp_wachtwoord: '' },
};
// welk veld per kanaal/bestemming een echt geheim is (token/wachtwoord/secret-key) — die komen nooit
// in platte tekst terug via GET /api/instellingen, zie specs/secrets-afscherming-plan.md. Overige
// velden (chat-ID, ntfy-topic, SFTP-host/gebruiker, S3-access-key, enz.) zijn geen geheim en blijven
// gewoon zichtbaar. AUTOMATISCHE_BACKUP_GEHEIM_VELD_PER_BESTEMMING staat verderop bij die sectie.
const NOTIFICATIE_GEHEIM_VELD_PER_KANAAL = { telegram: 'bot_token', pushover: 'api_token', email: 'smtp_wachtwoord' };
// een geheim veld in een PUT-body is drieledig: leeg/afwezig = ongewijzigd laten, `null` = expliciet
// wissen (de "Wissen"-link in de UI), een echte string = nieuwe waarde opslaan
function saniteerGeheimVeld(nieuweWaarde, bestaandeWaarde) {
  if (nieuweWaarde === null) return '';
  if (nieuweWaarde == null || nieuweWaarde === '') return bestaandeWaarde || '';
  return String(nieuweWaarde);
}
// vervangt geheime velden door een `<veld>_ingesteld`-boolean vóórdat instellingen.json de browser
// bereikt — interne aanroepers (stuurTelegram/stuurEmail/provisionGrafanaContactPoints/enz.) blijven
// gewoon readInstellingen() gebruiken en krijgen de echte waarden, alleen dit HTTP-antwoord is geredigeerd
function redigeerGeheimen(data) {
  const kopie = JSON.parse(JSON.stringify(data));
  if (kopie.notificaties) {
    Object.entries(NOTIFICATIE_GEHEIM_VELD_PER_KANAAL).forEach(([kanaal, veld]) => {
      const cfg = kopie.notificaties[kanaal];
      if (!cfg) return;
      cfg[veld + '_ingesteld'] = !!cfg[veld];
      delete cfg[veld];
    });
  }
  if (kopie.automatischeBackup && kopie.automatischeBackup.bestemmingen) {
    Object.entries(AUTOMATISCHE_BACKUP_GEHEIM_VELD_PER_BESTEMMING).forEach(([bestemming, veld]) => {
      const cfg = kopie.automatischeBackup.bestemmingen[bestemming];
      if (!cfg) return;
      cfg[veld + '_ingesteld'] = !!cfg[veld];
      delete cfg[veld];
    });
  }
  return kopie;
}
function readInstellingen() {
  const data = JSON.parse(fs.readFileSync(INSTELLINGEN_FILE, 'utf8'));
  if (!data.notificaties) data.notificaties = JSON.parse(JSON.stringify(NOTIFICATIE_KANALEN_DEFAULT));
  // AUTOMATISCHE_BACKUP_DEFAULT staat verderop in dit bestand (bij de automatische-back-up-sectie)
  // maar is hier al bruikbaar: deze functie wordt pas ná volledige module-evaluatie aangeroepen
  // (route-handlers/async callbacks), niet tijdens het top-level inladen zelf
  if (!data.automatischeBackup) data.automatischeBackup = JSON.parse(JSON.stringify(AUTOMATISCHE_BACKUP_DEFAULT));
  return data;
}
function writeInstellingen(data) { fs.writeFileSync(INSTELLINGEN_FILE, JSON.stringify(data, null, 2), 'utf8'); }

app.get('/api/instellingen', (req, res) => res.json(redigeerGeheimen(readInstellingen())));
app.put('/api/instellingen', (req, res) => {
  const { event_name, event_edition } = req.body || {};
  if (!veiligeTagWaarde(event_name) || !veiligeTagWaarde(event_edition)) {
    return res.status(400).json({ error: 'evenementnaam en editie zijn verplicht en mogen alleen letters, cijfers, "_" of "-" bevatten' });
  }
  // spread van de bestaande instellingen: dit endpoint gaat alleen over event_name/event_edition,
  // een kale overwrite zou het notificaties-blok hieronder stilzwijgend wissen
  writeInstellingen({ ...readInstellingen(), event_name, event_edition });
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

// ---------- Alert-notificaties: kanaal waarop de bestaande Grafana-alert-condities (90%-
// belastingsdrempel per fase) een bericht sturen (zie specs/notificatiekanaal-plan.md). Twee
// paden gebruiken dezelfde stuur*()-functies: de "Stuur testbericht"-knop (rechtstreeks, buiten
// Grafana om) en de webhook die Grafana's eigen alerting aanroept via de hieronder geprovisioneerde
// contact points (voor ntfy, dat geen native Grafana-contact-point-type heeft). ----------
// `bestaand` = de al opgeslagen config van dit kanaal (ongeredigeerd, uit readInstellingen()) —
// nodig om een leeg-gelaten geheim veld te kunnen laten staan i.p.v. per ongeluk te wissen
function saniteerKanaalConfig(kanaal, cfg, bestaand) {
  const defaults = NOTIFICATIE_KANALEN_DEFAULT[kanaal];
  const bron = cfg || {};
  const schoon = { aan: !!bron.aan };
  const geheimVeld = NOTIFICATIE_GEHEIM_VELD_PER_KANAAL[kanaal];
  Object.keys(defaults).forEach((key) => {
    if (key === 'aan') return;
    if (key === geheimVeld) {
      schoon[key] = saniteerGeheimVeld(bron[key], bestaand ? bestaand[key] : '');
      return;
    }
    schoon[key] = bron[key] != null ? String(bron[key]) : '';
  });
  return schoon;
}
function saniteerNotificaties(body, bestaandeNotificaties) {
  const result = {};
  Object.keys(NOTIFICATIE_KANALEN_DEFAULT).forEach((kanaal) => {
    result[kanaal] = saniteerKanaalConfig(kanaal, (body || {})[kanaal], (bestaandeNotificaties || {})[kanaal]);
  });
  return result;
}

async function stuurTelegram(cfg, onderwerp, tekst) {
  if (!cfg.bot_token || !cfg.chat_id) throw new Error('bot-token en chat-ID zijn verplicht');
  const res = await fetch('https://api.telegram.org/bot' + cfg.bot_token + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.chat_id, text: onderwerp + '\n\n' + tekst }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.description || ('Telegram gaf ' + res.status));
}
async function stuurPushover(cfg, onderwerp, tekst) {
  if (!cfg.user_key || !cfg.api_token) throw new Error('user key en API-token zijn verplicht');
  const params = new URLSearchParams({ token: cfg.api_token, user: cfg.user_key, title: onderwerp, message: tekst });
  const res = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status !== 1) throw new Error((data.errors && data.errors.join(', ')) || ('Pushover gaf ' + res.status));
}
async function stuurNtfy(cfg, onderwerp, tekst) {
  if (!cfg.topic) throw new Error('topic is verplicht');
  const server = (cfg.server_url || 'https://ntfy.sh').replace(/\/+$/, '');
  const res = await fetch(server + '/' + encodeURIComponent(cfg.topic), { method: 'POST', headers: { Title: onderwerp }, body: tekst });
  if (!res.ok) throw new Error('ntfy gaf ' + res.status + ': ' + (await res.text()));
}
async function stuurEmail(cfg, onderwerp, tekst) {
  if (!cfg.ontvangers || !cfg.smtp_host) throw new Error('ontvanger(s) en SMTP-host zijn verplicht');
  const nodemailer = require('nodemailer');
  const poort = cfg.smtp_poort ? Number(cfg.smtp_poort) : 587;
  const transport = nodemailer.createTransport({
    host: cfg.smtp_host, port: poort, secure: poort === 465,
    auth: cfg.smtp_gebruiker ? { user: cfg.smtp_gebruiker, pass: cfg.smtp_wachtwoord } : undefined,
  });
  await transport.sendMail({ from: cfg.smtp_gebruiker || 'stroom-dashboard@localhost', to: cfg.ontvangers, subject: onderwerp, text: tekst });
}
async function stuurNotificatie(kanaal, cfg, onderwerp, tekst) {
  if (kanaal === 'telegram') return stuurTelegram(cfg, onderwerp, tekst);
  if (kanaal === 'pushover') return stuurPushover(cfg, onderwerp, tekst);
  if (kanaal === 'ntfy') return stuurNtfy(cfg, onderwerp, tekst);
  if (kanaal === 'email') return stuurEmail(cfg, onderwerp, tekst);
  throw new Error('onbekend kanaal');
}

// Eén Grafana-contact-point "Stroomdashboard" met per aangezet kanaal een eigen integratie.
// Telegram/Pushover/e-mail zijn Grafana-native contact-point-types; ntfy heeft er geen (Grafana's
// generieke webhook-payload komt niet overeen met wat ntfy verwacht), dus dat kanaal loopt via een
// webhook terug naar deze webapp (/api/notificaties/grafana-webhook hieronder), die 'm met
// dezelfde stuurNtfy() als de testknop doorstuurt.
const GRAFANA_CONTACTPOINT_NAAM = 'Stroomdashboard';
const GRAFANA_DEFAULT_RECEIVER = 'grafana-default-email'; // Grafana's eigen ingebouwde standaard-ontvanger
const GRAFANA_CONTACTPOINT_UIDS = { telegram: 'stroomdash-telegram', pushover: 'stroomdash-pushover', email: 'stroomdash-email', ntfy: 'stroomdash-ntfy-webhook' };

function grafanaProvisioningHeaders() {
  if (!GRAFANA_ADMIN_PASSWORD) throw new Error('GRAFANA_PASSWORD is niet ingesteld in .env');
  return { Authorization: 'Basic ' + Buffer.from('admin:' + GRAFANA_ADMIN_PASSWORD).toString('base64'), 'Content-Type': 'application/json' };
}
function grafanaContactPointBody(kanaal, cfg) {
  const uid = GRAFANA_CONTACTPOINT_UIDS[kanaal];
  if (kanaal === 'telegram') return { uid, name: GRAFANA_CONTACTPOINT_NAAM, type: 'telegram', settings: { bottoken: cfg.bot_token, chatid: cfg.chat_id } };
  if (kanaal === 'pushover') return { uid, name: GRAFANA_CONTACTPOINT_NAAM, type: 'pushover', settings: { apiToken: cfg.api_token, userKey: cfg.user_key } };
  if (kanaal === 'email') return { uid, name: GRAFANA_CONTACTPOINT_NAAM, type: 'email', settings: { addresses: cfg.ontvangers.split(',').map((s) => s.trim()).filter(Boolean).join(';') } };
  // vervolgticket-toegang-van-buitenaf-ronde2.md §4: deze webhook is een container-naar-container-
  // aanroep zonder browser-sessie, dus staat (terecht) niet in AUTH_UITGEZONDERD — Grafana moet zich
  // legitimeren met hetzelfde INTERNAL_API_TOKEN als de simulator, via Grafana's eigen
  // authorization_scheme/authorization_credentials-velden (zet de Authorization-header, zie
  // heeftGeldigInternToken() hierboven). Leeg als INTERNAL_API_TOKEN niet ingesteld is — de webhook
  // krijgt dan gewoon een 401 totdat dat alsnog gebeurt (zie de waarschuwing in de provisioning-lus
  // hieronder).
  return {
    uid, name: GRAFANA_CONTACTPOINT_NAAM, type: 'webhook',
    settings: {
      url: 'http://webapp:8080/api/notificaties/grafana-webhook',
      httpMethod: 'POST',
      authorization_scheme: 'Bearer',
      authorization_credentials: INTERNAL_API_TOKEN,
    },
  };
}

// Best effort: als Grafana niet bereikbaar is of het admin-wachtwoord ontbreekt, faalt het
// opslaan van de instellingen zelf niet mee (zelfde patroon als syncTopologyToInflux hierboven) —
// de aanroeper (PUT /api/instellingen/notificaties) geeft de fout apart terug als waarschuwing.
async function provisionGrafanaContactPoints(notificaties) {
  const headers = grafanaProvisioningHeaders();
  const fouten = [];

  // fase 1: aangezette kanalen eerst aanmaken/bijwerken, elk in een eigen try/catch — een kanaal
  // dat aanstaat maar nog onvolledig ingevuld is (bijv. net aangevinkt, velden nog leeg) mag de
  // provisioning van de ANDERE, wél correcte kanalen niet blokkeren (vastgesteld tijdens testen:
  // zonder deze isolatie gooide één lege config de hele lus om)
  let aantalGeslaagd = 0;
  for (const kanaal of Object.keys(GRAFANA_CONTACTPOINT_UIDS)) {
    const cfg = notificaties[kanaal];
    if (!cfg || !cfg.aan) continue;
    if (kanaal === 'ntfy' && !INTERNAL_API_TOKEN) {
      fouten.push('ntfy: INTERNAL_API_TOKEN is niet ingesteld (of staat nog op de .env.example-placeholder) — Grafana kan zich niet bij de webhook legitimeren, alerts komen niet aan totdat dat opgelost is');
    }
    const uid = GRAFANA_CONTACTPOINT_UIDS[kanaal];
    try {
      const body = grafanaContactPointBody(kanaal, cfg);
      const putRes = await fetch(GRAFANA_URL + '/api/v1/provisioning/contact-points/' + uid, { method: 'PUT', headers, body: JSON.stringify(body) });
      if (putRes.status === 404) {
        const createRes = await fetch(GRAFANA_URL + '/api/v1/provisioning/contact-points', { method: 'POST', headers, body: JSON.stringify(body) });
        if (!createRes.ok) throw new Error('aanmaken gaf ' + createRes.status + ': ' + (await createRes.text()));
      } else if (!putRes.ok) {
        throw new Error('bijwerken gaf ' + putRes.status + ': ' + (await putRes.text()));
      }
      aantalGeslaagd++;
    } catch (e) {
      fouten.push(kanaal + ': ' + e.message);
    }
  }

  // fase 2: de policy bijwerken VÓÓR het verwijderen van uitgezette kanalen (fase 3) — anders
  // weigert Grafana de laatste overgebleven integratie onder "Stroomdashboard" te verwijderen
  // zodra de policy daar op dat moment nog naar wijst (referentie-integriteit, ontdekt tijdens
  // testen: alles-tegelijk-uitzetten gaf een 500 "failed to delete contact point" op het laatst
  // overgebleven kanaal, met de policy nog op de oude volgorde)
  const receiver = aantalGeslaagd > 0 ? GRAFANA_CONTACTPOINT_NAAM : GRAFANA_DEFAULT_RECEIVER;
  const policyRes = await fetch(GRAFANA_URL + '/api/v1/provisioning/policies', {
    method: 'PUT', headers, body: JSON.stringify({ receiver, group_by: ['grafana_folder', 'alertname'] }),
  });
  if (!policyRes.ok) fouten.push('notification policy: bijwerken gaf ' + policyRes.status + ': ' + (await policyRes.text()));

  // fase 3: nu pas de uitgezette kanalen verwijderen
  for (const kanaal of Object.keys(GRAFANA_CONTACTPOINT_UIDS)) {
    const cfg = notificaties[kanaal];
    if (cfg && cfg.aan) continue;
    const uid = GRAFANA_CONTACTPOINT_UIDS[kanaal];
    try {
      const delRes = await fetch(GRAFANA_URL + '/api/v1/provisioning/contact-points/' + uid, { method: 'DELETE', headers });
      if (!delRes.ok) throw new Error('verwijderen gaf ' + delRes.status + ': ' + (await delRes.text()));
    } catch (e) {
      fouten.push(kanaal + ': ' + e.message);
    }
  }

  if (fouten.length) throw new Error(fouten.join('; '));
}

app.put('/api/instellingen/notificaties', async (req, res) => {
  const bestaande = readInstellingen();
  const notificaties = saniteerNotificaties(req.body, bestaande.notificaties);
  writeInstellingen({ ...bestaande, notificaties });
  let grafanaFout = null;
  try { await provisionGrafanaContactPoints(notificaties); }
  catch (e) { grafanaFout = e.message; console.error('Grafana-provisioning voor alert-notificaties mislukt:', e.message); }
  res.json({ ok: true, grafanaFout });
});

app.post('/api/instellingen/notificaties/test/:kanaal', async (req, res) => {
  const kanaal = req.params.kanaal;
  if (!NOTIFICATIE_KANALEN_DEFAULT[kanaal]) return res.status(404).json({ error: 'onbekend kanaal' });
  // val terug op het al opgeslagen geheim als het testformulier dat veld leeg liet (zie
  // saniteerGeheimVeld) — zo kan een al ingesteld kanaal getest worden zonder het geheim opnieuw in
  // te typen
  const cfg = saniteerKanaalConfig(kanaal, req.body, readInstellingen().notificaties[kanaal]);
  try {
    await stuurNotificatie(kanaal, cfg, 'Stroom-Dashboard testbericht', 'Testbericht vanuit Stroom-Dashboard (' + new Date().toLocaleString('nl-NL') + ')');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// vangt Grafana's alertmanager-webhook-payload op (geconfigureerd via het "ntfy"-contact-point
// hierboven) en stuurt 'm door naar ntfy — alleen bereikbaar/zinvol als het ntfy-kanaal aanstaat
app.post('/api/notificaties/grafana-webhook', async (req, res) => {
  const { notificaties } = readInstellingen();
  const ntfyCfg = notificaties && notificaties.ntfy;
  if (!ntfyCfg || !ntfyCfg.aan) return res.status(404).json({ error: 'ntfy-kanaal is niet aangezet' });
  const payload = req.body || {};
  const status = payload.status === 'resolved' ? 'opgelost' : 'actief';
  const alertnamen = Array.isArray(payload.alerts) && payload.alerts.length
    ? payload.alerts.map((a) => (a.labels && a.labels.alertname) || '?').join(', ')
    : (payload.commonLabels && payload.commonLabels.alertname) || 'Grafana-alert';
  try {
    await stuurNtfy(ntfyCfg, 'Stroom-Dashboard alert', 'Status: ' + status + '\n' + alertnamen);
    res.json({ ok: true });
  } catch (e) {
    console.error('doorsturen Grafana-webhook naar ntfy mislukt:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// zodat de webapp-UI het Testdata-tabblad alleen toont als de bijbehorende endpoints ook echt werken
app.get('/api/test-mode', async (req, res) => res.json({ testMode: await isTestMode() }));

// ---------- i18n: platte dot-key vertaalbestanden, gedeeld client (fetch) + server (require voor
// het PDF-rapport) — één bron van waarheid ----------
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

// ---------- knikpunten bijwerken (bochten in de lijn kast<->voedingsbron, kalibratiemodus) ----------
// vervangt steeds de hele array in één keer (toevoegen/verslepen/verwijderen/resetten lopen allemaal
// via dit ene endpoint) — alleen kasten hebben een inkomende lijn, generators niet, dus geen lookup
// in data.generators zoals bij /positie hierboven.
app.post('/api/topology/knikpunten', (req, res) => {
  const { id, knikpunten } = req.body || {};
  if (!id || !Array.isArray(knikpunten)) return res.status(400).json({ error: 'id en knikpunten (array) zijn verplicht' });
  if (!knikpunten.every(p => p && typeof p.x_pct === 'number' && typeof p.y_pct === 'number')) {
    return res.status(400).json({ error: 'elk knikpunt moet x_pct en y_pct (getallen) hebben' });
  }
  const data = readTopo();
  const kast = data.kasten.find(k => k.id === id);
  if (!kast) return res.status(404).json({ error: 'onbekende kast-id: ' + id });
  kast.knikpunten = knikpunten;
  writeTopo(data);
  res.json({ ok: true, kast });
});

// ---------- viewport-kalibratie (specs/live-viewport-grote-monitor-plan.md, fase 3): welk deel van
// de tekening Live toont — top-level veld op de topologie (net als generators/kasten), niet per node,
// want dit is een eigenschap van de hele tekening. Server-side (i.p.v. alleen localStorage) omdat
// dit voor ELKE viewer van Live hetzelfde moet zijn, geen per-browser-voorkeur zoals zoom/rotatie. ----------
app.post('/api/topology/viewport', (req, res) => {
  const { actief, x_pct, y_pct, w_pct, h_pct } = req.body || {};
  const data = readTopo();
  if (actief === false) {
    data.viewport = null; // "Reset naar volledige tekening"
  } else {
    const velden = { x_pct, y_pct, w_pct, h_pct };
    if (Object.values(velden).some((v) => typeof v !== 'number' || v < 0 || v > 100)) {
      return res.status(400).json({ error: 'x_pct/y_pct/w_pct/h_pct zijn verplicht en moeten getallen tussen 0 en 100 zijn' });
    }
    if (w_pct <= 0 || h_pct <= 0 || x_pct + w_pct > 100 + 1e-6 || y_pct + h_pct > 100 + 1e-6) {
      return res.status(400).json({ error: 'viewport moet binnen de tekening (0-100%) vallen en een positieve breedte/hoogte hebben' });
    }
    data.viewport = { x_pct, y_pct, w_pct, h_pct };
  }
  writeTopo(data);
  res.json({ ok: true, viewport: data.viewport });
});

// ---------- generators beheren ----------
// een generator-node is normaal gesproken één aggregaat ('generator') of accu ('batterij'), maar kan ook
// een 'groep' zijn: één logische krachtbron die intern uit meerdere generators/accu's bestaat (bijv. een
// centrale met 6 aggregaten + een CAT-batterijcontainer die onderling load-sharen of elkaar back-uppen met
// automatische start). Kasten koppelen dan aan de groep zelf, niet aan een los lid — precies zoals het er
// in het veld ook uitziet (één aansluitpunt, intern beheerd). Een lid heeft naam/kVA/type, en sinds de
// generator-EM-rework ook een eigen stabiele `id` +
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
      // Shelly+CT-klem heeft
      rating_a: (l.rating_a != null && l.rating_a !== '') ? Number(l.rating_a) : null,
      shelly_ip: l.shelly_ip ? String(l.shelly_ip).trim() : null,
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

// specs/shelly-vervanging-plan.md: een shelly_ip-wijziging telt als "vervanging" zodra er al eerder
// een ander, niet-leeg shelly_ip stond — puur op de waarde-vergelijking, niet gekoppeld aan welke
// knop de aanroep deed, zodat ook een rechtstreekse bewerking van het IP-veld gelogd wordt (geen
// aparte "dit is een vervanging"-vlag nodig). De allereerste keer een IP invullen (vorigShellyIp
// leeg) is geen vervanging. Geeft het ONGEWIJZIGDE `bestaandeVervangingen`-array terug als er niets
// te loggen valt (kan `undefined` zijn) — de aanroeper hoeft dus alleen te herschrijven als de
// waarde ook echt verandert, geen kale `vervangingen: []` op elke kast/generator/lid die nog nooit
// vervangen is.
function nieuweVervangingenArray(vorigShellyIp, nieuwShellyIp, bestaandeVervangingen) {
  if (!vorigShellyIp || nieuwShellyIp === vorigShellyIp) return bestaandeVervangingen;
  const vervangingen = Array.isArray(bestaandeVervangingen) ? bestaandeVervangingen.slice() : [];
  vervangingen.push({ op: new Date().toISOString(), vorig_ip: vorigShellyIp, nieuw_ip: nieuwShellyIp });
  return vervangingen;
}

app.post('/api/generators', (req, res) => {
  const { naam, vermogen_kva, type, rating_a, shelly_ip } = req.body || {};
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
    shelly_ip: shelly_ip ? String(shelly_ip).trim() : null,
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
  const { naam, vermogen_kva, type, groep_soort, leden, rating_a, shelly_ip } = req.body || {};
  if (naam) gen.naam = naam;
  if (vermogen_kva) gen.vermogen_kva = Number(vermogen_kva);
  if (rating_a !== undefined) gen.rating_a = rating_a === '' || rating_a === null ? null : Number(rating_a);
  if (shelly_ip !== undefined) {
    const nieuweShellyIp = shelly_ip ? String(shelly_ip).trim() : null;
    const vervangingen = nieuweVervangingenArray(gen.shelly_ip, nieuweShellyIp, gen.vervangingen);
    if (vervangingen) gen.vervangingen = vervangingen;
    gen.shelly_ip = nieuweShellyIp;
  }
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
    // specs/shelly-vervanging-plan.md: de hele leden-array wordt in één keer meegestuurd, dus
    // normaliseerLeden() bouwt telkens verse lid-objecten — oude leden (matchen op het bestaande
    // `id`, zie normaliseerLeden()'s toelichting) opzoeken om per lid shelly_ip-wijzigingen te
    // vergelijken en een eventueel bestaand vervangingen-array mee te dragen naar het nieuwe object
    const oudeLedenPerId = new Map((gen.leden || []).filter(l => l.id).map(l => [l.id, l]));
    const nieuweLeden = normaliseerLeden(leden);
    nieuweLeden.forEach(lid => {
      const oud = lid.id ? oudeLedenPerId.get(lid.id) : null;
      if (oud) {
        const vervangingen = nieuweVervangingenArray(oud.shelly_ip, lid.shelly_ip, oud.vervangingen);
        if (vervangingen) lid.vervangingen = vervangingen;
      }
    });
    gen.leden = nieuweLeden;
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

// specs/generator-groep-powerplant-plan.md: bestaande, losse generators samenvoegen tot één nieuwe
// groep — de kasten die eronder hingen verhuizen mee (kast.generator wijst voortaan naar de
// groep-id), de samengevoegde generators zelf worden leden van de groep. Eén atomaire aanroep i.p.v.
// losse create/update/delete-rondjes vanuit de client, en één writeTopo() aan het einde i.p.v. stap
// voor stap — voorkomt een half-gemigreerde toestand als er halverwege iets misgaat (bijv. een
// ongeldig id ertussen): alle validatie gebeurt vóórdat er iets aan `data` verandert.
app.post('/api/generators/groeperen', (req, res) => {
  const { naam, vermogen_kva, groep_soort, generator_ids } = req.body || {};
  if (!naam || typeof naam !== 'string' || !naam.trim()) return res.status(400).json({ error: 'naam is verplicht' });
  if (!Array.isArray(generator_ids) || generator_ids.length < 2) return res.status(400).json({ error: 'minstens 2 generators nodig om te groeperen' });
  if (groep_soort && !GROEP_SOORTEN.includes(groep_soort)) return res.status(400).json({ error: 'ongeldig groep_soort' });

  const data = readTopo();
  const teGroeperen = [];
  for (const id of generator_ids) {
    const gen = data.generators.find(g => g.id === id);
    if (!gen) return res.status(400).json({ error: 'onbekende generator: ' + id });
    if (gen.type === 'groep') return res.status(400).json({ error: 'generator ' + gen.naam + ' is zelf al een groep — geneste groepen worden niet ondersteund' });
    teGroeperen.push(gen);
  }
  if (new Set(generator_ids).size !== generator_ids.length) return res.status(400).json({ error: 'dezelfde generator staat meerdere keren in de selectie' });

  const teGroeperenIds = new Set(generator_ids);
  const alleIds = [...data.generators.map(g => g.id), ...data.kasten.map(k => k.id)];
  const groepId = uniekeId(slugify(naam), alleIds);
  const totaalKva = teGroeperen.reduce((som, g) => som + (Number(g.vermogen_kva) || 0), 0);
  const groep = {
    id: groepId, naam: naam.trim(),
    vermogen_kva: vermogen_kva ? Number(vermogen_kva) : totaalKva,
    positie: { x_pct: null, y_pct: null },
    type: 'groep', groep_soort: groep_soort || null,
    leden: teGroeperen.map(g => ({
      naam: g.naam, type: g.type === 'batterij' ? 'batterij' : 'generator',
      vermogen_kva: g.vermogen_kva != null ? Number(g.vermogen_kva) : null,
      rating_a: g.rating_a != null ? Number(g.rating_a) : null,
      shelly_ip: g.shelly_ip || null,
    })),
    rating_a: null, shelly_ip: null,
    mqtt_topic_prefix: mqttPrefix(groepId, groepId),
  };
  voorzieLedenVanIdEnPrefix(groep, data);

  data.generators = data.generators.filter(g => !teGroeperenIds.has(g.id));
  data.generators.push(groep);
  data.kasten.forEach(k => {
    if (teGroeperenIds.has(k.generator)) {
      k.generator = groepId;
      k.mqtt_topic_prefix = mqttPrefix(groepId, k.id);
    }
  });

  writeTopo(data);
  res.json({ ok: true, generator: groep });
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
    afkorting: afkorting || undefined, shelly_ip: null, meetfactor: null,
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
  const { naam, rating_a, generator, parent, afkorting, type, heeft_bypass, shelly_ip, meetfactor } = req.body || {};

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
  if (shelly_ip !== undefined) {
    const nieuweShellyIp = shelly_ip ? String(shelly_ip).trim() : null;
    const vervangingen = nieuweVervangingenArray(kast.shelly_ip, nieuweShellyIp, kast.vervangingen);
    if (vervangingen) kast.vervangingen = vervangingen;
    kast.shelly_ip = nieuweShellyIp;
  }
  // specs/dubbel-veld-meetfactor-plan.md: modelmatige correctiefactor voor een kast met een "dubbel
  // veld" (2 parallelle Powerlock-sets naar dezelfde afnemer, maar ruimte voor maar 1 CT-klem) —
  // leeg/null = geen correctie. Alleen zinvol met een ingevuld shelly_ip, maar geen harde
  // validatiefout zonder: de meetfactor-relay (meetfactor-relay.js) negeert 'm dan gewoon.
  if (meetfactor !== undefined) {
    if (meetfactor === null || meetfactor === '') {
      kast.meetfactor = null;
    } else {
      const nieuweFactor = Number(meetfactor);
      if (!Number.isFinite(nieuweFactor) || nieuweFactor <= 0 || nieuweFactor > 10) {
        return res.status(400).json({ error: 'meetfactor moet een getal tussen 0 en 10 zijn' });
      }
      kast.meetfactor = nieuweFactor;
    }
  }
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

// specs/shelly-auto-configuratie-plan.md: MQTT-instellingen (+ optioneel het snelheidsscript) in
// één actie naar een Shelly pushen, i.p.v. de handmatige route uit README §3 (die blijft als
// fallback bestaan). Bewuste designkeuze: geen shelly_ip/mqtt_topic_prefix in de request-body — de
// server zoekt die zelf op via readTopo() aan de hand van de meegestuurde id's, nooit een door de
// client aangeleverd IP-adres direct gebruiken. Voorkomt dat dit endpoint een SSRF-hefboom wordt
// (anders kan een ingelogde gebruiker de server naar willekeurig welk IP laten posten); met
// id-lookup kan er hoogstens naar een IP gestuurd worden dat al ergens in de eigen topologie als
// shelly_ip staat, wat sowieso al door een ingelogde beheerder zelf is ingevuld. Bijkomend voordeel:
// altijd het actuele, server-berekende mqtt_topic_prefix, nooit een stale client-kopie.
// Bulk-configuratie is bewust client-side (de browser roept dit endpoint na elkaar aan, max. 2
// tegelijk) — geen apart bulk-endpoint/streaming-infrastructuur nodig, zie de UI in render-beheer.js.
app.post('/api/shelly/configureren', async (req, res) => {
  const { doelType, id, generatorId, script } = req.body || {};
  const data = readTopo();
  let doel;
  if (doelType === 'kast') {
    doel = data.kasten.find((k) => k.id === id);
  } else if (doelType === 'generator') {
    doel = data.generators.find((g) => g.id === id);
  } else if (doelType === 'lid') {
    const gen = data.generators.find((g) => g.id === generatorId);
    doel = gen && (gen.leden || []).find((l) => l.id === id);
  } else {
    return res.status(400).json({ error: 'ongeldig doelType' });
  }
  if (!doel) return res.status(404).json({ error: 'doel niet gevonden' });
  if (!doel.shelly_ip) return res.status(400).json({ error: 'dit doel heeft geen Shelly-IP ingevuld' });

  const brokerHost = bepaalHostLanIp();
  if (!brokerHost) {
    return res.status(400).json({ error: 'geen LAN-IP bekend (lan-ip-detector-service) — kan geen broker-adres meesturen naar de Shelly' });
  }

  let scriptCode = null;
  if (script) {
    try {
      scriptCode = fs.readFileSync(SHELLY_SCRIPT_FILE, 'utf8');
    } catch (e) {
      return res.status(500).json({ error: 'kon shelly/em-fast-publish.js niet lezen: ' + e.message });
    }
  }

  // specs/dubbel-veld-meetfactor-plan.md: een kast met een actieve meetfactor publiceert niet
  // rechtstreeks op zijn eigen officiele topic, maar op een "ruwe" subtopic — meetfactor-relay.js
  // leest die, vermenigvuldigt, en publiceert het resultaat pas op de officiele topic. Alleen van
  // toepassing op kasten (huidige scope, zie plan); generators/leden altijd de gewone prefix.
  const heeftMeetfactor = doelType === 'kast' && doel.meetfactor && Number(doel.meetfactor) !== 1;
  const topicPrefix = heeftMeetfactor ? doel.mqtt_topic_prefix + '/ruw' : doel.mqtt_topic_prefix;
  const resultaat = await configureerShelly(doel.shelly_ip, {
    topicPrefix,
    brokerHost,
    metScript: !!script,
    scriptCode,
  });
  res.json(resultaat);
});

// ---------- alles wissen ----------
app.post('/api/reset', (req, res) => {
  const bestaand = readTopo();
  // viewport is een eigenschap van de tekening zelf (welk deel Live toont), niet van de geplaatste
  // generators/kasten — "Alles wissen" hoort een eerder ingestelde viewport-kalibratie dus niet mee
  // te wissen, net als toelichting hiernaast
  writeTopo({ generators: [], kasten: [], toelichting: bestaand.toelichting, viewport: bestaand.viewport });
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

// ---------- afbeeldingsuploads (plattegrond, logo): .png/.bmp/.svg (plattegrond ook .pdf) ----------
// De bestandsnaam-extensie en de Content-Type die de browser meestuurt zijn allebei door de
// client te vervalsen, dus die tellen alleen als eerste, snelle filter. De echte controle is
// het herkennen van het bestandstype aan de daadwerkelijke bytes na de upload.
const AFBEELDING_EXT = new Set(['.png', '.bmp', '.svg']);
const AFBEELDING_MIME = new Set(['image/png', 'image/bmp', 'image/x-ms-bmp', 'image/svg+xml']);
const AFBEELDING_EXT_BY_TYPE = { png: '.png', bmp: '.bmp', svg: '.svg' };
// alleen de plattegrond-upload accepteert ook een PDF (specs/plattegrond-tile-based-plan.md) — het
// logo blijft op de oorspronkelijke drie formaten, zie kaartFileFilter/afbeeldingFileFilter hieronder
const KAART_EXT = new Set(['.png', '.bmp', '.svg', '.pdf']);
const KAART_MIME = new Set(['image/png', 'image/bmp', 'image/x-ms-bmp', 'image/svg+xml', 'application/pdf']);

function afbeeldingFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!AFBEELDING_EXT.has(ext) || !AFBEELDING_MIME.has(file.mimetype)) {
    return cb(new Error('alleen .png, .bmp of .svg bestanden zijn toegestaan'));
  }
  cb(null, true);
}
function kaartFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!KAART_EXT.has(ext) || !KAART_MIME.has(file.mimetype)) {
    return cb(new Error('alleen .png, .bmp, .svg of .pdf bestanden zijn toegestaan'));
  }
  cb(null, true);
}

function detecteerAfbeeldingType(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'bmp';
  if (buffer.length >= 5 && buffer.slice(0, 5).toString('latin1') === '%PDF-') return 'pdf';
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
  if (!type || type === 'pdf') {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'bestand is geen geldige .png, .bmp of .svg afbeelding' });
  }
  verwijderAfbeeldingsbestanden(basename);
  fs.renameSync(req.file.path, basename + AFBEELDING_EXT_BY_TYPE[type]);
  res.json({ ok: true });
}

const upload = multer({ dest: DATA_DIR, limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: afbeeldingFileFilter });
// plattegrond-upload ruimer dan het logo: een uit PDF geconverteerde SVG-plattegrond kan met veel
// vectorpaden een stuk groter zijn dan een simpel logo-bestand
const kaartUpload = multer({ dest: DATA_DIR, limits: { fileSize: 300 * 1024 * 1024 }, fileFilter: kaartFileFilter });
// multer geeft een fileFilter-afwijzing door aan de Express-errorhandler; die hier meteen
// als nette 400 afvangen voorkomt dat de upload eindigt in een generieke 500.
function metUploadFoutafhandeling(middleware) {
  return (req, res, next) => middleware(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

// ---------- plattegrond: tegel-piramide (specs/plattegrond-tile-based-plan.md) ----------
const TILE_SIZE = 256;
const TILE_DREMPEL_LANGE_ZIJDE_PX = 2000;
const TILE_DREMPEL_MEGAPIXEL = 3_000_000;
// gedeeld tussen de PDF- en SVG-rasterisatie hieronder — beide zetten een vectorbron om naar een
// PNG van vergelijkbare maximale grootte, vóórdat diezelfde PNG het normale tegel-drempelpad volgt
const PLATTEGROND_MAX_LANGE_ZIJDE_PX = 5500;

function execFileP(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || '').toString().trim() || ('kon ' + cmd + ' niet uitvoeren')));
      resolve(stdout.toString());
    });
  });
}

// leest het paginaformaat (in PDF-punten, 1/72 inch) van de eerste pagina — nodig om de
// rasterisatie-DPI zo te kiezen dat het resultaat rond PDF_MAX_LANGE_ZIJDE_PX uitkomt, i.p.v. een
// vaste DPI blind toe te passen (een plattegrond-PDF kan van A4 tot een plotterformaat variëren)
async function pdfPaginaformaatInPunten(pdfPad) {
  const out = await execFileP('pdfinfo', [pdfPad]);
  const m = out.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)\s*pts/);
  if (!m) throw new Error('kon PDF-paginaformaat niet bepalen');
  return { w: parseFloat(m[1]), h: parseFloat(m[2]) };
}

// rasteriseert alleen de eerste pagina naar PNG; geeft het pad van het resultaat terug
async function rasteriseerPdfNaarPng(pdfPad, uitvoerBasispad) {
  const { w, h } = await pdfPaginaformaatInPunten(pdfPad);
  const langsteZijdePts = Math.max(w, h);
  let dpi = Math.round((PLATTEGROND_MAX_LANGE_ZIJDE_PX / langsteZijdePts) * 72);
  dpi = Math.max(72, Math.min(600, dpi));
  await execFileP('pdftoppm', ['-png', '-r', String(dpi), '-singlefile', '-f', '1', '-l', '1', pdfPad, uitvoerBasispad]);
  return uitvoerBasispad + '.png';
}

// een geüploade SVG-plattegrond (vaak een PDF->SVG-conversie: duizenden losse paden, hoge precisie,
// laag-/groep-cruft van de conversietool) wordt vóór opslag altijd naar PNG gerasteriseerd i.p.v.
// als vector bewaard — de browser hoeft dan nooit meer het hele, potentieel zeer zware vector-
// document zelf te downloaden/parsen, en het resultaat volgt daarna hetzelfde tegel-drempelpad als
// elke andere plattegrond. sharp/libvips rasteriseert SVG out-of-the-box (bundelt librsvg), geen
// extra systeem-dependency nodig zoals bij PDF (poppler-utils). sharp's default input-density voor
// SVG is 72dpi, dus metadata() zonder eigen density-optie geeft de "72dpi-brongrootte" terug —
// zelfde dpi-vanuit-doelgrootte-berekening als de PDF-rasterisatie hierboven, nu op basis daarvan
// i.p.v. PDF-paginapunten.
async function rasteriseerSvgNaarPng(svgPad, uitvoerBasispad) {
  const { width, height } = await sharp(svgPad).metadata();
  const langsteZijdePx = Math.max(width, height);
  let dpi = Math.round((PLATTEGROND_MAX_LANGE_ZIJDE_PX / langsteZijdePx) * 72);
  dpi = Math.max(72, Math.min(600, dpi));
  const uitvoerPad = uitvoerBasispad + '.png';
  await sharp(svgPad, { density: dpi }).png().toFile(uitvoerPad);
  return uitvoerPad;
}

async function moetTegelen(pngPad) {
  const meta = await sharp(pngPad).metadata();
  const langsteZijde = Math.max(meta.width, meta.height);
  return langsteZijde > TILE_DREMPEL_LANGE_ZIJDE_PX || meta.width * meta.height > TILE_DREMPEL_MEGAPIXEL;
}

function verwijderTegelbestanden() {
  const dzi = TILES_PREFIX + '.dzi';
  const filesDir = TILES_PREFIX + '_files';
  if (fs.existsSync(dzi)) fs.unlinkSync(dzi);
  if (fs.existsSync(filesDir)) fs.rmSync(filesDir, { recursive: true, force: true });
}

async function genereerTegels(pngPad) {
  verwijderTegelbestanden();
  // het uitvoerformaat van .tile() volgt de pipeline (.png() hiervóór), geen 'format'-optie ín
  // .tile() zelf — leverde zonder deze .png()-call stilzwijgend JPEG-tegels op i.p.v. PNG, ondanks
  // een eerdere (foutieve) format:'png'-tile-optie; empirisch bevestigd tijdens het bouwen
  await sharp(pngPad).png().tile({ size: TILE_SIZE, layout: 'dz' }).toFile(TILES_PREFIX);
}

// huidige plattegrond-status voor de client: getiled (met afmetingen uit de .dzi) of plat, of geen
// plattegrond. GET /api/map/meta hieronder serveert dit rechtstreeks.
function huidigeKaartMeta() {
  const dzi = TILES_PREFIX + '.dzi';
  if (fs.existsSync(dzi)) {
    const xml = fs.readFileSync(dzi, 'utf8');
    // Width/Height staan elk op hun eigen regel, volgorde niet gegarandeerd (empirisch: sharp
    // schrijft Height vóór Width) — losse matches i.p.v. één regex die volgorde aanneemt
    const wM = xml.match(/Width="(\d+)"/), hM = xml.match(/Height="(\d+)"/);
    if (wM && hM) {
      const width = +wM[1], height = +hM[1];
      return { exists: true, tiled: true, width, height, tileSize: TILE_SIZE, maxLevel: Math.ceil(Math.log2(Math.max(width, height))) };
    }
  }
  if (bestaandAfbeeldingsbestand(MAP_BASENAME)) return { exists: true, tiled: false };
  return { exists: false };
}

// hoofdverwerking voor een plattegrond-upload: PDF/SVG worden eerst naar PNG gerasteriseerd (een
// SVG dus bewust nooit als vector opgeslagen, zie rasteriseerSvgNaarPng hierboven), PNG boven de
// drempel wordt getiled, alles daaronder (incl. BMP, zie specs/plattegrond-tile-based-plan.md "BMP
// blijft altijd buiten tiling") blijft op het bestaande platte-bestand-pad.
async function verwerkKaartUpload(req, res) {
  const buffer = fs.readFileSync(req.file.path);
  let type = detecteerAfbeeldingType(buffer);
  if (!type) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'bestand is geen geldige .png, .bmp, .svg of .pdf plattegrond' });
  }

  let bronPad = req.file.path;
  const opruimen = [req.file.path];
  try {
    if (type === 'pdf') {
      bronPad = await rasteriseerPdfNaarPng(bronPad, req.file.path + '-gerasteriseerd');
      opruimen.push(bronPad);
      type = 'png';
    } else if (type === 'svg') {
      bronPad = await rasteriseerSvgNaarPng(bronPad, req.file.path + '-gerasteriseerd');
      opruimen.push(bronPad);
      type = 'png';
    }

    verwijderAfbeeldingsbestanden(MAP_BASENAME);
    verwijderTegelbestanden();

    if (type === 'png' && (await moetTegelen(bronPad))) {
      await genereerTegels(bronPad);
      return res.json({ ok: true, tiled: true });
    }
    fs.copyFileSync(bronPad, MAP_BASENAME + AFBEELDING_EXT_BY_TYPE[type]);
    res.json({ ok: true, tiled: false });
  } catch (e) {
    res.status(500).json({ error: 'kon plattegrond niet verwerken: ' + e.message });
  } finally {
    opruimen.forEach((p) => { if (fs.existsSync(p)) fs.unlinkSync(p); });
  }
}

app.post('/api/map', metUploadFoutafhandeling(kaartUpload.single('kaart')), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'geen bestand ontvangen (veldnaam moet "kaart" zijn)' });
  verwerkKaartUpload(req, res);
});
app.get('/api/map', (req, res) => {
  const bestand = bestaandAfbeeldingsbestand(MAP_BASENAME);
  if (!bestand) return res.status(404).send('nog geen plattegrond geupload');
  res.sendFile(bestand);
});
app.get('/api/map/meta', (req, res) => res.json(huidigeKaartMeta()));
app.get('/api/map/tiles/:level/:tile', (req, res) => {
  const { level, tile } = req.params;
  if (!/^\d+$/.test(level) || !/^\d+_\d+\.png$/.test(tile)) return res.status(400).end();
  const p = path.join(TILES_PREFIX + '_files', level, tile);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.sendFile(p);
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
const RAPPORT_DIR = path.join(DATA_DIR, 'rapporten');
if (!fs.existsSync(RAPPORT_DIR)) fs.mkdirSync(RAPPORT_DIR, { recursive: true });

// paneel-id's in grafana/dashboards/stroomdashboard.json, per aanvinkbaar rapportonderdeel —
// "alarmen" heeft geen paneel (nog geen alert-geschiedenis, zie roadmap.md),
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
// kan aannemen i.p.v. een volwaardige multi-tabel-Flux-CSV-parser nodig te hebben.
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
// instellingen-velden — allemaal dezelfde soort waarde.
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
// Grafana-dashboards / README.md sectie 6): alleen de kasten met parent:null bij een generator
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
        // group() hierboven merget series van verschillende Telegraf-"generaties" in elkaar (een
        // Telegraf-herstart via telegraf-herstarter/ krijgt een nieuwe host-tag, dus een andere
        // oorspronkelijke tabel) zonder de rijvolgorde te garanderen — integral() vereist expliciet
        // op _time gesorteerde input, anders kan het (soms negatieve) onzin-uitkomsten geven zodra
        // een periode over zo'n herstart heen loopt
        '  |> sort(columns: ["_time"])\n' +
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

// ---------- Grafieken-tabblad (roadmap-item, vrije ad-hoc analyse — specs/grafieken-tabblad-plan.md):
// historische tijdreeks-query voor het lijndiagram. Eerste bouwstap van dat item (zie de
// "Bouwvolgorde-suggestie" in de spec: Lijn eerst) — staaf/taart/heatmap/Sankey en live-modus
// volgen in een latere stap. Server-side downsampling is een harde eis uit de spec: bij "hele
// evenement" (mogelijk dagen aan ~1s-data) mag de ruwe puntenreeks niet naar de browser, dus
// aggregateWindow() met een venstergrootte afgeleid van de periodelengte i.p.v. een vaste
// resolutie. Meerdere-edities-vergelijking (jaar-op-jaar) is bewust nog niet meegenomen — dat
// vraagt de tijd-sinds-start-uitlijning uit voorspellende-piekbelasting-plan.md, de spec zelf
// stelt voor die twee samen te bouwen; dit endpoint filtert intussen gewoon op één editie. ----------
const GRAFIEKEN_MAX_PUNTEN = 800;

// welk(e) InfluxDB-veld(en) een metric+fase-combinatie nodig heeft. "Totaal" bij spanning heeft
// geen echt total_voltage-veld (i.t.t. stroom/vermogen, waar de Shelly zelf al een total_*-veld
// publiceert) — daarvoor vraagt dit de drie fasevelden op en middelt grafiekenCsvNaarSeries() ze,
// i.p.v. een fysiek onjuiste "som" te tonen.
function grafiekenVeldenVoorMetric(metric, fase) {
  if (metric === 'energie') {
    if (fase === 'alle') return { measurement: 'shelly_emdata', velden: ['a_total_act_energy', 'b_total_act_energy', 'c_total_act_energy'] };
    return { measurement: 'shelly_emdata', velden: fase === 'totaal' ? ['total_act'] : [fase + '_total_act_energy'] };
  }
  if (metric === 'spanning' && fase === 'totaal') {
    return { measurement: 'shelly_em', velden: ['a_voltage', 'b_voltage', 'c_voltage'] };
  }
  const suffix = { stroom: 'current', spanning: 'voltage', vermogen: 'act_power' }[metric];
  if (!suffix) return null;
  // grafieken-alle-fasen-plan.md: "alle" wil de drie rauwe per-fase-velden als aparte series terug
  // (géén gemiddelde/som, i.t.t. de spanning+totaal-uitzondering hierboven) — zie
  // grafiekenCsvNaarSeriesPerVeld() verderop, die deze drie velden 1-op-1 naar 3 series omzet.
  if (fase === 'alle') return { measurement: 'shelly_em', velden: ['a_' + suffix, 'b_' + suffix, 'c_' + suffix] };
  return { measurement: 'shelly_em', velden: [(fase === 'totaal' ? 'total_' : fase + '_') + suffix] };
}

// vervolgticket-grafieken-tabblad.md §1: rating_a is een PER-FASE rating (zie topology.js), bij
// fase "totaal" is de driefasen-som (total_current) daar niet één-op-één mee vergelijkbaar (pas
// rond ~300% van rating_a "rood") — voor de statuskleur specifiek de zwaarst-belaste van de drie
// fases nemen, zelfde conventie als maxFaseStroom() in topology.js voor de live-status-stip.
// Geldt alleen bij metric stroom + fase totaal; alle andere combinaties tonen/kleuren al met de
// juiste, één-op-één vergelijkbare grootheid en hebben geen aparte statuswaarde nodig.
function grafiekenStatusVeldenVoorMetric(metric, fase) {
  return (metric === 'stroom' && fase === 'totaal') ? ['a_current', 'b_current', 'c_current'] : null;
}

// Flux-duration-string voor aggregateWindow(), berekend uit de periodelengte zodat het aantal
// punten per lijn ongeveer GRAFIEKEN_MAX_PUNTEN blijft, ongeacht periodelengte
function grafiekenVensterVoorPeriode(vanMs, totMs) {
  return Math.max(1, Math.floor((totMs - vanMs) / 1000 / GRAFIEKEN_MAX_PUNTEN)) + 's';
}

// zet de platte pivot-CSV (kolommen: _time, kast, <veld1>[, <veld2>, <veld3>]) om naar
// [{ id, punten: [[epoch_ms, waarde], ...] }] — bij 3 velden (de spanning+totaal-uitzondering
// hierboven) is de waarde het gemiddelde van de drie, anders het ene veld direct. Skipt een rij
// stil als niet alle benodigde velden een getal hebben (liever geen punt dan een punt op een
// onvolledig gemiddelde).
// `combine` bepaalt hoe meerdere velden (bijv. de spanning+totaal-uitzondering, of de drie
// statusvelden hierboven) tot één waarde per punt worden samengevoegt — gemiddelde-van-de-aanwezige-
// velden als default, de statuswaarde-berekening hieronder geeft er zelf een max-variant aan mee.
// vervolgticket-grafieken-tabblad-ronde2.md §1: een rij pas overslaan als ALLE gevraagde velden
// ontbreken, niet zodra er ééntje mist (bijv. een eenfase-kast of een gat in precies één fase-veld)
// — anders viel de hele rij (en dus de statuskleur) stil weg i.p.v. terecht amber/rood te tonen op
// basis van de wél aanwezige fases. Beide combine-varianten (default-gemiddelde en de max-variant
// hieronder) filteren zelf NaN/ontbrekend uit vóórdat ze middelen/maximaliseren.
function grafiekenCsvNaarSeries(csv, velden, combine) {
  const comb = combine || ((getallen) => {
    const aanwezig = getallen.filter((n) => !isNaN(n));
    return aanwezig.reduce((a, b) => a + b, 0) / aanwezig.length;
  });
  const regels = csv.replace(/\r\n/g, '\n').trim().split('\n').filter((r) => r.trim());
  if (regels.length < 2) return [];
  const kolommen = regels[0].split(',');
  const tijdIdx = kolommen.indexOf('_time');
  const kastIdx = kolommen.indexOf('kast');
  const veldIdxen = velden.map((v) => kolommen.indexOf(v));
  if (tijdIdx === -1 || kastIdx === -1 || veldIdxen.some((i) => i === -1)) return [];
  const perKast = new Map();
  regels.slice(1).forEach((regel) => {
    const waarden = regel.split(',');
    const id = waarden[kastIdx];
    const getallen = veldIdxen.map((i) => parseFloat(waarden[i]));
    if (!id || getallen.every((n) => isNaN(n))) return;
    const t = Date.parse(waarden[tijdIdx]);
    if (isNaN(t)) return;
    if (!perKast.has(id)) perKast.set(id, []);
    perKast.get(id).push([t, comb(getallen)]);
  });
  return Array.from(perKast, ([id, punten]) => ({ id, punten }));
}

// grafieken-alle-fasen-plan.md: variant van grafiekenCsvNaarSeries() hierboven die de drie
// per-fase-velden NIET combineert maar als drie aparte series teruggeeft — alleen gebruikt bij
// fase "alle", waar de server al afdwingt dat er precies 1 kast/generator gequeried wordt, dus
// "id" is hier gewoon de faseletter (a/b/c) i.p.v. een kast-id.
function grafiekenCsvNaarSeriesPerVeld(csv, velden) {
  const regels = csv.replace(/\r\n/g, '\n').trim().split('\n').filter((r) => r.trim());
  if (regels.length < 2) return [];
  const kolommen = regels[0].split(',');
  const tijdIdx = kolommen.indexOf('_time');
  const veldIdxen = velden.map((v) => kolommen.indexOf(v));
  if (tijdIdx === -1 || veldIdxen.some((i) => i === -1)) return [];
  const labels = ['a', 'b', 'c'];
  const punten = labels.map(() => []);
  regels.slice(1).forEach((regel) => {
    const waarden = regel.split(',');
    const t = Date.parse(waarden[tijdIdx]);
    if (isNaN(t)) return;
    veldIdxen.forEach((i, idx) => {
      const w = parseFloat(waarden[i]);
      if (!isNaN(w)) punten[idx].push([t, w]);
    });
  });
  return labels.map((label, idx) => ({ id: label, punten: punten[idx] }));
}

app.get('/api/grafieken/tijdreeks', async (req, res) => {
  const { ids, metric, fase, van, tot, editie } = req.query;
  const idLijst = (ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!idLijst.length) return res.status(400).json({ error: 'ids is verplicht (komma-gescheiden)' });
  if (!idLijst.every(veiligeTagWaarde)) return res.status(400).json({ error: 'ongeldig id in ids' });
  if (!['a', 'b', 'c', 'totaal', 'alle'].includes(fase)) return res.status(400).json({ error: 'ongeldige fase' });
  // server-side afgedwongen, niet alleen de checklist client-side beperkt tot 1 selectie (zelfde
  // "echte afdwinging, niet alleen knopjes verstoppen"-principe als bij de rolverdeling-rechten)
  if (fase === 'alle' && idLijst.length !== 1) {
    return res.status(400).json({ error: 'fase alle werkt alleen met precies 1 id' });
  }
  if (!van || !tot || isNaN(Date.parse(van)) || isNaN(Date.parse(tot))) {
    return res.status(400).json({ error: 'van en tot zijn verplicht en moeten geldige datums zijn' });
  }
  const veldinfo = grafiekenVeldenVoorMetric(metric, fase);
  if (!veldinfo) return res.status(400).json({ error: 'ongeldige metric' });
  let editieFilter = '';
  if (editie && editie !== '__alle__') {
    const veiligeEditie = veiligeTagWaarde(editie);
    if (!veiligeEditie) return res.status(400).json({ error: 'ongeldige editie' });
    editieFilter = '  |> filter(fn: (r) => r.editie == "' + veiligeEditie + '")\n';
  }

  const vanMs = new Date(van).getTime(), totMs = new Date(tot).getTime();
  const venster = grafiekenVensterVoorPeriode(vanMs, totMs);
  const veldFilter = veldinfo.velden.map((v) => 'r._field == "' + v + '"').join(' or ');
  const kastFilter = idLijst.map((id) => 'r.kast == "' + id + '"').join(' or ');

  const flux =
    'from(bucket: "' + INFLUX_BUCKET + '")\n' +
    '  |> range(start: ' + new Date(vanMs).toISOString() + ', stop: ' + new Date(totMs).toISOString() + ')\n' +
    '  |> filter(fn: (r) => r._measurement == "' + veldinfo.measurement + '")\n' +
    '  |> filter(fn: (r) => ' + veldFilter + ')\n' +
    '  |> filter(fn: (r) => ' + kastFilter + ')\n' +
    editieFilter +
    '  |> group(columns: ["kast", "_field"])\n' +
    '  |> aggregateWindow(every: ' + venster + ', fn: mean, createEmpty: false)\n' +
    '  |> group(columns: ["kast"])\n' +
    '  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")\n' +
    '  |> sort(columns: ["_time"])\n' +
    '  |> keep(columns: ' + JSON.stringify(['_time', 'kast', ...veldinfo.velden]) + ')';

  try {
    const csv = await influxQueryPlatteCsv(flux);
    const series = fase === 'alle'
      ? grafiekenCsvNaarSeriesPerVeld(csv, veldinfo.velden)
      : grafiekenCsvNaarSeries(csv, veldinfo.velden);
    res.json({ series });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- Staafdiagram/taart/heatmap (zelfde roadmap-item, zie grafieken-tabblad-plan.md §2/4/5):
// één geaggregeerde waarde per kast/generator over de gekozen periode i.p.v. een tijdreeks.
// "Piekwaarde"/"Gemiddelde" werken op het rauwe veld (zelfde veldkeuze als het lijndiagram
// hierboven); "Periode-totaal" is alleen zinvol/beschikbaar bij metric "energie" en hergebruikt
// dezelfde integral(unit: 1h)-aanpak als /api/overzicht/energie (optellen van vermogen over tijd
// i.p.v. de rauwe cumulatieve teller aflezen — consistenter bij tellerresets/gaten) ----------
function grafiekenVermogenVeld(fase) {
  return fase === 'totaal' ? 'total_act_power' : fase + '_act_power';
}

// integral(unit: 1h) van het vermogensveld -> kWh over de gekozen periode voor één kast; gedeeld
// door /api/grafieken/aggregaat (aggregatie=totaal) en /api/grafieken/sankey hieronder
async function berekenEnergieKwh(id, veld, range, editieFilter) {
  const flux =
    'from(bucket: "' + INFLUX_BUCKET + '")\n' +
    '  |> ' + range + '\n' +
    '  |> filter(fn: (r) => r._measurement == "shelly_em")\n' +
    '  |> filter(fn: (r) => r._field == "' + veld + '")\n' +
    '  |> filter(fn: (r) => r.kast == "' + id + '")\n' +
    editieFilter +
    '  |> group(columns: ["kast"])\n' +
    '  |> sort(columns: ["_time"])\n' +
    '  |> integral(unit: 1h)\n' +
    '  |> keep(columns: ["_value"])';
  const csv = await influxQueryPlatteCsv(flux);
  const waarde = parseFloat(csvKolomWaarden(csv, '_value')[0]);
  return isNaN(waarde) ? 0 : waarde / 1000;
}

// csv-kolommen kast,_field,_value (geen _time nodig na max()/mean(), dus geen pivot() — voorkomt
// onduidelijk pivot-rowKey-gedrag op een al-gereduceerd resultaat). Groepeert per kast, veld -> waarde
// (geen combine-functie hier — grafiekenAggregaatCsvNaarWaarden() middelt, de statuswaarde-
// berekening hieronder neemt het max, vandaar apart gehouden)
function grafiekenAggregaatCsvGroeperen(csv, velden) {
  const regels = csv.replace(/\r\n/g, '\n').trim().split('\n').filter((r) => r.trim());
  if (regels.length < 2) return new Map();
  const kolommen = regels[0].split(',');
  const kastIdx = kolommen.indexOf('kast');
  const veldIdx = kolommen.indexOf('_field');
  const waardeIdx = kolommen.indexOf('_value');
  if (kastIdx === -1 || veldIdx === -1 || waardeIdx === -1) return new Map();
  const perKast = new Map();
  regels.slice(1).forEach((regel) => {
    const cellen = regel.split(',');
    const id = cellen[kastIdx];
    const veld = cellen[veldIdx];
    const waarde = parseFloat(cellen[waardeIdx]);
    if (!id || !velden.includes(veld) || isNaN(waarde)) return;
    if (!perKast.has(id)) perKast.set(id, new Map());
    perKast.get(id).set(veld, waarde);
  });
  return perKast;
}
// middelt over meerdere velden net als grafiekenCsvNaarSeries() (de spanning+totaal-uitzondering)
function grafiekenAggregaatCsvNaarWaarden(csv, velden) {
  const perKast = grafiekenAggregaatCsvGroeperen(csv, velden);
  return Array.from(perKast, ([id, veldMap]) => {
    const waarden = Array.from(veldMap.values());
    return { id, waarde: waarden.reduce((a, b) => a + b, 0) / waarden.length };
  });
}
// grafieken-alle-fasen-staaf-taart-plan.md: variant van grafiekenAggregaatCsvNaarWaarden()
// hierboven die de drie per-fase-velden NIET middelt maar als aparte {id, fase, waarde}-entries
// teruggeeft (tot 3 per id) — velden op volgorde gezipt met ['a','b','c'], zelfde volgorde-aanname
// als grafiekenCsvNaarSeriesPerVeld() bij het lijndiagram. Alleen entries voor velden die ook echt
// aanwezig zijn in de veldMap (vanzelf geen kunstmatige 0 bij bijv. een eenfase-aansluiting).
function grafiekenAggregaatCsvNaarWaardenPerVeld(csv, velden) {
  const perKast = grafiekenAggregaatCsvGroeperen(csv, velden);
  const faseLabels = ['a', 'b', 'c'];
  const resultaten = [];
  perKast.forEach((veldMap, id) => {
    velden.forEach((veld, idx) => {
      if (veldMap.has(veld)) resultaten.push({ id, fase: faseLabels[idx], waarde: veldMap.get(veld) });
    });
  });
  return resultaten;
}

app.get('/api/grafieken/aggregaat', async (req, res) => {
  const { ids, metric, fase, van, tot, editie, aggregatie } = req.query;
  const idLijst = (ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!idLijst.length) return res.status(400).json({ error: 'ids is verplicht (komma-gescheiden)' });
  if (!idLijst.every(veiligeTagWaarde)) return res.status(400).json({ error: 'ongeldig id in ids' });
  if (!['a', 'b', 'c', 'totaal', 'alle'].includes(fase)) return res.status(400).json({ error: 'ongeldige fase' });
  if (!['piek', 'gemiddelde', 'totaal'].includes(aggregatie)) return res.status(400).json({ error: 'ongeldige aggregatie' });
  if (aggregatie === 'totaal' && metric !== 'energie') return res.status(400).json({ error: 'periode-totaal is alleen beschikbaar bij metric energie' });
  if (!van || !tot || isNaN(Date.parse(van)) || isNaN(Date.parse(tot))) {
    return res.status(400).json({ error: 'van en tot zijn verplicht en moeten geldige datums zijn' });
  }
  let editieFilter = '';
  if (editie && editie !== '__alle__') {
    const veiligeEditie = veiligeTagWaarde(editie);
    if (!veiligeEditie) return res.status(400).json({ error: 'ongeldige editie' });
    editieFilter = '  |> filter(fn: (r) => r.editie == "' + veiligeEditie + '")\n';
  }
  const vanMs = new Date(van).getTime(), totMs = new Date(tot).getTime();
  const range = 'range(start: ' + new Date(vanMs).toISOString() + ', stop: ' + new Date(totMs).toISOString() + ')';
  const kastFilter = idLijst.map((id) => 'r.kast == "' + id + '"').join(' or ');

  try {
    if (aggregatie === 'totaal') {
      if (fase === 'alle') {
        // grafieken-alle-fasen-staaf-taart-plan.md: per id 3 aanroepen (a/b/c) i.p.v. 1 —
        // grafiekenVermogenVeld() hoeft niet aangepast, accepteert al een willekeurige faseletter
        const resultaten = (await Promise.all(idLijst.map((id) =>
          Promise.all(['a', 'b', 'c'].map(async (f) => ({
            id, fase: f, waarde: await berekenEnergieKwh(id, grafiekenVermogenVeld(f), range, editieFilter),
          })))
        ))).flat();
        return res.json({ waarden: resultaten });
      }
      const veld = grafiekenVermogenVeld(fase);
      const resultaten = await Promise.all(idLijst.map(async (id) => ({ id, waarde: await berekenEnergieKwh(id, veld, range, editieFilter) })));
      return res.json({ waarden: resultaten });
    }

    const veldinfo = grafiekenVeldenVoorMetric(metric, fase);
    if (!veldinfo) return res.status(400).json({ error: 'ongeldige metric' });
    const veldFilter = veldinfo.velden.map((v) => 'r._field == "' + v + '"').join(' or ');
    const fn = aggregatie === 'piek' ? 'max' : 'mean';
    const flux =
      'from(bucket: "' + INFLUX_BUCKET + '")\n' +
      '  |> ' + range + '\n' +
      '  |> filter(fn: (r) => r._measurement == "' + veldinfo.measurement + '")\n' +
      '  |> filter(fn: (r) => ' + veldFilter + ')\n' +
      '  |> filter(fn: (r) => ' + kastFilter + ')\n' +
      editieFilter +
      '  |> group(columns: ["kast", "_field"])\n' +
      '  |> ' + fn + '()\n' +
      '  |> keep(columns: ["kast", "_field", "_value"])';
    const csv = await influxQueryPlatteCsv(flux);
    const waarden = fase === 'alle'
      ? grafiekenAggregaatCsvNaarWaardenPerVeld(csv, veldinfo.velden)
      : grafiekenAggregaatCsvNaarWaarden(csv, veldinfo.velden);

    // vervolgticket-grafieken-tabblad.md §1: bij fase totaal + metric stroom een aparte
    // statusWaarde meegeven (zwaarst-belaste fase i.p.v. de driefasen-som) — de weergegeven
    // waarde zelf (total_current) blijft ongewijzigd, alleen de kleurbepaling gebruikt statusWaarde.
    // grafieken-alle-fasen-staaf-taart-plan.md: bij fase "alle" is elke waarde al een rauwe,
    // direct met rating_a vergelijkbare single-fase-stroom — geen statusWaarde nodig (en de
    // frontend schakelt status-kleuring in deze modus toch al bewust uit).
    const statusVelden = fase === 'alle' ? null : grafiekenStatusVeldenVoorMetric(metric, fase);
    if (statusVelden) {
      const statusVeldFilter = statusVelden.map((v) => 'r._field == "' + v + '"').join(' or ');
      const statusFlux =
        'from(bucket: "' + INFLUX_BUCKET + '")\n' +
        '  |> ' + range + '\n' +
        '  |> filter(fn: (r) => r._measurement == "shelly_em")\n' +
        '  |> filter(fn: (r) => ' + statusVeldFilter + ')\n' +
        '  |> filter(fn: (r) => ' + kastFilter + ')\n' +
        editieFilter +
        '  |> group(columns: ["kast", "_field"])\n' +
        '  |> ' + fn + '()\n' +
        '  |> keep(columns: ["kast", "_field", "_value"])';
      const statusCsv = await influxQueryPlatteCsv(statusFlux);
      const statusPerKast = grafiekenAggregaatCsvGroeperen(statusCsv, statusVelden);
      waarden.forEach((w) => {
        const veldMap = statusPerKast.get(w.id);
        if (veldMap && veldMap.size) w.statusWaarde = Math.max(...veldMap.values());
      });
    }
    res.json({ waarden });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- Heatmap (zelfde roadmap-item, zie grafieken-tabblad-plan.md §5): rij per kast,
// kolom per tijdvak — uur-van-de-dag bij een periode tot ~3 dagen, anders per dag (zodat een
// meerdaags evenement geen honderden kolommen krijgt). Hergebruikt vrijwel dezelfde Flux-opbouw
// als /api/grafieken/tijdreeks (alleen het venster wisselt van puntenaantal-gebaseerd naar
// tijdvak-gebaseerd) en dezelfde grafiekenCsvNaarSeries()-parser; reshaped hier tot een grid met
// een gezamenlijke kolom-as (union van alle tijdstippen die ergens voorkomen, missende cellen
// blijven null i.p.v. een kunstmatige 0 — een lege meting is iets anders dan "geen stroom") ----------
app.get('/api/grafieken/heatmap', async (req, res) => {
  const { ids, metric, fase, van, tot, editie, aggregatie } = req.query;
  const idLijst = (ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!idLijst.length) return res.status(400).json({ error: 'ids is verplicht (komma-gescheiden)' });
  if (!idLijst.every(veiligeTagWaarde)) return res.status(400).json({ error: 'ongeldig id in ids' });
  if (!['a', 'b', 'c', 'totaal'].includes(fase)) return res.status(400).json({ error: 'ongeldige fase' });
  if (!['piek', 'gemiddelde'].includes(aggregatie)) return res.status(400).json({ error: 'ongeldige aggregatie (alleen piek/gemiddelde per cel)' });
  if (!van || !tot || isNaN(Date.parse(van)) || isNaN(Date.parse(tot))) {
    return res.status(400).json({ error: 'van en tot zijn verplicht en moeten geldige datums zijn' });
  }
  const veldinfo = grafiekenVeldenVoorMetric(metric, fase);
  if (!veldinfo) return res.status(400).json({ error: 'ongeldige metric' });
  let editieFilter = '';
  if (editie && editie !== '__alle__') {
    const veiligeEditie = veiligeTagWaarde(editie);
    if (!veiligeEditie) return res.status(400).json({ error: 'ongeldige editie' });
    editieFilter = '  |> filter(fn: (r) => r.editie == "' + veiligeEditie + '")\n';
  }

  const vanMs = new Date(van).getTime(), totMs = new Date(tot).getTime();
  const periodeDagen = (totMs - vanMs) / (1000 * 3600 * 24);
  const venster = periodeDagen > 3 ? '1d' : '1h';
  const fn = aggregatie === 'gemiddelde' ? 'mean' : 'max';
  const veldFilter = veldinfo.velden.map((v) => 'r._field == "' + v + '"').join(' or ');
  const kastFilter = idLijst.map((id) => 'r.kast == "' + id + '"').join(' or ');

  const flux =
    'from(bucket: "' + INFLUX_BUCKET + '")\n' +
    '  |> range(start: ' + new Date(vanMs).toISOString() + ', stop: ' + new Date(totMs).toISOString() + ')\n' +
    '  |> filter(fn: (r) => r._measurement == "' + veldinfo.measurement + '")\n' +
    '  |> filter(fn: (r) => ' + veldFilter + ')\n' +
    '  |> filter(fn: (r) => ' + kastFilter + ')\n' +
    editieFilter +
    '  |> group(columns: ["kast", "_field"])\n' +
    '  |> aggregateWindow(every: ' + venster + ', fn: ' + fn + ', createEmpty: false)\n' +
    '  |> group(columns: ["kast"])\n' +
    '  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")\n' +
    '  |> sort(columns: ["_time"])\n' +
    '  |> keep(columns: ' + JSON.stringify(['_time', 'kast', ...veldinfo.velden]) + ')';

  try {
    const csv = await influxQueryPlatteCsv(flux);
    const series = grafiekenCsvNaarSeries(csv, veldinfo.velden);
    const kolommenSet = new Set();
    series.forEach((s) => s.punten.forEach(([t]) => kolommenSet.add(t)));
    const kolommen = Array.from(kolommenSet).sort((a, b) => a - b);

    // vervolgticket-grafieken-tabblad.md §1: zie dezelfde toelichting bij /api/grafieken/aggregaat
    // hierboven — per cel een apart statusCellen-getal (zwaarst-belaste fase), de weergegeven
    // waarde (cellen) blijft de driefasen-som
    let statusPerKast = null;
    const statusVelden = grafiekenStatusVeldenVoorMetric(metric, fase);
    if (statusVelden) {
      const statusVeldFilter = statusVelden.map((v) => 'r._field == "' + v + '"').join(' or ');
      const statusFlux =
        'from(bucket: "' + INFLUX_BUCKET + '")\n' +
        '  |> range(start: ' + new Date(vanMs).toISOString() + ', stop: ' + new Date(totMs).toISOString() + ')\n' +
        '  |> filter(fn: (r) => r._measurement == "shelly_em")\n' +
        '  |> filter(fn: (r) => ' + statusVeldFilter + ')\n' +
        '  |> filter(fn: (r) => ' + kastFilter + ')\n' +
        editieFilter +
        '  |> group(columns: ["kast", "_field"])\n' +
        '  |> aggregateWindow(every: ' + venster + ', fn: ' + fn + ', createEmpty: false)\n' +
        '  |> group(columns: ["kast"])\n' +
        '  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")\n' +
        '  |> sort(columns: ["_time"])\n' +
        '  |> keep(columns: ' + JSON.stringify(['_time', 'kast', ...statusVelden]) + ')';
      const statusCsv = await influxQueryPlatteCsv(statusFlux);
      // vervolgticket-grafieken-tabblad-ronde2.md §1: NaN/ontbrekende fasewaarden er zelf uitfilteren
      // vóórdat het maximum genomen wordt — grafiekenCsvNaarSeries() geeft deze rij nu al door zodra
      // minstens één van de drie fasevelden aanwezig is (zie de aangepaste every()-check hierboven)
      const statusSeries = grafiekenCsvNaarSeries(statusCsv, statusVelden, (getallen) => Math.max(...getallen.filter((n) => !isNaN(n))));
      statusPerKast = new Map(statusSeries.map((s) => [s.id, new Map(s.punten)]));
    }

    const rijen = series.map((s) => {
      const perTijd = new Map(s.punten);
      const statusPerTijd = statusPerKast ? statusPerKast.get(s.id) : null;
      const rij = { id: s.id, cellen: kolommen.map((t) => (perTijd.has(t) ? perTijd.get(t) : null)) };
      if (statusPerTijd) rij.statusCellen = kolommen.map((t) => (statusPerTijd.has(t) ? statusPerTijd.get(t) : null));
      return rij;
    });
    res.json({ kolommen, rijen, venster });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- Sankey (zelfde roadmap-item, zie grafieken-tabblad-plan.md §3): energieverdeling vanaf
// één gekozen startpunt-generator. De keten zelf komt rechtstreeks uit de topologie in-memory
// (readTopo(), dezelfde bron als het Schema-tabblad z'n boomdiagram) i.p.v. de topology_edges-reeks
// in InfluxDB (die is er specifiek voor Grafana) — voor dit ad-hoc-tabblad is de actuele topologie
// zelf sowieso al beschikbaar, geen aparte Influx-round-trip nodig om de structuur te kennen. Alleen
// de kWh-waarde per link komt uit InfluxDB, met dezelfde integral(unit: 1h)-aanpak als hierboven ----------
app.get('/api/grafieken/sankey', async (req, res) => {
  const { startpunt, fase, van, tot, editie } = req.query;
  if (!startpunt || !veiligeTagWaarde(startpunt)) return res.status(400).json({ error: 'startpunt is verplicht' });
  if (!['a', 'b', 'c', 'totaal'].includes(fase)) return res.status(400).json({ error: 'ongeldige fase' });
  if (!van || !tot || isNaN(Date.parse(van)) || isNaN(Date.parse(tot))) {
    return res.status(400).json({ error: 'van en tot zijn verplicht en moeten geldige datums zijn' });
  }
  const data = readTopo();
  const gen = data.generators.find((g) => g.id === startpunt);
  if (!gen) return res.status(404).json({ error: 'onbekende generator/groep' });
  let editieFilter = '';
  if (editie && editie !== '__alle__') {
    const veiligeEditie = veiligeTagWaarde(editie);
    if (!veiligeEditie) return res.status(400).json({ error: 'ongeldige editie' });
    editieFilter = '  |> filter(fn: (r) => r.editie == "' + veiligeEditie + '")\n';
  }
  const vanMs = new Date(van).getTime(), totMs = new Date(tot).getTime();
  const range = 'range(start: ' + new Date(vanMs).toISOString() + ', stop: ' + new Date(totMs).toISOString() + ')';

  // volledige onderliggende keten verzamelen, hoe diep ook (recursief via parent, net als
  // listChildrenOf()/collectDescendantKasten() aan de clientkant voor het Schema-tabblad)
  const nodes = [{ id: gen.id, naam: gen.naam, type: gen.type || 'generator', parent: null }];
  function verzamel(parentId, isRoot) {
    const kinderen = data.kasten.filter((k) => (isRoot ? k.generator === parentId && !k.parent : k.parent === parentId));
    kinderen.forEach((k) => {
      nodes.push({ id: k.id, naam: k.naam, type: k.type || 'kast', parent: parentId });
      verzamel(k.id, false);
    });
  }
  verzamel(gen.id, true);
  const kastNodes = nodes.filter((n) => n.id !== gen.id);
  if (!kastNodes.length) return res.json({ nodes, links: [] });

  try {
    const veld = grafiekenVermogenVeld(fase);
    const links = await Promise.all(kastNodes.map(async (n) => ({
      from: n.parent, to: n.id, waarde: await berekenEnergieKwh(n.id, veld, range, editieFilter),
    })));
    res.json({ nodes, links });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// haalt één paneel als PDF op bij Grafana's eigen /render-endpoint (via grafana-image-renderer) —
// ondanks een misleidende "image/png"-Content-Type-header staat er een echte PDF in de body
// (geverifieerd op byte-niveau tijdens implementatie)
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
// licht/print-vriendelijk thema i.p.v. het donkere webapp-thema — bewuste afwijking.
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
  const eventTekst = 'Stroom-Dashboard · ' + d['rapport.pdfEditieLabel'].toLowerCase() + ' ' + editieLabel;

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
  const bestandsnaam = 'rapport_stroom-dashboard_' + editie + '.pdf';
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
// altijd, meetdata optioneel met periode ----------
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
// inclusief topology_edges, bedoeld om via het restore-endpoint terug te schrijven. topology_edges
// wordt niet over de gekozen periode
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

// herbruikbaar tussen de handmatige back-up-flow hieronder en de automatische-back-up-scheduler
// (zie provisionAutomatischeBackup() verderop) — bouwt de zip op het opgegeven pad, geen jobstatus-
// bijwerking hier (die is voor de twee aanroepers verschillend: backupJob vs. autoBackupStatus)
async function bouwBackupZip(bestandspad, meetdataPeriode) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(bestandspad);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    archive.append(JSON.stringify(readTopo(), null, 2), { name: 'topologie.json' });
    // vervolgticket-toegang-van-buitenaf.md §7: accounts/locaties hoorden nog niet bij de back-up —
    // zonder dit zijn ze weg bij een restore/volume-verlies, net zo erg als de topologie kwijtraken
    if (fs.existsSync(ACCOUNTS_FILE)) archive.file(ACCOUNTS_FILE, { name: 'accounts.json' });
    if (fs.existsSync(LOCATIES_FILE)) archive.file(LOCATIES_FILE, { name: 'locaties.json' });
    const kaartBestand = bestaandAfbeeldingsbestand(MAP_BASENAME);
    if (kaartBestand) archive.file(kaartBestand, { name: 'plattegrond' + path.extname(kaartBestand) });
    // getiled (specs/plattegrond-tile-based-plan.md): kaartBestand hierboven bestaat dan niet, de
    // .dzi + tegelmap gaan in plaats daarvan mee
    const kaartDzi = TILES_PREFIX + '.dzi';
    if (fs.existsSync(kaartDzi)) {
      archive.file(kaartDzi, { name: 'plattegrond-tiles.dzi' });
      archive.directory(TILES_PREFIX + '_files', 'plattegrond-tiles_files');
    }
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
}

async function voerBackupGeneratieUit(meetdataPeriode) {
  const bestandsnaam = 'backup_stroom-dashboard_' + Date.now() + '.zip';
  const bestandspad = path.join(BACKUP_DIR, bestandsnaam);
  await bouwBackupZip(bestandspad, meetdataPeriode);
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

// ---------- Back-up herstellen (restore, tegenhanger van hierboven). Twee modi: "volledig" (verse/lege instance, alle
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

    // optioneel: een back-up van vóór deze feature heeft deze entries niet, dan gewoon overslaan
    // i.p.v. het hele herstel te blokkeren (zelfde soort "sla over, geen harde eis"-patroon als media)
    const accountsEntry = zip.getEntries().find((e) => e.entryName === 'accounts.json');
    if (accountsEntry) { writeAccounts(JSON.parse(zip.readAsText(accountsEntry))); onderdelen.push('accounts'); }
    const locatiesEntry = zip.getEntries().find((e) => e.entryName === 'locaties.json');
    if (locatiesEntry) { writeLocaties(JSON.parse(zip.readAsText(locatiesEntry))); onderdelen.push('locaties'); }

    let mediaTeruggezet = false;
    ['plattegrond', 'logo'].forEach((naam) => {
      const mediaEntry = zip.getEntries().find((e) => e.entryName.startsWith(naam + '.'));
      if (!mediaEntry) return;
      const buffer = mediaEntry.getData();
      const type = detecteerAfbeeldingType(buffer);
      if (!type || type === 'pdf') return; // ongeldig media-bestand in de back-up: sla dit onderdeel over, blokkeer niet de rest van het herstel
      const basename = naam === 'plattegrond' ? MAP_BASENAME : LOGO_BASENAME;
      verwijderAfbeeldingsbestanden(basename);
      if (naam === 'plattegrond') verwijderTegelbestanden();
      fs.writeFileSync(basename + AFBEELDING_EXT_BY_TYPE[type], buffer);
      mediaTeruggezet = true;
    });
    // getiled plattegrond (specs/plattegrond-tile-based-plan.md): eigen tak, want die heeft geen
    // los 'plattegrond.<ext>'-entry zoals hierboven, maar een .dzi + tegelmap
    const dziEntry = zip.getEntries().find((e) => e.entryName === 'plattegrond-tiles.dzi');
    if (dziEntry) {
      verwijderAfbeeldingsbestanden(MAP_BASENAME);
      verwijderTegelbestanden();
      fs.writeFileSync(TILES_PREFIX + '.dzi', dziEntry.getData());
      const prefixInZip = 'plattegrond-tiles_files/';
      zip.getEntries()
        .filter((e) => e.entryName.startsWith(prefixInZip) && !e.isDirectory)
        .forEach((e) => {
          const dest = path.join(TILES_PREFIX + '_files', e.entryName.slice(prefixInZip.length));
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, e.getData());
        });
      mediaTeruggezet = true;
    }
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

// ---------- Automatische back-up: geplande, onbeheerde variant van de handmatige back-up
// hierboven — zelfde zip-inhoud (bouwBackupZip), automatisch getriggerd i.p.v. met een klik. Zie
// specs/automatische-backup-plan.md. ----------
const AUTOMATISCHE_BACKUP_DEFAULT = {
  aan: false, frequentie: 'dagelijks', dag: 'maandag', tijdstip: '03:00', meetdataMeenemen: true,
  bestemmingen: {
    lokaal: { aan: false, pad: '', bewaarAantal: '14' },
    sftp: { aan: false, host: '', poort: '22', gebruiker: '', wachtwoord: '', doelmap: '', bewaarAantal: '30' },
    s3: { aan: false, endpoint: '', bucket: '', access_key: '', secret_key: '', prefix: '', bewaarAantal: '30' },
  },
};
// zie NOTIFICATIE_GEHEIM_VELD_PER_KANAAL hierboven voor de uitleg — zelfde afscherming, nu voor de
// automatische-back-up-bestemmingen (lokaal heeft geen geheim veld)
const AUTOMATISCHE_BACKUP_GEHEIM_VELD_PER_BESTEMMING = { sftp: 'wachtwoord', s3: 'secret_key' };
// `bestaand` = de al opgeslagen automatischeBackup-config (ongeredigeerd), zelfde reden als bij
// saniteerKanaalConfig hierboven
function saniteerAutomatischeBackup(body, bestaand) {
  const bron = body || {};
  const schoon = {
    aan: !!bron.aan,
    frequentie: ['elk_uur', 'dagelijks', 'wekelijks'].includes(bron.frequentie) ? bron.frequentie : AUTOMATISCHE_BACKUP_DEFAULT.frequentie,
    dag: bron.dag || AUTOMATISCHE_BACKUP_DEFAULT.dag,
    tijdstip: /^\d{2}:\d{2}$/.test(bron.tijdstip) ? bron.tijdstip : AUTOMATISCHE_BACKUP_DEFAULT.tijdstip,
    meetdataMeenemen: bron.meetdataMeenemen !== false,
    bestemmingen: {},
  };
  Object.keys(AUTOMATISCHE_BACKUP_DEFAULT.bestemmingen).forEach((id) => {
    const defaults = AUTOMATISCHE_BACKUP_DEFAULT.bestemmingen[id];
    const bestemmingBron = (bron.bestemmingen || {})[id] || {};
    const bestemmingBestaand = (bestaand && bestaand.bestemmingen && bestaand.bestemmingen[id]) || {};
    const schoneBestemming = { aan: !!bestemmingBron.aan };
    const geheimVeld = AUTOMATISCHE_BACKUP_GEHEIM_VELD_PER_BESTEMMING[id];
    Object.keys(defaults).forEach((key) => {
      if (key === 'aan') return;
      if (key === geheimVeld) {
        schoneBestemming[key] = saniteerGeheimVeld(bestemmingBron[key], bestemmingBestaand[key]);
        return;
      }
      schoneBestemming[key] = bestemmingBron[key] != null ? String(bestemmingBron[key]) : defaults[key];
    });
    schoon.bestemmingen[id] = schoneBestemming;
  });
  return schoon;
}

// alleen niet-persistent (zelfde soort in-memory jobstatus als backupJob/rapportJob/herstelJob) —
// wordt bij elke wijziging van de instelling en na elke run herberekend
let autoBackupVolgendeRun = null;
let autoBackupStatus = { laatsteRunOp: null, laatsteRunResultaat: null, laatsteRunDetails: null, volgendeGeplandOp: null };

const DAGEN_VOLGORDE = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
function berekenVolgendeRunTijd(cfg, vanaf) {
  const nu = vanaf || new Date();
  if (cfg.frequentie === 'elk_uur') {
    const next = new Date(nu);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next;
  }
  const [uur, minuut] = (cfg.tijdstip || '03:00').split(':').map(Number);
  if (cfg.frequentie === 'dagelijks') {
    const next = new Date(nu);
    next.setHours(uur, minuut, 0, 0);
    if (next <= nu) next.setDate(next.getDate() + 1);
    return next;
  }
  // wekelijks
  const doelDag = DAGEN_VOLGORDE.indexOf(cfg.dag || 'maandag');
  const next = new Date(nu);
  next.setHours(uur, minuut, 0, 0);
  let deltaDagen = (doelDag - next.getDay() + 7) % 7;
  if (deltaDagen === 0 && next <= nu) deltaDagen = 7;
  next.setDate(next.getDate() + deltaDagen);
  return next;
}
function herbereikenAutoBackupSchema() {
  const { automatischeBackup } = readInstellingen();
  autoBackupVolgendeRun = automatischeBackup && automatischeBackup.aan ? berekenVolgendeRunTijd(automatischeBackup, new Date()) : null;
  autoBackupStatus.volgendeGeplandOp = autoBackupVolgendeRun ? autoBackupVolgendeRun.toISOString() : null;
}

async function verstuurNaarLokaal(cfg, bestandspad, bestandsnaam) {
  if (!cfg.pad) throw new Error('pad is verplicht');
  fs.mkdirSync(cfg.pad, { recursive: true });
  fs.copyFileSync(bestandspad, path.join(cfg.pad, bestandsnaam));
}
async function roteerLokaal(cfg) {
  const N = Number(cfg.bewaarAantal) || 14;
  const bestanden = fs.readdirSync(cfg.pad).filter((f) => f.startsWith('auto-backup_')).sort();
  bestanden.slice(0, Math.max(0, bestanden.length - N)).forEach((f) => fs.unlinkSync(path.join(cfg.pad, f)));
}

function sftpVerbindingsopties(cfg) {
  return { host: cfg.host, port: cfg.poort ? Number(cfg.poort) : 22, username: cfg.gebruiker, password: cfg.wachtwoord };
}
async function verstuurNaarSftp(cfg, bestandspad, bestandsnaam) {
  if (!cfg.host || !cfg.gebruiker) throw new Error('host en gebruiker zijn verplicht');
  const SftpClient = require('ssh2-sftp-client');
  const sftp = new SftpClient();
  const doelmap = (cfg.doelmap || '/').replace(/\/+$/, '') || '/';
  try {
    await sftp.connect(sftpVerbindingsopties(cfg));
    await sftp.mkdir(doelmap, true).catch(() => {}); // bestaat de map al, dan is dat prima
    await sftp.put(bestandspad, doelmap + '/' + bestandsnaam);
  } finally {
    await sftp.end().catch(() => {});
  }
}
async function roteerSftp(cfg) {
  const SftpClient = require('ssh2-sftp-client');
  const sftp = new SftpClient();
  const doelmap = (cfg.doelmap || '/').replace(/\/+$/, '') || '/';
  const N = Number(cfg.bewaarAantal) || 30;
  try {
    await sftp.connect(sftpVerbindingsopties(cfg));
    const lijst = (await sftp.list(doelmap)).filter((f) => f.name.startsWith('auto-backup_')).sort((a, b) => a.name.localeCompare(b.name));
    for (const f of lijst.slice(0, Math.max(0, lijst.length - N))) await sftp.delete(doelmap + '/' + f.name);
  } finally {
    await sftp.end().catch(() => {});
  }
}

function s3Client(cfg) {
  const { Client } = require('minio');
  const zonderProtocol = cfg.endpoint.replace(/^https?:\/\//, '');
  const [host, poortStr] = zonderProtocol.split(':');
  const useSSL = !cfg.endpoint.startsWith('http://');
  return new Client({ endPoint: host, port: poortStr ? Number(poortStr) : (useSSL ? 443 : 80), useSSL, accessKey: cfg.access_key, secretKey: cfg.secret_key });
}
function s3ObjectNaam(cfg, bestandsnaam) { return (cfg.prefix ? cfg.prefix.replace(/\/+$/, '') + '/' : '') + bestandsnaam; }
async function verstuurNaarS3(cfg, bestandspad, bestandsnaam) {
  if (!cfg.endpoint || !cfg.bucket) throw new Error('endpoint en bucket zijn verplicht');
  await s3Client(cfg).fPutObject(cfg.bucket, s3ObjectNaam(cfg, bestandsnaam), bestandspad);
}
async function roteerS3(cfg) {
  const client = s3Client(cfg);
  const prefix = cfg.prefix ? cfg.prefix.replace(/\/+$/, '') + '/' : '';
  const N = Number(cfg.bewaarAantal) || 30;
  const objecten = [];
  await new Promise((resolve, reject) => {
    const stream = client.listObjectsV2(cfg.bucket, prefix, false);
    stream.on('data', (obj) => { if (obj.name && obj.name.slice(prefix.length).startsWith('auto-backup_')) objecten.push(obj.name); });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  objecten.sort();
  const teVerwijderen = objecten.slice(0, Math.max(0, objecten.length - N));
  if (teVerwijderen.length) await client.removeObjects(cfg.bucket, teVerwijderen);
}

const AUTOMATISCHE_BACKUP_BESTEMMINGEN = {
  lokaal: { verstuur: verstuurNaarLokaal, roteer: roteerLokaal },
  sftp: { verstuur: verstuurNaarSftp, roteer: roteerSftp },
  s3: { verstuur: verstuurNaarS3, roteer: roteerS3 },
};

async function stuurAutoBackupMisluktNotificatie(onderwerp, tekst) {
  const { notificaties } = readInstellingen();
  if (!notificaties) return;
  for (const kanaal of Object.keys(NOTIFICATIE_KANALEN_DEFAULT)) {
    const cfg = notificaties[kanaal];
    if (!cfg || !cfg.aan) continue;
    try { await stuurNotificatie(kanaal, cfg, onderwerp, tekst); }
    catch (e) { console.error('kon back-up-mislukt-melding niet versturen via ' + kanaal + ':', e.message); }
  }
}

async function voerAutomatischeBackupUit(cfg) {
  const bestandsnaam = 'auto-backup_stroom-dashboard_' + Date.now() + '.zip';
  const bestandspad = path.join(BACKUP_DIR, bestandsnaam);
  try {
    const meetdataPeriode = cfg.meetdataMeenemen ? { van: '1970-01-01T00:00:00.000Z', tot: new Date().toISOString() } : null;
    await bouwBackupZip(bestandspad, meetdataPeriode);

    const resultaten = {};
    for (const [id, { verstuur, roteer }] of Object.entries(AUTOMATISCHE_BACKUP_BESTEMMINGEN)) {
      const bestemmingCfg = cfg.bestemmingen[id];
      if (!bestemmingCfg || !bestemmingCfg.aan) continue;
      try {
        await verstuur(bestemmingCfg, bestandspad, bestandsnaam);
        // rotatie ALTIJD pas na een bevestigd geslaagde nieuwe back-up — nooit oude back-ups
        // opschonen vóór de nieuwe veilig staat, anders zit je zonder geldige back-up als de
        // rotatie-stap zelf iets zou raken (zie "Betrouwbaarheid" in de spec)
        await roteer(bestemmingCfg);
        resultaten[id] = { ok: true };
      } catch (e) {
        resultaten[id] = { ok: false, foutmelding: e.message };
      }
    }

    const aantalBestemmingen = Object.keys(resultaten).length;
    const alleGeslaagd = aantalBestemmingen > 0 && Object.values(resultaten).every((r) => r.ok);
    autoBackupStatus.laatsteRunOp = new Date().toISOString();
    if (aantalBestemmingen === 0) {
      autoBackupStatus.laatsteRunResultaat = 'fout';
      autoBackupStatus.laatsteRunDetails = 'geen bestemming aangezet';
      await stuurAutoBackupMisluktNotificatie('Stroom-Dashboard: automatische back-up mislukt', 'De automatische back-up is niet verstuurd: geen enkele bestemming staat aan.');
    } else if (alleGeslaagd) {
      autoBackupStatus.laatsteRunResultaat = 'ok';
      autoBackupStatus.laatsteRunDetails = resultaten;
    } else {
      autoBackupStatus.laatsteRunResultaat = 'deels_mislukt';
      autoBackupStatus.laatsteRunDetails = resultaten;
      const mislukteBestemmingen = Object.entries(resultaten).filter(([, r]) => !r.ok).map(([id, r]) => id + ': ' + r.foutmelding).join('; ');
      await stuurAutoBackupMisluktNotificatie('Stroom-Dashboard: automatische back-up deels mislukt', mislukteBestemmingen);
    }
  } catch (e) {
    autoBackupStatus.laatsteRunOp = new Date().toISOString();
    autoBackupStatus.laatsteRunResultaat = 'fout';
    autoBackupStatus.laatsteRunDetails = e.message;
    console.error('automatische back-up mislukt:', e.message);
    await stuurAutoBackupMisluktNotificatie('Stroom-Dashboard: automatische back-up mislukt', e.message);
  } finally {
    // het lokale scratch-bestand in BACKUP_DIR is alleen een tussenstap voor het versturen naar de
    // bestemmingen hierboven (die zelf hun eigen kopie/rotatie beheren) — hier niet laten opstapelen
    fs.unlink(bestandspad, () => {});
  }
}

setInterval(async () => {
  if (!autoBackupVolgendeRun || Date.now() < autoBackupVolgendeRun.getTime()) return;
  const { automatischeBackup } = readInstellingen();
  if (!automatischeBackup || !automatischeBackup.aan) { herbereikenAutoBackupSchema(); return; }
  // niet gelijktijdig met een handmatige back-up-/restore-/PDF-rapportflow — deze tick overslaan
  // en op de eerstvolgende tick opnieuw proberen i.p.v. de geplande run te laten vervallen
  if (backupJob.status === 'bezig' || herstelJob.status === 'bezig' || rapportJob.status === 'bezig') return;
  await voerAutomatischeBackupUit(automatischeBackup);
  herbereikenAutoBackupSchema();
}, 15000);
herbereikenAutoBackupSchema(); // pikt een al aangezette planning weer op bij webapp-herstart

app.put('/api/instellingen/automatische-backup', (req, res) => {
  const bestaande = readInstellingen();
  const automatischeBackup = saniteerAutomatischeBackup(req.body, bestaande.automatischeBackup);
  writeInstellingen({ ...bestaande, automatischeBackup });
  herbereikenAutoBackupSchema();
  res.json({ ok: true });
});
app.get('/api/backup/automatisch/status', (req, res) => res.json(autoBackupStatus));

// ---------- MQTT-websocket-proxy (specs/toegang-van-buitenaf-diagnose.md bevinding #2) ----------
// mosquitto's websocket-listener (poort 9001) wordt niet meer naar de host gepubliceerd (zie
// docker-compose.yml) — alleen nog bereikbaar via het interne docker-netwerk, net als InfluxDB/
// Grafana nu al. De browser verbindt in plaats daarvan naar hetzelfde origin als de rest van de app
// (/mqtt), deze proxy stuurt dat door naar mosquitto — met het /api/mqtt-ticket-ticket hierboven als
// enige poort. mosquitto zelf blijft dus `allow_anonymous true` (veilig: niet meer extern bereikbaar).
const mqttProxy = createProxyMiddleware({ target: 'ws://mosquitto:9001', ws: true, changeOrigin: true });
app.use('/mqtt', mqttProxy);

// vervolgticket-toegang-van-buitenaf-ronde2.md §5: generieke laatste error-handler, nooit een
// stacktrace/foutdetail teruggeven — vult NODE_ENV=production (Dockerfile) aan als een tweede,
// onafhankelijke laag (bijv. voor wie de webapp buiten die Dockerfile om start). Bevestigd
// triggerbaar vóór de auth-gate via een kapotte JSON-body (express.json() draait eerder).
app.use((err, req, res, next) => {
  console.error('onverwachte serverfout:', err);
  res.status(err.status || 500).json({ error: 'er ging iets mis op de server' });
});

const PORT = process.env.PORT || 8080;
// specs/lan-ip-detectie-verplaatsen-plan.md: geen HOST_LAN_IP-env-var meer (die vereiste het losse
// start.sh/start.ps1-wrapperscriptje op de host) — de eenmalige lan-ip-detector-service in
// docker-compose.yml schrijft het gedetecteerde host-LAN-IP naar dit gedeelde volume-bestand vóórdat
// webapp opstart (depends_on: condition: service_completed_successfully), dus gewoon synchroon
// uitlezen bij opstarten is genoeg — leeg/ontbrekend bestand (bijv. handmatig gestart zonder compose,
// of detectie mislukt) valt terug op alleen `localhost` tonen, geen harde crash.
const HOST_LAN_IP_FILE = '/shared/host_lan_ip.txt';
function bepaalHostLanIp() {
  try {
    return fs.readFileSync(HOST_LAN_IP_FILE, 'utf8').trim();
  } catch (e) {
    return '';
  }
}
meetfactorRelay.start();
meetfactorRelay.meldTopologieWijziging(readTopo());
const server = app.listen(PORT, () => {
  console.log('Stroom-Dashboard luistert op poort ' + PORT);
  console.log('Open in de browser:');
  console.log('  http://localhost:' + PORT + '  (op deze machine)');
  const hostLanIp = bepaalHostLanIp();
  if (hostLanIp) {
    console.log('  http://' + hostLanIp + ':' + PORT + '  (vanaf een ander apparaat op hetzelfde netwerk)');
  } else {
    console.log('  Netwerk-IP niet gedetecteerd — zoek het handmatig op met `ip addr` (Linux) /');
    console.log('  `ipconfig` (Windows), of controleer de lan-ip-detector-containerlogs.');
  }
});

// websocket-upgrades lopen buiten Express' request-pipeline om (zie de toelichting bij
// /api/mqtt-ticket hierboven) — hier expliciet het ticket uit de querystring valideren vóórdat de
// upgrade naar mosquitto wordt doorgezet. vervolgticket-toegang-van-buitenaf.md §5: exacte
// padvergelijking i.p.v. startsWith (dat matchte ook op bijv. /mqttfoo).
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/mqtt') { socket.destroy(); return; }
  const ticket = url.searchParams.get('ticket');
  const record = ticket && mqttTickets.get(ticket);
  if (!record || record.verlooptOm < Date.now()) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  mqttTickets.delete(ticket); // vervolgticket §4: eenmalig bruikbaar, zie ook de kortere TTL hierboven
  mqttProxy.upgrade(req, socket, head);
});
