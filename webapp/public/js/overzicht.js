// ---------- Overzicht-subtab (Rapportages-tab, roadmap-item 6 / §11.3 optie B) ----------
// Hergebruikt drie bestaande subsystemen i.p.v. een nieuwe architectuur: dezelfde client-side
// liveData/liveEnergyData (Live/Schema), dezelfde topology.js-boomhelpers als het Schema-tabblad,
// en een nieuw server-endpoint (/api/overzicht/energie) dat dezelfde influxQuery()-helper
// hergebruikt als het PDF-rapport. Zie specs/rebuild-plan-v2-implementatie.md Fase D4b.
import { state, liveData } from './state.js';
import { listChildrenOf, collectDescendantKasten, statusOf, maxFaseStroom } from './topology.js';
import { apiCall } from './api.js';
import { t } from './i18n.js';
import { renderPins } from './render-pins.js';
import { renderDetail } from './render-detail.js';
import { renderKastPopup } from './kastpopup.js';

const STATUS_KLEUR = { green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)' };

let energieCache = {}; // { [generatorId]: kwh }, gevuld door verversEnergie()

function belastingPct(node){
  const maxFase = maxFaseStroom(liveData[node.id]);
  if(node.rating_a==null || maxFase==null) return null;
  return Math.min(999, Math.round((maxFase/node.rating_a)*100));
}

function renderOverzichtCards(){
  const container = document.getElementById('overzichtCards');
  container.innerHTML = '';
  const actief = state.overzichtGeneratorFilter;

  state.TOPO.generators.forEach(gen=>{
    const card = document.createElement('button');
    card.className = 'card' + (actief===gen.id ? ' active' : '');
    const status = statusOf(gen);
    const pct = belastingPct(gen);
    const kwh = energieCache[gen.id];
    card.innerHTML =
      '<div class="lbl"></div>'+
      '<div class="val"></div>'+
      '<div class="sub"><span class="dotstatus" style="background:'+(STATUS_KLEUR[status]||'var(--grey)')+'"></span><span class="subtext"></span></div>';
    card.querySelector('.lbl').textContent = gen.naam;
    card.querySelector('.val').textContent = kwh!=null ? kwh.toFixed(1)+' kWh' : '—';
    card.querySelector('.subtext').textContent = pct!=null ? pct+'%' : t('overzicht.geenRating');
    card.onclick = ()=>{
      state.overzichtGeneratorFilter = (actief===gen.id) ? null : gen.id;
      renderOverzichtCards(); renderOverzichtBars(); renderOverzichtBoom();
    };
    container.appendChild(card);
  });

  // samenvattend kaartje: totaal aantal kasten + hoeveel daarvan boven de 90%-drempel zitten
  const totaalKasten = state.TOPO.kasten.length;
  const boven90 = state.TOPO.kasten.filter(k=>statusOf(k)==='red').length;
  const totaalCard = document.createElement('div');
  totaalCard.className = 'card';
  totaalCard.style.cursor = 'default';
  totaalCard.innerHTML =
    '<div class="lbl"></div><div class="val">'+totaalKasten+'</div>'+
    '<div class="sub"><span class="dotstatus" style="background:'+(boven90>0?'var(--red)':'var(--green)')+'"></span><span class="subtext"></span></div>';
  totaalCard.querySelector('.lbl').textContent = t('overzicht.kastenTotaal');
  totaalCard.querySelector('.subtext').textContent = t('overzicht.bovenNegentig', {n: boven90});
  container.appendChild(totaalCard);
}

// welke kasten meetellen voor de staven/boom, rekening houdend met het drill-down-filter (klik op
// een generator-kaart hierboven) — null filter betekent: alle kasten van alle generators
function actieveKasten(){
  if(!state.overzichtGeneratorFilter) return state.TOPO.kasten;
  const gen = state.TOPO.generators.find(g=>g.id===state.overzichtGeneratorFilter);
  return gen ? collectDescendantKasten(gen) : state.TOPO.kasten;
}

function renderOverzichtBars(){
  const container = document.getElementById('overzichtBars');
  container.innerHTML = '';
  actieveKasten().forEach(k=>{
    const pct = belastingPct(k);
    const status = statusOf(k);
    const bar = document.createElement('button');
    bar.className = 'bar';
    bar.title = k.naam + (pct!=null ? ' · '+pct+'%' : '');
    bar.innerHTML = '<div class="fill" style="height:'+(pct!=null?Math.min(100,pct):2)+'%;background:'+(STATUS_KLEUR[status]||'var(--grey)')+'"></div><div class="name"></div>';
    bar.querySelector('.name').textContent = k.afkorting || k.naam;
    // drill-down: naar Live-modus springen met deze kast geselecteerd + databallon open,
    // hergebruikt de bestaande kastpopup-/aside-detail-machinery i.p.v. een eigen detailscherm
    bar.onclick = ()=>{
      document.getElementById('modeLive').click();
      state.selectedId = k.id;
      state.openPopupKastId = k.id;
      renderPins(); renderDetail(); renderKastPopup();
    };
    container.appendChild(bar);
  });
}

function renderOverzichtBoom(){
  const container = document.getElementById('overzichtBoom');
  container.innerHTML = '';
  const generators = state.overzichtGeneratorFilter
    ? state.TOPO.generators.filter(g=>g.id===state.overzichtGeneratorFilter)
    : state.TOPO.generators;

  generators.forEach(gen=>{
    const directKids = listChildrenOf(gen);
    if(!directKids.length) return;
    const totaalOnder = collectDescendantKasten(gen).length;

    const eersteRij = document.createElement('div');
    eersteRij.className = 'schemasm';
    eersteRij.innerHTML = '<div class="node gen"></div><div class="conn"></div><div class="node kast"></div>';
    eersteRij.querySelector('.node.gen').textContent = gen.naam;
    eersteRij.querySelector('.node.kast').textContent = directKids[0].naam;
    eersteRij.onclick = ()=>{
      document.getElementById('modeLive').click();
      state.selectedId = directKids[0].id; state.openPopupKastId = directKids[0].id;
      renderPins(); renderDetail(); renderKastPopup();
    };
    container.appendChild(eersteRij);

    const rest = totaalOnder - 1;
    if(rest > 0){
      const restRij = document.createElement('div');
      restRij.className = 'schemasm';
      restRij.style.paddingLeft = '32px';
      restRij.innerHTML = '<div class="conn"></div><div class="node kast"></div>';
      restRij.querySelector('.node.kast').textContent = t('overzicht.meerKasten', {n: rest});
      container.appendChild(restRij);
    }
  });

  if(!container.children.length){
    const leeg = document.createElement('div');
    leeg.className = 'empty';
    leeg.textContent = t('overzicht.geenGenerators');
    container.appendChild(leeg);
  }
}

// levert {van, tot} als ISO-strings op basis van de gekozen periode-chip — zelfde patroon als
// bepaalRapportPeriode() in rapport.js, maar zonder editie-keuze (Overzicht toont de huidige
// stack "as-is", geen editie-vergelijking)
async function bepaalOverzichtPeriode(){
  if(state.overzichtPeriodeChip==='24u'){
    const tot = new Date();
    const van = new Date(tot.getTime() - 24*3600*1000);
    return { van: van.toISOString(), tot: tot.toISOString() };
  }
  if(state.overzichtPeriodeChip==='aangepast'){
    const van = document.getElementById('overzichtVanInput').value;
    const tot = document.getElementById('overzichtTotInput').value;
    if(!van || !tot) throw new Error(t('rapport.alertVulDatums'));
    return { van: new Date(van).toISOString(), tot: new Date(tot).toISOString() };
  }
  const periode = await apiCall('/api/rapport/periode?editie=__alle__', 'GET');
  if(!periode.van || !periode.tot) throw new Error(t('rapport.alertGeenMeetdata'));
  return { van: periode.van, tot: periode.tot };
}

async function verversEnergie(){
  try{
    const { van, tot } = await bepaalOverzichtPeriode();
    energieCache = await apiCall('/api/overzicht/energie?van='+encodeURIComponent(van)+'&tot='+encodeURIComponent(tot), 'GET');
  }catch(e){
    energieCache = {};
  }
  renderOverzichtCards(); renderOverzichtBars(); renderOverzichtBoom();
}

document.querySelectorAll('#overzichtPanel [data-overzichtperiode]').forEach(chip=>{
  chip.onclick = ()=>{
    state.overzichtPeriodeChip = chip.dataset.overzichtperiode;
    document.querySelectorAll('#overzichtPanel [data-overzichtperiode]').forEach(c=>c.classList.toggle('active', c===chip));
    document.getElementById('overzichtAangepastPeriode').style.display = state.overzichtPeriodeChip==='aangepast' ? 'flex' : 'none';
    if(state.overzichtPeriodeChip!=='aangepast') verversEnergie();
  };
});
document.getElementById('overzichtToepassenBtn').onclick = ()=>{ verversEnergie().catch(e=>alert(e.message)); };

// aangeroepen bij elk binnenkomend MQTT-databericht (mqtt.js) zolang de Overzicht-subtab
// zichtbaar is: alleen de live status-afhankelijke delen (kaartjes, staven) opnieuw tekenen,
// niet de periode-kWh (die blijft geldig tot de volgende verversEnergie()-aanroep)
export function ververOverzichtLiveWeergave(){
  if(state.mode!=='rapportages' || state.rapportSubnav!=='overzicht') return;
  renderOverzichtCards();
  renderOverzichtBars();
}

// aangeroepen vanuit modes.js zodra de Overzicht-subtab getoond wordt
export function toonOverzicht(){
  verversEnergie();
}
