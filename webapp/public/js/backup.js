// ---------- Back-up-subtab (roadmap-item 8) ----------
// Hergebruikt 1-op-1 het status/resultaat/foutkaart-patroon (addform + dot busy/ok/err) van de
// PDF-rapportflow in rapport.js — zelfde interactiepatroon, eigen jobstatus (backupJob in server.js).
import { state } from './state.js';
import { apiCall } from './api.js';
import { t } from './i18n.js';
import { loadTopology } from './topology.js';

document.querySelectorAll('#backupPanel [data-backupperiode]').forEach(chip=>{
  chip.onclick = ()=>{
    state.backupPeriodeChip = chip.dataset.backupperiode;
    document.querySelectorAll('#backupPanel [data-backupperiode]').forEach(c=>c.classList.toggle('active', c===chip));
    document.getElementById('backupAangepastPeriode').style.display = state.backupPeriodeChip==='aangepast' ? 'flex' : 'none';
  };
});

// levert {van, tot} als ISO-strings op, zelfde patroon als bepaalRapportPeriode()/bepaalOverzichtPeriode()
async function bepaalBackupMeetdataPeriode(){
  if(state.backupPeriodeChip==='24u'){
    const tot = new Date();
    const van = new Date(tot.getTime() - 24*3600*1000);
    return { van: van.toISOString(), tot: tot.toISOString() };
  }
  if(state.backupPeriodeChip==='aangepast'){
    const van = document.getElementById('backupVanInput').value;
    const tot = document.getElementById('backupTotInput').value;
    if(!van || !tot) throw new Error(t('rapport.alertVulDatums'));
    return { van: new Date(van).toISOString(), tot: new Date(tot).toISOString() };
  }
  const periode = await apiCall('/api/rapport/periode?editie=__alle__', 'GET');
  if(!periode.van || !periode.tot) throw new Error(t('rapport.alertGeenMeetdata'));
  return { van: periode.van, tot: periode.tot };
}

function toonBackupCard(naam){
  ['backupStatusCard','backupResultCard','backupErrorCard'].forEach(id=>{
    document.getElementById(id).style.display = (id===naam) ? 'flex' : 'none';
  });
}

async function pollBackupStatus(){
  let job;
  try{ job = await apiCall('/api/backup/status', 'GET'); }
  catch(e){ return; }
  if(job.status==='bezig'){
    toonBackupCard('backupStatusCard');
    if(!state.backupPollHandle) state.backupPollHandle = setInterval(pollBackupStatus, 2000);
    return;
  }
  if(state.backupPollHandle){ clearInterval(state.backupPollHandle); state.backupPollHandle = null; }
  if(job.status==='klaar'){
    const grootteKb = job.bestandsgrootte ? Math.round(job.bestandsgrootte/1024/1024*10)/10+' MB' : '';
    const tijdstip = job.klaarOp ? new Date(job.klaarOp).toLocaleString() : '';
    document.getElementById('backupResultInfo').textContent = job.bestandsnaam+' · '+grootteKb+' · '+tijdstip;
    toonBackupCard('backupResultCard');
  } else if(job.status==='fout'){
    document.getElementById('backupErrorInfo').textContent = t('backup.mislukt', {fout: job.foutmelding || t('rapport.onbekendeFout')});
    toonBackupCard('backupErrorCard');
  } else {
    toonBackupCard(null);
  }
}

async function startBackupGeneratie(){
  try{
    const meetdataAangevinkt = document.getElementById('backupMeetdataCb').checked;
    const meetdata = meetdataAangevinkt ? await bepaalBackupMeetdataPeriode() : undefined;
    await apiCall('/api/backup/genereer', 'POST', { meetdata });
    toonBackupCard('backupStatusCard');
    if(state.backupPollHandle) clearInterval(state.backupPollHandle);
    state.backupPollHandle = setInterval(pollBackupStatus, 2000);
  }catch(e){ alert(e.message); }
}
document.getElementById('backupGenereerBtn').onclick = startBackupGeneratie;
document.getElementById('backupOpnieuwBtn').onclick = startBackupGeneratie;
document.getElementById('backupDownloadBtn').onclick = ()=>{ window.location.href = '/api/backup/download'; };

// ---------- Back-up herstellen (restore, tegenhanger van hierboven) ----------
// De drie optionrows hieronder zijn puur informatief (server bepaalt op basis van `herstelModus`
// zelf wat 'm daadwerkelijk terugzet, negeert topologie/media altijd bij "editie_toevoegen") —
// geen los aan-/uitvinkgedrag nodig, alleen tekst/dimming die met de gekozen modus meeverandert.
let herstelBestand = null;
let herstelModus = 'volledig';
const ONDERDEEL_LABEL = { topologie: 'backup.topologieLbl', media: 'backup.plattegrondLogoLbl', meetdata: 'backup.meetdataLbl' };

document.getElementById('herstelBestand').onchange = (ev)=>{
  herstelBestand = ev.target.files[0] || null;
  document.getElementById('herstelBestandsnaam').textContent = herstelBestand ? herstelBestand.name : '';
};

function updateHerstelModusUI(){
  const volledig = herstelModus === 'volledig';
  document.querySelectorAll('[data-herstelmodus]').forEach(el=>{
    el.classList.toggle('active', el.dataset.herstelmodus === herstelModus);
  });
  document.getElementById('herstelTopologieRow').classList.toggle('locked', !volledig);
  document.getElementById('herstelMediaRow').classList.toggle('locked', !volledig);
  document.querySelector('#herstelTopologieRow input').checked = volledig;
  document.querySelector('#herstelMediaRow input').checked = volledig;
  document.getElementById('herstelTopologieDesc').textContent = volledig ? t('backup.topologieDesc') : t('backup.herstelNvt');
  document.getElementById('herstelMediaDesc').textContent = volledig ? t('backup.plattegrondLogoDesc') : t('backup.herstelNvt');
  document.getElementById('herstelMeetdataDesc').textContent = volledig ? t('backup.meetdataDesc') : t('backup.herstelMeetdataAltijd');
  document.getElementById('herstelWaarschuwing').style.display = 'none';
}
document.querySelectorAll('[data-herstelmodus]').forEach(card=>{
  card.onclick = ()=>{ herstelModus = card.dataset.herstelmodus; updateHerstelModusUI(); };
});
updateHerstelModusUI();

function toonHerstelCard(naam){
  ['herstelStatusCard','herstelResultCard','herstelErrorCard'].forEach(id=>{
    document.getElementById(id).style.display = (id===naam) ? 'flex' : 'none';
  });
}

async function pollHerstelStatus(){
  let job;
  try{ job = await apiCall('/api/backup/herstel/status', 'GET'); }
  catch(e){ return; }
  if(job.status==='bezig'){
    toonHerstelCard('herstelStatusCard');
    if(!state.herstelPollHandle) state.herstelPollHandle = setInterval(pollHerstelStatus, 2000);
    return;
  }
  if(state.herstelPollHandle){ clearInterval(state.herstelPollHandle); state.herstelPollHandle = null; }
  if(job.status==='klaar'){
    const labels = job.resultaat.onderdelen.map(o=>ONDERDEEL_LABEL[o] ? t(ONDERDEEL_LABEL[o]) : o).join(', ');
    document.getElementById('herstelResultInfo').textContent = t('backup.herstelKlaar', {onderdelen: labels, editie: job.resultaat.editie});
    toonHerstelCard('herstelResultCard');
    loadTopology(); // topologie kan net teruggezet zijn
  } else if(job.status==='fout'){
    document.getElementById('herstelErrorInfo').textContent = t('backup.mislukt', {fout: job.foutmelding || t('rapport.onbekendeFout')});
    toonHerstelCard('herstelErrorCard');
  } else {
    toonHerstelCard(null);
  }
}

async function startHerstel(){
  if(!herstelBestand) return alert(t('backup.herstelAlertGeenBestand'));
  const fd = new FormData();
  fd.append('backup', herstelBestand);
  fd.append('modus', herstelModus);
  document.getElementById('herstelWaarschuwing').style.display = 'none';
  try{
    const res = await fetch('/api/backup/herstel', { method:'POST', body: fd });
    const data = await res.json().catch(()=>({}));
    if(!res.ok){
      if(res.status === 409 && data.error && herstelModus === 'editie_toevoegen'){
        const waarschuwing = document.getElementById('herstelWaarschuwing');
        waarschuwing.textContent = data.error;
        waarschuwing.style.display = 'block';
        return;
      }
      throw new Error(data.error || ('fout '+res.status));
    }
    toonHerstelCard('herstelStatusCard');
    if(state.herstelPollHandle) clearInterval(state.herstelPollHandle);
    state.herstelPollHandle = setInterval(pollHerstelStatus, 2000);
  }catch(e){ alert(e.message); }
}
document.getElementById('herstelStartBtn').onclick = startHerstel;
document.getElementById('herstelOpnieuwBtn').onclick = startHerstel;

export function initBackup(){
  pollBackupStatus(); // pikt een back-up die al liep vóór een page-refresh weer op
  pollHerstelStatus();
}
