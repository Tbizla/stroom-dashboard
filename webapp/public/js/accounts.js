// ---------- Accounts-beheer (specs/toegang-van-buitenaf-diagnose.md) — Beheer-tab ----------
// Losse accounts per persoon, geen gedeeld wachtwoord. Aanmaken/resetten toont het gegenereerde
// wachtwoord eenmalig (server geeft het maar één keer terug, zie server.js), geen e-mail-verzending.
import { apiCall } from './api.js';
import { t, huidigeLocale } from './i18n.js';

function fmtLaatstIngelogd(iso){
  return iso ? new Date(iso).toLocaleString(huidigeLocale()) : t('beheer.accountNooitIngelogd');
}

function toonWachtwoord(naam, wachtwoord){
  document.getElementById('accountWachtwoordLbl').textContent = t('beheer.accountAangemaakt', { naam });
  document.getElementById('accountWachtwoordWaarde').textContent = wachtwoord;
  document.getElementById('accountWachtwoordCard').style.display = 'block';
}

async function renderAccountsTabel(){
  const tabel = document.getElementById('accountsTable');
  let accounts;
  try{ accounts = await apiCall('/api/accounts', 'GET'); }catch(e){ return; }
  const perId = new Map(accounts.map(a=>[a.id, a]));
  tabel.innerHTML = '<tr><th>'+t('beheer.accountNaam')+'</th><th>'+t('beheer.accountEmail')+'</th><th>'+t('beheer.accountLaatstIngelogd')+'</th><th></th></tr>' +
    accounts.map(a=>
      '<tr>'+
      '<td>'+a.naam+'</td>'+
      '<td class="dim">'+(a.email || '—')+'</td>'+
      '<td class="dim">'+fmtLaatstIngelogd(a.laatst_ingelogd)+'</td>'+
      '<td><button data-reset="'+a.id+'">'+t('beheer.accountWachtwoordResetten')+'</button> <button class="danger" data-verwijder="'+a.id+'">'+t('common.verwijderen')+'</button></td>'+
      '</tr>'
    ).join('');
  tabel.querySelectorAll('[data-reset]').forEach(btn=>{
    btn.onclick = async ()=>{
      try{
        const { wachtwoord } = await apiCall('/api/accounts/'+btn.dataset.reset+'/reset-wachtwoord', 'POST');
        toonWachtwoord(perId.get(btn.dataset.reset).naam, wachtwoord);
      }catch(e){ alert(e.message); }
    };
  });
  tabel.querySelectorAll('[data-verwijder]').forEach(btn=>{
    btn.onclick = async ()=>{
      if(!confirm(t('beheer.accountVerwijderenConfirm', { naam: perId.get(btn.dataset.verwijder).naam }))) return;
      try{ await apiCall('/api/accounts/'+btn.dataset.verwijder, 'DELETE'); await renderAccountsTabel(); }
      catch(e){ alert(e.message); }
    };
  });
}

document.getElementById('addAccountBtn').onclick = async ()=>{
  const naamInput = document.getElementById('newAccountNaam');
  const emailInput = document.getElementById('newAccountEmail');
  const naam = naamInput.value.trim();
  if(!naam) return alert(t('beheer.alertVulAccountNaam'));
  try{
    const { wachtwoord } = await apiCall('/api/accounts', 'POST', { naam, email: emailInput.value.trim() });
    naamInput.value = ''; emailInput.value = '';
    toonWachtwoord(naam, wachtwoord);
    await renderAccountsTabel();
  }catch(e){ alert(e.message); }
};

document.getElementById('accountWachtwoordKopieerBtn').onclick = async ()=>{
  try{ await navigator.clipboard.writeText(document.getElementById('accountWachtwoordWaarde').textContent); }
  catch(e){ /* klembord kan geblokkeerd zijn, het wachtwoord staat toch al zichtbaar op het scherm */ }
};

export async function initAccounts(){
  await renderAccountsTabel();
}
