// ---------- meetfactor-relay: specs/dubbel-veld-meetfactor-plan.md ----------
// Een kast met een "dubbel veld" (2 parallelle Powerlock-sets naar dezelfde afnemer, maar ruimte
// voor maar 1 CT-klem) meet softwarematig maar de helft van zijn werkelijke belasting. De Shelly
// van zo'n kast wordt (via /api/shelly/configureren, zie server.js) geconfigureerd op een "ruwe"
// subtopic (<mqtt_topic_prefix>/ruw/...) i.p.v. de kast se officiele topic; deze relay leest die
// ruwe meting, vermenigvuldigt 'm met de ingestelde meetfactor, en publiceert het resultaat op de
// kast se normale, officiele topic — exact zoals de Shelly dat anders zelf zou doen.
//
// mqtt.js (browser) en telegraf.conf blijven ONGEWIJZIGD: beide lezen via hun bestaande wildcard-
// subscriptie (site/+/+/status/em:0) automatisch de al-gecorrigeerde waarde, zonder te weten dat
// deze relay ertussen zit — dat garandeert dat live-weergave én Grafana/InfluxDB/PDF-rapportages/
// de bestaande 90%-overbelastingsalerts altijd consistent zijn, met de correctie op precies één
// plek. Puur browser-side vermenigvuldigen zou alleen de live-weergave corrigeren, niet de InfluxDB-
// kant waar de alerts op draaien.
const mqtt = require('mqtt');

// vermenigvuldigbare velden — spanning/pf/frequentie/id NIET meeschalen, dat zijn geen grootheden
// die met de belasting meeschalen (Shelly Pro 3EM-veldnamen, zie simulator/index.js)
const EM_VELDEN = [
  'a_current', 'b_current', 'c_current', 'total_current',
  'a_act_power', 'b_act_power', 'c_act_power', 'total_act_power',
  'a_aprt_power', 'b_aprt_power', 'c_aprt_power', 'total_aprt_power',
];
const EMDATA_VELDEN = [
  'a_total_act_energy', 'b_total_act_energy', 'c_total_act_energy', 'total_act',
  'a_total_act_ret_energy', 'b_total_act_ret_energy', 'c_total_act_ret_energy', 'total_act_ret',
];

function vermenigvuldigVelden(data, velden, factor) {
  const out = { ...data };
  velden.forEach((veld) => {
    if (typeof out[veld] === 'number') out[veld] = Math.round(out[veld] * factor * 100) / 100;
  });
  return out;
}

function topicsVoor(prefix) {
  return [prefix + '/status/em:0', prefix + '/status/emdata:0'];
}

let client = null;
let actief = new Map(); // kastId -> { ruwPrefix, canoniekPrefix, factor }
let laatsteData = null;

function bepaalDoelen(data) {
  const doelen = new Map();
  (data.kasten || []).forEach((k) => {
    if (k.shelly_ip && k.meetfactor && Number(k.meetfactor) !== 1) {
      doelen.set(k.id, {
        ruwPrefix: k.mqtt_topic_prefix + '/ruw',
        canoniekPrefix: k.mqtt_topic_prefix,
        factor: Number(k.meetfactor),
      });
    }
  });
  return doelen;
}

function verwerkBericht(topic, payload, doel) {
  let data;
  try { data = JSON.parse(payload.toString()); } catch (e) { return; }
  const isEmdata = topic.endsWith('/emdata:0');
  const gecorrigeerd = vermenigvuldigVelden(data, isEmdata ? EMDATA_VELDEN : EM_VELDEN, doel.factor);
  const doelTopic = doel.canoniekPrefix + '/status/' + (isEmdata ? 'emdata:0' : 'em:0');
  client.publish(doelTopic, JSON.stringify(gecorrigeerd));
}

function synchroniseer(data) {
  if (!client || !client.connected) return; // wordt opnieuw geprobeerd zodra 'connect' vuurt
  const nieuw = bepaalDoelen(data);

  for (const [kastId, oud] of actief) {
    const na = nieuw.get(kastId);
    if (na && na.ruwPrefix === oud.ruwPrefix && na.factor === oud.factor) continue; // ongewijzigd
    topicsVoor(oud.ruwPrefix).forEach((t) => client.unsubscribe(t));
  }
  for (const [kastId, doel] of nieuw) {
    const oud = actief.get(kastId);
    if (oud && oud.ruwPrefix === doel.ruwPrefix && oud.factor === doel.factor) continue; // ongewijzigd
    topicsVoor(doel.ruwPrefix).forEach((t) => client.subscribe(t));
  }
  actief = nieuw;
}

function start() {
  if (client) return;
  client = mqtt.connect('mqtt://mosquitto:1883', { reconnectPeriod: 3000 });
  // na een (her)verbinding kloppen eerdere subscribes niet meer vanzelfsprekend — altijd
  // opnieuw vanaf een lege actief-set opbouwen op basis van de laatst bekende topologie
  client.on('connect', () => { actief = new Map(); if (laatsteData) synchroniseer(laatsteData); });
  client.on('message', (topic, payload) => {
    for (const doel of actief.values()) {
      if (topicsVoor(doel.ruwPrefix).includes(topic)) return verwerkBericht(topic, payload, doel);
    }
  });
  client.on('error', (e) => console.error('[meetfactor-relay] mqtt-fout:', e.message));
}

// aan te roepen bij het opstarten (met de net-ingelezen topologie) én bij elke writeTopo() —
// synchroniseert de actieve subscriptions met de kasten die op dat moment een meetfactor hebben
function meldTopologieWijziging(data) {
  laatsteData = data;
  synchroniseer(data);
}

module.exports = { start, meldTopologieWijziging };
