// ---------- Tile-based rendering voor een grote plattegrond (specs/plattegrond-tile-based-plan.md) ----------
// Laadt alleen de tegels die op het huidige zoomniveau echt binnen het zichtbare stuk van #mapwrap
// vallen, i.p.v. één (mogelijk enorme) platte afbeelding in zijn geheel te decoderen. Blijft bewust
// binnen het bestaande scale()+scroll-model van #mapinner (zie zoom.js) — #mapTiles krijgt een vaste
// CSS-breedte/hoogte gelijk aan de volle-resolutie-afmeting van de tegel-piramide, dezelfde rol als
// #mapimg's natuurlijke afmeting bij een platte plattegrond. Daardoor blijven getSurfaceEl()
// (topology.js) en de percentage-plaatsingswiskunde in render-pins.js/zoom.js ongewijzigd: die lezen
// alleen surface.clientWidth/clientHeight/getBoundingClientRect(), zonder onderscheid tussen "één
// image" en "een grid van tegel-<img>'s".
import { state, mapwrap, mapinner, mapTiles, zoomLevels, rotatieState } from './state.js';
import { naarContentFractie, isGewisseld } from './rotatie.js';

let meta = null; // { width, height, tileSize, maxLevel } van de actieve tegel-piramide
const geplaatst = new Map(); // "niveau/kolom_rij" -> <img>

function huidigeZoom(){ return zoomLevels[state.mode] ?? 1; }

// welk piramideniveau het beste past bij de huidige effectieve schermresolutie — bij ver uitzoomen
// een lager (kleiner, minder gedetailleerd) niveau, zodat er niet onnodig volle-resolutietegels
// gedownload worden voor iets wat toch maar een paar honderd csspx breed op het scherm staat
function huidigNiveau(){
  const z = Math.max(huidigeZoom(), 0.001);
  const niveau = Math.round(meta.maxLevel + Math.log2(z));
  return Math.max(0, Math.min(meta.maxLevel, niveau));
}

// afmeting (volle-resolutie-px) van het gekozen niveau — DZI-conventie: elk niveau lager halveert
function niveauAfmeting(niveau){
  const schaal = Math.pow(2, niveau - meta.maxLevel);
  return { w: Math.max(1, Math.ceil(meta.width * schaal)), h: Math.max(1, Math.ceil(meta.height * schaal)) };
}

export function initMapTiles(nieuweMeta){
  meta = nieuweMeta;
  mapTiles.style.width = meta.width + 'px';
  mapTiles.style.height = meta.height + 'px';
  mapTiles.innerHTML = '';
  geplaatst.clear();
  ververTegels();
}

export function ververTegels(){
  if(!meta || mapTiles.style.display === 'none') return;
  const niveau = huidigNiveau();
  const { w: niveauW, h: niveauH } = niveauAfmeting(niveau);
  // 1 tegel-px op dit niveau komt overeen met dit aantal volle-resolutie-px (en dus #mapTiles-css-px,
  // want #mapTiles staat op de volle-resolutie-afmeting)
  const schaalNaarVol = meta.width / niveauW;
  const tegelCss = meta.tileSize * schaalNaarVol;

  const z = huidigeZoom();
  // specs/live-viewport-grote-monitor-plan.md, fase 2: bij een rotatiestand ≠0 komt scrollpositie
  // niet meer via een simpele deling door z overeen met "welk stuk volle-resolutie-content is
  // zichtbaar" (rotate() zit ertussen) — de 4 hoekpunten van het zichtbare scrollvlak stuk voor stuk
  // terugrekenen via naarContentFractie() geeft (bij deze zuivere 90°-stappen) een exacte, niet-
  // scheve rechthoek terug; bij rotatie 0 reduceert dit tot dezelfde eenvoudige deling als voorheen.
  const r = rotatieState.graden;
  const gewisseld = isGewisseld(r);
  const renderedW = (gewisseld ? meta.height : meta.width) * z;
  const renderedH = (gewisseld ? meta.width : meta.height) * z;
  const hoeken = [
    [mapwrap.scrollLeft, mapwrap.scrollTop],
    [mapwrap.scrollLeft + mapwrap.clientWidth, mapwrap.scrollTop],
    [mapwrap.scrollLeft, mapwrap.scrollTop + mapwrap.clientHeight],
    [mapwrap.scrollLeft + mapwrap.clientWidth, mapwrap.scrollTop + mapwrap.clientHeight],
  ].map(([px, py]) => {
    const { fx, fy } = naarContentFractie(px / renderedW, py / renderedH, r);
    return [fx * meta.width, fy * meta.height];
  });
  const zichtbaarL = Math.min(...hoeken.map(p=>p[0])), zichtbaarR = Math.max(...hoeken.map(p=>p[0]));
  const zichtbaarT = Math.min(...hoeken.map(p=>p[1])), zichtbaarB = Math.max(...hoeken.map(p=>p[1]));
  const kolommen = Math.ceil(niveauW / meta.tileSize), rijen = Math.ceil(niveauH / meta.tileSize);

  const kolStart = Math.max(0, Math.floor(zichtbaarL / tegelCss) - 1);
  const kolEind = Math.min(kolommen - 1, Math.ceil(zichtbaarR / tegelCss) + 1);
  const rijStart = Math.max(0, Math.floor(zichtbaarT / tegelCss) - 1);
  const rijEind = Math.min(rijen - 1, Math.ceil(zichtbaarB / tegelCss) + 1);

  const gewenst = new Set();
  for(let r = rijStart; r <= rijEind; r++){
    for(let k = kolStart; k <= kolEind; k++){
      const key = niveau + '/' + k + '_' + r;
      gewenst.add(key);
      if(geplaatst.has(key)) continue;
      const img = document.createElement('img');
      // anders start de browser bij het slepen van een pin/knikpunt zijn eigen native
      // afbeeldingsdrag/-selectie op de tegel eronder — zie de preventDefault() in render-pins.js
      img.draggable = false;
      img.style.left = (k * tegelCss) + 'px';
      img.style.top = (r * tegelCss) + 'px';
      img.style.width = tegelCss + 'px';
      img.style.height = tegelCss + 'px';
      // een rand-tegel die niet bestaat (tileSize deelt de niveau-afmeting zelden precies) geeft een
      // 404 — gewoon leeg laten, geen foutmelding nodig voor iets wat de gebruiker niet ziet
      img.onerror = () => { img.style.display = 'none'; };
      img.src = '/api/map/tiles/' + niveau + '/' + k + '_' + r + '.png';
      mapTiles.appendChild(img);
      geplaatst.set(key, img);
    }
  }
  for(const [key, img] of geplaatst){
    if(gewenst.has(key)) continue;
    img.remove();
    geplaatst.delete(key);
  }
}

let debounceHandle = null;
function plangeVerversTegels(){
  clearTimeout(debounceHandle);
  debounceHandle = setTimeout(ververTegels, 80);
}

mapwrap.addEventListener('scroll', plangeVerversTegels);
window.addEventListener('resize', plangeVerversTegels);
// gedispatcht vanuit zoom.js's applyZoom() ná elke scale-wijziging (knoppen/scrollwiel/fit-to-screen)
// — een zoomwijziging op zich verandert mapwrap.scrollLeft/Top niet altijd (zie zoom.js), maar wél
// welk volle-resolutiegebied zichtbaar is, dus dit moet los van het 'scroll'-event blijven
mapinner.addEventListener('kaartzoom', plangeVerversTegels);
