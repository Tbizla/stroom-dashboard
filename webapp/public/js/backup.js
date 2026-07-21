// ---------- Back-up-subtab (roadmap-item 8) ----------
// Hergebruikt 1-op-1 het status/resultaat/foutkaart-patroon (addform + dot busy/ok/err) van de
// PDF-rapportflow in rapport.js — zelfde interactiepatroon, eigen jobstatus (backupJob in server.js).
import { state } from './state.js';
import { apiCall } from './api.js';
import { t } from './i18n.js';

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

export function initBackup(){
  pollBackupStatus(); // pikt een back-up die al liep vóór een page-refresh weer op
}
