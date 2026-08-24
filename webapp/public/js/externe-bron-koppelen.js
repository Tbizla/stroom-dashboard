// ---------- Externe Shelly koppelen aan een kast: specs/externe-shelly-koppelen-plan.md ----------
// Nieuwe "Externe bron"-kolom in de kasten-tabel (render-beheer.js) + een zoek-/koppel-popover,
// zelfde soort losstaand, positioned-fixed popover-patroon als het rechtsklik-mini-menu in
// render-pins.js (showCtxMenu/closeCtxMenu) — geen bestaand generiek popover-component om te
// hergebruiken, dus hier lokaal opnieuw opgebouwd.
import { apiCall } from './api.js';
import { t, huidigeLocale } from './i18n.js';
import { loadTopology } from './topology.js';

// bron.naam/ruwe_id komen van een NIET-vertrouwde externe partij (shellybeheerder/Rentman-broker,
// via extern-bron-registry.js op de server) — altijd escapen vóór het in innerHTML te zetten, zelfde
// reden/patroon als accounts.js se esc() voor gebruikers-ingevoerde naam/e-mail
function esc(s){
  return String(s).replace(/[&<>"']/g, (c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmtGeleden(iso){
  if(!iso) return '';
  const sec = Math.max(0, Math.round((Date.now()-new Date(iso).getTime())/1000));
  if(sec<60) return t('common.secondenGeleden', {n: sec});
  return t('common.minutenGeleden', {n: Math.round(sec/60)});
}

let cache = null;
async function laadBronnen(){
  if(!cache) cache = await apiCall('/api/externe-bronnen', 'GET');
  return cache;
}

let openPop = null;
let openAnker = null;
function sluitPopover(){
  if(!openPop) return;
  openPop.remove(); openPop = null; openAnker = null;
  document.removeEventListener('mousedown', onDocMouseDown, true);
  document.removeEventListener('keydown', onDocKeydown, true);
}
function onDocMouseDown(ev){ if(openPop && !openPop.contains(ev.target) && ev.target!==openAnker && !(openAnker && openAnker.contains(ev.target))) sluitPopover(); }
function onDocKeydown(ev){ if(ev.key==='Escape') sluitPopover(); }

// kast = de kast waarvoor gekoppeld wordt, ankerEl = het element (knop/chip) waar de popover onder
// verschijnt, opKoppel(bron) = aangeroepen zodra een keuze definitief is (na eventuele confirm)
function openPopover(kast, ankerEl, opKoppel){
  sluitPopover();
  const pop = document.createElement('div');
  pop.className = 'koppelpop';
  pop.style.position = 'fixed';
  // vervolgticket-koppelpop-positionering.md: pas zichtbaar maken ná de eerste positionering
  // hieronder — anders flitst 'm eerst op zijn (nog lege) skelet-hoogte op, vóórdat herteken() de
  // lijst gevuld heeft
  pop.style.visibility = 'hidden';
  pop.innerHTML =
    '<div class="koppelpop-head">'+
      '<input placeholder="'+t('beheer.externBronZoekPlaceholder')+'" id="koppelpopZoek">'+
      '<div class="koppelpop-filters">'+
        '<span class="chip active" data-schema="alles">'+t('beheer.externBronFilterAlles')+'</span>'+
        '<span class="chip" data-schema="mac">MAC</span>'+
        '<span class="chip" data-schema="rentman">Rentman</span>'+
      '</div>'+
      '<div class="koppelpop-count" id="koppelpopCount"></div>'+
    '</div>'+
    '<div class="koppelpop-list" id="koppelpopList"></div>';
  document.body.appendChild(pop);

  // vervolgticket-koppelpop-positionering.md: de eerdere versie positioneerde vóórdat herteken()
  // (async, wacht op GET /api/externe-bronnen) de lijst gevuld had — pop.offsetHeight was op dat
  // moment alleen de kop, dus de "blijf binnen het scherm"-clamp rekende met een veel te lage
  // hoogte en de popover liep alsnog voorbij de onderrand van het scherm zodra de lijst erbij kwam
  // (onbereikbaar/onbedienbaar, want ook de klik-buiten-sluit-listener zag 'm dan als "erbuiten").
  // Nu herroepen vanuit herteken() zelf, ná elke inhoudswijziging (ook bij zoeken/filteren, want de
  // hoogte verandert dan mee) — en als het onder de knop niet past, probeert 'm eerst erboven i.p.v.
  // gewoon van het scherm af te laten hangen.
  function positioneer(){
    const ankerRect = ankerEl.getBoundingClientRect();
    const marge = 12;
    let left = Math.min(ankerRect.left, window.innerWidth - pop.offsetWidth - marge);
    left = Math.max(marge, left);
    let top = ankerRect.bottom + 4;
    if(top + pop.offsetHeight + marge > window.innerHeight){
      const bovenoptie = ankerRect.top - 4 - pop.offsetHeight;
      top = bovenoptie >= marge ? bovenoptie : Math.max(marge, window.innerHeight - pop.offsetHeight - marge);
    }
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.style.visibility = 'visible';
  }

  let schemaFilter = 'alles';
  let zoekQuery = '';

  function rijKlik(bron){
    const bezet = bron.gekoppeldAanKastId && bron.gekoppeldAanKastId !== kast.id;
    if(bezet && !confirm(t('beheer.externBronHerkoppelConfirm', {bron: bron.naam, kast: bron.gekoppeldAanKastNaam}))) return;
    sluitPopover();
    opKoppel(bron);
  }

  function bouwRij(bron){
    const bezet = bron.gekoppeldAanKastId && bron.gekoppeldAanKastId !== kast.id;
    const rij = document.createElement('div');
    rij.className = 'koppelrij' + (bezet ? ' bezet' : '');
    const vers = bron.laatsteBerichtOp && (Date.now() - new Date(bron.laatsteBerichtOp).getTime() < 30000);
    const waarde = bron.laatsteWaarde!=null ? bron.laatsteWaarde.toFixed(1)+'A' : '—';
    rij.innerHTML =
      '<span class="dotje '+(vers?'vers':'stil')+'"></span>'+
      '<div class="koppelrij-mid">'+
        '<div class="naam">'+esc(bron.naam)+'</div>'+
        '<div class="sub"><span class="schema '+bron.schema+'">'+bron.schema+'</span><span class="id">'+esc(bron.ruwe_id)+'@'+esc(bron.naam)+'</span></div>'+
        (bezet ? '<div class="bezet-label">'+t('beheer.externBronAlGekoppeld', {kast: bron.gekoppeldAanKastNaam})+'</div>' : '')+
      '</div>'+
      '<div class="koppelrij-right"><div class="waarde">'+waarde+'</div><div class="geleden">'+fmtGeleden(bron.laatsteBerichtOp)+'</div></div>';
    rij.onclick = ()=> rijKlik(bron);
    return rij;
  }

  async function herteken(){
    const alle = await laadBronnen();
    const q = zoekQuery.trim().toLowerCase();
    const gefilterd = alle
      .filter(b => schemaFilter==='alles' || b.schema===schemaFilter)
      .filter(b => !q || b.naam.toLowerCase().includes(q) || b.ruwe_id.toLowerCase().includes(q))
      .sort((a,b) => {
        const ta = a.laatsteBerichtOp ? new Date(a.laatsteBerichtOp).getTime() : 0;
        const tb = b.laatsteBerichtOp ? new Date(b.laatsteBerichtOp).getTime() : 0;
        return tb - ta;
      });
    document.getElementById('koppelpopCount').textContent = t('beheer.externBronAantal', {n: gefilterd.length, totaal: alle.length});
    const lijst = document.getElementById('koppelpopList');
    lijst.innerHTML = '';
    if(!gefilterd.length){
      const leeg = document.createElement('div');
      leeg.className = 'bezet-label';
      leeg.style.padding = '.75rem';
      leeg.textContent = t('beheer.externBronGeenResultaten');
      lijst.appendChild(leeg);
      positioneer();
      return;
    }
    gefilterd.forEach(b => lijst.appendChild(bouwRij(b)));
    positioneer();
  }

  pop.querySelectorAll('.koppelpop-filters .chip').forEach(chip=>{
    chip.onclick = ()=>{
      pop.querySelectorAll('.koppelpop-filters .chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active');
      schemaFilter = chip.dataset.schema;
      herteken();
    };
  });
  const zoekInput = document.getElementById('koppelpopZoek');
  zoekInput.oninput = ()=>{ zoekQuery = zoekInput.value; herteken(); };
  zoekInput.focus();

  herteken();
  openPop = pop;
  openAnker = ankerEl;
  setTimeout(()=>{
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onDocKeydown, true);
  }, 0);
}

async function koppel(kast, bron){
  try{
    await apiCall('/api/kasten/'+kast.id, 'PUT', { externe_bron_id: bron.ruwe_id });
    cache = null; // volgende popover-open haalt de bijgewerkte gekoppeldAanKastId opnieuw op
    await loadTopology(); // ververst ook de kasten-tabel zelf (renderBeheer() roept renderKastSecties() al aan)
  }catch(e){ alert(e.message); }
}
async function ontkoppel(kast){
  try{
    await apiCall('/api/kasten/'+kast.id, 'PUT', { externe_bron_id: null });
    cache = null;
    await loadTopology();
  }catch(e){ alert(e.message); }
}

// aangeroepen per kastrij vanuit render-beheer.js — bouwt de "Externe bron"-cel (nog niet gekoppeld:
// gestippelde knop; wel gekoppeld: chip met naam/schema-badge + ontkoppelknop). Kast se eigen
// externe_bron_naam is niet bekend (alleen het id ligt vast in de topologie) — wordt bij het openen/
// laden van de bronnenlijst opgezocht en hier lazy bijgewerkt zodra dat klaar is.
export function bouwExternBronCel(kast){
  const wrap = document.createElement('div');
  wrap.className = 'extern-cell';

  function open(ankerEl){
    openPopover(kast, ankerEl, (bron)=> koppel(kast, bron));
  }

  if(!kast.externe_bron_id){
    const btn = document.createElement('button');
    btn.className = 'extern-koppel-btn';
    btn.textContent = '+ ' + t('beheer.externBronKoppelen');
    btn.onclick = ()=> open(btn);
    wrap.appendChild(btn);
    return wrap;
  }

  const chip = document.createElement('div');
  chip.className = 'extern-chip';
  chip.innerHTML = '<span class="naam">'+t('beheer.externBronLaden')+'</span>';
  chip.onclick = ()=> open(chip);
  const unlink = document.createElement('span');
  unlink.className = 'extern-unlink';
  unlink.textContent = '✕';
  unlink.title = t('beheer.externBronOntkoppelen');
  unlink.onclick = (ev)=>{ ev.stopPropagation(); ontkoppel(kast); };
  wrap.appendChild(chip);
  wrap.appendChild(unlink);

  // de kast kent alleen het ruwe_id (externe_bron_id) — naam/schema staan in de bronnenregistry,
  // die hier los (async) bijgehaald wordt zodat de tabel zelf niet op deze fetch hoeft te wachten
  laadBronnen().then(alle=>{
    const bron = alle.find(b => b.ruwe_id === kast.externe_bron_id);
    chip.innerHTML = bron
      ? '<span class="naam">'+esc(bron.naam)+'</span><span class="idtag">'+bron.schema+'</span>'
      : '<span class="naam">'+esc(kast.externe_bron_id)+'</span>';
  }).catch(()=>{
    chip.innerHTML = '<span class="naam">'+esc(kast.externe_bron_id)+'</span>';
  });

  return wrap;
}
