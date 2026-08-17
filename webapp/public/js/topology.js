import { state, liveData, mapimg, blankCanvas, mapTiles } from './state.js';
import { renderList } from './render-list.js';
import { renderDetail } from './render-detail.js';
import { renderBeheer } from './render-beheer.js';
import { renderSchema } from './render-schema.js';
import { renderPins } from './render-pins.js';
import { initMapTiles } from './map-tiles.js';

// specs/kast-op-aggregaat-plan.md: leden van een groep meegenomen zodat een kast die rechtstreeks
// aan één specifiek lid hangt (i.p.v. aan de groep als geheel) via nodeById()/allNodes() vindbaar
// is. Bestaande consumenten (zoom.js fit-to-screen, render-pins.js pin-plaatsing) filteren al op
// n.positie — een lid heeft er bewust geen (geen eigen pin op de plattegrond, de groep blijft één
// fysieke locatie), dus die blijven een lid vanzelf negeren zonder aparte uitzondering.
export function allNodes(){
  return [...state.TOPO.generators, ...state.TOPO.generators.flatMap(g=>g.leden||[]), ...state.TOPO.kasten];
}
export function isGen(n){ return n.vermogen_kva !== undefined; }
export function nodeById(id){ return allNodes().find(n=>n.id===id); }
// de groep waar een lid-id bij hoort — o.a. voor positieVoor() (lijn-eindpunt-fallback) en
// schemaChildrenOf() (render-schema.js)
export function vindGroepVoorLid(lidId){
  return state.TOPO.generators.find(g=>(g.leden||[]).some(l=>l.id===lidId));
}
// een lid heeft zelf geen positie (zie allNodes() hierboven) — voor alles wat een positie NODIG
// heeft (bijv. het startpunt van een verbindingslijn, render-pins.js) valt dat terug op de positie
// van de groep waar het lid bij hoort
export function positieVoor(node){
  if(!node) return null;
  if(node.positie) return node.positie;
  const groep = vindGroepVoorLid(node.id);
  return groep ? groep.positie : null;
}
export function genNaam(genId){
  const g = state.TOPO.generators.find(g=>g.id===genId);
  if(g) return g.naam;
  const groep = vindGroepVoorLid(genId);
  if(groep){
    const lid = (groep.leden||[]).find(l=>l.id===genId);
    if(lid) return groep.naam + ' → ' + lid.naam;
  }
  return genId;
}
// visueel onderscheid tussen een los aggregaat, een accu en een groep (meerdere aggregaten/accu's die
// samen als één krachtbron optreden, bijv. een centrale met 6 generators + een CAT-batterijcontainer)
export function typeIcon(n){ return n.type==='batterij' ? '🔋' : n.type==='groep' ? '🏭' : '⚡'; }
// het "oppervlak" waarop kasten geplaatst worden: de plattegrond (getiled of plat) als die is
// geüpload, anders een leeg vlak — zo kun je ook zonder plattegrond kasten vrij plaatsen. Bij een
// getilede plattegrond (specs/plattegrond-tile-based-plan.md) is #mapTiles het oppervlak i.p.v.
// #mapimg — dezelfde rol (vaste width/height, siblings binnen #mapinner), dus alle
// percentage-plaatsingswiskunde elders werkt ongewijzigd door.
export function getSurfaceEl(){
  if(state.kaartGetiled) return mapTiles;
  return mapimg.style.display !== 'none' ? mapimg : blankCanvas;
}

export async function loadTopology(){
  const res = await fetch('/api/topology');
  state.TOPO = await res.json();
  renderList(); renderDetail(); renderBeheer();
  if(state.mode==='schema') renderSchema();
}

export async function savePositie(node){
  await fetch('/api/topology/positie', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ id: node.id, x_pct: node.positie.x_pct, y_pct: node.positie.y_pct })
  });
}

export async function saveKnikpunten(kast){
  await fetch('/api/topology/knikpunten', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ id: kast.id, knikpunten: kast.knikpunten || [] })
  });
}

export async function loadMap(){
  let meta;
  try { meta = await (await fetch('/api/map/meta')).json(); }
  catch(e){ meta = { exists:false }; }

  if(!meta.exists){
    state.kaartGetiled = false;
    mapimg.style.display = 'none';
    mapTiles.style.display = 'none';
    blankCanvas.style.display = 'block';
    renderPins();
    return;
  }

  if(meta.tiled){
    state.kaartGetiled = true;
    mapimg.style.display = 'none';
    blankCanvas.style.display = 'none';
    mapTiles.style.display = 'block';
    initMapTiles(meta);
    renderPins();
    return;
  }

  state.kaartGetiled = false;
  mapTiles.style.display = 'none';
  const img = new Image();
  img.onload = ()=>{
    mapimg.src = '/api/map?t=' + Date.now();
    mapimg.style.display = 'block';
    blankCanvas.style.display = 'none';
    renderPins();
  };
  img.onerror = ()=>{
    mapimg.style.display = 'none';
    blankCanvas.style.display = 'block';
    renderPins();
  };
  img.src = '/api/map?t=' + Date.now();
}

export function loadLogo(){
  const headerLogo = document.getElementById('headerLogo');
  const img = new Image();
  img.onload = ()=>{ headerLogo.src = '/api/logo?t=' + Date.now(); headerLogo.style.display = 'inline'; };
  img.onerror = ()=>{ headerLogo.style.display = 'none'; };
  img.src = '/api/logo?t=' + Date.now();
}

// rating_a is de stroom die de aansluiting PER FASE aankan (standaard bij CEE-koppelingen,
// bijv. een "63A"-kast mag 63A op elke fase dragen) — dus vergelijken we de zwaarst belaste
// fase met de rating, niet total_current (dat is de som van alle drie de fasen en zou bij
// gebalanceerde belasting pas rond de 300% van rating_a een probleem lijken)
export function maxFaseStroom(d){
  if(!d) return null;
  const fasen = [d.a_current, d.b_current, d.c_current].filter(v=>v!=null);
  return fasen.length ? Math.max(...fasen) : null;
}

// werkt voor zowel kasten (rating_a altijd verplicht ingevuld) als generators (rating_a optioneel
// — alleen gezet als die generator ook echt uitgelezen wordt, native of via een Shelly+CT-klem)
export function statusOf(node){
  if(node.rating_a==null) return null;
  const cur = maxFaseStroom(liveData[node.id]);
  if(cur==null) return null;
  const pct = (cur / node.rating_a) * 100;
  if(pct >= 90) return 'red';
  if(pct >= 70) return 'amber';
  return 'green';
}
export function statusClass(node){
  const s = statusOf(node);
  return s ? 'status-'+s : '';
}

// kinderen van een generator (top-level, zonder parent-kast) of van een kast (via 'parent') —
// zelfde boomdefinitie als het schema-tabblad, zie schemaChildrenOf in render-schema.js
export function listChildrenOf(node){
  return isGen(node)
    ? state.TOPO.kasten.filter(k=>k.generator===node.id && !k.parent)
    : state.TOPO.kasten.filter(k=>k.parent===node.id);
}
export function collectDescendantKasten(node){
  let result = [];
  listChildrenOf(node).forEach(k=>{ result.push(k); result = result.concat(collectDescendantKasten(k)); });
  return result;
}
export function statusCounts(node){
  const counts = { green:0, amber:0, red:0 };
  collectDescendantKasten(node).forEach(k=>{ const s = statusOf(k); if(s) counts[s]++; });
  return counts;
}
