// ---------- login-gate (specs/toegang-van-buitenaf-diagnose.md) ----------
// Blokkeert de hele app (inclusief de QR-deeplink-flow in kaststatus.js, die dezelfde index.html/
// boot-volgorde deelt — geen apart achterdeurtje) tot er een geldige sessie is. Geen los
// login.html-bestand: dezelfde pagina, alleen de overlay zichtbaar terwijl `.app` verborgen blijft
// (zelfde aanpak als kaststatus.js voor de mobiele kaststatuspagina).
import { apiCall } from './api.js';
import { t } from './i18n.js';
import { state } from './state.js';

function verbergAlles(){
  document.querySelector('.app').style.display = 'none';
  document.getElementById('kastStatusPagina').style.display = 'none';
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('wachtwoordWijzigenOverlay').style.display = 'none';
}

function toonOverlay(foutmelding){
  verbergAlles();
  document.getElementById('loginOverlay').style.display = 'flex';
  const errEl = document.getElementById('loginErr');
  errEl.textContent = foutmelding || '';
  errEl.classList.toggle('show', !!foutmelding);
}

// specs/eerste-admin-standaardwachtwoord-plan.md: verplichte stap voor een account met
// moet_wachtwoord_wijzigen (het admin/admin-bootstrap-account) — blokkeert de rest van de app net
// als toonOverlay() dat doet voor "niet ingelogd", maar dan met het wijzigingsformulier i.p.v. het
// loginformulier. Server-side afgedwongen (auth-gate in server.js), dit scherm is dus niet zomaar
// te omzeilen door de overlay in devtools te verbergen.
function toonWachtwoordWijzigenOverlay(foutmelding){
  verbergAlles();
  document.getElementById('wachtwoordWijzigenOverlay').style.display = 'flex';
  const errEl = document.getElementById('wachtwoordWijzigenErr');
  errEl.textContent = foutmelding || '';
  errEl.classList.toggle('show', !!foutmelding);
}

document.getElementById('loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const naam = document.getElementById('loginNaam').value;
  const wachtwoord = document.getElementById('loginWachtwoord').value;
  try{
    const res = await apiCall('/api/login', 'POST', { naam, wachtwoord });
    if(res.moet_wachtwoord_wijzigen){ toonWachtwoordWijzigenOverlay(); return; }
    location.reload();
  }catch(err){
    toonOverlay(err.message);
  }
});

document.getElementById('wachtwoordWijzigenForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const nieuw = document.getElementById('wwNieuw').value;
  const herhaal = document.getElementById('wwHerhaal').value;
  if(nieuw !== herhaal){
    toonWachtwoordWijzigenOverlay(t('login.wachtwoordenOngelijk'));
    return;
  }
  try{
    await apiCall('/api/wachtwoord-wijzigen', 'POST', { wachtwoord: nieuw });
    location.reload();
  }catch(err){
    toonWachtwoordWijzigenOverlay(err.message);
  }
});

document.getElementById('logoutBtn').addEventListener('click', async ()=>{
  try{ await apiCall('/api/logout', 'POST'); }catch(e){}
  location.reload();
});

// aangeroepen vanuit main.js vóórdat enige andere API-aanroep gebeurt — geeft true terug als er een
// geldige sessie is (de rest van de app mag opstarten), anders wordt de login- of
// wachtwoord-wijzigen-overlay getoond en false teruggegeven (dekt ook het "pagina ververst tijdens
// de verplichte-wijziging-stap"-scenario, want /api/session geeft moet_wachtwoord_wijzigen net als
// /api/login terug).
export async function controleerSessie(){
  try{
    const account = await apiCall('/api/session', 'GET');
    if(account.moet_wachtwoord_wijzigen){ toonWachtwoordWijzigenOverlay(); return false; }
    document.getElementById('sessieNaam').textContent = account.naam;
    state.rol = account.rol || 'editor';
    verbergEditorOnlyTabsVoorViewer();
    return true;
  }catch(e){
    toonOverlay();
    return false;
  }
}

// specs/rolverdeling-plan.md: Beheer/Kalibreren/Testdata verdwijnen volledig uit de mode-switch
// voor een viewer (i.p.v. grijs-met-uitleg) — puur cosmetisch/vroeg, geen data-afhankelijkheid, dus
// hier meteen na het bepalen van de rol al veilig te doen (het daadwerkelijk wegklikken van Beheer
// als standaard-actieve tab gebeurt apart in main.js, ná loadTopology(), zie de toelichting daar).
// De server-side gate (auth-gate in server.js, isEditorOnlyRoute()) is de échte afdwinging — dit is
// alleen UI-opschoning, geen beveiliging op zich.
function verbergEditorOnlyTabsVoorViewer(){
  if(state.rol === 'editor') return;
  ['modeBeheer','modeCal','modeTest'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.style.display = 'none';
  });
}
