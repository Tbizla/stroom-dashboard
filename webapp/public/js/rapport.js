// ---------- rapport exporteren (PDF) ----------
import { state } from './state.js';
import { apiCall } from './api.js';
import { t, huidigeLocale, huidigeTaal } from './i18n.js';

async function vulRapportEditieSelect(){
  const select = document.getElementById('rapportEditieSelect');
  const huidige = select.value;
  try{
    const data = await apiCall('/api/rapport/edities', 'GET');
    select.innerHTML = '<option value="__alle__">'+t('rapport.alleEdities')+'</option>' +
      data.edities.map(e=>'<option value="'+e+'"'+(e===huidige?' selected':'')+'>'+e+'</option>').join('');
    if(!huidige && data.edities.length) select.value = data.edities[data.edities.length-1];
  }catch(e){ select.innerHTML = '<option value="__alle__">'+t('rapport.alleEdities')+'</option>'; }
}

// taal van het rapport: staat standaard op de huidige UI-taal, maar is via de schuifknop apart
// om te zetten voor deze ene generatie — losse keuze van de UI-taal-toggle in de header, geen
// aparte onthouden voorkeur (bij een taalwissel van de UI zelf herlaadt de pagina toch al, dus
// deze schuifknop synct opnieuw met huidigeTaal op dat moment)
let rapportTaal = huidigeTaal;
const rapportTaalToggleEl = document.getElementById('rapportTaalToggle');
rapportTaalToggleEl.checked = huidigeTaal === 'en';
rapportTaalToggleEl.onchange = ()=>{ rapportTaal = rapportTaalToggleEl.checked ? 'en' : 'nl'; };

document.querySelectorAll('.listfilters [data-periodechip]').forEach(chip=>{
  chip.onclick = ()=>{
    state.rapportPeriodeChip = chip.dataset.periodechip;
    document.querySelectorAll('.listfilters [data-periodechip]').forEach(c=>c.classList.toggle('active', c===chip));
    document.getElementById('rapportAangepastPeriode').style.display = state.rapportPeriodeChip==='aangepast' ? 'flex' : 'none';
  };
});

// levert {van, tot} als ISO-strings op basis van de gekozen periode-chip
async function bepaalRapportPeriode(){
  if(state.rapportPeriodeChip==='24u'){
    const tot = new Date();
    const van = new Date(tot.getTime() - 24*3600*1000);
    return { van: van.toISOString(), tot: tot.toISOString() };
  }
  if(state.rapportPeriodeChip==='aangepast'){
    const van = document.getElementById('rapportVanInput').value;
    const tot = document.getElementById('rapportTotInput').value;
    if(!van || !tot) throw new Error(t('rapport.alertVulDatums'));
    return { van: new Date(van).toISOString(), tot: new Date(tot).toISOString() };
  }
  // 'alles': volledige tijdrange van de gekozen editie opvragen
  const editie = document.getElementById('rapportEditieSelect').value;
  const periode = await apiCall('/api/rapport/periode?editie='+encodeURIComponent(editie), 'GET');
  if(!periode.van || !periode.tot) throw new Error(t('rapport.alertGeenMeetdata'));
  return { van: periode.van, tot: periode.tot };
}

function toonRapportCard(naam){
  ['rapportStatusCard','rapportResultCard','rapportErrorCard'].forEach(id=>{
    document.getElementById(id).style.display = (id===naam) ? 'flex' : 'none';
  });
}

async function pollRapportStatus(){
  let job;
  try{ job = await apiCall('/api/rapport/status', 'GET'); }
  catch(e){ return; }
  if(job.status==='bezig'){
    toonRapportCard('rapportStatusCard');
    if(!state.rapportPollHandle) state.rapportPollHandle = setInterval(pollRapportStatus, 2000);
    return;
  }
  if(state.rapportPollHandle){ clearInterval(state.rapportPollHandle); state.rapportPollHandle = null; }
  if(job.status==='klaar'){
    const grootteKb = job.bestandsgrootte ? Math.round(job.bestandsgrootte/1024)+' KB' : '';
    const tijdstip = job.klaarOp ? new Date(job.klaarOp).toLocaleString(huidigeLocale()) : '';
    document.getElementById('rapportResultInfo').textContent = job.bestandsnaam+' · '+grootteKb+' · '+tijdstip;
    toonRapportCard('rapportResultCard');
  } else if(job.status==='fout'){
    document.getElementById('rapportErrorInfo').textContent = job.foutmelding || t('rapport.onbekendeFout');
    toonRapportCard('rapportErrorCard');
  } else {
    toonRapportCard(null);
  }
}

async function startRapportGeneratie(){
  try{
    const { van, tot } = await bepaalRapportPeriode();
    const editie = document.getElementById('rapportEditieSelect').value;
    const onderdelen = {
      generatorTotalen: document.getElementById('rapportGeneratorTotalen').checked,
      kastPerFase: document.getElementById('rapportKastPerFase').checked,
      sankey: document.getElementById('rapportSankey').checked,
      alarmen: document.getElementById('rapportAlarmen').checked,
    };
    await apiCall('/api/rapport/genereer', 'POST', { editie, van, tot, onderdelen, taal: rapportTaal });
    toonRapportCard('rapportStatusCard');
    if(state.rapportPollHandle) clearInterval(state.rapportPollHandle);
    state.rapportPollHandle = setInterval(pollRapportStatus, 2000);
  }catch(e){ alert(e.message); }
}
document.getElementById('rapportGenereerBtn').onclick = startRapportGeneratie;
document.getElementById('rapportOpnieuwBtn').onclick = startRapportGeneratie;
document.getElementById('rapportDownloadBtn').onclick = ()=>{ window.location.href = '/api/rapport/download'; };

export function initRapport(){
  vulRapportEditieSelect();
  pollRapportStatus(); // pikt een generatie die al liep vóór een page-refresh weer op
}
