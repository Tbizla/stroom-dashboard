// ---------- extern-bridge-watchdog: specs/externe-mqtt-ui-plan.md §4 ("nu meteen meebouwen") ----------
// Bewaakt de mosquitto-bridge-verbindingsstatus server-side (eigen MQTT-client, zelfde patroon als
// meetcorrectie-relay.js) en stuurt bij het wegvallen/herstellen zelf een bericht via de bestaande
// alert-notificatiekanalen (stuurNotificatie() in server.js) — bewust NIET vanuit de browser
// (mqtt.js/live-kpi.js hebben hun eigen, aparte $SYS-abonnement voor de UI-weergave zelf): een
// browser-getriggerde melding zou (a) niet vuren als er niemand een tabblad open heeft staan, precies
// het scenario waarvoor een alert-kanaal bedoeld is, en (b) bij meerdere open tabbladen/apparaten
// dezelfde storing meerdere keren melden. Eén server-proces = één melding per storing-episode.
const mqtt = require('mqtt');

// zelfde topic als mqtt.js (browser) — mosquitto publiceert dit lokaal (retained) zodra de bridge-
// config `notifications true` + `remote_clientid extern-bron` heeft, zie bouwBridgeConf() in server.js
const BRIDGE_STATE_TOPIC = '$SYS/broker/connection/extern-bron/state';

let client = null;
let verbonden = null; // null = nog onbekend, true/false = laatst bekende bridge-status
let alertGestuurd = false; // voorkomt herhaalde meldingen zolang dezelfde storing-episode aanhoudt
let leesInstellingen = null;
let stuur = null; // stuurNotificatie(kanaal, cfg, onderwerp, tekst) uit server.js

async function stuurAlleAangezetteKanalen(notificaties, onderwerp, tekst) {
  for (const kanaal of Object.keys(notificaties || {})) {
    const cfg = notificaties[kanaal];
    if (!cfg || !cfg.aan) continue;
    try { await stuur(kanaal, cfg, onderwerp, tekst); }
    catch (e) { console.error('[extern-bridge-watchdog] notificatie via ' + kanaal + ' mislukt:', e.message); }
  }
}

async function meldTransitie(nieuwVerbonden) {
  if (!leesInstellingen) return;
  const { notificaties, externeMqtt } = leesInstellingen();
  if (!externeMqtt || !externeMqtt.actief || !externeMqtt.alert_bij_wegvallen) return;
  if (!nieuwVerbonden && !alertGestuurd) {
    alertGestuurd = true;
    await stuurAlleAangezetteKanalen(
      notificaties,
      'Stroom-Dashboard: externe MQTT-bron weggevallen',
      'De verbinding met de externe MQTT-broker ("' + (externeMqtt.host || '?') + '") is verbroken. ' +
      'De Live-weergave toont vanaf nu "geen data" i.p.v. de externe meting totdat de verbinding herstelt.',
    );
  } else if (nieuwVerbonden && alertGestuurd) {
    alertGestuurd = false;
    await stuurAlleAangezetteKanalen(
      notificaties,
      'Stroom-Dashboard: externe MQTT-bron hersteld',
      'De verbinding met de externe MQTT-broker ("' + (externeMqtt.host || '?') + '") is hersteld.',
    );
  }
}

function start() {
  if (client) return;
  client = mqtt.connect('mqtt://mosquitto:1883', { reconnectPeriod: 3000 });
  client.on('connect', () => client.subscribe(BRIDGE_STATE_TOPIC));
  client.on('message', (topic, payload) => {
    if (topic !== BRIDGE_STATE_TOPIC) return;
    const nieuw = payload.toString().trim() === '1';
    if (verbonden === nieuw) return;
    verbonden = nieuw;
    meldTransitie(nieuw).catch((e) => console.error('[extern-bridge-watchdog] melding mislukt:', e.message));
  });
  client.on('error', (e) => console.error('[extern-bridge-watchdog] mqtt-fout:', e.message));
}

// aan te roepen vóór start() — ontkoppelt deze module van server.js's readInstellingen/
// stuurNotificatie-implementatie, zelfde reden als meetcorrectie-relay.js's losse module-opzet
function init(readInstellingenFn, stuurNotificatieFn) {
  leesInstellingen = readInstellingenFn;
  stuur = stuurNotificatieFn;
}

module.exports = { start, init };
