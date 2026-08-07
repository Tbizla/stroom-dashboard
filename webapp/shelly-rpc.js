// ---------- Shelly Gen2+ RPC-client (specs/shelly-auto-configuratie-plan.md) ----------
// Alle aanroepen: POST http://<shelly-ip>/rpc met een JSON-RPC-body, via Node's ingebouwde fetch
// (Node 20, geen nieuwe dependency). Geverifieerd tegen de officiële Shelly Gen2+ API-documentatie
// (MQTT- en Script-componenten). Wordt uitsluitend server-side aangeroepen (de webapp-container zit
// toch al op hetzelfde lokale netwerk als de Shelly's) — nooit rechtstreeks vanuit de browser.

const RPC_TIMEOUT_MS = 5000;
const SCRIPT_NAAM = 'em-fast-publish';
const SCRIPT_CHUNK_GROOTTE = 1024;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function rpcCall(shellyIp, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  let res;
  try {
    res = await fetch('http://' + shellyIp + '/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 1, method, params: params || {} }),
      signal: controller.signal,
    });
  } catch (e) {
    throw new Error('Kan geen verbinding maken met dit IP-adres — controleer of het apparaat aan staat en op hetzelfde netwerk zit.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    throw new Error('Dit apparaat heeft een eigen beheerderswachtwoord ingesteld — automatisch configureren wordt daarmee nu niet ondersteund, zet het lokale apparaatwachtwoord uit of stel dit apparaat handmatig in (README §3).');
  }
  const data = await res.json().catch(() => ({}));
  if (data.error) throw new Error('Shelly gaf een fout terug: ' + (data.error.message || JSON.stringify(data.error)));
  return data.result;
}

async function wachtOpMqttVerbinding(shellyIp, { intervalMs = 2000, maxWachtMs = 20000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < maxWachtMs) {
    await sleep(intervalMs);
    try {
      const status = await rpcCall(shellyIp, 'MQTT.GetStatus');
      if (status && status.connected) return true;
    } catch (e) {
      // apparaat is tijdens de reboot even onbereikbaar — dat is verwacht, gewoon opnieuw proberen
    }
  }
  return false;
}

// MQTT.SetConfig antwoordt met restart_required:true — de instelling wordt pas actief ná een
// herstart, vandaar altijd Shelly.Reboot + een polling-wachtlus hierna (timeout ≠ harde fout: een
// device kan gewoon iets langzamer opstarten, dan rapporteren we "ingesteld, nog niet bevestigd").
async function configureerMqtt(shellyIp, { brokerHost, brokerPoort, topicPrefix }) {
  await rpcCall(shellyIp, 'MQTT.SetConfig', { config: { enable: true, server: brokerHost + ':' + brokerPoort, topic_prefix: topicPrefix } });
  await rpcCall(shellyIp, 'Shelly.Reboot');
  const verbonden = await wachtOpMqttVerbinding(shellyIp);
  return verbonden
    ? { ok: true, melding: 'MQTT-instellingen gezet, apparaat herstart en verbonden.' }
    : { ok: true, melding: 'MQTT-instellingen gezet en apparaat herstart, verbinding nog niet bevestigd binnen 20s — kan gewoon iets langzamer opstarten dan verwacht.' };
}

// Script.PutCode in stukken van 1024 bytes (append:false voor het eerste stuk, append:true voor de
// rest) — zelfde patroon als Shelly's eigen officiële upload-tooling, werkt ongeacht scriptgrootte.
async function zetScriptCode(shellyIp, scriptId, code) {
  for (let offset = 0; offset < code.length; offset += SCRIPT_CHUNK_GROOTTE) {
    const stuk = code.slice(offset, offset + SCRIPT_CHUNK_GROOTTE);
    await rpcCall(shellyIp, 'Script.PutCode', { id: scriptId, code: stuk, append: offset > 0 });
  }
}

async function configureerScript(shellyIp, scriptCode) {
  try {
    const lijst = await rpcCall(shellyIp, 'Script.List');
    const bestaand = ((lijst && lijst.scripts) || []).find((s) => s.name === SCRIPT_NAAM);
    let scriptId;
    if (bestaand) {
      scriptId = bestaand.id;
      // overschrijven van een lopend script geeft een fout (Shelly-documentatie) — eerst stoppen
      if (bestaand.running) await rpcCall(shellyIp, 'Script.Stop', { id: scriptId });
    } else {
      const nieuw = await rpcCall(shellyIp, 'Script.Create', { name: SCRIPT_NAAM });
      scriptId = nieuw.id;
    }
    await zetScriptCode(shellyIp, scriptId, scriptCode);
    await rpcCall(shellyIp, 'Script.SetConfig', { id: scriptId, config: { enable: true } });
    await rpcCall(shellyIp, 'Script.Start', { id: scriptId });
    return { ok: true, melding: 'Snelheidsscript geïnstalleerd en gestart.' };
  } catch (e) {
    return { ok: false, melding: 'Kon het snelheidsscript niet installeren — de MQTT-instellingen zijn wel gelukt. Probeer het script apart opnieuw, of stel het handmatig in (README §3). (' + e.message + ')' };
  }
}

// Eén apparaat volledig configureren: MQTT altijd, het script optioneel. Nooit een onbehandelde
// exception naar boven laten komen (dit is een verwacht, per-apparaat foutpad, geen serverfout) —
// altijd een compleet resultaatobject, ook als de MQTT-stap zelf al mislukt.
async function configureerShelly(shellyIp, { topicPrefix, brokerHost, brokerPoort = 1883, metScript, scriptCode }) {
  const start = Date.now();
  let mqttResultaat;
  try {
    mqttResultaat = await configureerMqtt(shellyIp, { brokerHost, brokerPoort, topicPrefix });
  } catch (e) {
    return { ok: false, mqtt: { ok: false, melding: e.message }, script: null, herstart_duur_ms: Date.now() - start };
  }
  const scriptResultaat = metScript ? await configureerScript(shellyIp, scriptCode) : null;
  return {
    ok: mqttResultaat.ok && (!scriptResultaat || scriptResultaat.ok),
    mqtt: mqttResultaat,
    script: scriptResultaat,
    herstart_duur_ms: Date.now() - start,
  };
}

module.exports = { configureerShelly };
