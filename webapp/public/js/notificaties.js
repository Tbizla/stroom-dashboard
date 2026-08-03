// ---------- Alert-notificaties (Beheer-tab) — kanaal waarop de bestaande Grafana-alert-condities
// (90%-belastingsdrempel) een bericht sturen. Zelfde opslag-in-instellingen.json-patroon als
// instellingen.js, maar zonder de telegraf-herstart-job (Grafana-provisioning gebeurt synchroon
// binnen de PUT-request, geen container-recreate nodig) ----------
import { apiCall } from './api.js';
import { t } from './i18n.js';

const KANALEN = ['telegram', 'pushover', 'ntfy', 'email'];
// welk veld per kanaal een geheim is — de server stuurt de waarde nooit terug (zie
// specs/secrets-afscherming-plan.md), dus deze velden worden nooit uit GET /api/instellingen
// gevuld, alleen een "<veld>_ingesteld"-boolean. Zelfde mapping als NOTIFICATIE_GEHEIM_VELD_PER_KANAAL
// in server.js.
const GEHEIM_VELD_PER_KANAAL = { telegram: 'bot_token', pushover: 'api_token', email: 'smtp_wachtwoord' };
// bijgehouden binnen deze pagina-sessie: welke geheime velden de gebruiker expliciet gewist heeft
// via de "Wissen"-link (zie huidigeKanaalConfig) — een leeg gelaten veld zonder wis-actie betekent
// "ongewijzigd laten", niet "verwijderen"
const gewisteVelden = new Set();

function veldenVoorKanaal(kanaal){
  if(kanaal==='telegram') return { bot_token: 'notifTelegramBotToken', chat_id: 'notifTelegramChatId' };
  if(kanaal==='pushover') return { user_key: 'notifPushoverUserKey', api_token: 'notifPushoverApiToken' };
  if(kanaal==='ntfy') return { topic: 'notifNtfyTopic', server_url: 'notifNtfyServer' };
  return { ontvangers: 'notifEmailOntvangers', smtp_host: 'notifEmailSmtpHost', smtp_poort: 'notifEmailSmtpPoort', smtp_gebruiker: 'notifEmailSmtpGebruiker', smtp_wachtwoord: 'notifEmailSmtpWachtwoord' };
}
function kanaalNaam(kanaal){ return kanaal.charAt(0).toUpperCase() + kanaal.slice(1); }

function huidigeKanaalConfig(kanaal){
  const velden = veldenVoorKanaal(kanaal);
  const cfg = { aan: document.getElementById('notif' + kanaalNaam(kanaal) + 'Toggle').classList.contains('on') };
  const geheimVeld = GEHEIM_VELD_PER_KANAAL[kanaal];
  Object.entries(velden).forEach(([key, id])=>{
    const waarde = document.getElementById(id).value.trim();
    if(key === geheimVeld){
      if(waarde) cfg[key] = waarde; // nieuwe waarde ingetypt -> overschrijven
      else if(gewisteVelden.has(kanaal+'.'+key)) cfg[key] = null; // expliciet gewist
      // anders: veld weglaten -> server laat de bestaande waarde ongewijzigd (saniteerGeheimVeld)
      return;
    }
    cfg[key] = waarde;
  });
  return cfg;
}

function vulKanaalConfig(kanaal, cfg){
  const velden = veldenVoorKanaal(kanaal);
  const toggle = document.getElementById('notif' + kanaalNaam(kanaal) + 'Toggle');
  const card = document.getElementById('notif' + kanaalNaam(kanaal) + 'Card');
  toggle.classList.toggle('on', !!(cfg && cfg.aan));
  card.classList.toggle('off', !(cfg && cfg.aan));
  const geheimVeld = GEHEIM_VELD_PER_KANAAL[kanaal];
  Object.entries(velden).forEach(([key, id])=>{
    const el = document.getElementById(id);
    if(key === geheimVeld){
      const ingesteld = !!(cfg && cfg[key + '_ingesteld']);
      el.value = '';
      el.placeholder = ingesteld ? t('beheer.notifGeheimIngesteld') : t('beheer.notifGeheimNietIngesteld');
      el.closest('.secretfield').classList.toggle('heeft-waarde', ingesteld);
      gewisteVelden.delete(kanaal+'.'+key);
      return;
    }
    // lege string niet overschrijven: anders wist een nog-nooit-opgeslagen kanaal (default '' uit
    // instellingen.json) bij elke pageload de HTML-eigen default (bijv. SMTP-poort 587)
    if(cfg && cfg[key]!=null && cfg[key]!=='') el.value = cfg[key];
  });
}

function toonTestResultaat(kanaal, ok, foutmelding){
  const dot = document.getElementById('notif' + kanaalNaam(kanaal) + 'Dot');
  const statusText = document.getElementById('notif' + kanaalNaam(kanaal) + 'StatusText');
  const result = document.getElementById('notif' + kanaalNaam(kanaal) + 'TestResult');
  dot.className = 'dot ' + (ok ? 'ok' : 'err');
  statusText.textContent = ok ? t('beheer.notifTestGeslaagd') : t('beheer.notifTestMislukt', {fout: foutmelding});
  result.className = 'testresult ' + (ok ? 'ok' : 'err');
  result.textContent = ok ? t('beheer.notifTestGeslaagd') : t('beheer.notifTestMislukt', {fout: foutmelding});
}

KANALEN.forEach(kanaal=>{
  const naam = kanaalNaam(kanaal);
  document.getElementById('notif' + naam + 'Toggle').onclick = (e)=>{
    e.currentTarget.classList.toggle('on');
    document.getElementById('notif' + naam + 'Card').classList.toggle('off', !e.currentTarget.classList.contains('on'));
  };
  document.getElementById('notif' + naam + 'TestBtn').onclick = async ()=>{
    const resultEl = document.getElementById('notif' + naam + 'TestResult');
    resultEl.className = 'testresult';
    resultEl.textContent = t('beheer.instellingenBezig');
    try{
      await apiCall('/api/instellingen/notificaties/test/' + kanaal, 'POST', huidigeKanaalConfig(kanaal));
      toonTestResultaat(kanaal, true);
    }catch(e){
      toonTestResultaat(kanaal, false, e.message);
    }
  };
});

// "Wissen"-link per geheim veld: markeert het veld als expliciet te wissen (zie gewisteVelden) en
// toont meteen de "niet ingesteld"-placeholder, ongeacht wat er nu in het invoerveld staat
Object.entries(GEHEIM_VELD_PER_KANAAL).forEach(([kanaal, veld])=>{
  const id = veldenVoorKanaal(kanaal)[veld];
  const wisLink = document.getElementById(id + 'Wis');
  wisLink.onclick = ()=>{
    gewisteVelden.add(kanaal+'.'+veld);
    const el = document.getElementById(id);
    el.value = '';
    el.placeholder = t('beheer.notifGeheimNietIngesteld');
    el.closest('.secretfield').classList.remove('heeft-waarde');
  };
});

document.getElementById('notifOpslaanBtn').onclick = async ()=>{
  ['notifResultCard','notifErrorCard'].forEach(id=>document.getElementById(id).style.display='none');
  const notificaties = {};
  KANALEN.forEach(kanaal=>{ notificaties[kanaal] = huidigeKanaalConfig(kanaal); });
  try{
    const res = await apiCall('/api/instellingen/notificaties', 'PUT', notificaties);
    document.getElementById('notifResultInfo').textContent = res.grafanaFout
      ? t('beheer.notifOpgeslagenGrafanaFout', {fout: res.grafanaFout})
      : t('beheer.notifOpgeslagen');
    document.getElementById('notifResultCard').style.display = 'flex';
    // na opslaan opnieuw inladen: geheime velden tonen weer de correcte "ingesteld"-placeholder
    // (incl. net gewiste/nieuw gezette velden) i.p.v. de invoerwaarde te laten staan
    initNotificaties();
  }catch(e){
    document.getElementById('notifErrorInfo').textContent = e.message;
    document.getElementById('notifErrorCard').style.display = 'flex';
  }
};

export async function initNotificaties(){
  try{
    const data = await apiCall('/api/instellingen', 'GET');
    const notificaties = data.notificaties || {};
    KANALEN.forEach(kanaal=>vulKanaalConfig(kanaal, notificaties[kanaal]));
  }catch(e){ /* lege velden zijn prima, gewoon opnieuw invullen */ }
}
