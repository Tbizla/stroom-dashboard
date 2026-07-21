// ---------- telegraf-herstarter ----------
// Klein, doelbewust beperkt servicetje: krijgt de echte /var/run/docker.sock gemount, maar biedt
// naar buiten toe maar precies één actie — "herstart telegraf met deze EVENT_NAME/EVENT_EDITION".
// Bestaat omdat kant-en-klare socket-proxy's (tecnativa/docker-socket-proxy, en de
// linuxserver.io-fork) bewust nooit DELETE-requests doorlaten, wat een echte container-recreate
// (nodig omdat Telegraf zijn env vars alleen bij het *aanmaken* van het container inleest, niet bij
// een kale restart) onmogelijk maakt via die route. Zie specs/single-use-vs-edities-diagnose.md §B1.
//
// Bewust: geen generieke Docker-API-doorgifte naar de webapp (die blijft dus zonder Docker-toegang) —
// alleen dit ene servicetje heeft de socket, en het doet altijd exact dezelfde vaste
// stop->remove->create->start-reeks op het "telegraf"-container, nooit iets anders.
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

async function herstartTelegraf(eventName, eventEdition) {
  const inspect = await dockerRequest('GET', '/containers/telegraf/json');

  const env = (inspect.Config.Env || []).filter((e) => !e.startsWith('EVENT_NAME=') && !e.startsWith('EVENT_EDITION='));
  env.push('EVENT_NAME=' + eventName, 'EVENT_EDITION=' + eventEdition);
  const netwerken = (inspect.NetworkSettings && inspect.NetworkSettings.Networks) || {};

  await dockerRequest('POST', '/containers/telegraf/stop');
  await dockerRequest('DELETE', '/containers/telegraf?force=true');
  const created = await dockerRequest('POST', '/containers/create?name=telegraf', {
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
    const eventName = veilig(payload.event_name);
    const eventEdition = veilig(payload.event_edition);
    if (!eventName || !eventEdition) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'event_name en event_edition zijn verplicht en mogen alleen letters, cijfers, "_" of "-" bevatten' }));
      return;
    }
    try {
      await herstartTelegraf(eventName, eventEdition);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error('[telegraf-herstarter] herstart mislukt:', e.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

const PORT = process.env.PORT || 8090;
server.listen(PORT, () => console.log('[telegraf-herstarter] luistert op poort ' + PORT));
