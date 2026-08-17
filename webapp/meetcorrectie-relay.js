// ---------- meetcorrectie-relay: specs/dubbel-veld-meetfactor-plan.md +
// specs/kast-op-aggregaat-plan.md (deel B) ----------
// Twee soorten softwarematige meetcorrectie, allebei nodig omdat de fysieke Shelly/CT-klem-opstelling
// niet altijd exact meet wat je in het dashboard wil zien. mqtt.js (browser) en telegraf.conf lezen
// ONAFHANKELIJK van elkaar dezelfde ruwe MQTT-topic rechtstreeks van mosquitto — de correctie moet
// dus vóór beide plaatsvinden (niet alleen client-side), anders raken live-weergave en Telegraf/
// InfluxDB (Grafana-grafieken, PDF-rapportages, de 90%-overbelastingsalerts) inconsistent.
//
// 1) "factor" (kast.meetfactor): een kast met een "dubbel veld" (2 parallelle Powerlock-sets naar
//    dezelfde afnemer, maar ruimte voor maar 1 CT-klem) meet softwarematig maar de helft van zijn
//    werkelijke belasting — vermenigvuldig de eigen meting.
// 2) "optellen" (kast.optellen_bij_generator): een kast die rechtstreeks (vóór het CT-klem-
//    meetpunt) op een generator/aggregaat is aangetapt, zit niet in diens eigen meting — tel de
//    kast se eigen (elders al correct gemeten) verbruik erbij op.
//
// Beide soorten werken volgens hetzelfde patroon: het FYSIEKE apparaat publiceert niet rechtstreeks
// op zijn officiele topic, maar op een "ruwe" subtopic (<prefix>/ruw/...) — geregeld door de
// Shelly-auto-configuratie in server.js. Deze relay leest die ruwe meting, corrigeert 'm, en
// publiceert het resultaat op de officiele topic, exact zoals het apparaat dat anders zelf zou doen.
// mqtt.js en telegraf.conf blijven ONGEWIJZIGD: beide lezen via hun bestaande wildcard-subscriptie
// (site/+/+/status/em:0) automatisch de al-gecorrigeerde waarde.
const mqtt = require('mqtt');

// vermenigvuldigbare/optelbare velden — spanning/pf/frequentie/id NIET meeschalen, dat zijn geen
// grootheden die met de belasting meeschalen (Shelly Pro 3EM-veldnamen, zie simulator/index.js)
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
function telOpVelden(basis, extra, velden) {
  const out = { ...basis };
  velden.forEach((veld) => {
    if (typeof out[veld] === 'number' && typeof extra[veld] === 'number') out[veld] = Math.round((out[veld] + extra[veld]) * 100) / 100;
  });
  return out;
}
function topicsVoor(prefix) {
  return { em: prefix + '/status/em:0', emdata: prefix + '/status/emdata:0' };
}
// alle generator/groep/lid-nodes plat, voor een simpele id-lookup — los van server.js's eigen
// vindGeneratorOfLid(), dit draait als los, dependency-vrij stukje binnen deze module
function alleGeneratorNodes(data) {
  const nodes = [];
  (data.generators || []).forEach((g) => {
    nodes.push(g);
    (g.leden || []).forEach((l) => nodes.push(l));
  });
  return nodes;
}

let client = null;
let doelen = new Map(); // doelId (kast- of generator/groep/lid-id) -> { type, ruwPrefix, canoniekPrefix, factor? , kastIds? }
let topicRollen = new Map(); // topic -> [{ doelId, rol: 'ruw-em'|'ruw-emdata'|'kast-em'|'kast-emdata', kastId? }]
let kastCache = new Map(); // kastId -> { em: laatste-em-bericht|null, emdata: laatste-emdata-bericht|null }
let laatsteData = null;

function bepaalDoelen(data) {
  const nieuw = new Map();

  (data.kasten || []).forEach((k) => {
    if (k.shelly_ip && k.meetfactor && Number(k.meetfactor) !== 1) {
      nieuw.set(k.id, { type: 'factor', ruwPrefix: k.mqtt_topic_prefix + '/ruw', canoniekPrefix: k.mqtt_topic_prefix, factor: Number(k.meetfactor) });
    }
  });

  const perGenerator = new Map();
  (data.kasten || []).forEach((k) => {
    if (k.optellen_bij_generator && !k.parent && k.generator) {
      if (!perGenerator.has(k.generator)) perGenerator.set(k.generator, []);
      perGenerator.get(k.generator).push(k.id);
    }
  });
  const generatorNodes = alleGeneratorNodes(data);
  for (const [genId, kastIds] of perGenerator) {
    const node = generatorNodes.find((n) => n.id === genId);
    if (!node || !node.shelly_ip || !node.mqtt_topic_prefix) continue;
    nieuw.set(genId, { type: 'optellen', ruwPrefix: node.mqtt_topic_prefix + '/ruw', canoniekPrefix: node.mqtt_topic_prefix, kastIds });
  }
  return nieuw;
}

function bouwTopicRollen(nieuweDoelen, data) {
  const rollen = new Map();
  const voegToe = (topic, rol) => { if (!rollen.has(topic)) rollen.set(topic, []); rollen.get(topic).push(rol); };
  const kastenById = new Map((data.kasten || []).map((k) => [k.id, k]));

  for (const [doelId, doel] of nieuweDoelen) {
    const ruwTopics = topicsVoor(doel.ruwPrefix);
    voegToe(ruwTopics.em, { doelId, rol: 'ruw-em' });
    voegToe(ruwTopics.emdata, { doelId, rol: 'ruw-emdata' });
    if (doel.type === 'optellen') {
      doel.kastIds.forEach((kastId) => {
        const kast = kastenById.get(kastId);
        if (!kast) return;
        const kastTopics = topicsVoor(kast.mqtt_topic_prefix);
        voegToe(kastTopics.em, { doelId, rol: 'kast-em', kastId });
        voegToe(kastTopics.emdata, { doelId, rol: 'kast-emdata', kastId });
      });
    }
  }
  return rollen;
}

function verwerkRuwBericht(doel, soort, data) {
  const velden = soort === 'em' ? EM_VELDEN : EMDATA_VELDEN;
  let gecorrigeerd;
  if (doel.type === 'factor') {
    gecorrigeerd = vermenigvuldigVelden(data, velden, doel.factor);
  } else {
    gecorrigeerd = data;
    doel.kastIds.forEach((kastId) => {
      const cache = kastCache.get(kastId);
      const extra = cache && cache[soort];
      if (extra) gecorrigeerd = telOpVelden(gecorrigeerd, extra, velden);
    });
  }
  const topics = topicsVoor(doel.canoniekPrefix);
  client.publish(soort === 'em' ? topics.em : topics.emdata, JSON.stringify(gecorrigeerd));
}

function synchroniseer(data) {
  if (!client || !client.connected) return; // wordt opnieuw geprobeerd zodra 'connect' vuurt
  const nieuweDoelen = bepaalDoelen(data);
  const nieuweRollen = bouwTopicRollen(nieuweDoelen, data);

  for (const topic of topicRollen.keys()) if (!nieuweRollen.has(topic)) client.unsubscribe(topic);
  for (const topic of nieuweRollen.keys()) if (!topicRollen.has(topic)) client.subscribe(topic);

  doelen = nieuweDoelen;
  topicRollen = nieuweRollen;
  // caches van kasten die niet meer relevant zijn opruimen, anders groeit deze Map eeuwig door bij
  // wisselende topologieën
  const relevanteKastIds = new Set();
  for (const doel of doelen.values()) if (doel.type === 'optellen') doel.kastIds.forEach((id) => relevanteKastIds.add(id));
  for (const kastId of kastCache.keys()) if (!relevanteKastIds.has(kastId)) kastCache.delete(kastId);
}

function verwerkBericht(topic, payload) {
  const rollen = topicRollen.get(topic);
  if (!rollen) return;
  let data;
  try { data = JSON.parse(payload.toString()); } catch (e) { return; }

  rollen.forEach(({ doelId, rol, kastId }) => {
    const doel = doelen.get(doelId);
    if (!doel) return;
    if (rol === 'ruw-em') return verwerkRuwBericht(doel, 'em', data);
    if (rol === 'ruw-emdata') return verwerkRuwBericht(doel, 'emdata', data);
    // kast-em/kast-emdata: alleen de cache bijwerken, geen eigen publicatie — de eerstvolgende ruwe
    // generator-meting neemt deze waarde vanzelf mee (zie verwerkRuwBericht hierboven)
    const soort = rol === 'kast-em' ? 'em' : 'emdata';
    if (!kastCache.has(kastId)) kastCache.set(kastId, { em: null, emdata: null });
    kastCache.get(kastId)[soort] = data;
  });
}

function start() {
  if (client) return;
  client = mqtt.connect('mqtt://mosquitto:1883', { reconnectPeriod: 3000 });
  // na een (her)verbinding kloppen eerdere subscribes niet meer vanzelfsprekend — altijd opnieuw
  // vanaf een lege staat opbouwen op basis van de laatst bekende topologie
  client.on('connect', () => { topicRollen = new Map(); doelen = new Map(); if (laatsteData) synchroniseer(laatsteData); });
  client.on('message', verwerkBericht);
  client.on('error', (e) => console.error('[meetcorrectie-relay] mqtt-fout:', e.message));
}

// aan te roepen bij het opstarten (met de net-ingelezen topologie) én bij elke writeTopo() —
// synchroniseert de actieve subscriptions met de kasten/generatoren die op dat moment een
// meetfactor of optellen_bij_generator hebben
function meldTopologieWijziging(data) {
  laatsteData = data;
  synchroniseer(data);
}

module.exports = { start, meldTopologieWijziging };
