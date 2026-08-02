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

// ---------- metric/fase-knoppenrijen ----------
document.querySelectorAll('#grafMetricRow .chip').forEach(chip=>{
  chip.onclick = ()=>{
    metric = chip.dataset.metric;
    document.querySelectorAll('#grafMetricRow .chip').forEach(c=>c.classList.toggle('active', c===chip));
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
    mode: 'grafieken', type: 'lijn',
    ids: Array.from(selectedIds).join(','), metric, fase,
    periode: state.grafiekenPeriodeChip,
    editie: document.getElementById('grafEditieSelect').value,
  });
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

  document.querySelectorAll('#grafMetricRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.metric===metric));
  document.querySelectorAll('#grafFaseRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.fase===fase));
  document.querySelectorAll('#grafPeriodeRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.periodechip===state.grafiekenPeriodeChip));
  document.getElementById('grafAangepastPeriode').style.display = state.grafiekenPeriodeChip==='aangepast' ? 'flex' : 'none';
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
