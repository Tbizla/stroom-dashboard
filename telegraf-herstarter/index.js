// ---------- telegraf-herstarter ----------
// Klein, doelbewust beperkt servicetje: krijgt de echte /var/run/docker.sock gemount, maar biedt
// naar buiten toe maar precies één actie — POST /herstart met een `doel` (telegraf of mosquitto).
// Bestaat omdat kant-en-klare socket-proxy's (tecnativa/docker-socket-proxy, en de
// linuxserver.io-fork) bewust nooit DELETE-requests doorlaten, wat een echte container-recreate
// (nodig omdat Telegraf zijn env vars alleen bij het *aanmaken* van het container inleest, niet bij
// een kale restart) onmogelijk maakt via die route.
//
// specs/externe-mqtt-broker-plan.md: uitgebreid met een tweede, vaste toegestane doel ("mosquitto")
// naast het oorspronkelijke "telegraf" — mosquitto's bridge-config (naar een externe MQTT-broker)
// verandert net als Telegraf's EVENT_NAME/EVENT_EDITION niet met een kale restart (bridge-
// verbindingen blijken bij mosquitto niet betrouwbaar via SIGHUP te herladen), maar hoeft geen
// env-var-injectie: de bridge-config staat al klaar op het gedeelde volume vóórdat dit endpoint
// aangeroepen wordt, een gewone recreate pikt 'm dan vanzelf op. Nog steeds geen generieke Docker-
// API-doorgifte naar de webapp — alleen dit ene servicetje heeft de socket, en "doel" accepteert
// uitsluitend deze twee vaste containernamen, nooit een door de aanroeper vrij te kiezen naam.
const http = require('http');

function dockerRequest(method, pad, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      socketPath: '/var/run/docker.sock',
      path: pad,
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(chunks ? JSON.parse(chunks) : null); } catch (e) { resolve(null); }
        } else {
          reject(new Error('Docker-API ' + method + ' ' + pad + ' gaf ' + res.statusCode + ': ' + chunks));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// zelfde whitelist als veiligeTagWaarde() in webapp/server.js — deze waarden komen in
// InfluxDB-tags/Flux-queries terecht, en hier ook in line-protocol-achtige env-var-regels
function veilig(v) {
  return typeof v === 'string' && /^[a-zA-Z0-9_-]+$/.test(v) ? v : null;
}

// generiek per containernaam: leest de huidige containerconfig, past optioneel een paar env-vars
// aan (telegraf-geval), en doet dezelfde stop->remove->create->start-reeks. `envAanpassingen` mag
// null zijn (mosquitto-geval: niets aan de env, alleen een verse container die het inmiddels al
// bijgewerkte bestand op het gedeelde volume oppikt).
async function herstartContainer(containerNaam, envAanpassingen) {
  const inspect = await dockerRequest('GET', '/containers/' + containerNaam + '/json');

  let env = inspect.Config.Env || [];
  if (envAanpassingen) {
    const keys = Object.keys(envAanpassingen);
    env = env.filter((e) => !keys.some((k) => e.startsWith(k + '=')));
    keys.forEach((k) => env.push(k + '=' + envAanpassingen[k]));
  }
  const netwerken = (inspect.NetworkSettings && inspect.NetworkSettings.Networks) || {};

  await dockerRequest('POST', '/containers/' + containerNaam + '/stop');
  await dockerRequest('DELETE', '/containers/' + containerNaam + '?force=true');
  const created = await dockerRequest('POST', '/containers/create?name=' + containerNaam, {
    Image: inspect.Config.Image,
    Env: env,
    Labels: inspect.Config.Labels,
    HostConfig: inspect.HostConfig,
    NetworkingConfig: { EndpointsConfig: netwerken },
  });
  await dockerRequest('POST', '/containers/' + created.Id + '/start');
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/herstart') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'alleen POST /herstart is beschikbaar' }));
    return;
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    let payload;
    try { payload = JSON.parse(body || '{}'); } catch (e) { payload = {}; }
    // afwezig `doel` = "telegraf", voor bestaande aanroepers die dit veld nog niet meesturen
    const doel = payload.doel === undefined || payload.doel === 'telegraf' ? 'telegraf'
      : payload.doel === 'mosquitto' ? 'mosquitto' : null;
    if (doel === null) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'doel moet "telegraf" of "mosquitto" zijn' }));
      return;
    }

    let envAanpassingen = null;
    if (doel === 'telegraf') {
      const eventName = veilig(payload.event_name);
      const eventEdition = veilig(payload.event_edition);
      if (!eventName || !eventEdition) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'event_name en event_edition zijn verplicht en mogen alleen letters, cijfers, "_" of "-" bevatten' }));
        return;
      }
      envAanpassingen = { EVENT_NAME: eventName, EVENT_EDITION: eventEdition };
    }

    try {
      await herstartContainer(doel, envAanpassingen);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error('[telegraf-herstarter] herstart (' + doel + ') mislukt:', e.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

const PORT = process.env.PORT || 8090;
server.listen(PORT, () => console.log('[telegraf-herstarter] luistert op poort ' + PORT));
