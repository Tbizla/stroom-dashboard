import { state, mapinner, mapwrap } from './state.js';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, ZOOM_STORAGE_KEY, zoomLevels } from './state.js';
import { allNodes, getSurfaceEl } from './topology.js';
import { renderKastPopup } from './kastpopup.js';

export function currentZoom(){ return zoomLevels[state.mode] ?? 1; }
export function applyZoom(){
  const z = currentZoom();
  if(state.mode==='schema'){
    document.getElementById('schemaSvg').style.transform = 'scale(' + z + ')';
  } else {
    mapinner.style.transform = 'scale(' + z + ')';
  }
  document.getElementById('zoomLabel').textContent = Math.round(z * 100) + '%';
  centerContentInViewport();
  renderKastPopup();
}
export function setZoom(z){
  z = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) * 100) / 100;
  zoomLevels[state.mode] = z;
  // elke zoomwijziging (ook handmatig via +/-/scrollwiel, niet alleen de fit-knop) legt vast voor welke
  // schemagrootte dit percentage gold, zodat een latere topologiewijziging dit als verouderd herkent
  if(state.mode==='schema'){
    const svg = document.getElementById('schemaSvg');
    zoomLevels.schemaSize = { w: +svg.getAttribute('width') || 0, h: +svg.getAttribute('height') || 0 };
  }
  try { localStorage.setItem(ZOOM_STORAGE_KEY, JSON.stringify(zoomLevels)); } catch(e) {}
  applyZoom();
}

// transform:scale() krimpt alleen de visuele weergave, niet de layout-/scrollbox van de wrap (die blijft
// op ongeschaalde grootte staan omdat de wrap gecentreerd is met flexbox). Zonder correctie blijft de
// viewport na uitzoomen op scrollpositie (0,0) staan, ver van waar de gekrompen inhoud zichtbaar is —
// dat toont dan alleen de lege achtergrond ("het scherm wordt zwart"). Daarom recentreren we na elke
// zoomwijziging de scrollpositie op het midden van de (geschaalde) inhoud.
// Alleen voor het schema: de SVG is altijd precies zo groot als de boom die 'm bevat, dus het midden
// van het element IS het midden van de inhoud. Het kaart/live-canvas is een vast groot werkvlak
// (4800x3000) los van hoeveel er daadwerkelijk op geplaatst is — daarop centreren trekt de viewport
// naar het midden van dat lege werkvlak i.p.v. naar waar de pins staan, dus daar juist NIET doen.
export function centerContentInViewport(){
  if(state.mode!=='schema') return;
  const wrap = document.getElementById('schemaWrap');
  const contentEl = document.getElementById('schemaSvg');
  const wrapRect = wrap.getBoundingClientRect();
  const contentRect = contentEl.getBoundingClientRect();
  if(!contentRect.width || !contentRect.height) return;
  const deltaX = (contentRect.left + contentRect.width / 2) - (wrapRect.left + wrapRect.width / 2);
  const deltaY = (contentRect.top + contentRect.height / 2) - (wrapRect.top + wrapRect.height / 2);
  wrap.scrollLeft += deltaX;
  wrap.scrollTop += deltaY;
}

document.getElementById('zoomInBtn').onclick = () => setZoom(currentZoom() + ZOOM_STEP);
document.getElementById('zoomOutBtn').onclick = () => setZoom(currentZoom() - ZOOM_STEP);
document.getElementById('zoomLabel').onclick = () => setZoom(1);

// zoomt zo ver uit (of in) dat de volledige inhoud past
export function fitToScreen(){
  if(state.mode==='schema') return fitToScreenSchema();
  return fitToScreenKaart();
}

// schema: de SVG is altijd al precies zo groot als de boom die 'm bevat (computeSchemaLayout
// berekent width/height op basis van het aantal knopen), dus "de hele SVG" IS hier al "wat er
// daadwerkelijk gebruikt wordt" — geen aparte bounding-box-berekening nodig.
export function fitToScreenSchema(){
  const wrap = document.getElementById('schemaWrap');
  const contentEl = document.getElementById('schemaSvg');
  // de ongeschaalde inhoudsgrootte NIET afleiden door de huidige (mogelijk inmiddels afwijkende)
  // zoomwaarde uit de zichtbare rect te delen — dat gaf een verkeerde fit zodra die aanname niet meer
  // klopte met de daadwerkelijk toegepaste transform. In plaats daarvan de transform even uitzetten en
  // de ware afmeting rechtstreeks meten; getBoundingClientRect() werkt betrouwbaar op zowel <svg> als
  // gewone elementen (offsetWidth/Height niet altijd op SVG-rootelementen).
  const prevTransform = contentEl.style.transform;
  contentEl.style.transform = 'none';
  const rect = contentEl.getBoundingClientRect();
  const cw = rect.width, ch = rect.height;
  contentEl.style.transform = prevTransform;
  if(!cw || !ch) return;
  const availW = wrap.clientWidth - 24, availH = wrap.clientHeight - 24;
  if(availW <= 0 || availH <= 0) return;
  setZoom(Math.min(availW / cw, availH / ch));
}

// kalibreren/live: het canvas (plattegrond of het lege werkvlak) is vaak veel groter dan wat er
// daadwerkelijk op geplaatst is — fitten op de HELE surface (bijv. het volledige 4800x3000 lege vlak)
// zoomt dan veel verder uit dan nodig en laat vooral lege ruimte zien. Fit daarom op de bounding box
// van de daadwerkelijk geplaatste generators/kasten, met wat marge, en scroll naar het midden daarvan.
export function fitToScreenKaart(){
  const wrap = document.getElementById('mapwrap');
  const surface = getSurfaceEl();
  const surfaceW = surface.clientWidth, surfaceH = surface.clientHeight;
  if(!surfaceW || !surfaceH) return;
  const availW = wrap.clientWidth - 24, availH = wrap.clientHeight - 24;
  if(availW <= 0 || availH <= 0) return;

  const geplaatst = allNodes().filter(n => n.positie && n.positie.x_pct != null);
  let minX = 0, maxX = 100, minY = 0, maxY = 100;
  if(geplaatst.length){
    minX = Math.min(...geplaatst.map(n => n.positie.x_pct));
    maxX = Math.max(...geplaatst.map(n => n.positie.x_pct));
    minY = Math.min(...geplaatst.map(n => n.positie.y_pct));
    maxY = Math.max(...geplaatst.map(n => n.positie.y_pct));
    const PAD = 4;
    minX = Math.max(0, minX - PAD); maxX = Math.min(100, maxX + PAD);
    minY = Math.max(0, minY - PAD); maxY = Math.min(100, maxY + PAD + 3); // iets extra onder voor het pin-label
  } // niks geplaatst: val terug op de hele surface (0-100), zodat er alsnog iets zinnigs te zien is

  const contentW = (maxX - minX) / 100 * surfaceW;
  const contentH = (maxY - minY) / 100 * surfaceH;
  if(!contentW || !contentH) return;
  const scale = Math.min(availW / contentW, availH / contentH, ZOOM_MAX);
  setZoom(scale);

  const centerX = (minX + maxX) / 2 / 100 * surfaceW * scale;
  const centerY = (minY + maxY) / 2 / 100 * surfaceH * scale;
  wrap.scrollLeft = centerX - wrap.clientWidth / 2;
  wrap.scrollTop = centerY - wrap.clientHeight / 2;
}
document.getElementById('zoomFitBtn').onclick = fitToScreen;

document.getElementById('mainBody').addEventListener('wheel', (ev) => {
  ev.preventDefault();
  setZoom(currentZoom() + (ev.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
}, { passive: false });

// klik-en-sleep pannen op de achtergrond (nu het scrollwiel zoomt i.p.v. scrollt).
// Pins hebben hun eigen mousedown met stopPropagation, dus die blijven gewoon versleepbaar;
// een gewone klik (zonder beweging) blijft ook gewoon werken voor plaatsen/selecteren.
export function enablePanDrag(wrapEl){
  let panning = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
  wrapEl.addEventListener('mousedown', (ev) => {
    panning = true;
    startX = ev.clientX; startY = ev.clientY;
    startLeft = wrapEl.scrollLeft; startTop = wrapEl.scrollTop;
    wrapEl.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (ev) => {
    if(!panning) return;
    wrapEl.scrollLeft = startLeft - (ev.clientX - startX);
    wrapEl.scrollTop = startTop - (ev.clientY - startY);
  });
  window.addEventListener('mouseup', () => {
    if(!panning) return;
    panning = false;
    wrapEl.style.cursor = '';
  });
}
enablePanDrag(mapwrap);
enablePanDrag(document.getElementById('schemaWrap'));
