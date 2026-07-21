import { state, detailEl, liveData } from './state.js';
import { nodeById, isGen, genNaam, typeIcon, maxFaseStroom, statusClass } from './topology.js';
import { t, huidigeLocale } from './i18n.js';
import { faseSwatch } from './fasekleuren.js';

// per-lid live rijen onder de bestaande ledenlijst van een groep (naam/kVA/soort blijft
// ongewijzigd) — zie specs/generator-em-rework-plan.md §2. Een lid zonder eigen rating_a heeft
// geen self-meter en toont dus bewust geen stip/waarde (zelfde graceful fallback als generators
// zonder rating_a elders in de app), geen verplichte migratie-actie voor bestaande leden.
function ledenblokHtml(gen){
  if(gen.type!=='groep' || !gen.leden || !gen.leden.length) return '';
  const rijen = gen.leden.map(lid=>{
    if(lid.rating_a==null){
      return '<div class="lidrow"><span class="dot2"></span><span class="naam">'+typeIcon(lid)+' '+lid.naam+'</span><span class="val">—</span></div>';
    }
    const maxFase = maxFaseStroom(liveData[lid.id]);
    const waarde = maxFase!=null ? maxFase.toFixed(2)+' A · '+Math.round(Math.min(999,(maxFase/lid.rating_a)*100))+'%' : '—';
    return '<div class="lidrow"><span class="dot2 '+statusClass(lid)+'"></span><span class="naam">'+typeIcon(lid)+' '+lid.naam+'</span><span class="val">'+waarde+'</span></div>';
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
      if(d[ph+'_current']!=null) html += '<div class="metric"><span class="k">'+faseSwatch(i)+t('detail.fase')+' '+ph.toUpperCase()+'</span><span>'+d[ph+'_current'].toFixed(2)+' A · '+(d[ph+'_voltage']?d[ph+'_voltage'].toFixed(0)+'V':'')+'</span></div>';
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
  }
  return html;
}

export function renderDetail(){
  const n = nodeById(state.selectedId);
  if(!n){ detailEl.innerHTML = '<div class="empty">'+t('aside.detailLeeg')+'</div>'; return; }
  const d = liveData[n.id];
  let html = '<h2>'+(n.type==='batterij'?'🔋 ':'')+n.naam+'</h2>';
  if(!isGen(n)){
    html += '<div class="sub">'+(n.type==='batterij'?t('detail.batterijPrefix'):'')+genNaam(n.generator)+' · '+t('detail.ratingSuffix', {rating: n.rating_a})+(n.opmerking?(' · '+n.opmerking):'')+'</div>';
    if(n.type==='batterij' && n.heeft_bypass){
      html += '<div class="metric"><span class="k">Bypass</span><span>'+t('detail.bypassUitleg')+'</span></div>';
    }
    html += metingenHtml(n, d);
  } else {
    const typeLabel = n.type==='batterij' ? t('detail.typeBatterij') : n.type==='groep' ? t('detail.typeGroep') : t('detail.typeGenerator');
    html += '<div class="sub">'+typeIcon(n)+' '+typeLabel+(n.rating_a!=null?' · '+t('detail.ratingSuffix', {rating: n.rating_a}):'')+'</div>';
    if(n.type==='groep' && n.leden && n.leden.length){
      const soortLabel = n.groep_soort==='parallel' ? t('detail.soortParallel') : n.groep_soort==='backup' ? t('detail.soortBackup') : n.groep_soort==='hybride' ? t('detail.soortHybride') : t('detail.soortOnbekend');
      html += '<div class="metric"><span class="k">'+t('detail.soortKoppeling')+'</span><span>'+soortLabel+'</span></div>';
      html += '<div class="metric"><span class="k">'+t('detail.leden', {n: n.leden.length})+'</span><span>'+n.leden.map(l=>typeIcon(l)+' '+l.naam+(l.vermogen_kva?' ('+l.vermogen_kva+'kVA)':'')).join(', ')+'</span></div>';
    }
    html += metingenHtml(n, d);
    html += ledenblokHtml(n);
  }
  html += '<div class="metric" style="margin-top:10px"><span class="k">'+t('detail.positie')+'</span><span>'+(n.positie && n.positie.x_pct!=null? n.positie.x_pct.toFixed(1)+'%, '+n.positie.y_pct.toFixed(1)+'%' : t('detail.nogNietGeplaatst'))+'</span></div>';
  detailEl.innerHTML = html;
}
