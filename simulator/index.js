const mqtt = require('mqtt');

const MQTT_URL = process.env.MQTT_URL || 'mqtt://mosquitto:1883';
const TOPOLOGY_URL = process.env.TOPOLOGY_URL || 'http://webapp:8080/api/topology';
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

async function main() {
  const topo = await wachtOpTopologie();
  console.log('[simulator] topologie geladen: ' + topo.kasten.length + ' kasten. Verbinden met ' + MQTT_URL);

  const client = mqtt.connect(MQTT_URL);
  client.on('connect', () => console.log('[simulator] verbonden, publiceert elke ' + INTERVAL_MS + 'ms fake meetdata'));
  client.on('error', (e) => console.error('[simulator] mqtt-fout:', e.message));

  // per kast een startbelasting als fractie van de eigen rating_a, die random-walkt over tijd
  const state = {};
  topo.kasten.forEach(k => { state[k.id] = rand(0.2, 0.5); });

  setInterval(() => {
    topo.kasten.forEach(k => {
      let fractie = state[k.id] + rand(-0.04, 0.04);
      if (Math.random() < PIEK_KANS) fractie += rand(0.3, 0.6); // simuleer een piek richting overbelasting
      fractie = Math.max(0.05, Math.min(1.15, fractie));
      state[k.id] = fractie;

      const totaal = fractie * k.rating_a;
      const perFase = totaal / 3;
      const a = maakFasePayload(perFase + rand(-0.3, 0.3));
      const b = maakFasePayload(perFase + rand(-0.3, 0.3));
      const c = maakFasePayload(perFase + rand(-0.3, 0.3));
      const totaalStroom = round2(a.current + b.current + c.current);
      const gemVoltage = (a.voltage + b.voltage + c.voltage) / 3;

      const payload = {
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

      const topic = k.mqtt_topic_prefix + '/status/em:0';
      client.publish(topic, JSON.stringify(payload));
    });
  }, INTERVAL_MS);
}

main();
