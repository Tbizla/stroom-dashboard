// entrypoint: importeert alle modules (hun top-level code wiret de DOM-event-listeners aan) en
// start tot slot de eerste databelading. Zie specs/rebuild-plan-v2-implementatie.md Fase A.
import './i18n.js';
import { state } from './state.js';
import { loadTopology, loadMap, loadLogo } from './topology.js';
import './zoom.js';
import './render-list.js';
import './render-detail.js';
import './render-pins.js';
import './kastpopup.js';
import './render-schema.js';
import './render-beheer.js';
import { initRapport } from './rapport.js';
import { initBackup } from './backup.js';
import { ververOverzichtLiveWeergave } from './overzicht.js';
import './mqtt.js';
import { refreshSimStatusIfTest } from './modes.js';
import { renderPins } from './render-pins.js';
import { t } from './i18n.js';

// ---------- plattegrond uploaden ----------
document.getElementById('mapFile').onchange = async (ev)=>{
  const file = ev.target.files[0];
  if(!file) return;
  const fd = new FormData();
  fd.append('kaart', file);
  const errEl = document.getElementById('mapUploadErr');
  errEl.style.display = 'none';
  const res = await fetch('/api/map', { method:'POST', body: fd });
  if(!res.ok){
    const body = await res.json().catch(()=>({}));
    errEl.textContent = body.error || t('main.uploadMislukt');
    errEl.style.display = 'inline';
    ev.target.value = '';
    return;
  }
  loadMap();
};

document.getElementById('logoFile').onchange = async (ev)=>{
  const file = ev.target.files[0];
  if(!file) return;
  const fd = new FormData();
  fd.append('logo', file);
  const status = document.getElementById('logoStatus');
  status.textContent = t('beheer.logoUploading');
  status.style.color = 'var(--text2)';
  const res = await fetch('/api/logo', { method:'POST', body: fd });
  if(!res.ok){
    const body = await res.json().catch(()=>({}));
    status.textContent = body.error || t('main.uploadMislukt');
    status.style.color = 'var(--red)';
    ev.target.value = '';
    return;
  }
  loadLogo();
  status.textContent = t('beheer.logoGeupload');
};

// ---------- export / import ----------
document.getElementById('exportBtn').onclick = ()=>{ window.location.href = '/api/export'; };
document.getElementById('importFile').onchange = (ev)=>{
  const file = ev.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async ()=>{
    try{
      const data = JSON.parse(reader.result);
      await fetch('/api/import', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      await loadTopology(); renderPins();
    }catch(e){ alert(t('main.alertImportFout', {fout: e.message})); }
  };
  reader.readAsText(file);
};

initRapport();
initBackup();

// ---------- elke paar seconden topologie herladen, zodat kalibratie door een ander direct zichtbaar is ----------
// niet op het Beheer-tabblad: daar ben je zelf de enige die bewerkt, en een tussentijdse herbouw van de
// tabellen verstoort dan alleen het snel achter elkaar invoeren van velden (focus/cursor/onopgeslagen tekst)
setInterval(async ()=>{
  if(state.mode==='beheer') return;
  const prevSelected = state.selectedId;
  await loadTopology();
  state.selectedId = prevSelected;
  renderPins();
  refreshSimStatusIfTest();
  ververOverzichtLiveWeergave();
}, 5000);

loadTopology().then(loadMap);
loadLogo();
// het Testdata-tabblad (en de bijbehorende endpoints) bestaat alleen als de stack met
// --profile test + TEST_MODE=true gestart is; anders geven die endpoints toch 404, dus verberg 'm
fetch('/api/test-mode').then(r=>r.json()).then(d=>{
  if(!d.testMode) document.getElementById('modeTest').style.display = 'none';
}).catch(()=>{});
