// ---------- mode switching ----------
import { state } from './state.js';
import { apiCall } from './api.js';
import { loadTopology } from './topology.js';
import { renderBeheer } from './render-beheer.js';
import { renderPins } from './render-pins.js';
import { renderSchema } from './render-schema.js';
import { renderKastPopup } from './kastpopup.js';
import { renderDetail } from './render-detail.js';
import { applyZoom, fitToScreen, setZoom, currentZoom } from './zoom.js';
import { zoomLevels } from './state.js';
import { t } from './i18n.js';
import { toonOverzicht } from './overzicht.js';
import { toonGrafieken } from './grafieken.js';
import { verbindMqtt } from './mqtt.js';
import { toonLocaties, toonLocatiesBeheren } from './hq-locaties.js';
import { ververLiveKpi } from './live-kpi.js';
import { renderVpOverlay } from './viewport-kalibratie.js';

function setActiveModeButton(id){
  ['modeBeheer','modeCal','modeSchema','modeLive','modeTest','modeRapportages','modeGrafieken'].forEach(b=>document.getElementById(b).classList.toggle('active', b===id));
  // geen kaart meer zichtbaar (of niet meer Live) na een tabwissel, dus een eventueel open
  // MQTT-databalonnetje heeft dan geen ankerpunt meer
  if(state.openPopupKastId){ state.openPopupKastId = null; renderKastPopup(); }
  // specs/live-viewport-grote-monitor-plan.md: #detail toont een trendlijn alleen op Live (state.
  // mode-check zit in render-detail.js zelf) — hier herrenderen zodat die meteen verschijnt/verdwijnt
  // bij elke tabwissel, niet pas bij de eerstvolgende toevallige aanleiding
  renderDetail();
  // specs/live-viewport-grote-monitor-plan.md, fase 3: het viewport-kalibratie-kader hoort/verdwijnt
  // alleen op Kalibreren (renderVpOverlay() zelf checkt state.mode) — hier al herrenderen i.p.v. pas
  // bij de eerstvolgende kaartzoom, anders blijft het kader nog even zichtbaar op het net-verlaten
  // tabblad
  renderVpOverlay();
}
// specs/beheer-subtabs-plan.md: vier sub-tabs binnen Beheer (Topologie/Instellingen/Accounts/
// Back-up), zelfde patroon als toonRapportSubnav() hieronder — een verhuizing van bestaande
// content in DOM-structuur, geen enkel formulier/tabel/knop is herbouwd of hernoemd, dus al het
// bestaande JS in render-beheer.js/instellingen.js/notificaties.js/accounts.js/(automatische-)
// backup.js blijft ongewijzigd werken zolang de id's intact blijven.
// Locaties kreeg géén 'subnavLocaties' id hier (die is al in gebruik door de gelijknamige
// Rapportages-subtab, zie toonRapportSubnav() verderop) — vandaar een expliciete naam->id-lookup
// i.p.v. de capitalize-truc die de overige drie subtabs hierboven nog gebruiken.
const BEHEER_SUBNAV_IDS = {
  topologie: 'subnavTopologie',
  instellingen: 'subnavInstellingen',
  accounts: 'subnavAccounts',
  backup: 'subnavBackup',
  locaties: 'subnavBeheerLocaties',
};
function toonBeheerSubnav(naam){
  state.beheerSubnav = naam;
  Object.entries(BEHEER_SUBNAV_IDS).forEach(([key,id])=>document.getElementById(id).classList.toggle('active', key===naam));
  document.getElementById('topologiePanel').style.display = naam==='topologie' ? 'flex' : 'none';
  document.getElementById('instellingenPanel').style.display = naam==='instellingen' ? 'flex' : 'none';
  document.getElementById('accountsPanel').style.display = naam==='accounts' ? 'flex' : 'none';
  document.getElementById('backupPanel').style.display = naam==='backup' ? 'flex' : 'none';
  document.getElementById('beheerLocatiesPanel').style.display = naam==='locaties' ? 'flex' : 'none';
  if(naam==='locaties') toonLocatiesBeheren();
}
document.getElementById('subnavTopologie').onclick = ()=>toonBeheerSubnav('topologie');
document.getElementById('subnavInstellingen').onclick = ()=>toonBeheerSubnav('instellingen');
document.getElementById('subnavAccounts').onclick = ()=>toonBeheerSubnav('accounts');
document.getElementById('subnavBackup').onclick = ()=>toonBeheerSubnav('backup');
document.getElementById('subnavBeheerLocaties').onclick = ()=>toonBeheerSubnav('locaties');

document.getElementById('modeBeheer').onclick = ()=>{
  state.mode='beheer';
  setActiveModeButton('modeBeheer');
  document.getElementById('liveControls').style.display='none';
  document.getElementById('calControls').style.display='none';
  document.getElementById('calbar').style.display='none';
  document.getElementById('liveTicker').style.display='none';
  document.getElementById('mainBody').style.display='none';
  document.getElementById('testPanel').style.display='none';
  document.getElementById('rapportagesPanel').style.display='none';
  document.getElementById('grafiekenPanel').style.display='none';
  document.getElementById('beheerPanel').style.display='flex';
  toonBeheerSubnav(state.beheerSubnav);
  renderBeheer();
};
document.getElementById('modeCal').onclick = ()=>{
  state.mode='cal';
  setActiveModeButton('modeCal');
  document.getElementById('liveControls').style.display='none';
  document.getElementById('calControls').style.display='flex';
  document.getElementById('calbar').style.display='flex';
  document.getElementById('liveTicker').style.display='none';
  document.getElementById('liveKpiRow').style.display='none';
  document.getElementById('rotateSep').style.display='inline-block';
  document.getElementById('rotateBtn').style.display='inline-block';
  document.getElementById('rotateLabel').style.display='inline-block';
  document.getElementById('beheerPanel').style.display='none';
  document.getElementById('testPanel').style.display='none';
  document.getElementById('rapportagesPanel').style.display='none';
  document.getElementById('grafiekenPanel').style.display='none';
  document.getElementById('mapwrap').style.display='flex';
  document.getElementById('schemaWrap').style.display='none';
  document.getElementById('mainBody').style.display='flex';
  applyZoom();
  renderPins();
};
document.getElementById('modeSchema').onclick = ()=>{
  state.mode='schema';
  setActiveModeButton('modeSchema');
  document.getElementById('liveControls').style.display='none';
  document.getElementById('calControls').style.display='none';
  document.getElementById('calbar').style.display='none';
  document.getElementById('liveTicker').style.display='none';
  document.getElementById('liveKpiRow').style.display='none';
  // specs/live-viewport-grote-monitor-plan.md, fase 2: geen rotatieknop op Schema (eigen
  // auto-gelayoutte SVG-boomdiagram, geen plattegrond)
  document.getElementById('rotateSep').style.display='none';
  document.getElementById('rotateBtn').style.display='none';
  document.getElementById('rotateLabel').style.display='none';
  document.getElementById('beheerPanel').style.display='none';
  document.getElementById('testPanel').style.display='none';
  document.getElementById('rapportagesPanel').style.display='none';
  document.getElementById('grafiekenPanel').style.display='none';
  document.getElementById('mapwrap').style.display='none';
  document.getElementById('schemaWrap').style.display='flex';
  document.getElementById('mainBody').style.display='flex';
  renderSchema();
  if(zoomLevels.schema == null) fitToScreen(); else applyZoom();
};
document.getElementById('modeLive').onclick = ()=>{
  state.mode='live';
  setActiveModeButton('modeLive');
  document.getElementById('liveControls').style.display='flex';
  document.getElementById('calControls').style.display='none';
  document.getElementById('calbar').style.display='none';
  document.getElementById('liveTicker').style.display='flex';
  document.getElementById('liveKpiRow').style.display='grid';
  document.getElementById('rotateSep').style.display='inline-block';
  document.getElementById('rotateBtn').style.display='inline-block';
  document.getElementById('rotateLabel').style.display='inline-block';
  document.getElementById('beheerPanel').style.display='none';
  document.getElementById('testPanel').style.display='none';
  document.getElementById('rapportagesPanel').style.display='none';
  document.getElementById('grafiekenPanel').style.display='none';
  document.getElementById('mapwrap').style.display='flex';
  document.getElementById('schemaWrap').style.display='none';
  document.getElementById('mainBody').style.display='flex';
  verbindMqtt();
  // specs/live-viewport-grote-monitor-plan.md, fase 3: setZoom() i.p.v. een kaal applyZoom() —
  // dwingt meteen de zoom-ondergrens + pan-clamp van een eventueel actieve viewport af, ook als
  // die zojuist op Kalibreren is toegepast terwijl je nog niet op Live was
  setZoom(currentZoom());
  renderPins();
  ververLiveKpi();
};
document.getElementById('modeTest').onclick = ()=>{
  state.mode='test';
  setActiveModeButton('modeTest');
  document.getElementById('liveControls').style.display='none';
  document.getElementById('calControls').style.display='none';
  document.getElementById('calbar').style.display='none';
  document.getElementById('liveTicker').style.display='none';
  document.getElementById('beheerPanel').style.display='none';
  document.getElementById('mainBody').style.display='none';
  document.getElementById('rapportagesPanel').style.display='none';
  document.getElementById('grafiekenPanel').style.display='none';
  document.getElementById('testPanel').style.display='flex';
  refreshSimStatus();
};

// ---------- Rapportages-tab: vijfde modeswitch-knop + altijd-zichtbare subnav (Overzicht/PDF-
// rapport) — Back-up verhuisde naar Beheer, zie specs/vervolgticket-commit-37d57ff.md §2 ----------
function toonRapportSubnav(naam){
  state.rapportSubnav = naam;
  ['subnavOverzicht','subnavPdf','subnavLocaties'].forEach(id=>document.getElementById(id).classList.toggle('active', id==='subnav'+naam.charAt(0).toUpperCase()+naam.slice(1)));
  document.getElementById('overzichtPanel').style.display = naam==='overzicht' ? 'flex' : 'none';
  document.getElementById('pdfRapportPanel').style.display = naam==='pdf' ? 'flex' : 'none';
  document.getElementById('locatiesPanel').style.display = naam==='locaties' ? 'flex' : 'none';
  if(naam==='overzicht') toonOverzicht();
  if(naam==='locaties') toonLocaties();
}
document.getElementById('subnavOverzicht').onclick = ()=>toonRapportSubnav('overzicht');
document.getElementById('subnavPdf').onclick = ()=>toonRapportSubnav('pdf');
document.getElementById('subnavLocaties').onclick = ()=>toonRapportSubnav('locaties');

document.getElementById('modeRapportages').onclick = ()=>{
  state.mode='rapportages';
  setActiveModeButton('modeRapportages');
  document.getElementById('liveControls').style.display='none';
  document.getElementById('calControls').style.display='none';
  document.getElementById('calbar').style.display='none';
  document.getElementById('liveTicker').style.display='none';
  document.getElementById('mainBody').style.display='none';
  document.getElementById('beheerPanel').style.display='none';
  document.getElementById('testPanel').style.display='none';
  document.getElementById('grafiekenPanel').style.display='none';
  document.getElementById('rapportagesPanel').style.display='flex';
  toonRapportSubnav(state.rapportSubnav);
};

document.getElementById('modeGrafieken').onclick = ()=>{
  state.mode='grafieken';
  setActiveModeButton('modeGrafieken');
  document.getElementById('liveControls').style.display='none';
  document.getElementById('calControls').style.display='none';
  document.getElementById('calbar').style.display='none';
  document.getElementById('liveTicker').style.display='none';
  document.getElementById('mainBody').style.display='none';
  document.getElementById('beheerPanel').style.display='none';
  document.getElementById('testPanel').style.display='none';
  document.getElementById('rapportagesPanel').style.display='none';
  document.getElementById('grafiekenPanel').style.display='flex';
  toonGrafieken();
};

document.getElementById('loadTestSimpelBtn').onclick = async ()=>{
  if(!confirm(t('testdata.confirmEenvoudig'))) return;
  try{
    await apiCall('/api/topology/test-data/simpel', 'POST');
    await loadTopology();
    alert(t('testdata.alertEenvoudigGeladen'));
  }catch(e){ alert(e.message); }
};

document.getElementById('loadTestUitgebreidBtn').onclick = async ()=>{
  if(!confirm(t('testdata.confirmUitgebreid'))) return;
  try{
    await apiCall('/api/topology/test-data/uitgebreid', 'POST');
    await loadTopology();
    alert(t('testdata.alertUitgebreidGeladen'));
  }catch(e){ alert(e.message); }
};

async function refreshSimStatus(){
  const dot = document.getElementById('simDot');
  const label = document.getElementById('simStatusLabel');
  try{
    const res = await fetch('/api/simulator/status');
    const data = await res.json();
    dot.className = 'dot ' + (data.enabled ? 'ok' : '');
    label.textContent = data.enabled ? t('testdata.simStatusActief') : t('testdata.simStatusGestopt');
  }catch(e){
    dot.className = 'dot err';
    label.textContent = t('testdata.simStatusFout');
  }
}

document.getElementById('simStartBtn').onclick = async ()=>{
  try{ await apiCall('/api/simulator/start', 'POST'); await refreshSimStatus(); }
  catch(e){ alert(e.message); }
};
document.getElementById('simStopBtn').onclick = async ()=>{
  try{ await apiCall('/api/simulator/stop', 'POST'); await refreshSimStatus(); }
  catch(e){ alert(e.message); }
};

document.getElementById('resetMetingenBtn').onclick = async ()=>{
  if(!confirm(t('testdata.confirmWisMeetdata'))) return;
  const status = document.getElementById('resetMetingenStatus');
  status.textContent = t('testdata.wissenBezig');
  try{
    await apiCall('/api/metingen/reset', 'POST');
    status.textContent = t('testdata.wissenKlaar');
  }catch(e){ status.textContent = ''; alert(e.message); }
};

export function refreshSimStatusIfTest(){
  if(state.mode==='test') refreshSimStatus();
}
