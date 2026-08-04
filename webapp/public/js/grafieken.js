// ---------- Grafieken-tabblad (specs/grafieken-tabblad-plan.md): vrije ad-hoc analyse ----------
// Eerste bouwstap van dat item: alleen het lijndiagram, alleen historisch (geen live-modus,
// zie de spec's eigen "Bouwvolgorde-suggestie" — Lijn eerst). Staaf/Sankey/Taart/Heatmap-knoppen
// staan al in de markup maar zijn bewust disabled, geen dode illusie van functionaliteit.
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
document.querySelectorAll('#grafTypeRow button:not([disabled])').forEach(btn=>{
  btn.onclick = ()=>{
    grafiekType = btn.dataset.type;
    document.querySelectorAll('#grafTypeRow button').forEach(b=>b.classList.toggle('active', b===btn));
    // aggregatie-knoppenrij hoort bij Staaf/Taart/Heatmap (spec §2/4/5), niet bij Lijn/Sankey
    document.getElementById('grafAggregatieGroup').style.display = ['staaf','taart','heatmap'].includes(grafiekType) ? 'flex' : 'none';
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
  document.getElementById('grafCanvas').style.display = status==='chart' ? 'block' : 'none';
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

async function verversGrafiek(){
  if(!selectedIds.size){
    if(chart){ chart.destroy(); chart = null; }
    toonGrafState('leeg');
    return;
  }
  let van, tot;
  try{ ({ van, tot } = await bepaalGrafiekenPeriode()); }
  catch(e){ toonGrafState('fout', e.message); return; }
  const editie = document.getElementById('grafEditieSelect').value;

  if(grafiekType==='staaf') return verversStaafGrafiek(van, tot, editie);
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

  document.querySelectorAll('#grafMetricRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.metric===metric));
  document.querySelectorAll('#grafFaseRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.fase===fase));
  document.querySelectorAll('#grafPeriodeRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.periodechip===state.grafiekenPeriodeChip));
  document.getElementById('grafAangepastPeriode').style.display = state.grafiekenPeriodeChip==='aangepast' ? 'flex' : 'none';
  document.querySelectorAll('#grafTypeRow button').forEach(b=>b.classList.toggle('active', b.dataset.type===grafiekType));
  document.getElementById('grafAggregatieGroup').style.display = ['staaf','taart','heatmap'].includes(grafiekType) ? 'flex' : 'none';
  document.querySelectorAll('#grafAggregatieRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.aggregatie===aggregatie));
  ververAggregatieBeschikbaarheid();
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
