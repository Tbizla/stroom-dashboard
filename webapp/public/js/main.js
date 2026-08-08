// entrypoint: importeert alle modules (hun top-level code wiret de DOM-event-listeners aan) en
// start tot slot de eerste databelading.
import './i18n.js';
import { state } from './state.js';
import { loadTopology, loadMap, loadLogo } from './topology.js';
import './zoom.js';
import './render-list.js';
import './render-detail.js';
import './render-pins.js';
import './kastpopup.js';
import './render-schema.js';
import './render-beheer.js';
import { initRapport } from './rapport.js';
import { initBackup } from './backup.js';
import { initAutomatischeBackup } from './automatische-backup.js';
import { initInstellingen } from './instellingen.js';
import { initNotificaties } from './notificaties.js';
import { initAccounts } from './accounts.js';
import { ververOverzichtLiveWeergave } from './overzicht.js';
import './grafieken.js';
import './mqtt.js';
import { refreshSimStatusIfTest } from './modes.js';
import { renderPins } from './render-pins.js';
import { t } from './i18n.js';
import { initQrCodes } from './qrcodes.js';
import { initKastStatusRoute } from './kaststatus.js';
import { initAnomalyOpruiming } from './anomaly.js';
import { renderDetail } from './render-detail.js';
import { renderList } from './render-list.js';
import { controleerSessie } from './auth.js';

// ---------- plattegrond uploaden ----------
document.getElementById('mapFile').onchange = async (ev)=>{
  const file = ev.target.files[0];
  if(!file) return;
  const fd = new FormData();
  fd.append('kaart', file);
  const errEl = document.getElementById('mapUploadErr');
  errEl.style.display = 'none';
  const res = await fetch('/api/map', { method:'POST', body: fd });
  if(!res.ok){
    const body = await res.json().catch(()=>({}));
    errEl.textContent = body.error || t('main.uploadMislukt');
    errEl.style.display = 'inline';
    ev.target.value = '';
    return;
  }
  loadMap();
};

document.getElementById('logoFile').onchange = async (ev)=>{
  const file = ev.target.files[0];
  if(!file) return;
  const fd = new FormData();
  fd.append('logo', file);
  const status = document.getElementById('logoStatus');
  status.textContent = t('beheer.logoUploading');
  status.style.color = 'var(--text2)';
  const res = await fetch('/api/logo', { method:'POST', body: fd });
  if(!res.ok){
    const body = await res.json().catch(()=>({}));
    status.textContent = body.error || t('main.uploadMislukt');
    status.style.color = 'var(--red)';
    ev.target.value = '';
    return;
  }
  loadLogo();
  status.textContent = t('beheer.logoGeupload');
};

// ---------- export / import ----------
document.getElementById('exportBtn').onclick = ()=>{ window.location.href = '/api/export'; };
document.getElementById('importFile').onchange = (ev)=>{
  const file = ev.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async ()=>{
    try{
      const data = JSON.parse(reader.result);
      await fetch('/api/import', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      await loadTopology(); renderPins();
    }catch(e){ alert(t('main.alertImportFout', {fout: e.message})); }
  };
  reader.readAsText(file);
};

// ---------- fullscreen-knop ----------
// specs/vervolgticket-fullscreen-knop.md: hele pagina, niet per tabblad-mode, dus hoort hier bij de
// andere kale, mode-onafhankelijke header-knoppen i.p.v. bij auth/i18n
const fullscreenBtn = document.getElementById('fullscreenBtn');
function ververFullscreenKnop(){
  fullscreenBtn.title = document.fullscreenElement ? t('header.volledigSchermVerlaten') : t('header.volledigScherm');
}
fullscreenBtn.onclick = ()=>{
  if(document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
};
document.addEventListener('fullscreenchange', ververFullscreenKnop);
ververFullscreenKnop();

// alles hieronder raakt de (nu login-gegate) /api/*-laag — pas starten zodra er een geldige
// sessie is, anders krijgt een uitgelogde bezoeker een scherm vol 401-fouten onder de login-overlay
// i.p.v. gewoon de overlay zelf (zie auth.js). De addEventListener-registraties hierboven (upload/
// export/import) zijn zelf harmless zonder sessie — ze doen pas iets bij een klik, en de overlay
// dekt het hele scherm af tot je bent ingelogd.
async function bootstrapApp(){
  initRapport();
  initBackup();
  initAutomatischeBackup();
  initInstellingen();
  initNotificaties();
  initAccounts();
  initQrCodes();
  initAnomalyOpruiming(()=>{
    renderList(); renderPins();
    if(state.selectedId) renderDetail();
    ververOverzichtLiveWeergave();
  });

  // ---------- elke paar seconden topologie herladen, zodat kalibratie door een ander direct zichtbaar is ----------
  // niet op het Beheer-tabblad: daar ben je zelf de enige die bewerkt, en een tussentijdse herbouw van de
  // tabellen verstoort dan alleen het snel achter elkaar invoeren van velden (focus/cursor/onopgeslagen tekst)
  setInterval(async ()=>{
    if(state.mode==='beheer') return;
    const prevSelected = state.selectedId;
    await loadTopology();
    state.selectedId = prevSelected;
    renderPins();
    refreshSimStatusIfTest();
    ververOverzichtLiveWeergave();
  }, 5000);

  loadTopology().then(()=>{
    loadMap();
    // een "Kopieer link"-URL van het Grafieken-tabblad (?mode=grafieken&...) opent dat tabblad
    // automatisch — geen algemene router, alleen deze ene deeplink (zie grafieken.js
    // herstelVanUrl()); pas ná loadTopology() zodat de checklist niet leeg begint
    if(new URLSearchParams(location.search).get('mode') === 'grafieken') document.getElementById('modeGrafieken').click();
    // specs/rolverdeling-plan.md: Beheer (de statische default-actieve tab) is voor een viewer
    // verborgen — zonder deze wissel zou een viewer op een leeg/onbereikbaar tabblad landen. Alleen
    // als er geen andere deeplink (hierboven) al een tab koos, en pas ná loadTopology() zodat
    // renderSchema() niet op nog-lege topologiedata draait.
    else if(state.rol === 'viewer') document.getElementById('modeSchema').click();
    // QR-code-deeplink (?mode=live&kast=<id>) — zie kaststatus.js: smal scherm krijgt de lichte
    // mobiele statuspagina, breed scherm het bestaande drill-down-gedrag naar Live-modus
    initKastStatusRoute();
  });
  loadLogo();
  // het Testdata-tabblad (en de bijbehorende endpoints) bestaat alleen als de stack met
  // --profile test + TEST_MODE=true gestart is; anders geven die endpoints toch 404, dus verberg 'm
  fetch('/api/test-mode').then(r=>r.json()).then(d=>{
    if(!d.testMode) document.getElementById('modeTest').style.display = 'none';
  }).catch(()=>{});
}

controleerSessie().then((ok)=>{ if(ok) bootstrapApp(); });
