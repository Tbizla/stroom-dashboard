// ---------- HQ-Locaties (specs/toegang-van-buitenaf-diagnose.md) — Rapportages-subtab ----------
// Handmatige locatielijst + een live statusoverzicht (server-naar-server opgehaald via
// /api/hq-locaties-status, zie server.js — de browser praat nooit rechtstreeks met een andere
// locatie-instance, dat voorkomt CORS/mixed-content-gedoe en houdt elke locatie-URL server-side).
import { apiCall } from './api.js';
import { t } from './i18n.js';

// vervolgticket-toegang-van-buitenaf.md §7: naam/URL komen van het locatielijst-formulier en gaan
// hier in innerHTML (en het href-attribuut) — escapen vóór het te renderen (stored-XSS anders)
function esc(s){
  return String(s).replace(/[&<>"']/g, (c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function statusInfo(loc){
  if(loc.offline) return { cls: 'off', tekst: t('locaties.offline') };
  if(!loc.amberRood) return { cls: 'ok', tekst: t('locaties.statusOk') };
  return { cls: 'amber', tekst: t('locaties.statusAmber', { n: loc.amberRood }) };
}

function renderCards(locaties){
  const el = document.getElementById('locCards');
  if(!locaties.length){
    el.innerHTML = '<div style="color:var(--text3);font-size:12.5px">'+t('locaties.geenLocaties')+'</div>';
    return;
  }
  el.innerHTML = locaties.map(loc=>{
    const status = statusInfo(loc);
    return '<div class="loccard">'+
      '<div class="top"><span class="naam">'+esc(loc.naam)+'</span><div class="dot '+status.cls+'"></div></div>'+
      '<div class="metrics">'+
        '<div>'+t('locaties.kasten')+'<b>'+(loc.offline?'—':loc.kasten)+'</b></div>'+
        '<div>'+t('locaties.amberRood')+'<b>'+(loc.offline?'—':loc.amberRood)+'</b></div>'+
      '</div>'+
      '<div class="statuslabel '+status.cls+'">'+status.tekst+'</div>'+
      '<a class="openbtn" href="'+esc(loc.url)+'" target="_blank" rel="noopener">'+t('locaties.beheerOpenen')+' →</a>'+
    '</div>';
  }).join('');
}

async function renderLocatiesTabel(){
  const tabel = document.getElementById('locatiesTable');
  let locaties;
  try{ locaties = await apiCall('/api/locaties', 'GET'); }catch(e){ return []; }
  tabel.innerHTML = '<tr><th>'+t('locaties.naam')+'</th><th>URL</th><th></th></tr>' +
    locaties.map(l=>
      '<tr><td>'+esc(l.naam)+'</td><td style="font-family:var(--mono);color:var(--text2)">'+esc(l.url)+'</td>'+
      '<td><button class="danger" data-verwijder="'+l.id+'">'+t('common.verwijderen')+'</button></td></tr>'
    ).join('');
  tabel.querySelectorAll('[data-verwijder]').forEach(btn=>{
    btn.onclick = async ()=>{
      if(!confirm(t('locaties.verwijderenConfirm'))) return;
      try{ await apiCall('/api/locaties/'+btn.dataset.verwijder, 'DELETE'); await ververLocaties(); }
      catch(e){ alert(e.message); }
    };
  });
  return locaties;
}

async function ververLocaties(){
  const locaties = await renderLocatiesTabel();
  if(!locaties.length){ renderCards([]); return; }
  try{
    renderCards(await apiCall('/api/hq-locaties-status', 'GET'));
  }catch(e){
    renderCards(locaties.map(l=>({ ...l, offline: true })));
  }
}

document.getElementById('addLocatieBtn').onclick = async ()=>{
  const naamInput = document.getElementById('newLocatieNaam');
  const urlInput = document.getElementById('newLocatieUrl');
  const naam = naamInput.value.trim();
  const url = urlInput.value.trim();
  if(!naam || !url) return alert(t('locaties.alertVulVelden'));
  try{
    await apiCall('/api/locaties', 'POST', { naam, url });
    naamInput.value = ''; urlInput.value = '';
    await ververLocaties();
  }catch(e){ alert(e.message); }
};

// aangeroepen vanuit modes.js zodra de Locaties-subtab getoond wordt
export async function toonLocaties(){
  await ververLocaties();
}
