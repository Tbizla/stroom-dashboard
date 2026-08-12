// ---------- specs/live-viewport-grote-monitor-plan.md, fase 3: viewport-kalibratie op Kalibreren ----------
// Aanvulling op het bestaande Kalibreren-tabblad (pin-plaatsing/-slepen/lijnen blijven ongewijzigd
// werken), geen vervanging: een sleepbaar/verkleinbaar kader waarmee je vastlegt welk deel van de
// tekening Live straks toont. Server-side opgeslagen (topology.json, GET/POST /api/topology/viewport
// — zie server.js) omdat dit voor ELKE viewer van Live hetzelfde moet zijn, geen per-browser
// voorkeur zoals zoom/rotatie (die blijven in localStorage). .vprect/.vphandle/.vpmask zitten als
// kind in #mapinner (index.html) en roteren/schalen dus automatisch mee met de kaart, exact zoals
// pins dat al doen — hun px-positie wordt hier berekend uit x_pct/y_pct/w_pct/h_pct tegen
// surface.clientWidth/Height, dezelfde forward-wiskunde als render-pins.js.
import { state, mapinner } from './state.js';
import { rotatieState } from './state.js';
import { getSurfaceEl } from './topology.js';
import { muisNaarPct } from './rotatie.js';
import { apiCall } from './api.js';
import { t } from './i18n.js';

const VOLLEDIGE_TEKENING = { x_pct: 0, y_pct: 0, w_pct: 100, h_pct: 100 };
const MIN_AFMETING_PCT = 5; // voorkomt een onbruikbaar piepklein kader tijdens het verkleinen

const rectEl = document.getElementById('vpRect');
const maskTopEl = document.getElementById('vpMaskTop');
const maskBottomEl = document.getElementById('vpMaskBottom');
const maskLeftEl = document.getElementById('vpMaskLeft');
const maskRightEl = document.getElementById('vpMaskRight');
const panelEl = document.getElementById('vpPanel');
const toggleBtn = document.getElementById('viewportKalibratieBtn');
const overlayEls = [rectEl, maskTopEl, maskBottomEl, maskLeftEl, maskRightEl, panelEl];

export function renderVpOverlay(){
  if(!state.viewportKalibratieActief || state.mode!=='cal'){
    overlayEls.forEach(el => el.style.display = 'none');
    return;
  }
  const surface = getSurfaceEl();
  const w = surface.clientWidth, h = surface.clientHeight;
  if(!w || !h) return;
  const vb = state.viewportBewerking;

  const left = vb.x_pct/100*w, top = vb.y_pct/100*h;
  const breedte = vb.w_pct/100*w, hoogte = vb.h_pct/100*h;

  rectEl.style.cssText = `display:block;left:${left}px;top:${top}px;width:${breedte}px;height:${hoogte}px`;
  maskTopEl.style.cssText = `display:block;left:0px;top:0px;width:${w}px;height:${top}px`;
  maskBottomEl.style.cssText = `display:block;left:0px;top:${top+hoogte}px;width:${w}px;height:${Math.max(0,h-(top+hoogte))}px`;
  maskLeftEl.style.cssText = `display:block;left:0px;top:${top}px;width:${left}px;height:${hoogte}px`;
  maskRightEl.style.cssText = `display:block;left:${left+breedte}px;top:${top}px;width:${Math.max(0,w-(left+breedte))}px;height:${hoogte}px`;

  panelEl.style.display = 'block';
  document.getElementById('vpReadoutX').textContent = vb.x_pct.toFixed(1)+'%';
  document.getElementById('vpReadoutY').textContent = vb.y_pct.toFixed(1)+'%';
  document.getElementById('vpReadoutW').textContent = vb.w_pct.toFixed(1)+'%';
  document.getElementById('vpReadoutH').textContent = vb.h_pct.toFixed(1)+'%';
}
// gedispatcht vanuit zoom.js's applyZoom() ná elke scale/rotatie-wijziging — zelfde event als
// map-tiles.js/render-pins.js al gebruiken
mapinner.addEventListener('kaartzoom', renderVpOverlay);

let vpStatusTimer = null;
function toonVpStatus(tekst){
  const el = document.getElementById('vpStatus');
  el.textContent = tekst;
  clearTimeout(vpStatusTimer);
  vpStatusTimer = setTimeout(()=>{ el.textContent = ''; }, 4000);
}

toggleBtn.onclick = ()=>{
  state.viewportKalibratieActief = !state.viewportKalibratieActief;
  toggleBtn.classList.toggle('active', state.viewportKalibratieActief);
  if(state.viewportKalibratieActief){
    state.viewportBewerking = state.TOPO.viewport ? { ...state.TOPO.viewport } : { ...VOLLEDIGE_TEKENING };
  }
  renderVpOverlay();
};

// hele kader verslepen (niet op een handle geklikt) — vergelijkt het content-punt van de start- en
// huidige muispositie (allebei al rotatiebewust via muisNaarPct) en past dat verschil toe op x_pct/
// y_pct, i.p.v. zelf nog een keer met rotatiehoeken te moeten rekenen
rectEl.addEventListener('mousedown', (ev)=>{
  if(ev.target.classList.contains('vphandle')) return;
  ev.preventDefault(); ev.stopPropagation();
  const rect = getSurfaceEl().getBoundingClientRect();
  const orig = { ...state.viewportBewerking };
  const start = muisNaarPct(ev, rect, rotatieState.graden);
  function onMove(mv){
    const huidig = muisNaarPct(mv, rect, rotatieState.graden);
    let x = orig.x_pct + (huidig.x - start.x);
    let y = orig.y_pct + (huidig.y - start.y);
    x = Math.max(0, Math.min(100 - orig.w_pct, x));
    y = Math.max(0, Math.min(100 - orig.h_pct, y));
    state.viewportBewerking = { ...orig, x_pct: x, y_pct: y };
    renderVpOverlay();
  }
  function onUp(){
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// hoek-handles verkleinen/vergroten — elke hoek houdt de TEGENOVERGESTELDE hoek vast (nw-handle
// slepen laat de se-hoek onbewogen, enz.)
document.querySelectorAll('#vpRect .vphandle').forEach(handle=>{
  handle.addEventListener('mousedown', (ev)=>{
    ev.stopPropagation(); ev.preventDefault();
    const corner = handle.dataset.h;
    const orig = { ...state.viewportBewerking };
    const rect = getSurfaceEl().getBoundingClientRect();
    function onMove(mv){
      const p = muisNaarPct(mv, rect, rotatieState.graden);
      let { x_pct: x, y_pct: y, w_pct: w, h_pct: h } = orig;
      if(corner.includes('w')){ const nieuweX = Math.min(p.x, x+w-MIN_AFMETING_PCT); w = (x+w) - nieuweX; x = nieuweX; }
      if(corner.includes('e')){ w = Math.max(MIN_AFMETING_PCT, p.x - x); }
      if(corner.includes('n')){ const nieuweY = Math.min(p.y, y+h-MIN_AFMETING_PCT); h = (y+h) - nieuweY; y = nieuweY; }
      if(corner.includes('s')){ h = Math.max(MIN_AFMETING_PCT, p.y - y); }
      x = Math.max(0, x); y = Math.max(0, y);
      w = Math.min(w, 100 - x); h = Math.min(h, 100 - y);
      state.viewportBewerking = { x_pct: x, y_pct: y, w_pct: w, h_pct: h };
      renderVpOverlay();
    }
    function onUp(){
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
});

document.getElementById('vpApplyBtn').onclick = async ()=>{
  const vb = state.viewportBewerking;
  try{
    const res = await apiCall('/api/topology/viewport', 'POST', { actief: true, ...vb });
    state.TOPO.viewport = res.viewport;
    toonVpStatus(t('viewport.toegepastStatus'));
  }catch(e){ alert(e.message); }
};
document.getElementById('vpResetBtn').onclick = async ()=>{
  try{
    await apiCall('/api/topology/viewport', 'POST', { actief: false });
    state.TOPO.viewport = null;
    state.viewportBewerking = { ...VOLLEDIGE_TEKENING };
    renderVpOverlay();
    toonVpStatus(t('viewport.resetStatus'));
  }catch(e){ alert(e.message); }
};
