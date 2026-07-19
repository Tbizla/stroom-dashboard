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
    a_current: a.current, a_voltage: a.voltage, a_act_power: a.power, a_aprt_power: a.power, a_pf: 0.98,
    b_current: b.current, b_voltage: b.voltage, b_act_power: b.power, b_aprt_power: b.power, b_pf: 0.98,
    c_current: c.current, c_voltage: c.voltage, c_act_power: c.power, c_aprt_power: c.power, c_pf: 0.98,
    n_current: null,
    total_current: totaalStroom,
    total_act_power: round1(totaalStroom * gemVoltage),
    total_aprt_power: round1(totaalStroom * gemVoltage),
    user_calibrated_phase: [],
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
      topo.kasten.forEach(k => { if (!(k.id in state)) state[k.id] = rand(0.2, 0.5); });
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
      return stroom;
    }
    topo.kasten.forEach(berekenKast);

    // generators (en groepen) zijn zelf pure bron/doorlus-punten zonder eigen belasting — hun
    // gemeten stroom is precies de som van alles wat er rechtstreeks op is aangesloten. Alleen
    // publiceren als er een rating (A) is ingevuld, want dat betekent dat 'm ook echt uitgelezen
    // wordt (native telemetrie of een toegevoegde Shelly met CT-klem)
    (topo.generators || []).forEach(gen => {
      if (gen.rating_a == null) return;
      const kinderen = topo.kasten.filter(k => k.generator === gen.id && !k.parent);
      let a = 0, b = 0, c = 0;
      kinderen.forEach(k => {
        const kp = berekenKast(k);
        a += kp.a; b += kp.b; c += kp.c;
      });
      const stroom = { a: round2(a), b: round2(b), c: round2(c) };
      const topic = 'fest/' + gen.id + '/' + gen.id + '/status/em:0';
      client.publish(topic, JSON.stringify(maakPayload(stroom)));
    });
  }, INTERVAL_MS);
}

main();
