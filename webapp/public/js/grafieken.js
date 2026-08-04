// ---------- Grafieken-tabblad (specs/grafieken-tabblad-plan.md): vrije ad-hoc analyse ----------
// Lijn/Staaf/Taart/Heatmap/Sankey zijn gebouwd, volgens de spec's eigen "Bouwvolgorde-suggestie".
// Live-modus (nog niet gebouwd) is een aparte, latere stap.
import { state } from './state.js';
import { apiCall } from './api.js';
import { t, huidigeLocale } from './i18n.js';
import { allNodes, isGen, typeIcon, listChildrenOf, nodeById } from './topology.js';

// mirrort --text2/--border uit style.css: Chart.js tekent op canvas, kan geen CSS-variabelen
// rechtstreeks lezen
const KLEUR_TEXT2 = '#8b93a1';
const KLEUR_BORDER = '#2a2f3a';
// categorisch palet om lijnen uit elkaar te houden — bewust los van de groen/amber/rood-
// statusconventie (die hoort bij het latere staafdiagram, waar kleur echt "t.o.v. rating" betekent)
const PALET = ['#4fd1c5', '#f5a623', '#e5484d', '#7c9eff', '#c77dff', '#5eead4', '#fbbf24', '#f472b6'];

let selectedIds = new Set();
let metric = 'stroom';
let fase = 'totaal';
let zoekQuery = '';
let chart = null;
let eersteKeerGetoond = true;
let grafiekType = 'lijn';
let aggregatie = 'piek';

// mirrort --green/--amber/--red uit style.css, zelfde 70/90%-conventie als overal elders in de
// app (kastpopup.js/render-detail.js) — Chart.js tekent op canvas, kan geen CSS-variabelen lezen
const KLEUR_GROEN = '#3ecf6a', KLEUR_AMBER = '#f5a623', KLEUR_ROOD = '#e5484d', KLEUR_GRIJS = '#4a5160';
function statusKleur(waarde, ratingA){
  if(ratingA==null) return KLEUR_GRIJS;
  const pct = (waarde/ratingA)*100;
  return pct>=90 ? KLEUR_ROOD : pct>=70 ? KLEUR_AMBER : KLEUR_GROEN;
}

function kleurVoorId(id){
  const idx = Array.from(selectedIds).indexOf(id);
  return PALET[(idx < 0 ? 0 : idx) % PALET.length];
}

// ---------- checklist (kasten/generators), plat + ingesprongen naar diepte, geen collapse nodig
// voor dit doel — anders dan de hoofd-sidebar (render-list.js) is hier alles altijd zichtbaar ----------
function renderChecklist(){
  const listEl = document.getElementById('grafList');
  listEl.innerHTML = '';
  const query = zoekQuery.trim().toLowerCase();

  function matches(n){
    return !query || n.naam.toLowerCase().includes(query) || (n.afkorting && n.afkorting.toLowerCase().includes(query));
  }
  function subtreeMatches(n){
    if(matches(n)) return true;
    return listChildrenOf(n).some(subtreeMatches);
  }
  function maakRow(n, depth){
    const row = document.createElement('label');
    row.className = 'graf-checkrow';
    row.style.paddingLeft = (14 + depth*14) + 'px';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selectedIds.has(n.id);
    cb.onchange = ()=>{
      if(cb.checked) selectedIds.add(n.id); else selectedIds.delete(n.id);
      renderChecklist(); verversGrafiek();
    };
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = selectedIds.has(n.id) ? kleurVoorId(n.id) : 'transparent';
    swatch.style.border = selectedIds.has(n.id) ? 'none' : '1px solid var(--border)';
    const naam = document.createElement('span');
    naam.textContent = (isGen(n) ? typeIcon(n)+' ' : (n.type==='batterij'?'🔋 ':'')) + n.naam;
    row.appendChild(cb); row.appendChild(swatch); row.appendChild(naam);
    listEl.appendChild(row);
  }
  function visit(n, depth){
    if(query && !subtreeMatches(n)) return;
    maakRow(n, depth);
    listChildrenOf(n).forEach(k=>visit(k, depth+1));
  }
  state.TOPO.generators.forEach(g=>visit(g, 0));

  document.getElementById('grafGeenNodes').style.display = state.TOPO.generators.length ? 'none' : 'block';
}

document.getElementById('grafZoek').addEventListener('input', (e)=>{
  zoekQuery = e.target.value;
  renderChecklist();
});

// ---------- grafiektype-knoppenrij ----------
// metric vóór het (eventueel) locken, zodat "vorige metric" hersteld kan worden zodra je wegschakelt
// van een type met een vaste metric — Taart ligt vast op Energie (spec §4, een "aandeel van het
// totaal" is alleen bij een optelbare grootheid zinvol), Heatmap op Stroom (spec §5: de groen/amber/
// rood-celkleur ís "t.o.v. rating", net als bij Staaf — geen zinvolle rating-vergelijking voor W/V/kWh)
const METRIC_LOCK = { taart: 'energie', heatmap: 'stroom', sankey: 'energie' };
let metricVoorLock = null;
function ververMetricLock(){
  const lock = METRIC_LOCK[grafiekType] || null;
  document.querySelectorAll('#grafMetricRow .chip').forEach(c=>c.disabled = !!lock);
  if(lock){
    if(metricVoorLock==null) metricVoorLock = metric;
    metric = lock;
  } else if(metricVoorLock!=null){
    metric = metricVoorLock;
    metricVoorLock = null;
  }
  document.querySelectorAll('#grafMetricRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.metric===metric));
}
// Sankey wisselt de linkerkolom om (startpunt-dropdown i.p.v. checklist) en laat Fase helemaal
// verdwijnen (spec §3: "fase/aggregatie-keuzes zijn hier niet van toepassing") — de checklist-
// selectie zelf blijft ondertussen intact (niet leegmaken), zie spec "Wat het niet is"/gemeenschap.
function vulSankeyStartpuntSelect(){
  const select = document.getElementById('grafSankeyStartpunt');
  const huidige = select.value;
  select.innerHTML = state.TOPO.generators.map(g=>'<option value="'+g.id+'"'+(g.id===huidige?' selected':'')+'>'+typeIcon(g)+' '+g.naam+'</option>').join('');
}
function ververSankeyLinkerkolom(){
  const isSankey = grafiekType==='sankey';
  document.getElementById('grafChecklistWrap').style.display = isSankey ? 'none' : 'block';
  document.getElementById('grafSankeyWrap').style.display = isSankey ? 'block' : 'none';
  document.getElementById('grafFaseGroup').style.display = isSankey ? 'none' : 'flex';
  if(isSankey) vulSankeyStartpuntSelect();
}
document.getElementById('grafSankeyStartpunt').addEventListener('change', verversGrafiek);

document.querySelectorAll('#grafTypeRow button:not([disabled])').forEach(btn=>{
  btn.onclick = ()=>{
    grafiekType = btn.dataset.type;
    document.querySelectorAll('#grafTypeRow button').forEach(b=>b.classList.toggle('active', b===btn));
    ververMetricLock();
    ververSankeyLinkerkolom();
    // aggregatie-knoppenrij hoort bij Staaf/Taart/Heatmap (spec §2/4/5), niet bij Lijn/Sankey; bij
    // Taart ligt aggregatie zelf ook vast op Periode-totaal (een "aandeel van het totaal" heeft
    // alleen bij een optelbare grootheid betekenis, niet bij een piek/gemiddelde)
    document.getElementById('grafAggregatieGroup').style.display = ['staaf','taart','heatmap'].includes(grafiekType) ? 'flex' : 'none';
    if(grafiekType==='taart'){
      aggregatie = 'totaal';
      document.querySelectorAll('#grafAggregatieRow .chip').forEach(c=>{ c.classList.toggle('active', c.dataset.aggregatie==='totaal'); c.disabled = true; });
    } else {
      document.querySelectorAll('#grafAggregatieRow .chip').forEach(c=>c.disabled = false);
      ververAggregatieBeschikbaarheid();
    }
    verversGrafiek();
  };
});

// ---------- aggregatie-knoppenrij (Staaf/Taart/Heatmap) — "Periode-totaal" alleen zinvol/
// beschikbaar bij metric Energie, zie spec §2 ----------
function ververAggregatieBeschikbaarheid(){
  const totaalBtn = document.querySelector('#grafAggregatieRow [data-aggregatie="totaal"]');
  const beschikbaar = metric === 'energie';
  totaalBtn.disabled = !beschikbaar;
  if(!beschikbaar && aggregatie==='totaal'){
    aggregatie = 'piek';
    document.querySelectorAll('#grafAggregatieRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.aggregatie==='piek'));
  }
}
document.querySelectorAll('#grafAggregatieRow .chip').forEach(chip=>{
  chip.onclick = ()=>{
    if(chip.disabled) return;
    aggregatie = chip.dataset.aggregatie;
    document.querySelectorAll('#grafAggregatieRow .chip').forEach(c=>c.classList.toggle('active', c===chip));
    verversGrafiek();
  };
});

// ---------- metric/fase-knoppenrijen ----------
document.querySelectorAll('#grafMetricRow .chip').forEach(chip=>{
  chip.onclick = ()=>{
    if(chip.disabled) return;
    metric = chip.dataset.metric;
    document.querySelectorAll('#grafMetricRow .chip').forEach(c=>c.classList.toggle('active', c===chip));
    ververAggregatieBeschikbaarheid();
    verversGrafiek();
  };
});
document.querySelectorAll('#grafFaseRow .chip').forEach(chip=>{
  chip.onclick = ()=>{
    fase = chip.dataset.fase;
    document.querySelectorAll('#grafFaseRow .chip').forEach(c=>c.classList.toggle('active', c===chip));
    verversGrafiek();
  };
});

// ---------- periode (zelfde patroon als bepaalRapportPeriode() in rapport.js) ----------
document.querySelectorAll('#grafPeriodeRow .chip').forEach(chip=>{
  chip.onclick = ()=>{
    state.grafiekenPeriodeChip = chip.dataset.periodechip;
    document.querySelectorAll('#grafPeriodeRow .chip').forEach(c=>c.classList.toggle('active', c===chip));
    document.getElementById('grafAangepastPeriode').style.display = state.grafiekenPeriodeChip==='aangepast' ? 'flex' : 'none';
    if(state.grafiekenPeriodeChip!=='aangepast') verversGrafiek();
  };
});
document.getElementById('grafVanInput').addEventListener('change', ()=>{ if(state.grafiekenPeriodeChip==='aangepast') verversGrafiek(); });
document.getElementById('grafTotInput').addEventListener('change', ()=>{ if(state.grafiekenPeriodeChip==='aangepast') verversGrafiek(); });

async function bepaalGrafiekenPeriode(){
  if(state.grafiekenPeriodeChip==='24u'){
    const tot = new Date();
    const van = new Date(tot.getTime() - 24*3600*1000);
    return { van: van.toISOString(), tot: tot.toISOString() };
  }
  if(state.grafiekenPeriodeChip==='aangepast'){
    const van = document.getElementById('grafVanInput').value;
    const tot = document.getElementById('grafTotInput').value;
    if(!van || !tot) throw new Error(t('rapport.alertVulDatums'));
    return { van: new Date(van).toISOString(), tot: new Date(tot).toISOString() };
  }
  const editie = document.getElementById('grafEditieSelect').value;
  const periode = await apiCall('/api/rapport/periode?editie='+encodeURIComponent(editie), 'GET');
  if(!periode.van || !periode.tot) throw new Error(t('rapport.alertGeenMeetdata'));
  return { van: periode.van, tot: periode.tot };
}

// ---------- editie-select (zelfde bron als PDF-rapport, vulRapportEditieSelect() in rapport.js) ----------
async function vulEditieSelect(){
  const select = document.getElementById('grafEditieSelect');
  const huidige = select.value;
  try{
    const data = await apiCall('/api/rapport/edities', 'GET');
    select.innerHTML = '<option value="__alle__">'+t('rapport.alleEdities')+'</option>' +
      data.edities.map(e=>'<option value="'+e+'"'+(e===huidige?' selected':'')+'>'+e+'</option>').join('');
    if(!huidige && data.edities.length) select.value = data.edities[data.edities.length-1];
  }catch(e){ select.innerHTML = '<option value="__alle__">'+t('rapport.alleEdities')+'</option>'; }
}
document.getElementById('grafEditieSelect').addEventListener('change', verversGrafiek);

// ---------- statusweergave (leeg/fout/chart) ----------
function toonGrafState(status, foutmelding){
  // Heatmap/Sankey tekenen op een eigen CSS-grid-div/SVG, geen Chart.js-canvas (spec §5: "puur
  // SVG/CSS-grid, geen library nodig") — dus welke van de drie containers zichtbaar wordt hangt af
  // van het actieve type
  const heatmapActief = grafiekType==='heatmap', sankeyActief = grafiekType==='sankey';
  document.getElementById('grafCanvas').style.display = (status==='chart' && !heatmapActief && !sankeyActief) ? 'block' : 'none';
  document.getElementById('grafHeatmap').style.display = (status==='chart' && heatmapActief) ? 'block' : 'none';
  document.getElementById('grafSankeySvg').style.display = (status==='chart' && sankeyActief) ? 'block' : 'none';
  const leeg = document.getElementById('grafLeegState');
  leeg.style.display = (status==='leeg' || status==='leeg-data') ? 'flex' : 'none';
  leeg.textContent = status==='leeg-data' ? t('grafieken.geenDataInPeriode') : t('grafieken.leegState');
  document.getElementById('grafFoutState').style.display = status==='fout' ? 'flex' : 'none';
  if(status==='fout') document.getElementById('grafFoutInfo').textContent = foutmelding;
}

function tekenChart(series){
  const eenheid = { stroom:'A', spanning:'V', vermogen:'W', energie:'kWh' }[metric];
  const datasets = series.map(s=>({
    label: (nodeById(s.id) || {naam: s.id}).naam,
    data: s.punten.map(([tijd, waarde])=>({x: tijd, y: waarde})),
    borderColor: kleurVoorId(s.id),
    backgroundColor: kleurVoorId(s.id),
    pointRadius: 0,
    borderWidth: 2,
    tension: 0.15,
  }));
  if(chart) chart.destroy();
  chart = new Chart(document.getElementById('grafCanvas'), {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      scales: {
        x: { type: 'linear', ticks: { color: KLEUR_TEXT2, callback: (v)=> new Date(v).toLocaleTimeString(huidigeLocale(), {hour:'2-digit', minute:'2-digit'}) }, grid: { color: KLEUR_BORDER } },
        y: { title: { display: true, text: eenheid, color: KLEUR_TEXT2 }, ticks: { color: KLEUR_TEXT2 }, grid: { color: KLEUR_BORDER } },
      },
      plugins: {
        legend: { labels: { color: KLEUR_TEXT2 } },
        tooltip: { callbacks: { title: (items)=> new Date(items[0].parsed.x).toLocaleString(huidigeLocale()) } },
      },
    },
  });
}

function tekenStaafChart(waarden){
  // groen/amber/rood-conventie past hier alleen rechtstreeks bij metric "stroom" (dat ís letterlijk
  // "t.o.v. rating", zie spec §2) — bij de andere metrics (geen rating-drempel in Ampère
  // vergelijkbaar met W/V/kWh) valt dit terug op hetzelfde categorische palet als het lijndiagram
  const eenheid = { stroom:'A', spanning:'V', vermogen:'W', energie:'kWh' }[metric];
  const gesorteerd = waarden.slice().sort((a,b)=>b.waarde-a.waarde);
  const labels = gesorteerd.map(w=>(nodeById(w.id)||{naam:w.id}).naam);
  const kleuren = gesorteerd.map(w=>{
    if(metric!=='stroom') return kleurVoorId(w.id);
    const node = nodeById(w.id);
    return statusKleur(w.waarde, node ? node.rating_a : null);
  });
  if(chart) chart.destroy();
  chart = new Chart(document.getElementById('grafCanvas'), {
    type: 'bar',
    data: { labels, datasets: [{ data: gesorteerd.map(w=>w.waarde), backgroundColor: kleuren }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      scales: {
        x: { ticks: { color: KLEUR_TEXT2 }, grid: { display: false } },
        y: { title: { display: true, text: eenheid, color: KLEUR_TEXT2 }, ticks: { color: KLEUR_TEXT2 }, grid: { color: KLEUR_BORDER } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function tekenTaartChart(waarden){
  const totaal = waarden.reduce((s,w)=>s+w.waarde, 0);
  const gesorteerd = waarden.slice().sort((a,b)=>b.waarde-a.waarde);
  const labels = gesorteerd.map(w=>(nodeById(w.id)||{naam:w.id}).naam);
  const kleuren = gesorteerd.map(w=>kleurVoorId(w.id));
  if(chart) chart.destroy();
  chart = new Chart(document.getElementById('grafCanvas'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: gesorteerd.map(w=>w.waarde), backgroundColor: kleuren, borderColor: '#12151a', borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: KLEUR_TEXT2,
            // percentage + kWh-waarde in de legenda, zie spec §4
            generateLabels: (c)=> c.data.labels.map((label,i)=>{
              const waarde = c.data.datasets[0].data[i];
              const pct = totaal>0 ? Math.round((waarde/totaal)*100) : 0;
              return { text: label+' — '+pct+'% ('+waarde.toFixed(1)+' kWh)', fillStyle: kleuren[i], strokeStyle: kleuren[i], index: i };
            }),
          },
        },
        tooltip: { callbacks: { label: (item)=>{
          const pct = totaal>0 ? Math.round((item.parsed/totaal)*100) : 0;
          return item.label+': '+pct+'% ('+item.parsed.toFixed(1)+' kWh)';
        } } },
      },
    },
  });
}

async function verversLijnGrafiek(van, tot, editie){
  const params = new URLSearchParams({ ids: Array.from(selectedIds).join(','), metric, fase, van, tot, editie });
  let data;
  try{ data = await apiCall('/api/grafieken/tijdreeks?'+params.toString(), 'GET'); }
  catch(e){ toonGrafState('fout', e.message); return; }
  if(!data.series.length || data.series.every(s=>!s.punten.length)){
    if(chart){ chart.destroy(); chart = null; }
    toonGrafState('leeg-data');
    return;
  }
  toonGrafState('chart');
  tekenChart(data.series);
}

async function verversStaafGrafiek(van, tot, editie){
  const params = new URLSearchParams({ ids: Array.from(selectedIds).join(','), metric, fase, van, tot, editie, aggregatie });
  let data;
  try{ data = await apiCall('/api/grafieken/aggregaat?'+params.toString(), 'GET'); }
  catch(e){ toonGrafState('fout', e.message); return; }
  if(!data.waarden.length){
    if(chart){ chart.destroy(); chart = null; }
    toonGrafState('leeg-data');
    return;
  }
  toonGrafState('chart');
  tekenStaafChart(data.waarden);
}

// hergebruikt dezelfde /api/grafieken/aggregaat-data als Staaf (metric/aggregatie liggen bij Taart
// al vast op energie/totaal via ververMetricLock()) — "vrijwel gratis bovenop Staaf", zie de
// bouwvolgorde-suggestie in de spec
async function verversTaartGrafiek(van, tot, editie){
  const params = new URLSearchParams({ ids: Array.from(selectedIds).join(','), metric, fase, van, tot, editie, aggregatie });
  let data;
  try{ data = await apiCall('/api/grafieken/aggregaat?'+params.toString(), 'GET'); }
  catch(e){ toonGrafState('fout', e.message); return; }
  if(!data.waarden.length || !data.waarden.some(w=>w.waarde>0)){
    if(chart){ chart.destroy(); chart = null; }
    toonGrafState('leeg-data');
    return;
  }
  toonGrafState('chart');
  tekenTaartChart(data.waarden);
}

// puur CSS-grid, geen library (spec §5) — rij per kast, kolom per tijdvak (uur-van-de-dag of dag,
// zie venster). Celkleur volgt groen/amber/rood t.o.v. rating (metric ligt hier vast op stroom via
// ververMetricLock(), zelfde reden als bij Staaf); een ontbrekende meting (null) is een lege cel,
// geen kunstmatige 0
function tekenHeatmap(kolommen, rijen, venster){
  const el = document.getElementById('grafHeatmap');
  const labelFmt = venster==='1d'
    ? (t)=> new Date(t).toLocaleDateString(huidigeLocale(), {day:'2-digit', month:'2-digit'})
    : (t)=> new Date(t).toLocaleTimeString(huidigeLocale(), {hour:'2-digit', minute:'2-digit'});
  el.innerHTML = '';
  el.style.display = 'grid';
  el.style.gridTemplateColumns = '140px repeat('+kolommen.length+', minmax(28px,1fr))';
  el.style.gap = '2px';
  el.style.alignContent = 'start';

  el.appendChild(document.createElement('div')); // linkerbovenhoek, leeg
  kolommen.forEach(t=>{
    const kop = document.createElement('div');
    kop.textContent = labelFmt(t);
    kop.style.cssText = 'font-size:10px;color:'+KLEUR_TEXT2+';text-align:center;writing-mode:vertical-rl;padding:2px 0';
    el.appendChild(kop);
  });

  rijen.forEach(rij=>{
    const naamCel = document.createElement('div');
    naamCel.textContent = (nodeById(rij.id)||{naam:rij.id}).naam;
    naamCel.style.cssText = 'font-size:11.5px;color:'+KLEUR_TEXT2+';display:flex;align-items:center;padding-right:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    el.appendChild(naamCel);
    const node = nodeById(rij.id);
    rij.cellen.forEach((waarde,i)=>{
      const cel = document.createElement('div');
      cel.title = (nodeById(rij.id)||{naam:rij.id}).naam+' · '+labelFmt(kolommen[i])+': '+(waarde==null?t('grafieken.heatmapGeenData'):waarde.toFixed(1)+' '+({stroom:'A',spanning:'V',vermogen:'W',energie:'kWh'}[metric]));
      cel.style.cssText = 'aspect-ratio:1;border-radius:3px;background:'+(waarde==null?'transparent':statusKleur(waarde, node?node.rating_a:null))+
        (waarde==null ? ';border:1px dashed '+KLEUR_BORDER : '');
      el.appendChild(cel);
    });
  });
}

// zelfde node-type-kleurcodering als het Schema-tabblad (render-schema.js), voor herkenbaarheid
// tussen de twee (spec §3)
const SANKEY_KLEUR = { groep: '#b18cf0', batterij: '#5b8def', generator: '#4fd1c5' };
function sankeyNodeKleur(type){ return SANKEY_KLEUR[type] || KLEUR_GRIJS; } // kast -> grijs

function svgEl(tag, attrs){
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs||{}).forEach(([k,v])=>el.setAttribute(k,v));
  return el;
}

// eenvoudige, zelfgetekende Sankey (geen library, spec-suggestie in het Technisch fundament): de
// data is altijd een boom (elke kast heeft precies één ouder), dus een links-naar-rechts
// lagen-layout met breedte-naar-waarde-proportionele "linten" volstaat — geen algemene DAG-
// sankey-library nodig zoals d3-sankey zou vereisen
function tekenSankeyChart(nodes, links){
  const svg = document.getElementById('grafSankeySvg');
  svg.innerHTML = '';
  const W = Math.max(svg.clientWidth||900, 400), H = Math.max(svg.clientHeight||480, 300);
  svg.setAttribute('viewBox', '0 0 '+W+' '+H);

  const childrenOf = new Map(); // parentId -> [link, ...]
  links.forEach(l=>{ if(!childrenOf.has(l.from)) childrenOf.set(l.from, []); childrenOf.get(l.from).push(l); });
  const incomingWaarde = new Map(links.map(l=>[l.to, l.waarde]));

  const waardeCache = new Map();
  function waardeVan(id){
    if(waardeCache.has(id)) return waardeCache.get(id);
    const kids = (childrenOf.get(id)||[]).map(l=>l.to);
    const v = kids.length ? kids.reduce((s,kid)=>s+waardeVan(kid),0) : (incomingWaarde.get(id)||0);
    waardeCache.set(id, v);
    return v;
  }
  const root = nodes[0];
  const totaalWaarde = Math.max(waardeVan(root.id), 0.0001);

  const level = new Map([[root.id, 0]]);
  const volgorde = [root.id];
  let qi = 0;
  while(qi < volgorde.length){
    const id = volgorde[qi++];
    (childrenOf.get(id)||[]).forEach(l=>{ level.set(l.to, level.get(id)+1); volgorde.push(l.to); });
  }
  const maxLevel = Math.max(...level.values());
  const RECT_W = 16, MARGE_X = 8, TOP = 24, BOTTOM = 24, GAP_Y = 8;
  // begrensd i.p.v. altijd de volledige containerbreedte vullen — anders trekt een ondiepe keten
  // (weinig niveaus) de kolommen ver uit elkaar met veel lege ruimte ertussen
  const colGap = maxLevel>0 ? Math.min((W - MARGE_X*2 - RECT_W) / maxLevel, 240) : 0;
  const xVan = (lvl)=> MARGE_X + lvl*colGap;
  const schaal = (H - TOP - BOTTOM) / totaalWaarde; // px per kWh, gelijk over alle kolommen

  // per ouder: kWh-offset van elk kind binnen de ouder (voor de linker-aanhechting van het lint)
  childrenOf.forEach(lijst=>{ let acc=0; lijst.forEach(l=>{ l._offset = acc; acc += l.waarde; }); });

  const pos = new Map(); // id -> {x,y,h,v}
  for(let lvl=0; lvl<=maxLevel; lvl++){
    const lijst = nodes.filter(n=>level.get(n.id)===lvl);
    let y = TOP;
    lijst.forEach(n=>{
      const v = waardeVan(n.id);
      const h = Math.max(v*schaal, 3);
      pos.set(n.id, { x: xVan(lvl), y, h, v });
      y += h + GAP_Y;
    });
  }

  // linten eerst (onder de node-rechthoeken), van ouder naar kind
  links.forEach(l=>{
    const van = pos.get(l.from), naar = pos.get(l.to);
    if(!van || !naar) return;
    const x1 = van.x + RECT_W, y1 = van.y + l._offset*schaal, h1 = Math.max(l.waarde*schaal, 3);
    const x2 = naar.x, y2 = naar.y, h2 = naar.h;
    const midX = (x1+x2)/2;
    const d = 'M'+x1+','+y1+' C'+midX+','+y1+' '+midX+','+y2+' '+x2+','+y2+
      ' L'+x2+','+(y2+h2)+' C'+midX+','+(y2+h2)+' '+midX+','+(y1+h1)+' '+x1+','+(y1+h1)+' Z';
    const path = svgEl('path', { d, fill: sankeyNodeKleur((nodeById(l.from)||{}).type), opacity: '0.35' });
    svg.appendChild(path);
  });

  // dan de nodes zelf + labels
  nodes.forEach(n=>{
    const p = pos.get(n.id);
    if(!p) return;
    svg.appendChild(svgEl('rect', { x:p.x, y:p.y, width:RECT_W, height:p.h, rx:2, fill:sankeyNodeKleur(n.type) }));
    const label = svgEl('text', { x: p.x+RECT_W+6, y: p.y+p.h/2, fill: KLEUR_TEXT2, 'font-size':'11', 'dominant-baseline':'middle' });
    label.textContent = n.naam + (n.id!==root.id ? ' · '+p.v.toFixed(1)+' kWh' : ' · '+p.v.toFixed(1)+' kWh totaal');
    svg.appendChild(label);
  });
}

async function verversSankeyGrafiek(van, tot, editie){
  if(chart){ chart.destroy(); chart = null; } // zie verversHeatmapGrafiek() voor de reden
  const startpunt = document.getElementById('grafSankeyStartpunt').value;
  if(!startpunt){ toonGrafState('leeg'); return; }
  const params = new URLSearchParams({ startpunt, fase: 'totaal', van, tot, editie });
  let data;
  try{ data = await apiCall('/api/grafieken/sankey?'+params.toString(), 'GET'); }
  catch(e){ toonGrafState('fout', e.message); return; }
  if(!data.links.length){
    document.getElementById('grafSankeySvg').innerHTML = '';
    toonGrafState('leeg-data');
    return;
  }
  toonGrafState('chart');
  tekenSankeyChart(data.nodes, data.links);
}

async function verversHeatmapGrafiek(van, tot, editie){
  // geen Chart.js-instantie voor een heatmap (eigen CSS-grid) — een eventuele oude chart van vóór
  // het wisselen naar Heatmap opruimen, anders blijft "Downloaden als PNG" per ongeluk de vorige
  // (nu verborgen) grafiek downloaden i.p.v. niets te doen
  if(chart){ chart.destroy(); chart = null; }
  const params = new URLSearchParams({ ids: Array.from(selectedIds).join(','), metric, fase, van, tot, editie, aggregatie });
  let data;
  try{ data = await apiCall('/api/grafieken/heatmap?'+params.toString(), 'GET'); }
  catch(e){ toonGrafState('fout', e.message); return; }
  if(!data.kolommen.length || !data.rijen.length){
    document.getElementById('grafHeatmap').innerHTML = '';
    toonGrafState('leeg-data');
    return;
  }
  toonGrafState('chart');
  tekenHeatmap(data.kolommen, data.rijen, data.venster);
}

async function verversGrafiek(){
  // Sankey gebruikt geen kasten-checklist maar een startpunt-select, zie ververSankeyLinkerkolom()
  if(grafiekType!=='sankey' && !selectedIds.size){
    if(chart){ chart.destroy(); chart = null; }
    toonGrafState('leeg');
    return;
  }
  let van, tot;
  try{ ({ van, tot } = await bepaalGrafiekenPeriode()); }
  catch(e){ toonGrafState('fout', e.message); return; }
  const editie = document.getElementById('grafEditieSelect').value;

  if(grafiekType==='staaf') return verversStaafGrafiek(van, tot, editie);
  if(grafiekType==='taart') return verversTaartGrafiek(van, tot, editie);
  if(grafiekType==='heatmap') return verversHeatmapGrafiek(van, tot, editie);
  if(grafiekType==='sankey') return verversSankeyGrafiek(van, tot, editie);
  return verversLijnGrafiek(van, tot, editie);
}
document.getElementById('grafOpnieuwBtn').onclick = verversGrafiek;

// ---------- PNG-download ----------
document.getElementById('grafPngBtn').onclick = ()=>{
  if(!chart) return;
  const a = document.createElement('a');
  a.href = chart.toBase64Image('image/png', 1);
  a.download = 'grafiek.png';
  a.click();
};

// ---------- deelbare link: codeert de huidige selectie als query-string, geen opslag/database
// (zie "Wat het niet is" in de spec) ----------
function huidigeSelectieAlsParams(){
  const params = new URLSearchParams({
    mode: 'grafieken', type: grafiekType,
    ids: Array.from(selectedIds).join(','), metric, fase,
    periode: state.grafiekenPeriodeChip,
    editie: document.getElementById('grafEditieSelect').value,
  });
  if(['staaf','taart','heatmap'].includes(grafiekType)) params.set('aggregatie', aggregatie);
  if(grafiekType==='sankey') params.set('startpunt', document.getElementById('grafSankeyStartpunt').value);
  if(state.grafiekenPeriodeChip==='aangepast'){
    params.set('van', document.getElementById('grafVanInput').value);
    params.set('tot', document.getElementById('grafTotInput').value);
  }
  return params;
}
document.getElementById('grafLinkBtn').onclick = async ()=>{
  const url = location.origin + location.pathname + '?' + huidigeSelectieAlsParams().toString();
  const btn = document.getElementById('grafLinkBtn');
  const orig = btn.textContent;
  try{
    await navigator.clipboard.writeText(url);
    btn.textContent = t('grafieken.linkGekopieerd');
  }catch(e){
    // clipboard-API kan geblokkeerd zijn (geen HTTPS/geen permissie) — dan de link zelf tonen
    // i.p.v. stil te falen
    window.prompt(t('grafieken.linkKopieerHandmatig'), url);
    return;
  }
  setTimeout(()=>{ btn.textContent = orig; }, 1500);
};

// leest een eerder gekopieerde link uit (?mode=grafieken&ids=...&metric=...&...), zie main.js voor
// het automatisch openen van dit tabblad als de URL ernaar verwijst. Live-modus wordt bewust nooit
// in de link gecodeerd (zie spec), dus hier ook niets om over uit te lezen.
function herstelVanUrl(){
  const params = new URLSearchParams(location.search);
  if(params.get('mode') !== 'grafieken') return;
  const idsParam = params.get('ids');
  if(idsParam) selectedIds = new Set(idsParam.split(',').filter(Boolean));
  if(params.get('metric')) metric = params.get('metric');
  if(params.get('fase')) fase = params.get('fase');
  if(params.get('periode')) state.grafiekenPeriodeChip = params.get('periode');
  if(params.get('van')) document.getElementById('grafVanInput').value = params.get('van');
  if(params.get('tot')) document.getElementById('grafTotInput').value = params.get('tot');
  const typeParam = params.get('type');
  if(typeParam && document.querySelector('#grafTypeRow [data-type="'+typeParam+'"]:not([disabled])')) grafiekType = typeParam;
  if(params.get('aggregatie')) aggregatie = params.get('aggregatie');

  document.querySelectorAll('#grafFaseRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.fase===fase));
  document.querySelectorAll('#grafPeriodeRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.periodechip===state.grafiekenPeriodeChip));
  document.getElementById('grafAangepastPeriode').style.display = state.grafiekenPeriodeChip==='aangepast' ? 'flex' : 'none';
  document.querySelectorAll('#grafTypeRow button').forEach(b=>b.classList.toggle('active', b.dataset.type===grafiekType));
  document.getElementById('grafAggregatieGroup').style.display = ['staaf','taart','heatmap'].includes(grafiekType) ? 'flex' : 'none';
  ververMetricLock();
  ververSankeyLinkerkolom();
  const startpuntParam = params.get('startpunt');
  if(grafiekType==='sankey' && startpuntParam && document.querySelector('#grafSankeyStartpunt option[value="'+startpuntParam+'"]')){
    document.getElementById('grafSankeyStartpunt').value = startpuntParam;
  }
  if(grafiekType==='taart'){
    aggregatie = 'totaal';
    document.querySelectorAll('#grafAggregatieRow .chip').forEach(c=>{ c.classList.toggle('active', c.dataset.aggregatie==='totaal'); c.disabled = true; });
  } else {
    document.querySelectorAll('#grafAggregatieRow .chip').forEach(c=>c.disabled = false);
    ververAggregatieBeschikbaarheid();
  }
  document.querySelectorAll('#grafAggregatieRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.aggregatie===aggregatie));
}

// aangeroepen vanuit modes.js zodra het Grafieken-tabblad getoond wordt
export async function toonGrafieken(){
  await vulEditieSelect();
  if(eersteKeerGetoond){
    eersteKeerGetoond = false;
    herstelVanUrl();
    const editieUitUrl = new URLSearchParams(location.search).get('editie');
    const select = document.getElementById('grafEditieSelect');
    if(editieUitUrl && Array.from(select.options).some(o=>o.value===editieUitUrl)) select.value = editieUitUrl;
  }
  renderChecklist();
  verversGrafiek();
}
