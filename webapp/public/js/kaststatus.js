// ---------- mobiele kast-statuspagina achter de QR-deeplink (?mode=live&kast=<id>) ----------
// Bevinding uit specs/qr-code-plan.md: de volledige Live-modus (vaste 320px-zijlijst, geen
// touch-events, geen @media-laag) is niet bruikbaar op een telefoonscherm. Op een smal scherm
// toont deze deeplink daarom een eigen, lichte statuskaart i.p.v. de volledige Live-modus; op een
// breed scherm (desktop/tablet) blijft het gewoon het bestaande drill-down-gedrag (zie
// overzicht.js: modeLive + selectedId/openPopupKastId).
import { state, liveData } from './state.js';
import { nodeById, statusClass } from './topology.js';
import { renderPins } from './render-pins.js';
import { renderDetail, metingenHtml } from './render-detail.js';
import { renderKastPopup } from './kastpopup.js';
import { t } from './i18n.js';

const NAUW_SCHERM = '(max-width: 700px)';
let actievePaginaKastId = null;

function render(kastId){
  const el = document.getElementById('kastStatusPagina');
  const n = nodeById(kastId);
  if(!n){
    el.innerHTML = '<div class="kaststatus-melding">'+t('kaststatus.nietGevonden')+'</div>';
    return;
  }
  const d = liveData[n.id];
  const dotCls = statusClass(n);
  let html = '<div class="kaststatus-head">⚡ Stroom-Dashboard</div>';
  html += '<div class="kaststatus-card">';
  html += '<div class="kaststatus-top"><div class="kaststatus-bigdot '+dotCls+'"></div><div><div class="kaststatus-nm">'+n.naam+'</div>'+(n.afkorting?'<div class="kaststatus-afk">'+n.afkorting+'</div>':'')+'</div></div>';
  html += metingenHtml(n, d);
  if(n.shelly_ip){
    html += '<a class="shellylink" href="http://'+n.shelly_ip+'" target="_blank" rel="noopener" style="text-align:center;display:block;margin-top:12px">'+t('common.openShelly')+'</a>';
    html += '<div class="netnote" style="text-align:center">'+t('common.shellyNetnote')+'</div>';
  }
  html += '</div>';
  html += '<a class="maplink" href="#" id="kaststatusMaplink">'+t('kaststatus.bekijkOpPlattegrond')+'</a>';
  el.innerHTML = html;
  document.getElementById('kaststatusMaplink').onclick = (e)=>{ e.preventDefault(); toonVolledigeLive(kastId); };
}

function toonVolledigeLive(kastId){
  actievePaginaKastId = null;
  document.getElementById('kastStatusPagina').style.display = 'none';
  document.querySelector('.app').style.display = '';
  document.getElementById('modeLive').click();
  state.selectedId = kastId; state.openPopupKastId = kastId;
  renderPins(); renderDetail(); renderKastPopup();
}

// aangeroepen vanuit mqtt.js zodra er nieuwe data binnenkomt, zodat de kaart live meebeweegt
// zonder eigen polling-interval
export function ververKastStatusPagina(){
  if(actievePaginaKastId) render(actievePaginaKastId);
}

export function initKastStatusRoute(){
  const params = new URLSearchParams(location.search);
  if(params.get('mode') !== 'live' || !params.get('kast')) return;
  const kastId = params.get('kast');
  const smal = window.matchMedia(NAUW_SCHERM).matches;
  if(!smal){
    toonVolledigeLive(kastId);
    return;
  }
  actievePaginaKastId = kastId;
  document.querySelector('.app').style.display = 'none';
  document.getElementById('kastStatusPagina').style.display = 'block';
  render(kastId);
  // automatisch verbinden: de kast-statuspagina heeft geen eigen "Verbind"-knop (dat hoort bij de
  // verborgen .app-header), dus hergebruikt de bestaande MQTT-connect-flow programmatisch met het
  // hostname-/poort-standaard-gedrag dat modes.js ook al voor de gewone Live-modus toepast
  const hostInput = document.getElementById('brokerHost');
  const portInput = document.getElementById('brokerPort');
  hostInput.value = hostInput.value || location.hostname || 'localhost';
  portInput.value = portInput.value || '9001';
  document.getElementById('connectBtn').click();
}
