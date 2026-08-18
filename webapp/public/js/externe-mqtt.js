// ---------- Externe MQTT-broker (Beheer > Instellingen) — specs/externe-mqtt-broker-plan.md ----------
// Zelfde tweestaps-opslagpatroon als instellingen.js (systeeminstellingen): PUT slaat direct op en
// start meteen een asynchrone herstart-job (hier: mosquitto i.p.v. Telegraf, via dezelfde
// telegraf-herstarter-service — zie server.js), apart gepolld met hetzelfde bezig/klaar/fout-patroon.
// Wachtwoord volgt het geheimen-patroon van notificaties.js (nooit teruggelezen, alleen een
// "_ingesteld"-boolean, met een expliciete "Wissen"-link).
import { apiCall } from './api.js';
import { t } from './i18n.js';

let wachtwoordGewist = false;

function toonExterneMqttCard(naam){
  ['externeMqttStatusCard','externeMqttResultCard','externeMqttErrorCard'].forEach(id=>{
    document.getElementById(id).style.display = (id===naam) ? 'flex' : 'none';
  });
}

async function pollMosquittoHerstart(){
  let job;
  try{ job = await apiCall('/api/instellingen/externe-mqtt/status', 'GET'); }
  catch(e){ return; }
  if(job.status==='bezig'){
    toonExterneMqttCard('externeMqttStatusCard');
    setTimeout(pollMosquittoHerstart, 1500);
    return;
  }
  if(job.status==='klaar'){
    toonExterneMqttCard('externeMqttResultCard');
  } else if(job.status==='fout'){
    document.getElementById('externeMqttErrorInfo').textContent = job.foutmelding || t('rapport.onbekendeFout');
    toonExterneMqttCard('externeMqttErrorCard');
  } else {
    toonExterneMqttCard(null);
  }
}

document.getElementById('externeMqttToggle').onclick = (e)=>{
  e.currentTarget.classList.toggle('on');
  document.getElementById('externeMqttCard').classList.toggle('off', !e.currentTarget.classList.contains('on'));
};
document.getElementById('externeMqttTlsToggle').onclick = (e)=> e.currentTarget.classList.toggle('on');
document.getElementById('externeMqttWachtwoordWis').onclick = ()=>{
  wachtwoordGewist = true;
  const el = document.getElementById('externeMqttWachtwoord');
  el.value = '';
  el.placeholder = t('beheer.notifGeheimNietIngesteld');
  el.closest('.secretfield').classList.remove('heeft-waarde');
};

document.getElementById('externeMqttOpslaanBtn').onclick = async ()=>{
  toonExterneMqttCard(null);
  const wachtwoordVeld = document.getElementById('externeMqttWachtwoord').value;
  const body = {
    actief: document.getElementById('externeMqttToggle').classList.contains('on'),
    host: document.getElementById('externeMqttHost').value.trim(),
    poort: document.getElementById('externeMqttPoort').value.trim(),
    tls: document.getElementById('externeMqttTlsToggle').classList.contains('on'),
    ca_cert: document.getElementById('externeMqttCaCert').value.trim(),
    username: document.getElementById('externeMqttUsername').value.trim(),
    // leeg + niet expliciet gewist = veld weglaten -> server laat de bestaande waarde ongewijzigd
    wachtwoord: wachtwoordVeld ? wachtwoordVeld : (wachtwoordGewist ? null : undefined),
  };
  try{
    await apiCall('/api/instellingen/externe-mqtt', 'PUT', body);
    toonExterneMqttCard('externeMqttStatusCard');
    pollMosquittoHerstart();
  }catch(e){
    document.getElementById('externeMqttErrorInfo').textContent = e.message;
    toonExterneMqttCard('externeMqttErrorCard');
  }
};

export async function initExterneMqtt(){
  try{
    const data = await apiCall('/api/instellingen', 'GET');
    const cfg = data.externeMqtt || {};
    document.getElementById('externeMqttToggle').classList.toggle('on', !!cfg.actief);
    document.getElementById('externeMqttCard').classList.toggle('off', !cfg.actief);
    if(cfg.host) document.getElementById('externeMqttHost').value = cfg.host;
    if(cfg.poort) document.getElementById('externeMqttPoort').value = cfg.poort;
    document.getElementById('externeMqttTlsToggle').classList.toggle('on', cfg.tls !== false);
    if(cfg.username) document.getElementById('externeMqttUsername').value = cfg.username;
    if(cfg.ca_cert) document.getElementById('externeMqttCaCert').value = cfg.ca_cert;
    const wachtwoordEl = document.getElementById('externeMqttWachtwoord');
    wachtwoordEl.value = '';
    wachtwoordEl.placeholder = cfg.wachtwoord_ingesteld ? t('beheer.notifGeheimIngesteld') : t('beheer.notifGeheimNietIngesteld');
    wachtwoordEl.closest('.secretfield').classList.toggle('heeft-waarde', !!cfg.wachtwoord_ingesteld);
    wachtwoordGewist = false;
  }catch(e){ /* lege velden zijn prima, gewoon opnieuw invullen */ }
  pollMosquittoHerstart(); // pikt een herstart die al liep vóór een page-refresh weer op
}
