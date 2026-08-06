// ---------- login-gate (specs/toegang-van-buitenaf-diagnose.md) ----------
// Blokkeert de hele app (inclusief de QR-deeplink-flow in kaststatus.js, die dezelfde index.html/
// boot-volgorde deelt — geen apart achterdeurtje) tot er een geldige sessie is. Geen los
// login.html-bestand: dezelfde pagina, alleen de overlay zichtbaar terwijl `.app` verborgen blijft
// (zelfde aanpak als kaststatus.js voor de mobiele kaststatuspagina).
import { apiCall } from './api.js';
import { t } from './i18n.js';

function toonOverlay(foutmelding){
  document.querySelector('.app').style.display = 'none';
  document.getElementById('kastStatusPagina').style.display = 'none';
  document.getElementById('loginOverlay').style.display = 'flex';
  const errEl = document.getElementById('loginErr');
  errEl.textContent = foutmelding || '';
  errEl.classList.toggle('show', !!foutmelding);
}

document.getElementById('loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const naam = document.getElementById('loginNaam').value;
  const wachtwoord = document.getElementById('loginWachtwoord').value;
  try{
    await apiCall('/api/login', 'POST', { naam, wachtwoord });
    location.reload();
  }catch(err){
    toonOverlay(err.message);
  }
});

document.getElementById('logoutBtn').addEventListener('click', async ()=>{
  try{ await apiCall('/api/logout', 'POST'); }catch(e){}
  location.reload();
});

// aangeroepen vanuit main.js vóórdat enige andere API-aanroep gebeurt — geeft true terug als er een
// geldige sessie is (de rest van de app mag opstarten), anders wordt de login-overlay getoond en
// false teruggegeven.
export async function controleerSessie(){
  try{
    const account = await apiCall('/api/session', 'GET');
    document.getElementById('sessieNaam').textContent = account.naam;
    return true;
  }catch(e){
    toonOverlay();
    return false;
  }
}
