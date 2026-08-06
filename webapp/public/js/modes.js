// ---------- mode switching ----------
import { state } from './state.js';
import { apiCall } from './api.js';
import { loadTopology } from './topology.js';
import { renderBeheer } from './render-beheer.js';
import { renderPins } from './render-pins.js';
import { renderSchema } from './render-schema.js';
import { renderKastPopup } from './kastpopup.js';
import { applyZoom, fitToScreen } from './zoom.js';
import { zoomLevels } from './state.js';
import { t } from './i18n.js';
import { toonOverzicht } from './overzicht.js';
import { toonGrafieken } from './grafieken.js';
import { verbindMqtt } from './mqtt.js';
import { toonLocaties } from './hq-locaties.js';

function setActiveModeButton(id){
  ['modeBeheer','modeCal','modeSchema','modeLive','modeTest','modeRapportages','modeGrafieken'].forEach(b=>document.getElementById(b).classList.toggle('active', b===id));
  // geen kaart meer zichtbaar (of niet meer Live) na een tabwissel, dus een eventueel open
  // MQTT-databalonnetje heeft dan geen ankerpunt meer
  if(state.openPopupKastId){ state.openPopupKastId = null; renderKastPopup(); }
}
document.getElementById('modeBeheer').onclick = ()=>{
  state.mode='beheer';
  setActiveModeButton('modeBeheer');
  document.getElementById('liveControls').style.display='none';
  document.getElementById('calControls').style.display='none';
  document.getElementById('calbar').style.display='none';
  document.getElementById('mainBody').style.display='none';
  document.getElementById('testPanel').style.display='none';
  document.getElementById('rapportagesPanel').style.display='none';
  document.getElementById('grafiekenPanel').style.display='none';
  document.getElementById('beheerPanel').style.display='flex';
  renderBeheer();
};
document.getElementById('modeCal').onclick = ()=>{
  state.mode='cal';
  setActiveModeButton('modeCal');
  document.getElementById('liveControls').style.display='none';
  document.getElementById('calControls').style.display='flex';
  document.getElementById('calbar').style.display='flex';
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
  document.getElementById('beheerPanel').style.display='none';
  document.getElementById('testPanel').style.display='none';
  document.getElementById('rapportagesPanel').style.display='none';
  document.getElementById('grafiekenPanel').style.display='none';
  document.getElementById('mapwrap').style.display='flex';
  document.getElementById('schemaWrap').style.display='none';
  document.getElementById('mainBody').style.display='flex';
  verbindMqtt();
  applyZoom();
  renderPins();
};
document.getElementById('modeTest').onclick = ()=>{
  state.mode='test';
  setActiveModeButton('modeTest');
  document.getElementById('liveControls').style.display='none';
  document.getElementById('calControls').style.display='none';
  document.getElementById('calbar').style.display='none';
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
