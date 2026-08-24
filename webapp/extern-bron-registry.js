// ---------- extern-bron-registry: specs/externe-shelly-koppelen-plan.md ----------
// Houdt een server-side, site-brede registry bij van alle ruwe externe bronnen die ooit via de
// mosquitto-bridge zijn gezien onder het extern/-prefix (topic-vorm "...<ruwe-id>@<naam>...",
// waarbij de ruwe-id een MAC-adres óf een Rentman-asset-ID is) — kan niet client-side/per-
// browsersessie leven: moet blijven bestaan ook als niemand net kijkt, en met honderden bronnen (de
// hele klantsite, niet alleen Mikes eigen kasten) is dit te veel om telkens opnieuw uit MQTT-
// geschiedenis af te leiden. Zelfde opzet als meetcorrectie-relay.js/extern-bridge-watchdog.js: een
// eigen, kleine MQTT-client naar de lokale mosquitto, los van de browser.
const mqtt = require('mqtt');

// een "<ruwe-id>@<naam>"-segment ergens in het topic-pad — geen vaste positie/diepte aangenomen,
// want de exacte topic-vorm van de shellybeheerder/Rentman-broker is niet gegarandeerd gelijk aan
// Mikes eigen site/<generator>/<kast>-structuur (zie server.js se bouwBridgeConf(), die inmiddels op
// "#" i.p.v. "site/#" abonneert)
function vindRuweBron(topic) {
  const segmenten = topic.split('/');
  for (const seg of segmenten) {
    const m = seg.match(/^([^@/]+)@(.+)$/);
    if (m) return { ruwe_id: m[1], naam: m[2] };
  }
  return null;
}

// eerst strikt tegen een MAC-patroon testen (12 hex-tekens, met/zonder :/- ertussen) — alles wat
// daar niet aan voldoet is 'rentman'. Bevestigd met Mike (specs/externe-shelly-koppelen-plan.md):
// bekend restrisico is een Rentman-ID die toevallig exact een geldig MAC-patroon vormt, in de
// praktijk onwaarschijnlijk (Rentman-ID's bevatten doorgaans een "-" of niet-hex-letters).
function detecteerSchema(ruweId) {
  const kaal = ruweId.replace(/[:-]/g, '');
  return /^[0-9a-fA-F]{12}$/.test(kaal) ? 'mac' : 'rentman';
}

function maxFaseStroom(data) {
  const fasen = [data.a_current, data.b_current, data.c_current].filter((v) => typeof v === 'number');
  if (fasen.length) return Math.max(...fasen);
  return typeof data.total_current === 'number' ? data.total_current : null;
}

const registry = new Map(); // ruwe_id -> { ruwe_id, naam, schema, laatsteBerichtOp, laatsteWaarde }
let client = null;

function verwerkBericht(topic, payload) {
  const gevonden = vindRuweBron(topic);
  if (!gevonden) return; // geen <id>@<naam>-segment in dit topic — niet relevant voor de koppel-UI
  const bestaand = registry.get(gevonden.ruwe_id);
  const entry = bestaand || { ruwe_id: gevonden.ruwe_id, schema: detecteerSchema(gevonden.ruwe_id), laatsteWaarde: null };
  entry.naam = gevonden.naam; // laatst geziene naam wint (kan aan de shellybeheerder-kant hernoemd zijn)
  entry.laatsteBerichtOp = new Date().toISOString();
  if (topic.endsWith('/status/em:0')) {
    let data;
    try { data = JSON.parse(payload.toString()); } catch (e) { data = null; }
    if (data) {
      const waarde = maxFaseStroom(data);
      if (waarde != null) entry.laatsteWaarde = waarde;
    }
  }
  registry.set(gevonden.ruwe_id, entry);
}

function start() {
  if (client) return;
  client = mqtt.connect('mqtt://mosquitto:1883', { reconnectPeriod: 3000 });
  client.on('connect', () => client.subscribe('extern/#'));
  client.on('message', verwerkBericht);
  client.on('error', (e) => console.error('[extern-bron-registry] mqtt-fout:', e.message));
}

function alleBronnen() {
  return Array.from(registry.values());
}

module.exports = { start, alleBronnen };
