import { state, liveData, mapimg, blankCanvas } from './state.js';
import { renderList } from './render-list.js';
import { renderDetail } from './render-detail.js';
import { renderBeheer } from './render-beheer.js';
import { renderSchema } from './render-schema.js';
import { renderPins } from './render-pins.js';

export function allNodes(){ return [...state.TOPO.generators, ...state.TOPO.kasten]; }
export function isGen(n){ return n.vermogen_kva !== undefined; }
export function nodeById(id){ return allNodes().find(n=>n.id===id); }
export function genNaam(genId){ const g = state.TOPO.generators.find(g=>g.id===genId); return g ? g.naam : genId; }
// visueel onderscheid tussen een los aggregaat, een accu en een groep (meerdere aggregaten/accu's die
// samen als één krachtbron optreden, bijv. een centrale met 6 generators + een CAT-batterijcontainer)
export function typeIcon(n){ return n.type==='batterij' ? '🔋' : n.type==='groep' ? '🏭' : '⚡'; }
// het "oppervlak" waarop kasten geplaatst worden: de plattegrond als die is geüpload,
// anders een leeg vlak — zo kun je ook zonder plattegrond kasten vrij plaatsen
export function getSurfaceEl(){ return mapimg.style.display !== 'none' ? mapimg : blankCanvas; }

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

export function loadMap(){
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
