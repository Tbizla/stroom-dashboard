import { state, mapinner, mapwrap } from './state.js';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, ZOOM_STORAGE_KEY, zoomLevels, rotatieState, saveRotatieState } from './state.js';
import { allNodes, getSurfaceEl } from './topology.js';
import { renderKastPopup } from './kastpopup.js';
import { offsetRoteren, offsetInverseRoteren, isGewisseld } from './rotatie.js';

const zoomLabelEl = document.getElementById('zoomLabel');
const rotateLabelEl = document.getElementById('rotateLabel');

export function currentZoom(){ return zoomLevels[state.mode] ?? 1; }
export function applyZoom(){
  const z = currentZoom();
  if(state.mode==='schema'){
    document.getElementById('schemaSvg').style.transform = 'scale(' + z + ')';
  } else {
    // specs/live-viewport-grote-monitor-plan.md, fase 2: scale() en rotate() commuteren hier
    // probleemloos (uniforme scale, zelfde transform-origin), dus de volgorde maakt niets uit
    mapinner.style.transform = 'scale(' + z + ') rotate(' + rotatieState.graden + 'deg)';
    // specs/plattegrond-tile-based-plan.md: map-tiles.js luistert hierop om te herberekenen welke
    // tegels zichtbaar zijn — een scale-wijziging verandert mapwrap.scrollLeft/Top niet altijd (zie
    // hieronder), maar wél welk volle-resolutiegebied zichtbaar is
    mapinner.dispatchEvent(new CustomEvent('kaartzoom'));
    rotateLabelEl.textContent = rotatieState.graden + '°';
  }
  // niet overschrijven terwijl de gebruiker er zelf in aan het typen is (focus) — anders springt de
  // invoer tijdens het typen terug naar de nog-actieve waarde
  if(document.activeElement !== zoomLabelEl) zoomLabelEl.value = Math.round(z * 100) + '%';
  centerContentInViewport();
  renderKastPopup();
}
// focal (optioneel): { clientX, clientY } — het schermpunt dat na de zoomwijziging op dezelfde
// plek moet blijven staan (bijv. de muispositie bij scrollwiel-zoom), i.p.v. altijd vanuit de
// linkerbovenhoek van de inhoud te schalen (transform-origin:top left op #mapinner). Alleen
// zinvol voor kaart/live (Schema centreert al op zijn eigen inhoud, zie centerContentInViewport).
export function setZoom(z, focal){
  const vorigeZoom = currentZoom();
  z = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) * 100) / 100;
  zoomLevels[state.mode] = z;
  // elke zoomwijziging (ook handmatig via +/-/scrollwiel, niet alleen de fit-knop) legt vast voor welke
  // schemagrootte dit percentage gold, zodat een latere topologiewijziging dit als verouderd herkent
  if(state.mode==='schema'){
    const svg = document.getElementById('schemaSvg');
    zoomLevels.schemaSize = { w: +svg.getAttribute('width') || 0, h: +svg.getAttribute('height') || 0 };
  }
  try { localStorage.setItem(ZOOM_STORAGE_KEY, JSON.stringify(zoomLevels)); } catch(e) {}

  if(focal && state.mode!=='schema' && vorigeZoom){
    // specs/live-viewport-grote-monitor-plan.md, fase 2: bij een rotatiestand ≠0 is "scrollpositie
    // / zoom" niet meer hetzelfde als "content-px" (rotate() zit tussen scroll-ruimte en content-
    // ruimte in) — reken via offsetInverseRoteren/offsetRoteren om, met het gerenderde middelpunt
    // van #mapinner als tussenstap. Bij rotatie 0 reduceert dit exact tot de oude, simpele
    // contentX = (scroll+viewport)/zoom-berekening (geverifieerd tijdens het bouwen).
    const surface = getSurfaceEl();
    const surfaceW = surface.clientWidth, surfaceH = surface.clientHeight;
    const r = rotatieState.graden;
    const gewisseld = isGewisseld(r);
    const rect = mapwrap.getBoundingClientRect();
    const viewportX = focal.clientX - rect.left, viewportY = focal.clientY - rect.top;

    const prevRenderedW = (gewisseld ? surfaceH : surfaceW) * vorigeZoom;
    const prevRenderedH = (gewisseld ? surfaceW : surfaceH) * vorigeZoom;
    const renderOffX = (mapwrap.scrollLeft + viewportX) - prevRenderedW / 2;
    const renderOffY = (mapwrap.scrollTop + viewportY) - prevRenderedH / 2;
    // het content-punt (ongeroteerde, onverschaalde px-offset t.o.v. het content-midden) dat nu
    // precies onder de cursor ligt
    const contentOff = offsetInverseRoteren(renderOffX / vorigeZoom, renderOffY / vorigeZoom, r);

    applyZoom();

    // datzelfde content-punt na de nieuwe schaal (zelfde rotatie) weer onder diezelfde
    // cursorpositie zetten
    const nieuwRenderOff = offsetRoteren(contentOff.ox, contentOff.oy, r);
    const newRenderedW = (gewisseld ? surfaceH : surfaceW) * z;
    const newRenderedH = (gewisseld ? surfaceW : surfaceH) * z;
    mapwrap.scrollLeft = newRenderedW / 2 + nieuwRenderOff.ox * z - viewportX;
    mapwrap.scrollTop = newRenderedH / 2 + nieuwRenderOff.oy * z - viewportY;
  } else {
    applyZoom();
  }
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
// zelf een percentage kunnen intypen i.p.v. alleen +/-/scrollwiel/fit-to-screen — Enter en focus-
// verlies passen 'm toe, Escape zet 'm terug op de huidige waarde zonder te wijzigen. Een ongeldige
// invoer (leeg, geen getal, 0 of negatief) valt terug op de huidige waarde i.p.v. een foutmelding —
// setZoom() zelf klemt een geldig getal al vast tussen ZOOM_MIN/ZOOM_MAX.
function commitZoomInput(){
  const waarde = parseFloat(zoomLabelEl.value);
  if(!isNaN(waarde) && waarde > 0) setZoom(waarde / 100);
  else applyZoom();
}
zoomLabelEl.addEventListener('focus', () => zoomLabelEl.select());
zoomLabelEl.addEventListener('keydown', (ev) => {
  if(ev.key === 'Enter'){ commitZoomInput(); zoomLabelEl.blur(); }
  else if(ev.key === 'Escape'){ applyZoom(); zoomLabelEl.blur(); }
});
zoomLabelEl.addEventListener('blur', commitZoomInput);

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
  // knikpuntcoördinaten meenemen in de bounding box — een bocht die ver van de rechte lijn tussen
  // twee nodes afligt, mag "fit to screen" niet buiten beeld laten vallen
  const knikpunten = state.TOPO.kasten.flatMap(k => k.knikpunten || []);
  let minX = 0, maxX = 100, minY = 0, maxY = 100;
  if(geplaatst.length){
    const xs = geplaatst.map(n => n.positie.x_pct).concat(knikpunten.map(p => p.x_pct));
    const ys = geplaatst.map(n => n.positie.y_pct).concat(knikpunten.map(p => p.y_pct));
    minX = Math.min(...xs);
    maxX = Math.max(...xs);
    minY = Math.min(...ys);
    maxY = Math.max(...ys);
    const PAD = 4;
    minX = Math.max(0, minX - PAD); maxX = Math.min(100, maxX + PAD);
    minY = Math.max(0, minY - PAD); maxY = Math.min(100, maxY + PAD + 3); // iets extra onder voor het pin-label
  } // niks geplaatst: val terug op de hele surface (0-100), zodat er alsnog iets zinnigs te zien is

  const contentW = (maxX - minX) / 100 * surfaceW;
  const contentH = (maxY - minY) / 100 * surfaceH;
  if(!contentW || !contentH) return;

  // specs/live-viewport-grote-monitor-plan.md, fase 2: bij 90°/270° is de gerenderde (zichtbare)
  // breedte/hoogte van zowel de bounding box als de volle surface verwisseld t.o.v. hun
  // ongeroteerde betekenis — reduceert bij rotatie 0 exact tot de oude berekening (geverifieerd
  // tijdens het bouwen: offsetRoteren(...,0) is de identiteit)
  const r = rotatieState.graden;
  const gewisseld = isGewisseld(r);
  const renderedContentW = gewisseld ? contentH : contentW;
  const renderedContentH = gewisseld ? contentW : contentH;
  const scale = Math.min(availW / renderedContentW, availH / renderedContentH, ZOOM_MAX);
  setZoom(scale);

  // middelpunt van de bounding box als px-offset t.o.v. het content-midden, dan geroteerd naar
  // een offset t.o.v. het gerenderde midden (dat op hetzelfde schermpunt valt, transform-
  // origin:center center)
  const bboxCenterX = (minX + maxX) / 2 / 100 * surfaceW;
  const bboxCenterY = (minY + maxY) / 2 / 100 * surfaceH;
  const offset = offsetRoteren(bboxCenterX - surfaceW / 2, bboxCenterY - surfaceH / 2, r);
  const renderedW = (gewisseld ? surfaceH : surfaceW) * scale;
  const renderedH = (gewisseld ? surfaceW : surfaceH) * scale;
  const targetX = renderedW / 2 + offset.ox * scale;
  const targetY = renderedH / 2 + offset.oy * scale;
  wrap.scrollLeft = targetX - wrap.clientWidth / 2;
  wrap.scrollTop = targetY - wrap.clientHeight / 2;
}

// specs/live-viewport-grote-monitor-plan.md, fase 2: stapsgewijs 90° draaien, alleen zinvol op
// Kalibreren/Live (Schema is een auto-gelayoutte SVG-boom, geen plattegrond — de knop staat daar
// sowieso verborgen, zie modes.js, maar deze check is een extra vangnet)
export function roteerKaart(){
  if(state.mode!=='cal' && state.mode!=='live') return;
  rotatieState.graden = (rotatieState.graden + 90) % 360;
  saveRotatieState();
  fitToScreen();
}
document.getElementById('rotateBtn').onclick = roteerKaart;
document.getElementById('zoomFitBtn').onclick = fitToScreen;

document.getElementById('mainBody').addEventListener('wheel', (ev) => {
  ev.preventDefault();
  setZoom(currentZoom() + (ev.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), { clientX: ev.clientX, clientY: ev.clientY });
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
