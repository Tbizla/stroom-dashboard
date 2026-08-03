// ---------- Automatische back-up (Back-up-subtab, tussen "Back-up maken" en "Back-up herstellen") ----------
// Geplande, onbeheerde variant van de bestaande handmatige back-up — zelfde UI-taal (chancard/
// toggle) als notificaties.js voor de bestemmingskaarten. Opslag in instellingen.json
// (automatischeBackup-blok), scheduling/rotatie/verzending gebeurt server-side (server.js).
import { apiCall } from './api.js';
import { t } from './i18n.js';

const BESTEMMINGEN = ['lokaal', 'sftp', 's3'];
function bestemmingNaam(id){ return id.charAt(0).toUpperCase() + id.slice(1); }

function veldenVoorBestemming(id){
  if(id==='lokaal') return { pad: 'autoDestLokaalPad', bewaarAantal: 'autoDestLokaalBewaar' };
  if(id==='sftp') return { host: 'autoDestSftpHost', poort: 'autoDestSftpPoort', gebruiker: 'autoDestSftpGebruiker', wachtwoord: 'autoDestSftpWachtwoord', doelmap: 'autoDestSftpDoelmap', bewaarAantal: 'autoDestSftpBewaar' };
  return { endpoint: 'autoDestS3Endpoint', bucket: 'autoDestS3Bucket', access_key: 'autoDestS3AccessKey', secret_key: 'autoDestS3SecretKey', prefix: 'autoDestS3Prefix', bewaarAantal: 'autoDestS3Bewaar' };
}
// welk veld per bestemming een geheim is — zelfde afscherming/wis-patroon als notificaties.js, zie
// specs/secrets-afscherming-plan.md en AUTOMATISCHE_BACKUP_GEHEIM_VELD_PER_BESTEMMING in server.js
const GEHEIM_VELD_PER_BESTEMMING = { sftp: 'wachtwoord', s3: 'secret_key' };
const gewisteVelden = new Set();

function huidigeBestemmingConfig(id){
  const velden = veldenVoorBestemming(id);
  const cfg = { aan: document.getElementById('autoDest' + bestemmingNaam(id) + 'Toggle').classList.contains('on') };
  const geheimVeld = GEHEIM_VELD_PER_BESTEMMING[id];
  Object.entries(velden).forEach(([key, elId])=>{
    const waarde = document.getElementById(elId).value.trim();
    if(key === geheimVeld){
      if(waarde) cfg[key] = waarde;
      else if(gewisteVelden.has(id+'.'+key)) cfg[key] = null;
      return;
    }
    cfg[key] = waarde;
  });
  return cfg;
}
function vulBestemmingConfig(id, cfg){
  const velden = veldenVoorBestemming(id);
  const toggle = document.getElementById('autoDest' + bestemmingNaam(id) + 'Toggle');
  const card = document.getElementById('autoDest' + bestemmingNaam(id) + 'Card');
  toggle.classList.toggle('on', !!(cfg && cfg.aan));
  card.classList.toggle('off', !(cfg && cfg.aan));
  const geheimVeld = GEHEIM_VELD_PER_BESTEMMING[id];
  Object.entries(velden).forEach(([key, elId])=>{
    const el = document.getElementById(elId);
    if(key === geheimVeld){
      const ingesteld = !!(cfg && cfg[key + '_ingesteld']);
      el.value = '';
      el.placeholder = ingesteld ? t('beheer.notifGeheimIngesteld') : t('beheer.notifGeheimNietIngesteld');
      el.closest('.secretfield').classList.toggle('heeft-waarde', ingesteld);
      gewisteVelden.delete(id+'.'+key);
      return;
    }
    if(cfg && cfg[key]!=null && cfg[key]!=='') el.value = cfg[key];
  });
}

Object.entries(GEHEIM_VELD_PER_BESTEMMING).forEach(([id, veld])=>{
  const elId = veldenVoorBestemming(id)[veld];
  document.getElementById(elId + 'Wis').onclick = ()=>{
    gewisteVelden.add(id+'.'+veld);
    const el = document.getElementById(elId);
    el.value = '';
    el.placeholder = t('beheer.notifGeheimNietIngesteld');
    el.closest('.secretfield').classList.remove('heeft-waarde');
  };
});

BESTEMMINGEN.forEach(id=>{
  const naam = bestemmingNaam(id);
  document.getElementById('autoDest' + naam + 'Toggle').onclick = (e)=>{
    e.currentTarget.classList.toggle('on');
    document.getElementById('autoDest' + naam + 'Card').classList.toggle('off', !e.currentTarget.classList.contains('on'));
  };
});

function toonFrequentieVelden(){
  const frequentie = document.getElementById('autoBackupFrequentie').value;
  document.getElementById('autoBackupDagWrap').style.display = frequentie==='wekelijks' ? 'flex' : 'none';
  document.getElementById('autoBackupTijdstipWrap').style.display = frequentie==='elk_uur' ? 'none' : 'flex';
}
document.getElementById('autoBackupFrequentie').onchange = toonFrequentieVelden;

document.getElementById('autoBackupToggle').onclick = (e)=>{
  e.currentTarget.classList.toggle('on');
  document.getElementById('autoBackupBody').style.opacity = e.currentTarget.classList.contains('on') ? '1' : '.55';
};

function huidigeAutoBackupConfig(){
  const cfg = {
    aan: document.getElementById('autoBackupToggle').classList.contains('on'),
    frequentie: document.getElementById('autoBackupFrequentie').value,
    dag: document.getElementById('autoBackupDag').value,
    tijdstip: document.getElementById('autoBackupTijdstip').value,
    meetdataMeenemen: document.getElementById('autoBackupMeetdataCb').checked,
    bestemmingen: {},
  };
  BESTEMMINGEN.forEach(id=>{ cfg.bestemmingen[id] = huidigeBestemmingConfig(id); });
  return cfg;
}

document.getElementById('autoBackupOpslaanBtn').onclick = async ()=>{
  ['autoBackupResultCard','autoBackupErrorCard'].forEach(id=>document.getElementById(id).style.display='none');
  try{
    const res = await apiCall('/api/instellingen/automatische-backup', 'PUT', huidigeAutoBackupConfig());
    document.getElementById('autoBackupResultInfo').textContent = res.fout
      ? t('beheer.notifOpgeslagenGrafanaFout', {fout: res.fout})
      : t('backup.autoOpgeslagen');
    document.getElementById('autoBackupResultCard').style.display = 'flex';
    // na opslaan opnieuw inladen: geheime velden tonen weer de correcte "ingesteld"-placeholder
    // i.p.v. de invoerwaarde te laten staan (zelfde reden als notificaties.js)
    initAutomatischeBackup();
  }catch(e){
    document.getElementById('autoBackupErrorInfo').textContent = e.message;
    document.getElementById('autoBackupErrorCard').style.display = 'flex';
  }
};

async function ververAutoBackupStatus(){
  let status;
  try{ status = await apiCall('/api/backup/automatisch/status', 'GET'); }
  catch(e){ return; }
  const dot = document.getElementById('autoBackupStatusDot');
  const tekst = document.getElementById('autoBackupStatusTekst');
  const volgende = document.getElementById('autoBackupVolgendeTekst');

  if(!status.laatsteRunOp){
    dot.className = 'dot';
    tekst.textContent = t('backup.autoNogNooitGedraaid');
  } else {
    const tijdstip = new Date(status.laatsteRunOp).toLocaleString();
    if(status.laatsteRunResultaat==='ok'){
      dot.className = 'dot ok';
      const bestemmingen = Object.keys(status.laatsteRunDetails||{}).filter(k=>status.laatsteRunDetails[k].ok).map(bestemmingNaam).join(', ');
      tekst.textContent = t('backup.autoLaatsteGeslaagd', {tijdstip, bestemmingen});
    } else if(status.laatsteRunResultaat==='deels_mislukt'){
      dot.className = 'dot err';
      const mislukt = Object.keys(status.laatsteRunDetails||{}).filter(k=>!status.laatsteRunDetails[k].ok).map(bestemmingNaam).join(', ');
      tekst.textContent = t('backup.autoLaatsteDeelsMislukt', {tijdstip, bestemmingen: mislukt});
    } else {
      dot.className = 'dot err';
      const fout = typeof status.laatsteRunDetails==='string' ? status.laatsteRunDetails : JSON.stringify(status.laatsteRunDetails);
      tekst.textContent = t('backup.autoLaatsteMislukt', {tijdstip, fout});
    }
  }
  volgende.textContent = status.volgendeGeplandOp
    ? t('backup.autoVolgendeGepland', {tijdstip: new Date(status.volgendeGeplandOp).toLocaleString()})
    : t('backup.autoUitgeschakeld');
}

export async function initAutomatischeBackup(){
  try{
    const data = await apiCall('/api/instellingen', 'GET');
    const cfg = data.automatischeBackup || {};
    document.getElementById('autoBackupToggle').classList.toggle('on', !!cfg.aan);
    document.getElementById('autoBackupBody').style.opacity = cfg.aan ? '1' : '.55';
    if(cfg.frequentie) document.getElementById('autoBackupFrequentie').value = cfg.frequentie;
    if(cfg.dag) document.getElementById('autoBackupDag').value = cfg.dag;
    if(cfg.tijdstip) document.getElementById('autoBackupTijdstip').value = cfg.tijdstip;
    document.getElementById('autoBackupMeetdataCb').checked = cfg.meetdataMeenemen !== false;
    BESTEMMINGEN.forEach(id=>vulBestemmingConfig(id, (cfg.bestemmingen||{})[id]));
    toonFrequentieVelden();
  }catch(e){ /* lege velden zijn prima, gewoon opnieuw invullen */ }
  ververAutoBackupStatus();
}
