import { state, detailEl, liveData, externBlokGesloten } from './state.js';
import { nodeById, isGen, genNaam, typeIcon, maxFaseStroom, statusClass, primaireMeting, primaireEnergie, externIsPrimair, externStatusVoor } from './topology.js';
import { t, huidigeLocale } from './i18n.js';
import { faseSwatch } from './fasekleuren.js';
import { heeftActieveAnomaly, anomalyTekst, bevestigAnomaly } from './anomaly.js';
import { sparklineSvg } from './live-spark.js';
import { toonDetailTab } from './aside-tabs.js';
import { externBadgeHtml, bronVervangenBadgeHtml, geenDataGrootHtml, geenDataCompactHtml, externMetricRijenHtml, externLaatsteKortHtml } from './extern-weergave.js';

// per-lid live rijen onder de bestaande ledenlijst van een groep (naam/kVA/soort blijft
// ongewijzigd). Een lid zonder eigen rating_a heeft
// geen self-meter en toont dus bewust geen stip/waarde (zelfde graceful fallback als generators
// zonder rating_a elders in de app), geen verplichte migratie-actie voor bestaande leden.
// klein "Open Shelly"-icoontje voor in een compacte lid-rij/-cel — zelfde link als kastpopup.js/
// de bredere aside-detail-variant, alleen dan icoon-only i.v.m. de beperkte ruimte per lid
function lidShellyLink(lid){
  if(!lid.shelly_ip) return '';
  return '<a class="lidrow-shelly" href="http://'+lid.shelly_ip+'" target="_blank" rel="noopener" title="'+t('common.openShelly')+' — '+t('common.shellyNetnote')+'">🔗</a>';
}

function ledenblokHtml(gen){
  if(gen.type!=='groep' || !gen.leden || !gen.leden.length) return '';
  const rijen = gen.leden.map(lid=>{
    if(lid.rating_a==null){
      return '<div class="lidrow"><span class="dot2"></span><span class="naam">'+typeIcon(lid)+' '+lid.naam+'</span><span class="val geen-sensor-label">'+t('common.geenSensor')+'</span>'+lidShellyLink(lid)+'</div>';
    }
    const maxFase = maxFaseStroom(liveData[lid.id]);
    const waarde = maxFase!=null ? maxFase.toFixed(2)+' A · '+Math.round(Math.min(999,(maxFase/lid.rating_a)*100))+'%' : '—';
    return '<div class="lidrow"><span class="dot2 '+statusClass(lid)+'"></span><span class="naam">'+typeIcon(lid)+' '+lid.naam+'</span><span class="val">'+waarde+'</span>'+lidShellyLink(lid)+'</div>';
  }).join('');
  return '<div class="ledenblok"><div class="ledenblok-head">'+t('detail.ledenblokHead', {n: gen.leden.length})+'</div>'+rijen+'</div>';
}

// meetdata-blok (fasen, vermogen, belastingsbalk) — gedeeld tussen kasten (rating_a altijd
// verplicht) en generators (rating_a optioneel, alleen gezet als 'm ook echt uitgelezen wordt)
export function metingenHtml(node, d){
  let html = '';
  const maxFase = maxFaseStroom(d);
  if(d && d.total_current!=null) html += '<div class="metric"><span class="k">'+t('detail.totaleStroom')+'</span><span>'+d.total_current.toFixed(2)+' A</span></div>';
  if(d){
    ['a','b','c'].forEach((ph, i)=>{
      if(d[ph+'_current']!=null) html += '<div class="metric"><span class="k">'+faseSwatch(i)+t('detail.fase')+' '+ph.toUpperCase()+'</span><span>'+d[ph+'_current'].toFixed(2)+' A · '+(d[ph+'_voltage']?d[ph+'_voltage'].toFixed(0)+'V':'')+(d[ph+'_freq']!=null?' · '+d[ph+'_freq'].toFixed(1)+'Hz':'')+'</span></div>';
    });
    if(d.total_act_power!=null) html += '<div class="metric"><span class="k">'+t('detail.vermogen')+'</span><span>'+d.total_act_power.toFixed(0)+' W</span></div>';
    html += '<div class="metric"><span class="k">'+t('detail.laatsteUpdate')+'</span><span>'+new Date(d.ts).toLocaleTimeString(huidigeLocale())+'</span></div>';
  }
  if(node.rating_a!=null){
    const pct = maxFase!=null ? Math.min(100, (maxFase/node.rating_a)*100) : 0;
    const cls = pct>=90?'var(--red)':pct>=70?'var(--amber)':'var(--green)';
    html += '<div class="metric"><span class="k">'+t('detail.belastingRating')+'</span><span>'+(maxFase!=null?Math.round(pct)+'%':t('detail.geenData'))+'</span></div>';
    html += '<div class="barwrap"><div class="bar" style="width:'+pct+'%;background:'+cls+'"></div></div>';
  } else if(maxFase!=null){
    html += '<div class="metric"><span class="k">'+t('detail.belasting')+'</span><span>'+t('detail.geenRatingIngesteld')+'</span></div>';
  } else {
    html += '<div class="metric"><span class="k">'+t('detail.belasting')+'</span><span class="geen-sensor-label">'+t('common.geenSensor')+'</span></div>';
  }
  return html;
}

// specs/externe-mqtt-ui-plan.md §1/§2: zelfde in-/uitklapbare Extern-blok als kastpopup.js, hier als
// HTML-string omdat renderDetail() de hele aside in één keer via innerHTML opbouwt — alleen in modus
// "naast lokaal", nooit voor groepen (zie externIsPrimair()/de aanroep in renderDetail hieronder)
function externBlokHtml(nodeId){
  const gesloten = externBlokGesloten.has(nodeId);
  const status = externStatusVoor(nodeId);
  const bodyHtml = status==='ok' ? externMetricRijenHtml(nodeId) : geenDataCompactHtml(nodeId);
  return '<div class="extern-blok'+(gesloten?' dicht':'')+'" id="asideExternBlok">'+
    '<div class="extern-head" id="asideExternHead"><span class="chev">'+(gesloten?'▸':'▾')+'</span>'+externBadgeHtml()+'<span class="laatste2">'+externLaatsteKortHtml(nodeId)+'</span></div>'+
    '<div class="extern-body">'+bodyHtml+'</div>'+
  '</div>';
}

export function renderDetail(){
  const n = nodeById(state.selectedId);
  if(!n){ detailEl.innerHTML = '<div class="empty">'+t('aside.detailLeeg')+'</div>'; return; }
  // specs/live-viewport-grote-monitor-plan.md, fase 1e: een kast/generator selecteren op Live
  // wisselt in portrait-stand automatisch naar de Detail-tab (in landscape zonder effect, zie
  // aside-tabs.js) — alleen op Live, niet op Kalibreren (daar wil je typisch op de lijst blijven
  // om door te gaan met plaatsen) of Schema
  if(state.mode==='live') toonDetailTab();
  // specs/externe-mqtt-ui-plan.md: groepen slaan de externe weergave altijd over (geen eigen enkele
  // externe meting), ongeacht de site-brede modus — zie externIsPrimair() in topology.js
  const externPrimair = externIsPrimair(n);
  const externStatus = externPrimair ? externStatusVoor(n.id) : null;
  const d = primaireMeting(n);
  // specs/optellen-onderliggende-kasten-plan.md: "som onderliggend" i.p.v. "cumulatief" — dat woord
  // betekent hier al iets anders (de "Cumulatieve energie"-rij verderop in metingenHtml())
  const somBadge = n.optellen_onderliggend ? '<span class="som-onderliggend-badge">'+t('common.somOnderliggendBadge')+'</span>' : '';
  let html = '<h2>'+(n.type==='batterij'?'🔋 ':'')+n.naam+(externPrimair?bronVervangenBadgeHtml():somBadge)+'</h2>';
  if(heeftActieveAnomaly(n.id)){
    html += '<div class="metric anomaly-row" id="detailAnomalyRow"><span class="k">⚡ '+t('anomaly.badgeTitel')+'</span></div>'+
      '<div class="anomaly-detail">'+anomalyTekst(n.id)+'</div>';
  }
  if(!isGen(n)){
    html += '<div class="sub">'+(n.type==='batterij'?t('detail.batterijPrefix'):'')+genNaam(n.generator)+' · '+t('detail.ratingSuffix', {rating: n.rating_a})+(n.opmerking?(' · '+n.opmerking):'')+'</div>';
    if(n.type==='batterij' && n.heeft_bypass){
      html += '<div class="metric"><span class="k">Bypass</span><span>'+t('detail.bypassUitleg')+'</span></div>';
    }
    if(externPrimair && externStatus!=='ok') html += geenDataGrootHtml(n.id, state.externBridgeVerbrokenSinds);
    else html += metingenHtml(n, d);
  } else {
    const typeLabel = n.type==='batterij' ? t('detail.typeBatterij') : n.type==='groep' ? t('detail.typeGroep') : t('detail.typeGenerator');
    html += '<div class="sub">'+typeIcon(n)+' '+typeLabel+(n.rating_a!=null?' · '+t('detail.ratingSuffix', {rating: n.rating_a}):'')+'</div>';
    if(n.type==='groep' && n.leden && n.leden.length){
      const soortLabel = n.groep_soort==='parallel' ? t('detail.soortParallel') : n.groep_soort==='backup' ? t('detail.soortBackup') : n.groep_soort==='hybride' ? t('detail.soortHybride') : t('detail.soortOnbekend');
      html += '<div class="metric"><span class="k">'+t('detail.soortKoppeling')+'</span><span>'+soortLabel+'</span></div>';
      html += '<div class="metric"><span class="k">'+t('detail.leden', {n: n.leden.length})+'</span><span>'+n.leden.map(l=>typeIcon(l)+' '+l.naam+(l.vermogen_kva?' ('+l.vermogen_kva+'kVA)':'')).join(', ')+'</span></div>';
    }
    if(externPrimair && externStatus!=='ok') html += geenDataGrootHtml(n.id, state.externBridgeVerbrokenSinds);
    else html += metingenHtml(n, d);
    html += ledenblokHtml(n);
  }
  // specs/externe-mqtt-ui-plan.md §1: alleen in modus "naast lokaal", standaard open zolang de
  // externe bron site-breed actief staat, ná metingenHtml()/ledenblokHtml(), vóór de sparklijn —
  // nooit voor een optellen_onderliggend-node (geen eigen externe koppeling om te tonen)
  if(!externPrimair && !n.optellen_onderliggend && n.type!=='groep' && state.externeMqtt.actief && state.externeMqtt.weergave_modus==='naast_lokaal'){
    html += externBlokHtml(n.id);
  }
  // specs/live-viewport-grote-monitor-plan.md: trendlijn van de laatste minuten, alleen op Live —
  // #detail is gedeeld met Kalibreren (zie topology.js/getSurfaceEl()), dus expliciet op state.mode
  // gaten i.p.v. een aparte "live-detail"-element te bouwen. Puur-client-side buffer (live-spark.js),
  // geen nieuwe databron.
  if(state.mode==='live'){
    const spark = sparklineSvg(n.id, 240, 40);
    html += '<div class="spark-wrap"><div class="spark-label">'+t('live.sparkLabel')+'</div>'+
      (spark || '<div class="spark-leeg">'+t('live.sparkLeeg')+'</div>')+'</div>';
  }
  html += '<div class="metric" style="margin-top:10px"><span class="k">'+t('detail.positie')+'</span><span>'+(n.positie && n.positie.x_pct!=null? n.positie.x_pct.toFixed(1)+'%, '+n.positie.y_pct.toFixed(1)+'%' : t('detail.nogNietGeplaatst'))+'</span></div>';
  if(n.shelly_ip){
    html += '<a class="shellylink" href="http://'+n.shelly_ip+'" target="_blank" rel="noopener" style="margin-top:10px">'+t('common.openShelly')+'</a>';
    html += '<div class="netnote">'+t('common.shellyNetnote')+'</div>';
  }
  detailEl.innerHTML = html;
  const anomalyRow = document.getElementById('detailAnomalyRow');
  if(anomalyRow) anomalyRow.onclick = ()=>{ bevestigAnomaly(n.id); renderDetail(); };
  const externHead = document.getElementById('asideExternHead');
  if(externHead) externHead.onclick = ()=>{
    if(externBlokGesloten.has(n.id)) externBlokGesloten.delete(n.id); else externBlokGesloten.add(n.id);
    renderDetail();
  };
}
