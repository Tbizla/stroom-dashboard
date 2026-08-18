// ---------- specs/externe-mqtt-ui-plan.md: gedeelde HTML-bouwstenen voor de "Extern"-weergave,
// gebruikt door zowel kastpopup.js (plattegrond) als render-detail.js (aside-detail) — beide tonen
// exact dezelfde badge/reden-tekst/kleur, dus hier één keer gebouwd i.p.v. in beide bestanden
// gedupliceerd. ----------
import { liveDataExtern } from './state.js';
import { externStatusVoor } from './topology.js';
import { t, huidigeLocale } from './i18n.js';
import { faseSwatch } from './fasekleuren.js';

function fmtVeld(v, eenheid, decimals){
  if(v==null) return '—';
  const d = decimals==null ? 2 : decimals;
  return v.toFixed(d) + (eenheid ? ' '+eenheid : '');
}

// reden-stip-kleur + -tekst voor een niet-'ok' externStatusVoor()-uitkomst
function redenVoor(status, d){
  if(status==='verbroken') return { kleur:'rood', tekst: t('common.externRedenVerbroken') };
  if(status==='verouderd'){
    const minGeleden = Math.max(1, Math.round((Date.now()-d.ts)/60000));
    return { kleur:'amber', tekst: t('common.externRedenVerouderd', {n: minGeleden}) };
  }
  return { kleur:'grijs', tekst: t('common.externRedenWacht') };
}

export function externBadgeHtml(){ return '<span class="extern-badge">'+t('common.extern')+'</span>'; }
export function bronVervangenBadgeHtml(){ return '<span class="bron-vervangen-badge">'+t('common.extern')+'</span>'; }

// compacte variant, binnen het Extern-blok (modus "naast lokaal")
export function geenDataCompactHtml(kastId){
  const status = externStatusVoor(kastId);
  const { kleur, tekst } = redenVoor(status, liveDataExtern[kastId]);
  return '<div class="geen-data-compact"><div class="titel">'+t('common.geenDataTitel')+'</div>'+
    '<div class="reden"><span class="reden-stip '+kleur+'"></span>'+tekst+'</div></div>';
}

// grote/centrale variant, als enige inhoud (modus "extern vervangt lokaal") — sindsTs = optioneel
// tijdstip (ms) waarop de storing begon, alleen bekend bij reden 'verbroken' (zie mqtt.js)
export function geenDataGrootHtml(kastId, sindsTs){
  const status = externStatusVoor(kastId);
  const { tekst } = redenVoor(status, liveDataExtern[kastId]);
  const sinds = sindsTs ? '<div class="sinds">'+t('common.externSinds', {tijd: new Date(sindsTs).toLocaleTimeString(huidigeLocale())})+'</div>' : '';
  return '<div class="geen-data-groot"><div class="icoon">⚠</div><div class="titel">'+t('common.geenDataTitel')+'</div>'+
    '<div class="reden">'+tekst+'</div>'+sinds+'</div>';
}

// fase-tabel (A/B/C, stroom+spanning) + totale-stroom-regel voor de externe meting van kastId —
// 1-op-1 dezelfde kolommen als de lokale kastpopup-tabel, hier alleen voor het Extern-blok
export function externTabelHtml(kastId){
  const d = liveDataExtern[kastId];
  if(!d) return geenDataCompactHtml(kastId);
  return '<table>'+
      '<tr><th></th><th>'+faseSwatch(0)+'A</th><th>'+faseSwatch(1)+'B</th><th>'+faseSwatch(2)+'C</th></tr>'+
      '<tr><td>'+t('kastpopup.stroom')+'</td><td>'+fmtVeld(d.a_current,'A')+'</td><td>'+fmtVeld(d.b_current,'A')+'</td><td>'+fmtVeld(d.c_current,'A')+'</td></tr>'+
      '<tr><td>'+t('kastpopup.spanning')+'</td><td>'+fmtVeld(d.a_voltage,'V',0)+'</td><td>'+fmtVeld(d.b_voltage,'V',0)+'</td><td>'+fmtVeld(d.c_voltage,'V',0)+'</td></tr>'+
    '</table>'+
    '<div class="kprow"><span class="k">'+t('kastpopup.totaleStroom')+'</span><span>'+fmtVeld(d.total_current,'A')+'</span></div>';
}

// per-fase .metric-rijen voor de externe meting van kastId — zelfde opbouw als render-detail.js se
// metingenHtml(), voor het Extern-blok in de aside-detail
export function externMetricRijenHtml(kastId){
  const d = liveDataExtern[kastId];
  if(!d) return geenDataCompactHtml(kastId);
  let html = '';
  if(d.total_current!=null) html += '<div class="metric"><span class="k">'+t('detail.totaleStroom')+'</span><span>'+d.total_current.toFixed(2)+' A</span></div>';
  ['a','b','c'].forEach((ph, i)=>{
    if(d[ph+'_current']!=null) html += '<div class="metric"><span class="k">'+faseSwatch(i)+t('detail.fase')+' '+ph.toUpperCase()+'</span><span>'+d[ph+'_current'].toFixed(2)+' A · '+(d[ph+'_voltage']?d[ph+'_voltage'].toFixed(0)+'V':'')+'</span></div>';
  });
  return html;
}

// het korte "laatste update"-tekstje rechts in de extern-head, of "wacht op data…" als er nog geen
// bericht is voor deze kast (ongeacht of dat door 'wacht'/'verouderd'/'verbroken' komt — het
// uitgeklapte lichaam eronder toont de precieze reden, zie geenDataCompactHtml hierboven)
export function externLaatsteKortHtml(kastId){
  const d = liveDataExtern[kastId];
  return d ? t('common.secondenGeleden', {n: Math.max(0, Math.round((Date.now()-d.ts)/1000))}) : t('common.externWachtKort');
}
