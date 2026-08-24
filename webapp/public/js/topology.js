import { state, liveData, liveEnergyData, liveDataExtern, liveEnergyDataExtern, mapimg, blankCanvas, mapTiles } from './state.js';
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

// specs/externe-mqtt-ui-plan.md: site-brede weergave-instelling, opgehaald via het bestaande
// /api/instellingen (al geredigeerd — de externeMqtt-secties wachtwoord komt hier nooit in mee,
// en is voor deze puur-weergave-instelling ook niet nodig). Aangeroepen vanuit main.js op dezelfde
// momenten als loadTopology() (bootstrap + de 5s-poll), zodat een wijziging in Beheer >
// Instellingen door een ander scherm ook hier binnen een paar seconden doorwerkt.
export async function loadExterneMqttInstelling(){
  try{
    const res = await fetch('/api/instellingen');
    const data = await res.json();
    const cfg = data.externeMqtt || {};
    state.externeMqtt = {
      actief: !!cfg.actief,
      weergave_modus: cfg.weergave_modus || 'naast_lokaal',
      alert_bij_wegvallen: cfg.alert_bij_wegvallen !== false,
    };
  }catch(e){ /* laatst bekende waarde laten staan */ }
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

// ---------- specs/externe-mqtt-ui-plan.md: gedeelde "welke bron/status geldt hier" afleiding —
// hergebruikt door kastpopup.js, render-detail.js, render-pins.js (via statusOf() hieronder) en
// live-kpi.js, zodat al die plekken exact dezelfde regels volgen i.p.v. de logica los te dupliceren ----------
// hoe lang een externe meting nog als "vers" geldt vóór 'ie als "verouderd/stil" telt (zie
// externStatusVoor) — zelfde soort marge als de "6 min geleden" uit de mockup
export const EXTERN_VEROUDERD_MS = 5 * 60 * 1000;

// vier mogelijke uitkomsten voor kastId (of null als de externe bron helemaal niet actief staat):
// 'ok' | 'wacht' (bron actief, nog geen bericht voor déze kast) | 'verouderd' (stil gevallen) |
// 'verbroken' (de bridge zelf ligt eruit, zie mqtt.js se $SYS/broker/connection/.../state-abonnement)
export function externStatusVoor(kastId){
  if(!state.externeMqtt || !state.externeMqtt.actief) return null;
  if(state.externBridgeVerbonden === false) return 'verbroken';
  const d = liveDataExtern[kastId];
  if(!d) return 'wacht';
  if(Date.now() - d.ts > EXTERN_VEROUDERD_MS) return 'verouderd';
  return 'ok';
}

// of de externe meting voor déze node de PRIMAIRE weergave is (modus "extern vervangt lokaal") —
// groepen slaan dit altijd over (geen eigen enkele externe meting, elk lid heeft zijn eigen lokale
// Shelly, zie kastpopup.js se lidtabel-tak), ongeacht de site-brede modus
export function externIsPrimair(node){
  return !!(node && node.type!=='groep' && state.externeMqtt && state.externeMqtt.actief && state.externeMqtt.weergave_modus==='vervangt_lokaal');
}

// welke live-meting voor tabellen/statuskleuren/pin-kleur gebruikt moet worden — lokaal, tenzij de
// externe bron voor déze node de primaire weergave is (externIsPrimair) én daadwerkelijk 'ok' is;
// anders null (geen stille terugval op een verouderde lokale waarde, zie het geen-data-met-reden-
// ontwerp — de "vervangt lokaal"-modus toont dan expliciet geen data i.p.v. impliciet lokaal)
export function primaireMeting(node){
  if(externIsPrimair(node)) return externStatusVoor(node.id)==='ok' ? liveDataExtern[node.id] : null;
  return liveData[node.id];
}
export function primaireEnergie(node){
  if(externIsPrimair(node)) return externStatusVoor(node.id)==='ok' ? liveEnergyDataExtern[node.id] : null;
  return liveEnergyData[node.id];
}

// werkt voor zowel kasten (rating_a altijd verplicht ingevuld) als generators (rating_a optioneel
// — alleen gezet als die generator ook echt uitgelezen wordt, native of via een Shelly+CT-klem)
export function statusOf(node){
  if(node.rating_a==null) return null;
  const cur = maxFaseStroom(primaireMeting(node));
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

// ---------- specs/externe-shelly-koppelen-plan.md: een ruwe externe bron ("<ruwe-id>@<naam>",
// site-breed, niet Mikes eigen site/<generator>/<kast>-vorm) wordt aan een kast gekoppeld via
// kast.externe_bron_id — mqtt.js gebruikt dit i.p.v. de oude (onjuiste) aanname dat een extern/#-
// topic 1-op-1 Mikes eigen topic-structuur volgt ----------
// zelfde extractie als extern-bron-registry.js (server-side): een "<ruwe-id>@<naam>"-segment ergens
// in het topic-pad, geen vaste positie aangenomen
export function vindRuweBronInTopic(topic){
  const segmenten = topic.split('/');
  for(const seg of segmenten){
    const m = seg.match(/^([^@/]+)@(.+)$/);
    if(m) return { ruwe_id: m[1], naam: m[2] };
  }
  return null;
}
export function kastVoorRuweBron(ruweId){
  return state.TOPO.kasten.find(k => k.externe_bron_id === ruweId) || null;
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
