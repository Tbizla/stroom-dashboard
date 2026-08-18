// ---------- specs/live-viewport-grote-monitor-plan.md: KPI-tegels + alert-ticker-strip, alleen op
// Live. Reine reindexering van bestaande data (statusOf()/liveData), geen nieuwe databron. ----------
import { state, liveData } from './state.js';
import { statusOf, maxFaseStroom, genNaam, primaireMeting } from './topology.js';
import { t, huidigeLocale } from './i18n.js';

function berekenKpis(){
  const kasten = state.TOPO.kasten;
  const belastingen = [];
  let rood = 0, amber = 0, groen = 0, offline = 0;
  kasten.forEach(k=>{
    const s = statusOf(k);
    if(s==null){ offline++; return; }
    if(s==='red') rood++; else if(s==='amber') amber++; else groen++;
    const cur = maxFaseStroom(primaireMeting(k));
    if(cur!=null && k.rating_a) belastingen.push(cur/k.rating_a*100);
  });
  const totaal = belastingen.length ? belastingen.reduce((a,b)=>a+b,0)/belastingen.length : null;
  const piek = belastingen.length ? Math.max(...belastingen) : null;
  return { totaal, piek, alerts: rood+amber, offline, rood, amber, groen };
}

let tickerBerichten = [];
let tickerIndex = 0;

function bouwTickerBerichten(){
  tickerBerichten = state.TOPO.kasten
    .filter(k=>{ const s = statusOf(k); return s==='amber' || s==='red'; })
    .map(k=>{
      const s = statusOf(k);
      const cur = maxFaseStroom(primaireMeting(k));
      const pct = (cur!=null && k.rating_a) ? (cur/k.rating_a*100).toFixed(1)+'%' : '—';
      return { status: s, tekst: genNaam(k.generator) + ' · ' + k.naam + ' — ' + pct };
    });
  if(tickerIndex >= tickerBerichten.length) tickerIndex = 0;
}

// specs/externe-mqtt-ui-plan.md §4: of de bridge-storing nu de pinned melding moet tonen — telt
// ongeacht de site-brede weergavemodus (ook bij "alleen lokaal"/"naast lokaal", waar lokaal
// intussen prima doorwerkt): het is een melding over de externe bron zelf
function externStoringActief(){
  return !!(state.externeMqtt && state.externeMqtt.actief && state.externBridgeVerbonden===false);
}

function toonTickerBericht(){
  const el = document.getElementById('tickerMsg');
  const wrap = document.getElementById('liveTicker');
  const pulse = document.getElementById('tickerPulse');
  const liveLabel = document.getElementById('tickerLiveLabel');
  if(!el) return;
  const storing = externStoringActief();
  if(wrap) wrap.classList.toggle('extern-actief', storing);
  if(pulse) pulse.classList.toggle('extern', storing);
  if(liveLabel) liveLabel.textContent = storing ? t('live.tickerStoring') : t('live.tickerLive');
  if(storing){
    // pinned vooraan zolang de storing duurt — géén rotatie met de gewone rood/amber-berichten,
    // zie bouwTickerBerichten()/initLiveTicker() hieronder. "N kasten" = alle kasten site-breed
    // (niet alleen de nu-geselecteerde weergavemodus), zie de mockup-toelichting.
    const tijd = state.externBridgeVerbrokenSinds ? new Date(state.externBridgeVerbrokenSinds).toLocaleTimeString(huidigeLocale()) : '';
    el.innerHTML = '<div class="ticker-msg-item show"><span class="ticker-tag extern">'+t('live.tickerTagExtern')+'</span>'+t('live.tickerExternStoring', {n: state.TOPO.kasten.length, tijd})+'</div>';
    return;
  }
  if(!tickerBerichten.length){
    el.innerHTML = '<div class="ticker-msg-item show">'+t('live.tickerGeenAlerts')+'</div>';
    return;
  }
  const b = tickerBerichten[tickerIndex % tickerBerichten.length];
  const tagTekst = b.status==='red' ? t('live.tickerTagRood') : t('live.tickerTagAmber');
  el.innerHTML = '<div class="ticker-msg-item show"><span class="ticker-tag '+b.status+'">'+tagTekst+'</span>'+b.tekst+'</div>';
}

// aangeroepen bij elk MQTT-bericht (mqtt.js) én bij elke topologiewijziging (loadTopology) — alleen
// zinvol werk doen als het paneel toch zichtbaar is
export function ververLiveKpi(){
  if(state.mode!=='live') return;
  const kpi = berekenKpis();
  document.getElementById('kpiTotaal').innerHTML = kpi.totaal!=null ? kpi.totaal.toFixed(1)+'<small>%</small>' : '–';
  document.getElementById('kpiPiek').innerHTML = kpi.piek!=null ? kpi.piek.toFixed(1)+'<small>%</small>' : '–';
  document.getElementById('kpiAlerts').textContent = kpi.alerts;
  document.getElementById('kpiOffline').textContent = kpi.offline;
  document.getElementById('tickerRood').textContent = kpi.rood;
  document.getElementById('tickerAmber').textContent = kpi.amber;
  document.getElementById('tickerNormaal').textContent = kpi.groen;
  document.getElementById('tickerOffline').textContent = kpi.offline;
  bouwTickerBerichten();
  toonTickerBericht();
}

// eigen rotatie-interval, los van databijwerkingen — de tekst wisselt ook door zonder nieuw MQTT-
// bericht, zolang er meerdere actieve alerts zijn
export function initLiveTicker(){
  setInterval(()=>{
    if(state.mode!=='live' || externStoringActief() || tickerBerichten.length<2) return;
    tickerIndex = (tickerIndex+1) % tickerBerichten.length;
    toonTickerBericht();
  }, 3200);
}
