// ---------- Systeeminstellingen (evenementnaam/editie) — Beheer-tab ----------
// Bewerkbaar vanuit de UI i.p.v. alleen via .env.
// Opslaan gebeurt in twee stappen: PUT /api/instellingen (direct, schrijft instellingen.json) en
// daarna POST /api/instellingen/telegraf-herstart (asynchrone job, herstart Telegraf zodat nieuwe
// metingen ook echt de nieuwe editie/evenement-tags krijgen — Telegraf leest die alleen bij het
// aanmaken van het container, zie §B1) — apart gepolld, zelfde bezig/klaar/fout-patroon als de
// rapport-/back-upflows.
import { apiCall } from './api.js';
import { t } from './i18n.js';

function toonInstellingCard(naam){
  ['instellingStatusCard','instellingResultCard','instellingErrorCard'].forEach(id=>{
    document.getElementById(id).style.display = (id===naam) ? 'flex' : 'none';
  });
}

async function pollTelegrafHerstart(){
  let job;
  try{ job = await apiCall('/api/instellingen/telegraf-herstart/status', 'GET'); }
  catch(e){ return; }
  if(job.status==='bezig'){
    toonInstellingCard('instellingStatusCard');
    setTimeout(pollTelegrafHerstart, 1500);
    return;
  }
  if(job.status==='klaar'){
    toonInstellingCard('instellingResultCard');
  } else if(job.status==='fout'){
    document.getElementById('instellingErrorInfo').textContent = t('backup.mislukt', {fout: job.foutmelding || t('rapport.onbekendeFout')});
    toonInstellingCard('instellingErrorCard');
  } else {
    toonInstellingCard(null);
  }
}

async function slaInstellingenOp(){
  const event_name = document.getElementById('instellingEventName').value.trim();
  const event_edition = document.getElementById('instellingEventEdition').value.trim();
  if(!event_name || !event_edition) return alert(t('beheer.alertVulInstellingen'));
  try{
    await apiCall('/api/instellingen', 'PUT', { event_name, event_edition });
    toonInstellingCard('instellingStatusCard');
    await apiCall('/api/instellingen/telegraf-herstart', 'POST');
    pollTelegrafHerstart();
  }catch(e){
    document.getElementById('instellingErrorInfo').textContent = e.message;
    toonInstellingCard('instellingErrorCard');
  }
}
document.getElementById('instellingOpslaanBtn').onclick = slaInstellingenOp;

export async function initInstellingen(){
  try{
    const data = await apiCall('/api/instellingen', 'GET');
    if(data.event_name) document.getElementById('instellingEventName').value = data.event_name;
    if(data.event_edition) document.getElementById('instellingEventEdition').value = data.event_edition;
  }catch(e){ /* lege velden zijn prima, gewoon opnieuw invullen */ }
  pollTelegrafHerstart(); // pikt een herstart die al liep vóór een page-refresh weer op
}
