// ---------- Grafieken-tabblad (specs/grafieken-tabblad-plan.md): vrije ad-hoc analyse ----------
// Lijn/Staaf/Taart/Heatmap/Sankey + live-modus + PNG-export zijn gebouwd, volgens de spec's eigen
// "Bouwvolgorde-suggestie" (live-modus als losstaande laatste stap, zie sectie verderop in dit bestand).
import { state, liveData } from './state.js';
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

// ---------- live-modus (specs/grafieken-tabblad-plan.md, sectie "Live-modus") — hergebruikt de
// bestaande MQTT-websocketverbinding van het Live-tabblad (mqtt.js roept verwerkGrafiekenLiveMessage()
// aan per bericht, ongeacht welk tabblad actief is, zelfde patroon als liveData/anomaly.js), geen
// eigen databron. De rolling buffer bewaart altijd de volle 60 minuten ongeacht het gekozen
// live-venster, zodat je het venster kan vergroten zonder eerder ontvangen data te verliezen. ----------
let liveVensterMin = 15;
let livePaused = false;
let laatsteNietLivePeriode = '24u';
const LIVE_BUFFER_MAX_MS = 60 * 60 * 1000;
const liveBuffer = new Map(); // id -> [{ts, data}, ...]
function liveActief(){ return state.grafiekenPeriodeChip === 'live'; }

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
let metricVoorLock = null; // vorige metric van vóór een type-lock (taart/heatmap/sankey)
// tijdens live-modus is Energie (kWh) nergens zinvol (een periode-optelling, geen momentwaarde) —
// voor Taart/Sankey verschuift de normale energie-lock hierboven dan naar Vermogen (spec Live-modus
// §Sankey&Taart: "metric springt automatisch... naar Vermogen"); Lijn/Staaf hebben een vrije
// metric-keuze, daar wordt alleen de Energie-chip specifiek uitgeschakeld i.p.v. de hele rij
let metricVoorLive = null;
function ververMetricLock(){
  const typeLock = METRIC_LOCK[grafiekType] || null;
  if(typeLock){
    if(metricVoorLock==null) metricVoorLock = metric;
    metric = typeLock;
  } else if(metricVoorLock!=null){
    metric = metricVoorLock;
    metricVoorLock = null;
  }
  const liveEnergieUitgesloten = liveActief() && grafiekType!=='heatmap'; // heatmap heeft geen live-modus
  if(liveEnergieUitgesloten && metric==='energie'){
    if(metricVoorLive==null) metricVoorLive = metric;
    metric = 'vermogen';
  } else if(!liveEnergieUitgesloten && metricVoorLive!=null){
    metric = metricVoorLive;
    metricVoorLive = null;
  }
  document.querySelectorAll('#grafMetricRow .chip').forEach(c=>{
    const isEnergie = c.dataset.metric==='energie';
    c.disabled = typeLock ? true : (liveEnergieUitgesloten && isEnergie);
    c.title = (!typeLock && liveEnergieUitgesloten && isEnergie) ? t('grafieken.energieNietInLiveTitle') : '';
    c.classList.toggle('active', c.dataset.metric===metric);
  });
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

// bundelt alle vier de "hangt af van type + live-status"-functies achter één aanroep — voorheen
// stonden deze los herhaald op de twee plekken die iets aan type/periode veranderen (typeRow-klik,
// herstelVanUrl); nu de live-modus er een derde as bijzet, is dat een derde plek die verzwaren
function ververAlleAfgeleideUiState(){
  ververMetricLock();
  ververSankeyLinkerkolom();
  ververAggregatieWeergave();
  ververLiveUi();
}

document.querySelectorAll('#grafTypeRow button:not([disabled])').forEach(btn=>{
  btn.onclick = ()=>{
    grafiekType = btn.dataset.type;
    document.querySelectorAll('#grafTypeRow button').forEach(b=>b.classList.toggle('active', b===btn));
    // Heatmap heeft geen live-modus (spec: "draait per definitie om een afgerond patroon over
    // meerdere uren") — val terug op de laatst gekozen niet-live periode i.p.v. een ongeldige
    // combinatie te laten ontstaan
    if(grafiekType==='heatmap' && liveActief()){
      state.grafiekenPeriodeChip = laatsteNietLivePeriode;
      document.querySelectorAll('#grafPeriodeRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.periodechip===state.grafiekenPeriodeChip));
      document.getElementById('grafAangepastPeriode').style.display = state.grafiekenPeriodeChip==='aangepast' ? 'flex' : 'none';
    }
    ververAlleAfgeleideUiState();
    verversGrafiek();
  };
});

// ---------- aggregatie-knoppenrij (Staaf/Taart/Heatmap) — "Periode-totaal" alleen zinvol/
// beschikbaar bij metric Energie, zie spec §2. Tijdens live-modus toont Staaf een aparte rij met
// live-specifieke betekenis (Huidig/Piek-in-venster/Gemiddelde-in-venster i.p.v. Piek/Gemiddelde/
// Periode-totaal, spec Live-modus §Staafdiagram); Taart heeft in live-modus geen aggregatie-keuze
// nodig (altijd het huidige aandeel, geen periode om over te aggregeren) ----------
function ververAggregatieBeschikbaarheid(){
  const totaalBtn = document.querySelector('#grafAggregatieRow [data-aggregatie="totaal"]');
  const beschikbaar = metric === 'energie';
  totaalBtn.disabled = !beschikbaar;
  if(!beschikbaar && aggregatie==='totaal'){
    aggregatie = 'piek';
    document.querySelectorAll('#grafAggregatieRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.aggregatie==='piek'));
  }
}
const AGG_LIVE_OPTIES = ['huidig','piekvenster','gemvenster'];
function ververAggregatieWeergave(){
  const live = liveActief() && grafiekType!=='heatmap';
  const toontAggregatieGroep = ['staaf','taart','heatmap'].includes(grafiekType) && !(live && grafiekType==='taart');
  document.getElementById('grafAggregatieGroup').style.display = toontAggregatieGroep ? 'flex' : 'none';
  const toontLiveRow = live && grafiekType==='staaf';
  document.getElementById('grafAggregatieRow').style.display = toontLiveRow ? 'none' : 'flex';
  document.getElementById('grafAggregatieRowLive').style.display = toontLiveRow ? 'flex' : 'none';
  if(toontLiveRow){
    if(!AGG_LIVE_OPTIES.includes(aggregatie)) aggregatie = 'huidig';
    document.querySelectorAll('#grafAggregatieRowLive .chip').forEach(c=>c.classList.toggle('active', c.dataset.aggregatie===aggregatie));
    return;
  }
  if(grafiekType==='taart'){
    aggregatie = 'totaal';
    document.querySelectorAll('#grafAggregatieRow .chip').forEach(c=>{ c.classList.toggle('active', c.dataset.aggregatie==='totaal'); c.disabled = true; });
  } else {
    document.querySelectorAll('#grafAggregatieRow .chip').forEach(c=>c.disabled = false);
    ververAggregatieBeschikbaarheid();
    document.querySelectorAll('#grafAggregatieRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.aggregatie===aggregatie));
  }
}
document.querySelectorAll('#grafAggregatieRow .chip, #grafAggregatieRowLive .chip').forEach(chip=>{
  chip.onclick = ()=>{
    if(chip.disabled) return;
    aggregatie = chip.dataset.aggregatie;
    document.querySelectorAll('#grafAggregatieRow .chip, #grafAggregatieRowLive .chip').forEach(c=>c.classList.toggle('active', c.dataset.aggregatie===aggregatie));
    verversGrafiek();
  };
});

// ---------- live-venster-duur (5/15/30/60 min) ----------
document.querySelectorAll('#grafLiveVensterRow .chip').forEach(chip=>{
  chip.onclick = ()=>{
    liveVensterMin = parseInt(chip.dataset.vensterMin, 10);
    document.querySelectorAll('#grafLiveVensterRow .chip').forEach(c=>c.classList.toggle('active', c===chip));
    if(liveActief()) verversLiveWeergave();
  };
});

// ---------- pauzeren/hervatten (puur client-side — de buffer blijft doorlopen, alleen het
// hertekenen stopt/hervat, spec Live-modus: "hervatten toont meteen de actuele stand, geen
// inhaal-animatie") ----------
document.getElementById('grafLivePauseBtn').onclick = ()=>{
  livePaused = !livePaused;
  document.getElementById('grafLivePauseBtn').textContent = livePaused ? t('grafieken.liveHervatten') : t('grafieken.livePauzeren');
  if(!livePaused) verversLiveWeergave();
};

// ---------- live-gebonden UI (indicator, pauzeknop, venster-groep, editie-select vastzetten,
// Live-chip uitschakelen bij Heatmap) — spec Live-modus, gemeenschappelijk voor alle typen ----------
function ververLiveUi(){
  const live = liveActief();
  document.getElementById('grafLiveVensterGroep').style.display = live ? 'flex' : 'none';
  document.getElementById('grafLiveIndicator').style.display = live ? 'inline-flex' : 'none';
  document.getElementById('grafLivePauseBtn').style.display = live ? 'inline-block' : 'none';
  const editieSelect = document.getElementById('grafEditieSelect');
  editieSelect.disabled = live;
  editieSelect.title = live ? t('grafieken.liveEditieVastTitle') : '';
  const liveChip = document.querySelector('#grafPeriodeRow [data-periodechip="live"]');
  liveChip.disabled = grafiekType==='heatmap';
  liveChip.title = grafiekType==='heatmap' ? t('grafieken.liveNietBeschikbaarHeatmapTitle') : '';
  if(!live) livePaused = false;
  document.getElementById('grafLivePauseBtn').textContent = livePaused ? t('grafieken.liveHervatten') : t('grafieken.livePauzeren');
}

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
    if(chip.disabled) return;
    state.grafiekenPeriodeChip = chip.dataset.periodechip;
    if(state.grafiekenPeriodeChip!=='live') laatsteNietLivePeriode = state.grafiekenPeriodeChip;
    document.querySelectorAll('#grafPeriodeRow .chip').forEach(c=>c.classList.toggle('active', c===chip));
    document.getElementById('grafAangepastPeriode').style.display = state.grafiekenPeriodeChip==='aangepast' ? 'flex' : 'none';
    ververAlleAfgeleideUiState();
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
function heatmapLabelFmt(venster){
  return venster==='1d'
    ? (t)=> new Date(t).toLocaleDateString(huidigeLocale(), {day:'2-digit', month:'2-digit'})
    : (t)=> new Date(t).toLocaleTimeString(huidigeLocale(), {hour:'2-digit', minute:'2-digit'});
}

// laatst getekende heatmap-data, bewaard voor de PNG-export hieronder (tekenHeatmap() zelf tekent
// alleen de zichtbare CSS-grid-DOM, geen canvas)
let laatsteHeatmapData = null;

function tekenHeatmap(kolommen, rijen, venster){
  laatsteHeatmapData = { kolommen, rijen, venster };
  const el = document.getElementById('grafHeatmap');
  const labelFmt = heatmapLabelFmt(venster);
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
    laatsteHeatmapData = null;
    toonGrafState('leeg-data');
    return;
  }
  toonGrafState('chart');
  tekenHeatmap(data.kolommen, data.rijen, data.venster);
}

async function verversGrafiek(){
  if(liveActief()){
    verversLiveWeergave();
    return;
  }
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

// ---------- live-modus: databuffer, live-waarden-berekening en per-type live-rendering ----------
// mirrort de veldnamen die kastpopup.js al gebruikt voor de MQTT-databallon (a/b/c/total_current,
// _voltage, _act_power) — "totaal" bij spanning is (net als bij het historische endpoint) het
// gemiddelde van de drie fasen, er bestaat geen fysiek total_voltage-veld
function liveVeldWaarde(data, m, f){
  if(!data) return null;
  if(m==='stroom') return f==='totaal' ? data.total_current : data[f+'_current'];
  if(m==='vermogen') return f==='totaal' ? data.total_act_power : data[f+'_act_power'];
  if(m==='spanning'){
    if(f!=='totaal') return data[f+'_voltage'];
    const vals = [data.a_voltage, data.b_voltage, data.c_voltage].filter(v=>v!=null);
    return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
  }
  return null; // energie: niet ondersteund in live, zie ververMetricLock()
}

function liveMoetTekenen(){
  return state.mode==='grafieken' && liveActief() && !livePaused && grafiekType!=='heatmap';
}

// aangeroepen vanuit mqtt.js voor élk binnenkomend bericht, ongeacht actief tabblad — zelfde
// altijd-actief patroon als liveData/anomaly.js, zodat de buffer al gevuld is zodra je naar Live
// wisselt. Bewaart altijd de volle 60 minuten, los van het momenteel gekozen live-venster (zie
// LIVE_BUFFER_MAX_MS hierboven), zodat het venster vergroten geen data kost.
export function verwerkGrafiekenLiveMessage(kastId, data){
  if(!liveBuffer.has(kastId)) liveBuffer.set(kastId, []);
  const buf = liveBuffer.get(kastId);
  buf.push({ ts: Date.now(), data });
  const grens = Date.now() - LIVE_BUFFER_MAX_MS;
  while(buf.length && buf[0].ts < grens) buf.shift();
  if(liveMoetTekenen()) verversLiveWeergave();
}

// veiligheidsnet naast de directe redraw-bij-elk-bericht hierboven: laat de grafiek ook zonder
// nieuwe MQTT-berichten doorschuiven (oudste punten vallen links uit beeld) en houdt de weergave
// actueel als de gebruiker net naar het Grafieken-tabblad wisselt terwijl live al liep
let liveTickGestart = false;
function zorgLiveTick(){
  if(liveTickGestart) return;
  liveTickGestart = true;
  setInterval(()=>{ if(liveMoetTekenen()) verversLiveWeergave(); }, 2000);
}

function liveStaafWaarde(id){
  const huidig = liveVeldWaarde(liveData[id], metric, fase);
  if(aggregatie!=='piekvenster' && aggregatie!=='gemvenster') return huidig;
  const grens = Date.now() - liveVensterMin*60000;
  const punten = (liveBuffer.get(id)||[]).filter(e=>e.ts>=grens).map(e=>liveVeldWaarde(e.data, metric, fase)).filter(v=>v!=null);
  if(!punten.length) return huidig;
  return aggregatie==='piekvenster' ? Math.max(...punten) : punten.reduce((a,b)=>a+b,0)/punten.length;
}

// zelfde boomdefinitie als het backend-Sankey-endpoint (verzamel()/readTopo() in server.js), maar
// client-side met de al-geladen topologie + de laatste MQTT-waarde per kast i.p.v. een berekende
// kWh-integraal over een periode — spec Live-modus: "actuele vermogensverdeling, geen cumulatieve
// energie"
function bouwLiveSankeyBoom(startpuntId){
  const root = nodeById(startpuntId);
  if(!root) return { nodes: [], links: [] };
  const nodes = [{ id: root.id, naam: root.naam, type: root.type || 'generator', parent: null }];
  const links = [];
  function verzamel(node, parentId){
    listChildrenOf(node).forEach(k=>{
      nodes.push({ id: k.id, naam: k.naam, type: k.type || 'kast', parent: parentId });
      links.push({ from: parentId, to: k.id, waarde: liveVeldWaarde(liveData[k.id], 'vermogen', 'totaal') || 0 });
      verzamel(k, k.id);
    });
  }
  verzamel(root, root.id);
  return { nodes, links };
}

function verversLiveWeergave(){
  if(grafiekType==='sankey'){
    const startpunt = document.getElementById('grafSankeyStartpunt').value;
    if(!startpunt){ toonGrafState('leeg'); return; }
    const { nodes, links } = bouwLiveSankeyBoom(startpunt);
    if(nodes.length<2){ toonGrafState('leeg-data'); return; }
    toonGrafState('chart'); tekenSankeyChart(nodes, links);
    return;
  }
  if(!selectedIds.size){
    if(chart){ chart.destroy(); chart = null; }
    toonGrafState('leeg');
    return;
  }
  if(grafiekType==='taart'){
    const waarden = Array.from(selectedIds).map(id=>({ id, waarde: liveVeldWaarde(liveData[id], metric, fase) || 0 }));
    if(!waarden.some(w=>w.waarde>0)){ toonGrafState('leeg-data'); return; }
    toonGrafState('chart'); tekenTaartChart(waarden);
    return;
  }
  if(grafiekType==='staaf'){
    const waarden = Array.from(selectedIds).map(id=>({ id, waarde: liveStaafWaarde(id) || 0 }));
    toonGrafState('chart'); tekenStaafChart(waarden);
    return;
  }
  const grens = Date.now() - liveVensterMin*60000;
  const series = Array.from(selectedIds).map(id=>({
    id,
    punten: (liveBuffer.get(id)||[]).filter(e=>e.ts>=grens)
      .map(e=>[e.ts, liveVeldWaarde(e.data, metric, fase)]).filter(([,w])=>w!=null),
  }));
  if(!series.some(s=>s.punten.length)){ toonGrafState('leeg-data'); return; }
  toonGrafState('chart'); tekenChart(series);
}
zorgLiveTick();

// ---------- PNG-download: één uniforme exportroute voor alle vijf typen (spec, Technisch fundament:
// "geen aparte, per-type-verschillende downloadknop-logica"). Lijn/Staaf/Taart zijn al canvas-based
// via Chart.js; Sankey (eigen SVG, geen HTML erin) rasterizeert alsnog naar canvas via een Image —
// de browser kan dat zelf, geen library nodig. Heatmap tekent in plaats daarvan zijn laatste data
// opnieuw rechtstreeks op een eigen canvas (zie heatmapNaarPngDataUrl hieronder). ----------
function downloadPng(dataUrl){
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'grafiek.png';
  a.click();
}
function svgNaarPngDataUrl(bronSvg){
  return new Promise((resolve, reject)=>{
    const W = Math.max(bronSvg.clientWidth, 400), H = Math.max(bronSvg.clientHeight, 300);
    const clone = bronSvg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', W); clone.setAttribute('height', H);
    // achtergrond expliciet meetekenen — anders is de PNG transparant en oncontroleerbaar op een
    // lichte achtergrond (bijv. geplakt in een e-mail of document)
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '100%'); rect.setAttribute('height', '100%'); rect.setAttribute('fill', '#12151a');
    clone.insertBefore(rect, clone.firstChild);
    const svgStr = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = ()=>{
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      canvas.getContext('2d').drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = (e)=>{ URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
// Heatmap opnieuw tekenen op een eigen (onzichtbare) canvas i.p.v. de zichtbare CSS-grid-DOM te
// rasterizeren: een SVG-foreignObject-truc (zoals bij Sankey hierboven) "taint" het canvas zodra er
// HTML in zit (Chromium-beveiligingsbeperking, tijdens implementatie ontdekt via Playwright — het
// canvas mag dan niet meer uitgelezen worden met toDataURL) — dat probleem doet zich niet voor bij
// een zuivere SVG zoals de Sankey. Gebruikt dezelfde laatsteHeatmapData als tekenHeatmap() hierboven.
function heatmapNaarPngDataUrl(){
  const { kolommen, rijen, venster } = laatsteHeatmapData;
  const labelFmt = heatmapLabelFmt(venster);
  const NAAMKOL = 140, CELW = 32, CELH = 28, KOPH = 56;
  const W = NAAMKOL + kolommen.length*CELW, H = KOPH + rijen.length*CELH;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#12151a'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = KLEUR_TEXT2; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  kolommen.forEach((tijd, i)=>{
    ctx.save();
    ctx.translate(NAAMKOL + i*CELW + CELW/2, KOPH - 6);
    ctx.rotate(-Math.PI/2);
    ctx.fillText(labelFmt(tijd), 0, 0);
    ctx.restore();
  });
  ctx.textAlign = 'left';
  rijen.forEach((rij, ri)=>{
    const node = nodeById(rij.id);
    ctx.fillStyle = KLEUR_TEXT2; ctx.font = '11.5px sans-serif';
    ctx.fillText((node||{naam:rij.id}).naam, 4, KOPH + ri*CELH + CELH/2);
    rij.cellen.forEach((waarde, ci)=>{
      const x = NAAMKOL + ci*CELW, y = KOPH + ri*CELH;
      if(waarde==null){
        ctx.strokeStyle = KLEUR_BORDER; ctx.setLineDash([2,2]);
        ctx.strokeRect(x+1, y+1, CELW-2, CELH-2);
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = statusKleur(waarde, node ? node.rating_a : null);
        ctx.fillRect(x+1, y+1, CELW-2, CELH-2);
      }
    });
  });
  return canvas.toDataURL('image/png');
}
document.getElementById('grafPngBtn').onclick = async ()=>{
  if(grafiekType==='sankey'){
    const sankeySvg = document.getElementById('grafSankeySvg');
    if(!sankeySvg.childElementCount) return;
    try{ downloadPng(await svgNaarPngDataUrl(sankeySvg)); }catch(e){ /* browser kan geen SVG->canvas, stil negeren i.p.v. crashen */ }
    return;
  }
  if(grafiekType==='heatmap'){
    if(!laatsteHeatmapData || !laatsteHeatmapData.rijen.length) return;
    downloadPng(heatmapNaarPngDataUrl());
    return;
  }
  if(!chart) return;
  downloadPng(chart.toBase64Image('image/png', 1));
};

// ---------- deelbare link: codeert de huidige selectie als query-string, geen opslag/database
// (zie "Wat het niet is" in de spec) ----------
function huidigeSelectieAlsParams(){
  // Live-modus wordt bewust nooit in de link gecodeerd (spec: "een moment-gebonden weergave"),
  // valt terug op Laatste 24u; idem de bijbehorende live-aggregatiewaarden (huidig/piekvenster/
  // gemvenster) — die zijn ongeldig voor het historische endpoint dat de ontvanger van de link krijgt
  const periode = state.grafiekenPeriodeChip === 'live' ? '24u' : state.grafiekenPeriodeChip;
  const params = new URLSearchParams({
    mode: 'grafieken', type: grafiekType,
    ids: Array.from(selectedIds).join(','), metric, fase,
    periode,
    editie: document.getElementById('grafEditieSelect').value,
  });
  if(['staaf','taart','heatmap'].includes(grafiekType) && !AGG_LIVE_OPTIES.includes(aggregatie)) params.set('aggregatie', aggregatie);
  if(grafiekType==='sankey') params.set('startpunt', document.getElementById('grafSankeyStartpunt').value);
  if(periode==='aangepast'){
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

  laatsteNietLivePeriode = state.grafiekenPeriodeChip; // een gedeelde link codeert nooit 'live', zie huidigeSelectieAlsParams()
  document.querySelectorAll('#grafFaseRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.fase===fase));
  document.querySelectorAll('#grafPeriodeRow .chip').forEach(c=>c.classList.toggle('active', c.dataset.periodechip===state.grafiekenPeriodeChip));
  document.getElementById('grafAangepastPeriode').style.display = state.grafiekenPeriodeChip==='aangepast' ? 'flex' : 'none';
  document.querySelectorAll('#grafTypeRow button').forEach(b=>b.classList.toggle('active', b.dataset.type===grafiekType));
  const startpuntParam = params.get('startpunt');
  if(grafiekType==='sankey' && startpuntParam && document.querySelector('#grafSankeyStartpunt option[value="'+startpuntParam+'"]')){
    document.getElementById('grafSankeyStartpunt').value = startpuntParam;
  }
  ververAlleAfgeleideUiState();
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
