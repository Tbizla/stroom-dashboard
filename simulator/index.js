const mqtt = require('mqtt');

const MQTT_URL = process.env.MQTT_URL || 'mqtt://mosquitto:1883';
const TOPOLOGY_URL = process.env.TOPOLOGY_URL || 'http://webapp:8080/api/topology';
const STATUS_URL = process.env.SIMULATOR_STATUS_URL || 'http://webapp:8080/api/simulator/status';
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '5000', 10);
const PIEK_KANS = parseFloat(process.env.PIEK_KANS || '0.01'); // kans per tik dat een kast een belastingspiek krijgt

function rand(min, max) { return min + Math.random() * (max - min); }
function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }

async function wachtOpTopologie() {
  while (true) {
    try {
      const res = await fetch(TOPOLOGY_URL);
      if (res.ok) {
        const data = await res.json();
        if (data.kasten && data.kasten.length) return data;
      }
    } catch (e) { /* server nog niet klaar, opnieuw proberen */ }
    console.log('[simulator] wacht op topologie via ' + TOPOLOGY_URL + ' ...');
    await new Promise(r => setTimeout(r, 3000));
  }
}

function maakFasePayload(current) {
  const voltage = rand(228, 232);
  return {
    current: Math.max(0, round2(current)),
    voltage: round1(voltage),
    power: round1(current * voltage),
  };
}

function maakPayload(stroom) {
  const a = maakFasePayload(stroom.a);
  const b = maakFasePayload(stroom.b);
  const c = maakFasePayload(stroom.c);
  const totaalStroom = round2(a.current + b.current + c.current);
  const gemVoltage = (a.voltage + b.voltage + c.voltage) / 3;
  return {
    id: 0,
    a_current: a.current, a_voltage: a.voltage, a_act_power: a.power, a_aprt_power: a.power, a_pf: 0.98, a_freq: round1(rand(49.9, 50.1)),
    b_current: b.current, b_voltage: b.voltage, b_act_power: b.power, b_aprt_power: b.power, b_pf: 0.98, b_freq: round1(rand(49.9, 50.1)),
    c_current: c.current, c_voltage: c.voltage, c_act_power: c.power, c_aprt_power: c.power, c_pf: 0.98, c_freq: round1(rand(49.9, 50.1)),
    n_current: null,
    total_current: totaalStroom,
    total_act_power: round1(totaalStroom * gemVoltage),
    total_aprt_power: round1(totaalStroom * gemVoltage),
    user_calibrated_phase: [],
  };
}

// nominale spanning gebruikt om de cumulatieve energie (Wh) te integreren uit de gemeten stroom —
// een simpele vaste waarde is hier prima, de energieteller hoeft niet millivolt-precies te zijn
// om er in de popup realistisch uit te zien
const NOMINAL_VOLTAGE = 230;

// Shelly Pro 3EM-veldnamen voor status/emdata:0 (EMData.GetStatus): *_total_act_energy per fase
// in Wh, plus een totaal. *_ret_energy (teruggeleverde energie) simuleren we niet — geen
// terugleverscenario in deze stack — en blijft dus altijd 0.
function maakEmdataPayload(energie) {
  return {
    id: 0,
    a_total_act_energy: round2(energie.a), a_total_act_ret_energy: 0,
    b_total_act_energy: round2(energie.b), b_total_act_ret_energy: 0,
    c_total_act_energy: round2(energie.c), c_total_act_ret_energy: 0,
    total_act: round2(energie.a + energie.b + energie.c),
    total_act_ret: 0,
  };
}

// een kast met eigen kinderen (bijv. een hoofdverdeler) is electrisch vooral een doorlus-punt:
// het overgrote deel van de gemeten stroom is wat de kinderen er onderaan vragen, niet wat er
// rechtstreeks op die kast zelf is aangesloten. Alleen leaf-kasten (geen kinderen, het daadwerkelijke
// eindverbruik) krijgen de volle eigen-belastingfractie; kasten-met-kinderen krijgen een veel
// kleinere fractie ("een paar lokale stopcontacten op de verdeler zelf"), zodat het merendeel van
// hun gemeten stroom écht van de kinderen komt in plaats van een losstaand willekeurig getal.
const NIET_LEAF_EIGEN_SCHAAL = 0.15;

async function isIngeschakeld() {
  try {
    const res = await fetch(STATUS_URL);
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.enabled;
  } catch (e) {
    return false; // webapp niet bereikbaar: veilig default naar uit
  }
}

async function main() {
  let topo = await wachtOpTopologie();
  console.log('[simulator] topologie geladen: ' + topo.kasten.length + ' kasten. Verbinden met ' + MQTT_URL);

  const client = mqtt.connect(MQTT_URL);
  client.on('connect', () => console.log('[simulator] verbonden met MQTT, wacht tot ingeschakeld via de webapp (Testdata-tabblad)'));
  client.on('error', (e) => console.error('[simulator] mqtt-fout:', e.message));

  // per kast een startbelasting als fractie van de eigen rating_a, die random-walkt over tijd
  const state = {};
  topo.kasten.forEach(k => { state[k.id] = rand(0.2, 0.5); });
  // leden van een groep (generator-EM-rework) zijn voor de
  // simulator gewoon losse meetpunten met hun eigen rating_a, zelfde random-walk als een kast
  (topo.generators || []).forEach(g => (g.leden || []).forEach(l => { if (l.id) state[l.id] = rand(0.2, 0.5); }));

  // cumulatieve energie per fase (Wh) per kast/generator/lid-zelfmeter, begint bij 0 (nieuw
  // geïnstalleerde meter) en telt op zolang de simulator draait; los van `state` want dit moet
  // nooit terugvallen
  const energyState = {};
  function initEnergie(id) { if (!(id in energyState)) energyState[id] = { a: 0, b: 0, c: 0 }; }
  topo.kasten.forEach(k => initEnergie(k.id));
  (topo.generators || []).forEach(g => { initEnergie(g.id); (g.leden || []).forEach(l => { if (l.id) initEnergie(l.id); }); });
  function accumuleerEnergie(id, stroom, intervalMs) {
    const uren = intervalMs / 1000 / 3600;
    const e = energyState[id];
    e.a += stroom.a * NOMINAL_VOLTAGE * uren;
    e.b += stroom.b * NOMINAL_VOLTAGE * uren;
    e.c += stroom.c * NOMINAL_VOLTAGE * uren;
    return e;
  }

  // topologie periodiek verversen (bijv. wisselen tussen de eenvoudige en uitgebreide
  // testtopologie op het Testdata-tabblad) zonder dat de container herstart hoeft te worden
  setInterval(async () => {
    try {
      const res = await fetch(TOPOLOGY_URL);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.kasten || !data.kasten.length) return;
      if (data.kasten.length !== topo.kasten.length) {
        console.log('[simulator] topologie gewijzigd: ' + topo.kasten.length + ' -> ' + data.kasten.length + ' kasten');
      }
      topo = data;
      topo.kasten.forEach(k => { if (!(k.id in state)) state[k.id] = rand(0.2, 0.5); initEnergie(k.id); });
      (topo.generators || []).forEach(g => {
        initEnergie(g.id);
        (g.leden || []).forEach(l => { if (!l.id) return; if (!(l.id in state)) state[l.id] = rand(0.2, 0.5); initEnergie(l.id); });
      });
    } catch (e) { /* webapp tijdelijk niet bereikbaar, volgende poging opnieuw */ }
  }, 5000);

  let wasIngeschakeld = false;
  setInterval(async () => {
    const ingeschakeld = await isIngeschakeld();
    if (ingeschakeld !== wasIngeschakeld) {
      console.log('[simulator] ' + (ingeschakeld ? 'ingeschakeld — publiceert nu elke ' + INTERVAL_MS + 'ms fake meetdata' : 'uitgeschakeld — publiceren gestopt'));
      wasIngeschakeld = ingeschakeld;
    }
    if (!ingeschakeld) return;

    const kinderenVan = {};
    topo.kasten.forEach(k => { if (k.parent) (kinderenVan[k.parent] = kinderenVan[k.parent] || []).push(k); });

    // per kast eerst de kinderen berekenen (en publiceren), dan pas de kast zelf, zodat de
    // gepubliceerde stroom van een kast altijd exact de som is van wat er onderaan 'm hangt
    const berekend = {};
    function berekenKast(k) {
      if (berekend[k.id]) return berekend[k.id];

      let fractie = state[k.id] + rand(-0.04, 0.04);
      if (Math.random() < PIEK_KANS) fractie += rand(0.3, 0.6); // simuleer een piek richting overbelasting
      fractie = Math.max(0.05, Math.min(1.15, fractie));
      state[k.id] = fractie;

      const kinderen = kinderenVan[k.id] || [];
      // rating_a is de stroom die de aansluiting PER FASE aankan (CEE-norm), dus elke fase
      // benadert bij fractie=1.0 de volle rating — niet de rating gedeeld door 3
      const schaal = kinderen.length ? NIET_LEAF_EIGEN_SCHAAL : 1;
      const eigenBasis = fractie * k.rating_a * schaal;
      let a = Math.max(0, eigenBasis + rand(-0.3, 0.3));
      let b = Math.max(0, eigenBasis + rand(-0.3, 0.3));
      let c = Math.max(0, eigenBasis + rand(-0.3, 0.3));

      kinderen.forEach(kind => {
        const kp = berekenKast(kind);
        a += kp.a; b += kp.b; c += kp.c;
      });

      const stroom = { a: round2(a), b: round2(b), c: round2(c) };
      berekend[k.id] = stroom;
      client.publish(k.mqtt_topic_prefix + '/status/em:0', JSON.stringify(maakPayload(stroom)));
      initEnergie(k.id);
      client.publish(k.mqtt_topic_prefix + '/status/emdata:0', JSON.stringify(maakEmdataPayload(accumuleerEnergie(k.id, stroom, INTERVAL_MS))));
      return stroom;
    }
    topo.kasten.forEach(berekenKast);

    // generators (en groepen) zijn zelf pure bron/doorlus-punten zonder eigen belasting — hun
    // gemeten stroom is precies de som van alles wat er rechtstreeks op is aangesloten. Alleen
    // publiceren als er een rating (A) is ingevuld, want dat betekent dat 'm ook echt uitgelezen
    // wordt (native telemetrie of een toegevoegde Shelly met CT-klem)
    (topo.generators || []).forEach(gen => {
      // leden van een groep zijn onafhankelijke meetpunten (elk hun eigen Shelly+CT-klem) en staan
      // los van de eigen self-meter van de groep zelf — dus vóór (niet ná) de `rating_a==null`-
      // early-return hieronder, anders zou een groep zonder eigen rating nooit lid-data publiceren
      // ook al hebben individuele leden wel een rating_a (zie generator-em-rework-plan.md §1/§2)
      (gen.leden || []).forEach(lid => {
        if (lid.rating_a == null || !lid.mqtt_topic_prefix || !lid.id) return;
        let fractie = (state[lid.id] != null ? state[lid.id] : rand(0.2, 0.5)) + rand(-0.04, 0.04);
        if (Math.random() < PIEK_KANS) fractie += rand(0.3, 0.6);
        fractie = Math.max(0.05, Math.min(1.15, fractie));
        state[lid.id] = fractie;
        const eigenBasis = fractie * lid.rating_a;
        const lidStroom = {
          a: round2(Math.max(0, eigenBasis + rand(-0.3, 0.3))),
          b: round2(Math.max(0, eigenBasis + rand(-0.3, 0.3))),
          c: round2(Math.max(0, eigenBasis + rand(-0.3, 0.3))),
        };
        initEnergie(lid.id);
        client.publish(lid.mqtt_topic_prefix + '/status/em:0', JSON.stringify(maakPayload(lidStroom)));
        client.publish(lid.mqtt_topic_prefix + '/status/emdata:0', JSON.stringify(maakEmdataPayload(accumuleerEnergie(lid.id, lidStroom, INTERVAL_MS))));
      });

      // generators (en groepen) zijn zelf pure bron/doorlus-punten zonder eigen belasting — hun
      // gemeten stroom is precies de som van alles wat er rechtstreeks op is aangesloten. Alleen
      // publiceren als er een rating (A) is ingevuld, want dat betekent dat 'm ook echt uitgelezen
      // wordt (native telemetrie of een toegevoegde Shelly met CT-klem)
      if (gen.rating_a == null) return;
      const kinderen = topo.kasten.filter(k => k.generator === gen.id && !k.parent);
      let a = 0, b = 0, c = 0;
      kinderen.forEach(k => {
        const kp = berekenKast(k);
        a += kp.a; b += kp.b; c += kp.c;
      });
      const stroom = { a: round2(a), b: round2(b), c: round2(c) };
      const prefix = 'site/' + gen.id + '/' + gen.id;
      client.publish(prefix + '/status/em:0', JSON.stringify(maakPayload(stroom)));
      initEnergie(gen.id);
      client.publish(prefix + '/status/emdata:0', JSON.stringify(maakEmdataPayload(accumuleerEnergie(gen.id, stroom, INTERVAL_MS))));
    });
  }, INTERVAL_MS);
}

main();
