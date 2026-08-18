// ---------- Beheer: generators & kasten aanmaken, bewerken, koppelen, verwijderen ----------
import { state, beheerState, saveBeheerState, isBeheerNodeOpen, expandedGroepen, sidebarState, saveSidebarState } from './state.js';
import { listChildrenOf, collectDescendantKasten, genNaam, typeIcon } from './topology.js';
import { apiCall } from './api.js';
import { loadTopology } from './topology.js';
import { t } from './i18n.js';
import { openQrOverlay } from './qrcodes.js';

// specs/generator-groep-powerplant-plan.md: selectiemodus-state voor "generators groeperen" — puur
// een transiente UI-toestand van deze pagina (net als de andere module-level `let`s in dit bestand),
// hoeft dus niet in state.js/beheerState (dat overleeft een page-reload, dit hoeft niet)
let groepeerSelectieActief = false;
let groepeerGeselecteerd = new Set();

// specs/shelly-vervanging-plan.md: welke rij het inline "Vervangen"-formuliertje open heeft staan —
// net als groepeerGeselecteerd/expandedGroepen hierboven een puur transiente UI-state die een
// renderBeheer()-rebuild moet overleven (de hele tabel wordt bij elke wijziging herbouwd).
// Sleutel: "kast:<id>" | "generator:<id>" | "lid:<generatorId>|<lidIndex>"
let vervangFormOpen = new Set();

function ververGroepeerActiebalk(){
  const balk = document.getElementById('genGroepeerActiebalk');
  const aantal = groepeerGeselecteerd.size;
  if(!groepeerSelectieActief || aantal < 2){
    balk.style.display = 'none';
    return;
  }
  balk.style.display = 'flex';
  document.getElementById('genGroepeerAantal').textContent = t('beheer.groepeerAantalGeselecteerd', {n: aantal});
}

document.getElementById('genGroeperenBtn').addEventListener('click', ()=>{
  groepeerSelectieActief = !groepeerSelectieActief;
  groepeerGeselecteerd.clear();
  document.getElementById('genGroeperenBtn').classList.toggle('active', groepeerSelectieActief);
  ververGroepeerActiebalk();
  renderBeheer();
});
document.getElementById('genGroepeerAnnulerenBtn').addEventListener('click', ()=>{
  groepeerSelectieActief = false;
  groepeerGeselecteerd.clear();
  document.getElementById('genGroeperenBtn').classList.remove('active');
  ververGroepeerActiebalk();
  renderBeheer();
});

function toonGroepeerDialoog(){
  document.getElementById('groepeerNaam').value = '';
  document.getElementById('groepeerSoort').value = '';
  const errEl = document.getElementById('groepeerErr');
  errEl.textContent = '';
  errEl.classList.remove('show');
  const aantalKasten = state.TOPO.kasten.filter(k=>groepeerGeselecteerd.has(k.generator)).length;
  document.getElementById('groepeerWaarschuwing').textContent = t('beheer.groepeerWaarschuwing', {n: aantalKasten});
  document.getElementById('groepeerOverlay').style.display = 'flex';
}
function verbergGroepeerDialoog(){
  document.getElementById('groepeerOverlay').style.display = 'none';
}
document.getElementById('genGroepeerOpenDialoogBtn').addEventListener('click', toonGroepeerDialoog);
document.getElementById('groepeerOverlayClose').addEventListener('click', verbergGroepeerDialoog);
document.getElementById('groepeerAnnulerenBtn').addEventListener('click', verbergGroepeerDialoog);
document.getElementById('groepeerBevestigenBtn').addEventListener('click', async ()=>{
  const naam = document.getElementById('groepeerNaam').value.trim();
  const groep_soort = document.getElementById('groepeerSoort').value || undefined;
  const errEl = document.getElementById('groepeerErr');
  if(!naam){
    errEl.textContent = t('beheer.groepeerNaamVerplicht');
    errEl.classList.add('show');
    return;
  }
  try{
    await apiCall('/api/generators/groeperen', 'POST', { naam, groep_soort, generator_ids: Array.from(groepeerGeselecteerd) });
    verbergGroepeerDialoog();
    groepeerSelectieActief = false;
    groepeerGeselecteerd.clear();
    document.getElementById('genGroeperenBtn').classList.remove('active');
    ververGroepeerActiebalk();
    await loadTopology();
  }catch(e){
    errEl.textContent = e.message;
    errEl.classList.add('show');
  }
});

// specs/mqtt-configuratie-plan.md: MQTT-topic-prefix kopiëren (kast/generator/lid) — zelfde
// stil-falen-patroon als de bestaande wachtwoord-kopieerknop in accounts.js
// (navigator.clipboard.writeText, de waarde staat toch al zichtbaar in het veld ernaast). Korte
// visuele bevestiging (icoon wisselt even naar een vinkje) i.p.v. een aparte toast/melding.
async function kopieerMqttPrefix(prefix, btnEl){
  try{ await navigator.clipboard.writeText(prefix); }catch(e){ /* klembord geblokkeerd, prefix staat al zichtbaar */ }
  if(!btnEl) return;
  const origineel = btnEl.textContent;
  btnEl.textContent = '✓';
  setTimeout(()=>{ btnEl.textContent = origineel; }, 1200);
}

// specs/shelly-auto-configuratie-plan.md: MQTT-instellingen (+ optioneel het snelheidsscript) in
// één actie naar een Shelly pushen — server doet al het RPC-werk (webapp/shelly-rpc.js), de client
// stuurt alleen doelType/id/generatorId/script en toont het resultaat.
async function voerShellyConfiguratieUit(doel, metScript){
  try{
    return await apiCall('/api/shelly/configureren', 'POST', { doelType: doel.doelType, id: doel.id, generatorId: doel.generatorId, script: metScript });
  }catch(e){
    // apiCall gooit bij een 4xx/5xx (bijv. geen shelly_ip, geen LAN-IP bekend) — dat zijn
    // request-fouten, geen device-fouten, maar de UI toont ze op dezelfde manier
    return { ok:false, mqtt:{ ok:false, melding:e.message }, script:null };
  }
}

function toonShellyToast(titel){
  document.getElementById('shellyToastTitel').textContent = titel;
  document.getElementById('shellyToastRegel1').textContent = '';
  document.getElementById('shellyToastRegel2').textContent = '';
  document.getElementById('shellyToast').style.display = 'block';
}
function zetShellyToastRegel(regel1, regel2){
  document.getElementById('shellyToastRegel1').textContent = regel1 || '';
  document.getElementById('shellyToastRegel2').textContent = regel2 || '';
}

// géén streaming/SSE vanaf de server (bewuste keuze, zie het plan) — de "live voortgangstekst" is
// dus een client-side benaderde tijdlijn terwijl de ene, blokkerende serveraanroep loopt, geen
// echte per-stap-bevestiging. Zodra de aanroep terugkomt, wordt de tijdlijn direct vervangen door
// het daadwerkelijke resultaat.
async function startShellyConfiguratie(doel, metScript){
  toonShellyToast(doel.naam);
  zetShellyToastRegel(t('beheer.shellyToastVersturen'));
  const timers = [
    setTimeout(()=> zetShellyToastRegel(t('beheer.shellyToastHerstart')), 700),
    setTimeout(()=> zetShellyToastRegel(t('beheer.shellyToastVerbinding')), 1800),
  ];
  if(metScript) timers.push(setTimeout(()=> zetShellyToastRegel(t('beheer.shellyToastVerbinding'), t('beheer.shellyToastScript')), 6000));
  const resultaat = await voerShellyConfiguratieUit(doel, metScript);
  timers.forEach(clearTimeout);
  const mqttRegel = resultaat.mqtt ? (resultaat.mqtt.ok?'✅ ':'❌ ') + resultaat.mqtt.melding : '';
  const scriptRegel = resultaat.script ? (resultaat.script.ok?'✅ ':'❌ ') + resultaat.script.melding : '';
  zetShellyToastRegel(mqttRegel, scriptRegel);
  document.getElementById('shellyToastTitel').textContent = (resultaat.ok ? t('beheer.shellyToastKlaar') : t('beheer.shellyToastFout')) + ' — ' + doel.naam;
}
document.getElementById('shellyToastSluit').addEventListener('click', ()=>{ document.getElementById('shellyToast').style.display = 'none'; });

// specs/feedback_no_bulk_mqtt_shelly_config: elke ⚙️-configureer-actie pusht meteen echte
// MQTT-instellingen naar een fysiek apparaat — een bevestiging voorkomt dat een misklik dat
// ongemerkt doet. Bewust NIET voor de vervang-flow (maakVervangForm) hierboven: die vereist al een
// nieuw IP intypen + expliciet op "Vervangen" klikken, dus een misklik kan daar al niet optreden.
function bevestigShellyConfiguratie(naam){
  return confirm(t('beheer.shellyConfigureerBevestiging', { naam }));
}

// helper voor de kast-rij (DOM-gebouwd, zie kastRij() hieronder) — generator-/lid-rijen zijn
// string-gebouwd en gebruiken data-shelly-cfg-*-attributen + een gedelegeerde binding in
// renderBeheer() i.p.v. deze functie, zelfde patroon-verschil als de rest van dit bestand.
function maakShellyConfigureerControl(doel){
  const wrap = document.createElement('span');
  wrap.className = 'shelly-cfg';
  const scriptChk = document.createElement('input');
  scriptChk.type = 'checkbox';
  scriptChk.checked = true;
  scriptChk.title = t('beheer.shellyConfigureerScriptTitle');
  const btn = document.createElement('button');
  btn.className = 'shelly-cfg-btn';
  btn.textContent = '⚙️';
  btn.title = t('beheer.shellyConfigureren');
  btn.onclick = ()=>{ if(bevestigShellyConfiguratie(doel.naam)) startShellyConfiguratie(doel, scriptChk.checked); };
  wrap.appendChild(scriptChk);
  wrap.appendChild(btn);
  return wrap;
}

// specs/shelly-vervanging-plan.md: één "Vervangen"-actie i.p.v. de twee losse stappen (IP-veld
// overtypen, dan apart de ⚙️-configureerknop zoeken) — inline toggle-formuliertje binnen dezelfde
// actiekolom-cel, geen apart modal-venster (zelfde soort toggle-zichtbare div als de aangepaste-
// periode-invoer bij Rapportages/Grafieken). DOM-gebouwd, voor de kast-rij (zelfde patroon-verschil
// als maakShellyConfigureerControl() hierboven t.o.v. de generator-/lid-rijen).
// `opNieuweShellyIp` doet de PUT die het nieuwe shelly_ip opslaat (en dus ook de server-side
// vervangingen-log triggert, zie server.js); `doel` is hetzelfde soort object als
// startShellyConfiguratie() elders al verwacht.
function maakVervangForm(key, opNieuweShellyIp, doel){
  const wrap = document.createElement('span');
  wrap.className = 'vervang-form';
  const ipInput = document.createElement('input');
  ipInput.className = 'vervang-ip-input';
  ipInput.placeholder = t('beheer.vervangNieuwIpPlaceholder');
  const scriptChk = document.createElement('input');
  scriptChk.className = 'vervang-script-chk';
  scriptChk.type = 'checkbox';
  scriptChk.checked = true;
  scriptChk.title = t('beheer.shellyConfigureerScriptTitle');
  const bevestigBtn = document.createElement('button');
  bevestigBtn.className = 'vervang-bevestig-btn';
  bevestigBtn.textContent = t('beheer.vervangBevestigen');
  bevestigBtn.onclick = async ()=>{
    const nieuwIp = ipInput.value.trim();
    if(!nieuwIp) return;
    bevestigBtn.disabled = true;
    try{
      await opNieuweShellyIp(nieuwIp);
      vervangFormOpen.delete(key);
      await loadTopology(); // herbouwt renderBeheer() al — vervangFormOpen mist deze key dus weer normale knoppen
      startShellyConfiguratie(doel, scriptChk.checked);
    }catch(e){ alert(e.message); bevestigBtn.disabled = false; }
  };
  const annulerenBtn = document.createElement('button');
  annulerenBtn.className = 'vervang-annuleer-btn';
  annulerenBtn.textContent = t('common.annuleren');
  annulerenBtn.onclick = ()=>{ vervangFormOpen.delete(key); renderBeheer(); };
  wrap.appendChild(ipInput); wrap.appendChild(scriptChk); wrap.appendChild(bevestigBtn); wrap.appendChild(annulerenBtn);
  return wrap;
}
function maakVervangOpenKnop(key){
  const btn = document.createElement('button');
  btn.textContent = '🔁';
  btn.title = t('beheer.vervangen');
  btn.onclick = ()=>{ vervangFormOpen.add(key); renderBeheer(); };
  return btn;
}
// klein indicatortje bij de Shelly-IP-kolom, alleen zichtbaar als er al eens iets vervangen is —
// tooltip toont de geschiedenis (nieuwste eerst), geen aparte pagina/export nodig voor een eerste versie
function maakVervangIndicator(vervangingen){
  if(!vervangingen || !vervangingen.length) return null;
  const el = document.createElement('span');
  el.className = 'shelly-vervang-indicator';
  el.textContent = '🔁';
  el.title = vervangingen.slice().reverse().map(v=>
    new Date(v.op).toLocaleString() + ': ' + v.vorig_ip + ' → ' + v.nieuw_ip
  ).join('\n');
  return el;
}

// string-gebouwde tegenhangers van maakVervangForm()/maakVervangOpenKnop()/maakVervangIndicator()
// hierboven, voor de generator-/lid-rijen (string-built + gedelegeerde events, zie de toelichting
// bij maakShellyConfigureerControl()). `esc()` bestaat al elders in dit bestand niet — deze waarden
// (IP-adressen, ISO-tijdstippen) bevatten geen HTML-gevoelige tekens, dus geen aparte escape nodig.
function vervangFormHtml(key){
  return '<span class="vervang-form" data-vervang-key="'+key+'">'+
    '<input class="vervang-ip-input" placeholder="'+t('beheer.vervangNieuwIpPlaceholder')+'">'+
    '<input type="checkbox" class="vervang-script-chk" checked title="'+t('beheer.shellyConfigureerScriptTitle')+'">'+
    '<button class="vervang-bevestig-btn">'+t('beheer.vervangBevestigen')+'</button>'+
    '<button class="vervang-annuleer-btn">'+t('common.annuleren')+'</button>'+
  '</span>';
}
function vervangOpenKnopHtml(key){
  return '<button class="vervang-open-btn" data-vervang-key="'+key+'" title="'+t('beheer.vervangen')+'">🔁</button>';
}
function vervangIndicatorHtml(vervangingen){
  if(!vervangingen || !vervangingen.length) return '';
  const titel = vervangingen.slice().reverse().map(v=>
    new Date(v.op).toLocaleString() + ': ' + v.vorig_ip + ' → ' + v.nieuw_ip
  ).join('\n').replace(/"/g,'&quot;');
  return '<span class="shelly-vervang-indicator" title="'+titel+'">🔁</span>';
}

// specs/kast-op-aggregaat-plan.md: een kast kan voortaan ook rechtstreeks aan één specifiek lid van
// een groep gekoppeld worden (i.p.v. alleen aan de groep als geheel) — leden van een groep komen
// daarom als extra, herkenbaar ingesprongen opties mee onder hun eigen groep
export function vulGenSelect(select, geselecteerd){
  select.innerHTML = state.TOPO.generators.map(g=>{
    let html = '<option value="'+g.id+'"'+(g.id===geselecteerd?' selected':'')+'>'+typeIcon(g)+' '+g.naam+'</option>';
    if(g.type==='groep'){
      html += (g.leden||[]).map(l=>'<option value="'+l.id+'"'+(l.id===geselecteerd?' selected':'')+'>&nbsp;&nbsp;&nbsp;&nbsp;↳ '+l.naam+'</option>').join('');
    }
    return html;
  }).join('');
}
export function vulParentSelect(select, generatorId, eigenId, geselecteerd){
  const opties = state.TOPO.kasten.filter(k=>k.generator===generatorId && k.id!==eigenId);
  select.innerHTML = '<option value="">'+t('beheer.rechtstreeksOpGenerator')+'</option>' +
    opties.map(k=>'<option value="'+k.id+'"'+(k.id===geselecteerd?' selected':'')+'>'+(k.type==='batterij'?'🔋 ':'')+k.naam+'</option>').join('');
}

// ---------- Beheer: kasten gegroepeerd per stroombron (zelfde aanpak/component als de
// Kalibreren/Live-aside, zie sidebar-redesign-spec.md, maar met een eigen beheerState-opslag en
// eigen, simpelere defaults: in Beheer wil je in principe alles zien, dus secties staan
// standaard open; geneste kasten-met-kinderen staan net als in de sidebar standaard dicht, zodat
// een diepe keten niet meteen de hele sectie vult) ----------
function computeKastTableOpenStates(){
  const states = {};
  function visit(node, isGenerator){
    const kids = listChildrenOf(node);
    if(kids.length){
      states[node.id] = isBeheerNodeOpen(node.id, isGenerator);
    }
    kids.forEach(k=>visit(k, false));
  }
  state.TOPO.generators.forEach(g=>visit(g, true));
  return states;
}

export function renderKastSecties(){
  const container = document.getElementById('kastSections');
  container.innerHTML = '';
  const query = state.kastZoekQuery.trim().toLowerCase();
  const filter = state.kastTypeFilter;
  const searching = !!query || filter !== 'alles';
  const openStates = computeKastTableOpenStates();

  function kastMatchesFilter(k){
    const bron = genNaam(k.generator);
    const textOk = !query || k.naam.toLowerCase().includes(query) || (k.afkorting && k.afkorting.toLowerCase().includes(query)) || bron.toLowerCase().includes(query);
    if(!textOk) return false;
    if(filter==='kast') return (k.type||'kast')==='kast';
    if(filter==='batterij') return k.type==='batterij';
    if(filter==='bypass') return !!k.heeft_bypass;
    return true;
  }
  const subtreeMatchCache = new Map();
  function subtreeMatches(k){
    if(subtreeMatchCache.has(k.id)) return subtreeMatchCache.get(k.id);
    let result = kastMatchesFilter(k);
    if(!result) result = listChildrenOf(k).some(subtreeMatches);
    subtreeMatchCache.set(k.id, result);
    return result;
  }

  function kastVeld(tr, waarde, opts){
    const td = document.createElement('td');
    td.appendChild(waarde);
    if(opts && opts.style) td.style.cssText = opts.style;
    tr.appendChild(td);
  }

  function kastRij(tbody, k, depth){
    const heeftKinderen = listChildrenOf(k).length > 0;
    const type = k.type || 'kast';
    const isBatterij = type === 'batterij';
    const tr = document.createElement('tr');

    const naamWrap = document.createElement('div');
    naamWrap.className = 'ktbl-naam';
    naamWrap.style.paddingLeft = (depth*14) + 'px';
    const marker = document.createElement('span');
    marker.className = 'chev';
    let open = true;
    if(heeftKinderen){
      open = searching ? true : openStates[k.id];
      marker.textContent = open ? '▾' : '▸';
      marker.style.cursor = 'pointer';
      marker.onclick = ()=>{ beheerState[k.id] = !openStates[k.id]; saveBeheerState(); renderKastSecties(); };
    } else if(depth>0){
      marker.textContent = '↳';
    }
    naamWrap.appendChild(marker);
    const naamInput = document.createElement('input');
    naamInput.value = k.naam;
    naamInput.style.flex = '1';
    naamInput.onchange = async ()=>{ try{ await apiCall('/api/kasten/'+k.id, 'PUT', {naam: naamInput.value}); await loadTopology(); } catch(e){ alert(e.message); } };
    naamWrap.appendChild(naamInput);
    // vervolgticket-beheer-dropdown-namen.md: expliciete min-width nodig, net als de overige
    // kolommen hieronder — zonder dit computet de browser's auto-table-layout de intrinsieke
    // breedte van deze kolom via de flex-child (naamInput.style.flex='1' = flex-basis:0%), wat
    // vrijwel geen bijdrage aan de preferred column width levert. Resultaat: de naamkolom stortte
    // in tot een paar pixels breed (kastnaam onzichtbaar) zodra de overige, wél expliciet
    // gebreedte kolommen samen al bijna de volledige tabelbreedte opeisten.
    kastVeld(tr, naamWrap, {style:'min-width:180px'});

    const afkInput = document.createElement('input');
    afkInput.value = k.afkorting || '';
    afkInput.onchange = async ()=>{ try{ await apiCall('/api/kasten/'+k.id, 'PUT', {afkorting: afkInput.value}); await loadTopology(); } catch(e){ alert(e.message); } };
    kastVeld(tr, afkInput, {style:'min-width:80px'});

    const ratingInput = document.createElement('input');
    ratingInput.type = 'number';
    ratingInput.value = k.rating_a;
    ratingInput.onchange = async ()=>{ try{ await apiCall('/api/kasten/'+k.id, 'PUT', {rating_a: ratingInput.value}); await loadTopology(); } catch(e){ alert(e.message); } };
    kastVeld(tr, ratingInput, {style:'min-width:70px'});

    const typeSel = document.createElement('select');
    typeSel.innerHTML = '<option value="kast"'+(!isBatterij?' selected':'')+'>'+t('beheer.typeKast')+'</option><option value="batterij"'+(isBatterij?' selected':'')+'>'+t('beheer.typeBatterij')+'</option>';
    typeSel.onchange = async ()=>{ try{ await apiCall('/api/kasten/'+k.id, 'PUT', {type: typeSel.value}); await loadTopology(); } catch(e){ alert(e.message); } };
    kastVeld(tr, typeSel, {style:'min-width:110px'});

    const bypassInput = document.createElement('input');
    bypassInput.type = 'checkbox';
    bypassInput.checked = !!k.heeft_bypass;
    bypassInput.disabled = !isBatterij;
    bypassInput.title = t('beheer.bypassTitle');
    bypassInput.onchange = async ()=>{ try{ await apiCall('/api/kasten/'+k.id, 'PUT', {heeft_bypass: bypassInput.checked}); await loadTopology(); } catch(e){ alert(e.message); } };
    kastVeld(tr, bypassInput, {style:'min-width:90px;text-align:center'});

    const shellyInput = document.createElement('input');
    shellyInput.value = k.shelly_ip || '';
    shellyInput.placeholder = t('beheer.shellyIpPlaceholder');
    shellyInput.title = t('beheer.shellyIpTitle');
    shellyInput.onchange = async ()=>{ try{ await apiCall('/api/kasten/'+k.id, 'PUT', {shelly_ip: shellyInput.value.trim() || null}); await loadTopology(); } catch(e){ alert(e.message); } };
    const shellyWrap = document.createElement('div');
    shellyWrap.className = 'shelly-cell';
    shellyWrap.appendChild(shellyInput);
    // specs/dubbel-veld-meetfactor-plan.md: leeg = normale kast, geen correctie
    const meetfactorInput = document.createElement('input');
    meetfactorInput.className = 'meetfactor-input';
    meetfactorInput.type = 'number'; meetfactorInput.step = '0.1'; meetfactorInput.min = '0';
    meetfactorInput.value = k.meetfactor != null ? k.meetfactor : '';
    meetfactorInput.placeholder = t('beheer.meetfactorPlaceholder');
    meetfactorInput.title = t('beheer.meetfactorTitle');
    meetfactorInput.onchange = async ()=>{ try{ await apiCall('/api/kasten/'+k.id, 'PUT', {meetfactor: meetfactorInput.value.trim() || null}); await loadTopology(); } catch(e){ alert(e.message); await loadTopology(); } };
    shellyWrap.appendChild(meetfactorInput);
    const mqttCopyBtn = document.createElement('button');
    mqttCopyBtn.className = 'mqtt-copy-btn';
    mqttCopyBtn.textContent = '📋';
    mqttCopyBtn.title = t('beheer.mqttKopieerTitle');
    mqttCopyBtn.onclick = ()=> kopieerMqttPrefix(k.mqtt_topic_prefix, mqttCopyBtn);
    shellyWrap.appendChild(mqttCopyBtn);
    const vervangIndicator = maakVervangIndicator(k.vervangingen);
    if(vervangIndicator) shellyWrap.appendChild(vervangIndicator);
    kastVeld(tr, shellyWrap, {style:'min-width:150px'});

    const genSel = document.createElement('select');
    vulGenSelect(genSel, k.generator);
    const parentSel = document.createElement('select');
    vulParentSelect(parentSel, k.generator, k.id, k.parent);
    genSel.onchange = async ()=>{
      vulParentSelect(parentSel, genSel.value, k.id, null);
      try{ await apiCall('/api/kasten/'+k.id, 'PUT', {generator: genSel.value, parent: null}); await loadTopology(); }
      catch(e){ alert(e.message); await loadTopology(); }
    };
    parentSel.onchange = async ()=>{ try{ await apiCall('/api/kasten/'+k.id, 'PUT', {parent: parentSel.value || null}); await loadTopology(); } catch(e){ alert(e.message); await loadTopology(); } };
    // specs/kast-op-aggregaat-plan.md, deel B: alleen zinvol als de kast rechtstreeks (geen parent)
    // op een generator/lid hangt — expliciete opt-in, geen automatische aanname
    const optellenInput = document.createElement('input');
    optellenInput.type = 'checkbox';
    optellenInput.className = 'optellen-input';
    optellenInput.checked = !!k.optellen_bij_generator;
    optellenInput.title = t('beheer.optellenTitle');
    optellenInput.onchange = async ()=>{ try{ await apiCall('/api/kasten/'+k.id, 'PUT', {optellen_bij_generator: optellenInput.checked}); await loadTopology(); } catch(e){ alert(e.message); await loadTopology(); } };
    const genWrap = document.createElement('div');
    genWrap.className = 'gen-cell';
    genWrap.appendChild(genSel);
    genWrap.appendChild(optellenInput);
    kastVeld(tr, genWrap, {style:'min-width:170px'});
    kastVeld(tr, parentSel, {style:'min-width:190px'});

    const actieWrap = document.createElement('div');
    actieWrap.style.cssText = 'display:flex;gap:4px;align-items:center;flex-wrap:wrap';
    const vervangKey = 'kast:'+k.id;
    if(vervangFormOpen.has(vervangKey)){
      actieWrap.appendChild(maakVervangForm(vervangKey,
        (nieuwIp)=> apiCall('/api/kasten/'+k.id, 'PUT', {shelly_ip: nieuwIp}),
        {doelType:'kast', id:k.id, naam:k.naam}));
    } else {
      if(!isBatterij){
        // geen QR-codes voor batterijen (net als generators) — zie specs/qr-code-plan.md
        const qrBtn = document.createElement('button');
        qrBtn.textContent = t('beheer.qrKnop');
        qrBtn.onclick = ()=> openQrOverlay(k);
        actieWrap.appendChild(qrBtn);
      }
      if(k.shelly_ip){
        actieWrap.appendChild(maakShellyConfigureerControl({doelType:'kast', id:k.id, naam:k.naam}));
      }
      actieWrap.appendChild(maakVervangOpenKnop(vervangKey));
      const delBtn = document.createElement('button');
      delBtn.className = 'danger';
      delBtn.textContent = t('common.verwijderen');
      delBtn.onclick = async ()=>{
        if(!confirm(t('beheer.confirmKastVerwijderen'))) return;
        try{ await apiCall('/api/kasten/'+k.id, 'DELETE'); await loadTopology(); }
        catch(e){ alert(e.message); }
      };
      actieWrap.appendChild(delBtn);
    }
    kastVeld(tr, actieWrap, {style:'min-width:170px'});

    tbody.appendChild(tr);
    if(heeftKinderen && open){
      listChildrenOf(k).forEach(kind=>{
        if(searching && !subtreeMatches(kind)) return;
        kastRij(tbody, kind, depth+1);
      });
    }
  }

  state.TOPO.generators.forEach(gen=>{
    const alleKasten = collectDescendantKasten(gen);
    if(searching && !alleKasten.some(subtreeMatches)) return;

    const sectie = document.createElement('div');
    sectie.className = 'ksectie';

    const head = document.createElement('div');
    head.className = 'ksectie-head';
    const heeftKasten = alleKasten.length > 0;
    let sectieOpen = true;
    const chev = document.createElement('span');
    chev.className = 'chev';
    if(heeftKasten){
      sectieOpen = searching ? true : openStates[gen.id];
      chev.textContent = sectieOpen ? '▾' : '▸';
      head.onclick = ()=>{ beheerState[gen.id] = !openStates[gen.id]; saveBeheerState(); renderKastSecties(); };
    }
    head.appendChild(chev);
    const naam = document.createElement('div');
    naam.className = 'naam';
    naam.textContent = typeIcon(gen) + ' ' + gen.naam + (gen.type==='groep' ? ' (groep — '+gen.leden.length+' leden)' : '');
    head.appendChild(naam);
    const kva = document.createElement('div');
    kva.className = 'kva';
    kva.textContent = gen.vermogen_kva + ' kVA';
    head.appendChild(kva);
    const aantal = document.createElement('div');
    aantal.className = 'aantal';
    aantal.textContent = alleKasten.length + ' ' + (alleKasten.length===1 ? t('beheer.kastEnkel') : t('beheer.kastMeervoud'));
    head.appendChild(aantal);
    sectie.appendChild(head);

    if(heeftKasten && sectieOpen){
      const tabel = document.createElement('table');
      tabel.className = 'btable';
      tabel.innerHTML = '<tr><th>'+t('beheer.thNaam')+'</th><th style="min-width:80px">'+t('beheer.thAfk')+'</th><th style="min-width:70px">'+t('beheer.thA')+'</th><th style="min-width:110px">'+t('beheer.thType')+'</th>'+
        '<th style="min-width:90px">'+t('beheer.thBypass')+'</th><th style="min-width:150px">'+t('beheer.thShellyIp')+'</th><th style="min-width:150px">'+t('beheer.thGenerator')+'</th><th style="min-width:190px">'+t('beheer.thGevoedVanaf')+'</th><th style="min-width:170px"></th></tr>';
      listChildrenOf(gen).forEach(k=>{
        if(searching && !subtreeMatches(k)) return;
        kastRij(tabel, k, 0);
      });
      // vervolgticket-ui-schaal-en-qr-sticker.md §1: .ksectie zelf houdt overflow:hidden (voor de
      // afgeronde hoeken van de sectie als geheel), maar dat kapte zonder deze wrapper ook alle
      // tabelinhoud breder dan de sectie hard af zonder scrollbalk — met de huidige kolommen
      // (ruim 1150px aan expliciete min-widths) paste dat simpelweg niet meer op een kleiner
      // scherm. Deze losse div regelt de horizontale scroll voor de tabel specifiek.
      const scrollWrap = document.createElement('div');
      scrollWrap.style.overflowX = 'auto';
      scrollWrap.appendChild(tabel);
      sectie.appendChild(scrollWrap);

      const hiddenCount = alleKasten.filter(k=>!kastMatchesFilter(k)).length;
      let verbergReden = null;
      if(filter === 'kast') verbergReden = t('beheer.filterQuote', {label: t('beheer.filterKasten')});
      else if(filter === 'batterij') verbergReden = t('beheer.filterQuote', {label: t('beheer.filterBatterijen')});
      else if(filter === 'bypass') verbergReden = t('beheer.filterQuote', {label: t('beheer.filterBypass')});
      else if(query) verbergReden = t('beheer.doorZoekopdracht');
      if(searching && hiddenCount>0 && verbergReden){
        const note = document.createElement('div');
        note.className = 'ksectie-hidden-note';
        const aantalWoord = hiddenCount===1 ? t('beheer.kastEnkel') : t('beheer.kastMeervoud');
        note.textContent = '+ ' + hiddenCount + ' ' + aantalWoord + ' ' + t('beheer.verborgenDoor', {reden: verbergReden});
        sectie.appendChild(note);
      }
    }

    const addWrap = document.createElement('div');
    addWrap.className = 'ksectie-addbtn-wrap';
    const addBtn = document.createElement('button');
    addBtn.textContent = t('beheer.kastOp', {naam: gen.naam});
    addBtn.onclick = ()=>{
      const newGenSel = document.getElementById('newKastGen');
      const newParentSel = document.getElementById('newKastParent');
      newGenSel.value = gen.id;
      vulParentSelect(newParentSel, gen.id, null, null);
      const naamVeld = document.getElementById('newKastNaam');
      naamVeld.focus();
      naamVeld.scrollIntoView({behavior:'smooth', block:'center'});
    };
    addWrap.appendChild(addBtn);
    sectie.appendChild(addWrap);

    container.appendChild(sectie);
  });

  const collapsibleIds = Object.keys(openStates);
  const openCount = collapsibleIds.filter(id=>openStates[id]).length;
  const toggleBtn = document.getElementById('kastToggleAllBtn');
  const expandAction = openCount===0 && collapsibleIds.length>0;
  toggleBtn.textContent = expandAction ? t('common.allesUitklappen') : t('common.allesInklappen');
  toggleBtn.onclick = ()=>{
    collapsibleIds.forEach(id=>{ beheerState[id] = expandAction; });
    saveBeheerState();
    renderKastSecties();
  };
}

document.getElementById('kastZoek').addEventListener('input', (e)=>{
  state.kastZoekQuery = e.target.value;
  renderKastSecties();
});
document.querySelectorAll('#beheerPanel .chip[data-kfilter]').forEach(chip=>{
  chip.onclick = ()=>{
    state.kastTypeFilter = chip.dataset.kfilter;
    document.querySelectorAll('#beheerPanel .chip[data-kfilter]').forEach(c=>c.classList.toggle('active', c===chip));
    renderKastSecties();
  };
});

export function renderBeheer(){
  // generators-tabel
  const genTable = document.getElementById('genTable');
  // specs/generator-groep-powerplant-plan.md: selectiemodus voegt een checkbox-kolom vooraan toe
  // (alleen zichtbaar tijdens het selecteren) — groep-rijen zelf zijn niet selecteerbaar, geneste
  // groepen blijven uitgesloten net als bij de rest van het groepsysteem
  let gh = '<tr>'+(groepeerSelectieActief?'<th style="width:26px"></th>':'')+
    '<th>'+t('beheer.thNaam')+'</th><th style="min-width:110px">'+t('beheer.thType')+'</th><th style="min-width:80px">'+t('beheer.thKva')+'</th><th style="min-width:90px">'+t('beheer.thRating')+'</th>'+
    '<th style="min-width:150px">'+t('beheer.thShellyIp')+'</th>'+
    '<th style="min-width:70px">'+t('beheer.thAantalKasten')+'</th><th style="min-width:140px">'+t('beheer.thSoortKoppeling')+'</th><th style="min-width:110px">'+t('beheer.thLeden')+'</th><th style="min-width:130px"></th></tr>';
  state.TOPO.generators.forEach(g=>{
    const aantal = state.TOPO.kasten.filter(k=>k.generator===g.id).length;
    const type = g.type || 'generator';
    const isGroep = type === 'groep';
    if(!Array.isArray(g.leden)) g.leden = []; // oudere generators (van vóór dit veld bestond) missen 'leden' nog
    gh += '<tr>'+
      (groepeerSelectieActief ? '<td>'+(isGroep
        ? '<span style="color:var(--text3)" title="'+t('beheer.groepeerNietSelecteerbaar')+'">—</span>'
        : '<input type="checkbox" class="gen-groepeer-check" data-gen-id="'+g.id+'" '+(groepeerGeselecteerd.has(g.id)?'checked':'')+'>')+'</td>' : '')+
      '<td><input value="'+g.naam.replace(/"/g,'&quot;')+'" data-gen-naam="'+g.id+'"></td>'+
      '<td><select data-gen-type="'+g.id+'">'+
        '<option value="generator"'+(type==='generator'?' selected':'')+'>'+t('beheer.typeGenerator')+'</option>'+
        '<option value="batterij"'+(type==='batterij'?' selected':'')+'>'+t('beheer.typeBatterij')+'</option>'+
        '<option value="groep"'+(type==='groep'?' selected':'')+'>'+t('beheer.typeGroep')+'</option>'+
      '</select></td>'+
      '<td><input type="number" value="'+g.vermogen_kva+'" data-gen-kva="'+g.id+'"></td>'+
      '<td><div class="rating-cell"><input type="checkbox" data-gen-heeft-sensor="'+g.id+'" '+(g.rating_a!=null?'checked':'')+' title="'+t('beheer.heeftSensorTitle')+'">'+
        '<input type="number" placeholder="—" value="'+(g.rating_a!=null?g.rating_a:'')+'" data-gen-rating="'+g.id+'" title="'+t('beheer.ratingTitle')+'" '+(g.rating_a==null?'disabled':'')+'></div></td>'+
      '<td style="min-width:150px"><div class="shelly-cell"><input placeholder="'+(g.rating_a!=null?t('beheer.shellyIpPlaceholder'):'—')+'" value="'+(g.shelly_ip||'').replace(/"/g,'&quot;')+'" data-gen-shelly="'+g.id+'" title="'+t('beheer.shellyIpTitle').replace(/"/g,'&quot;')+'" '+(g.rating_a==null?'disabled':'')+'>'+
        '<button class="mqtt-copy-btn" data-mqtt-copy="'+g.mqtt_topic_prefix+'" title="'+t('beheer.mqttKopieerTitle')+'">📋</button>'+
        vervangIndicatorHtml(g.vervangingen)+'</div></td>'+
      '<td>'+aantal+'</td>'+
      '<td><select data-gen-soort="'+g.id+'" '+(isGroep?'':'disabled')+' title="'+(isGroep?'':t('beheer.soortKoppelingDisabledTitle').replace(/"/g,'&quot;'))+'">'+
        '<option value=""'+(!g.groep_soort?' selected':'')+'>'+t('beheer.soortLeeg')+'</option>'+
        '<option value="parallel"'+(g.groep_soort==='parallel'?' selected':'')+'>'+t('beheer.soortParallel')+'</option>'+
        '<option value="backup"'+(g.groep_soort==='backup'?' selected':'')+'>'+t('beheer.soortBackup')+'</option>'+
        '<option value="hybride"'+(g.groep_soort==='hybride'?' selected':'')+'>'+t('beheer.soortHybride')+'</option>'+
      '</select></td>'+
      '<td>'+(isGroep ? '<button data-groep-toggle="'+g.id+'">'+t('beheer.ledenBtn', {n: g.leden.length})+' '+(expandedGroepen.has(g.id)?'▴':'▾')+'</button>' : '—')+'</td>'+
      '<td><div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">'+
        (vervangFormOpen.has('generator:'+g.id)
          ? vervangFormHtml('generator:'+g.id)
          : ((g.shelly_ip?'<span class="shelly-cfg"><input type="checkbox" class="shelly-cfg-script" checked title="'+t('beheer.shellyConfigureerScriptTitle')+'"><button class="shelly-cfg-btn" data-shelly-cfg-type="generator" data-shelly-cfg-id="'+g.id+'" title="'+t('beheer.shellyConfigureren')+'">⚙️</button></span>':'')+
             vervangOpenKnopHtml('generator:'+g.id)+
             '<button data-gen-del="'+g.id+'" class="danger">'+t('common.verwijderen')+'</button>')
        )+
      '</div></td>'+
      '</tr>';
    if(isGroep && expandedGroepen.has(g.id)){
      gh += '<tr class="ledenrow"><td colspan="'+(groepeerSelectieActief?10:9)+'"><table class="btable ledentable">'+
        '<tr><th>'+t('beheer.ledenTableThNaam')+'</th><th style="min-width:110px">'+t('beheer.thType')+'</th><th style="min-width:90px">'+t('beheer.thKva')+'</th><th style="min-width:90px">'+t('beheer.thRating')+'</th><th style="min-width:150px">'+t('beheer.thShellyIp')+'</th><th style="min-width:100px"></th></tr>'+
        g.leden.map((l,i)=>
          '<tr>'+
            '<td><input value="'+l.naam.replace(/"/g,'&quot;')+'" data-lid-naam="'+g.id+'|'+i+'"></td>'+
            '<td><select data-lid-type="'+g.id+'|'+i+'"><option value="generator"'+(l.type!=='batterij'?' selected':'')+'>'+t('beheer.typeGenerator')+'</option><option value="batterij"'+(l.type==='batterij'?' selected':'')+'>'+t('beheer.typeBatterij')+'</option></select></td>'+
            '<td><input type="number" value="'+(l.vermogen_kva!=null?l.vermogen_kva:'')+'" data-lid-kva="'+g.id+'|'+i+'"></td>'+
            '<td><div class="rating-cell"><input type="checkbox" data-lid-heeft-sensor="'+g.id+'|'+i+'" '+(l.rating_a!=null?'checked':'')+' title="'+t('beheer.heeftSensorTitle')+'">'+
              '<input type="number" placeholder="—" value="'+(l.rating_a!=null?l.rating_a:'')+'" data-lid-rating="'+g.id+'|'+i+'" title="'+t('beheer.ledenRatingTitle')+'" '+(l.rating_a==null?'disabled':'')+'></div></td>'+
            '<td style="min-width:150px"><div class="shelly-cell"><input placeholder="'+(l.rating_a!=null?t('beheer.shellyIpPlaceholder'):'—')+'" value="'+(l.shelly_ip||'').replace(/"/g,'&quot;')+'" data-lid-shelly="'+g.id+'|'+i+'" title="'+t('beheer.shellyIpTitle').replace(/"/g,'&quot;')+'" '+(l.rating_a==null?'disabled':'')+'>'+
              '<button class="mqtt-copy-btn" data-mqtt-copy="'+(l.mqtt_topic_prefix||'')+'" title="'+t('beheer.mqttKopieerTitle')+'">📋</button>'+
              vervangIndicatorHtml(l.vervangingen)+'</div></td>'+
            '<td><div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">'+
              (vervangFormOpen.has('lid:'+g.id+'|'+i)
                ? vervangFormHtml('lid:'+g.id+'|'+i)
                : ((l.shelly_ip?'<span class="shelly-cfg"><input type="checkbox" class="shelly-cfg-script" checked title="'+t('beheer.shellyConfigureerScriptTitle')+'"><button class="shelly-cfg-btn" data-shelly-cfg-type="lid" data-shelly-cfg-id="'+(l.id||'')+'" data-shelly-cfg-generator="'+g.id+'" title="'+t('beheer.shellyConfigureren')+'">⚙️</button></span>':'')+
                   vervangOpenKnopHtml('lid:'+g.id+'|'+i)+
                   '<button data-lid-del="'+g.id+'|'+i+'" class="danger">×</button>')
              )+
            '</div></td>'+
          '</tr>'
        ).join('')+
        '<tr>'+
          '<td><input placeholder="'+t('beheer.ledenNewPlaceholder')+'" data-lid-new-naam="'+g.id+'"></td>'+
          '<td><select data-lid-new-type="'+g.id+'"><option value="generator">'+t('beheer.typeGenerator')+'</option><option value="batterij">'+t('beheer.typeBatterij')+'</option></select></td>'+
          '<td><input type="number" placeholder="'+t('beheer.kvaPlaceholder')+'" data-lid-new-kva="'+g.id+'"></td>'+
          '<td></td>'+
          '<td></td>'+
          '<td><button data-lid-add="'+g.id+'">+</button></td>'+
        '</tr>'+
        '</table></td></tr>';
    }
  });
  // vervolgticket-ui-schaling-4k-addform.md: het "+ Generator"-formulier stond als losse
  // .addform-div ONDER de tabel (niet als echte <tr>), dus de inputs kregen nooit dezelfde
  // kolombreedtes als het echte auto-table-layout — leek bij de oude, smallere .beheercol-max-width
  // toevallig ongeveer uit te lijnen, maar viel zichtbaar uit elkaar zodra de tabel breder werd (zie
  // de .beheercol flex:1-fix hierboven). Nu een echte trailing <tr> in dezelfde tabel, zelfde
  // patroon als de al langer bestaande "+"-rij in de leden-subtabel verderop in dit bestand — lijnt
  // daardoor per definitie uit, ongeacht schermbreedte. Kolommen zonder invoerveld bij het aanmaken
  // (type/shelly-ip/#kasten/soort koppeling/leden) blijven leeg, net als bij die leden-rij.
  gh += '<tr>'+(groepeerSelectieActief?'<td></td>':'')+
    '<td><input id="newGenNaam" placeholder="'+t('beheer.newGenNaamPlaceholder')+'"></td>'+
    '<td></td>'+
    '<td><input id="newGenKva" type="number" placeholder="'+t('beheer.kvaPlaceholder')+'"></td>'+
    '<td><input id="newGenRating" type="number" placeholder="'+t('beheer.ratingOptioneelPlaceholder')+'"></td>'+
    '<td></td><td></td><td></td><td></td>'+
    '<td><button id="addGenBtn">'+t('beheer.addGenerator')+'</button></td>'+
    '</tr>';
  genTable.innerHTML = gh;
  document.getElementById('addGenBtn').onclick = handleAddGenerator;

  genTable.querySelectorAll('[data-mqtt-copy]').forEach(el=>el.onclick = ()=> kopieerMqttPrefix(el.dataset.mqttCopy, el));

  genTable.querySelectorAll('[data-shelly-cfg-type]').forEach(btn=>{
    btn.onclick = ()=>{
      const type = btn.dataset.shellyCfgType;
      const id = btn.dataset.shellyCfgId;
      const generatorId = btn.dataset.shellyCfgGenerator;
      const scriptChk = btn.parentElement.querySelector('.shelly-cfg-script');
      let naam = id;
      if(type==='generator'){ const g = state.TOPO.generators.find(x=>x.id===id); naam = g ? g.naam : id; }
      if(type==='lid'){
        const g = state.TOPO.generators.find(x=>x.id===generatorId);
        const l = g && (g.leden||[]).find(x=>x.id===id);
        naam = (g?g.naam:'') + (l?' — '+l.naam:'');
      }
      if(bevestigShellyConfiguratie(naam)) startShellyConfiguratie({doelType:type, id, generatorId, naam}, scriptChk ? scriptChk.checked : true);
    };
  });

  // specs/shelly-vervanging-plan.md: generator-/lid-tegenhanger van maakVervangForm()/
  // maakVervangOpenKnop() bij de kast-rij hierboven — string-gebouwd + gedelegeerde events, zelfde
  // patroon-verschil als de rest van dit bestand tussen kast- en generator-/lid-rijen.
  genTable.querySelectorAll('.vervang-open-btn').forEach(btn=>{
    btn.onclick = ()=>{ vervangFormOpen.add(btn.dataset.vervangKey); renderBeheer(); };
  });
  genTable.querySelectorAll('.vervang-annuleer-btn').forEach(btn=>{
    btn.onclick = ()=>{
      vervangFormOpen.delete(btn.closest('[data-vervang-key]').dataset.vervangKey);
      renderBeheer();
    };
  });
  genTable.querySelectorAll('.vervang-bevestig-btn').forEach(btn=>{
    btn.onclick = async ()=>{
      const formEl = btn.closest('[data-vervang-key]');
      const key = formEl.dataset.vervangKey;
      const nieuwIp = formEl.querySelector('.vervang-ip-input').value.trim();
      const scriptChk = formEl.querySelector('.vervang-script-chk');
      if(!nieuwIp) return;
      btn.disabled = true;
      try{
        let doel;
        if(key.startsWith('generator:')){
          const id = key.slice('generator:'.length);
          await apiCall('/api/generators/'+id, 'PUT', {shelly_ip: nieuwIp});
          vervangFormOpen.delete(key);
          await loadTopology(); // herbouwt de tabel al zonder deze key -> normale knoppen terug
          const g = state.TOPO.generators.find(x=>x.id===id);
          doel = {doelType:'generator', id, naam: g?g.naam:id};
        } else {
          const [genId, idx] = key.slice('lid:'.length).split('|');
          const leden = huidigeLeden(genId); leden[idx].shelly_ip = nieuwIp;
          vervangFormOpen.delete(key);
          await saveLeden(genId, leden); // roept zelf al loadTopology() aan
          const g = state.TOPO.generators.find(x=>x.id===genId);
          const l = g && g.leden[idx];
          doel = {doelType:'lid', id: l?l.id:'', generatorId: genId, naam: (g?g.naam:'')+(l?' — '+l.naam:'')};
        }
        startShellyConfiguratie(doel, scriptChk.checked);
      }catch(e){ alert(e.message); btn.disabled = false; }
    };
  });

  if(groepeerSelectieActief){
    genTable.querySelectorAll('.gen-groepeer-check').forEach(el=>el.onchange = ()=>{
      const id = el.dataset.genId;
      if(el.checked) groepeerGeselecteerd.add(id); else groepeerGeselecteerd.delete(id);
      ververGroepeerActiebalk();
    });
  }

  // stuurt de volledige ledenlijst van een groep naar de server; edits zelf blijven index-gebaseerd
  // (simpelste manier om vanuit deze tabel te muteren), maar huidigeLeden() kopieert ook het
  // bestaande `id`/`mqtt_topic_prefix`/`rating_a` van elk lid mee, dus die blijven behouden — de
  // server genereert alleen een nieuw id voor een lid dat er nog geen heeft (zie
  // voorzieLedenVanIdEnPrefix() in server.js)
  async function saveLeden(genId, leden){
    try{ await apiCall('/api/generators/'+genId, 'PUT', {leden}); await loadTopology(); }
    catch(e){ alert(e.message); }
  }
  function huidigeLeden(genId){ return (state.TOPO.generators.find(g=>g.id===genId)||{leden:[]}).leden.map(l=>({...l})); }

  genTable.querySelectorAll('[data-gen-naam]').forEach(el=>el.onchange = async ()=>{
    try{ await apiCall('/api/generators/'+el.dataset.genNaam, 'PUT', {naam: el.value}); await loadTopology(); }
    catch(e){ alert(e.message); }
  });
  genTable.querySelectorAll('[data-gen-kva]').forEach(el=>el.onchange = async ()=>{
    try{ await apiCall('/api/generators/'+el.dataset.genKva, 'PUT', {vermogen_kva: el.value}); await loadTopology(); }
    catch(e){ alert(e.message); }
  });
  genTable.querySelectorAll('[data-gen-rating]').forEach(el=>el.onchange = async ()=>{
    try{ await apiCall('/api/generators/'+el.dataset.genRating, 'PUT', {rating_a: el.value}); await loadTopology(); }
    catch(e){ alert(e.message); }
  });
  genTable.querySelectorAll('[data-gen-shelly]').forEach(el=>el.onchange = async ()=>{
    try{ await apiCall('/api/generators/'+el.dataset.genShelly, 'PUT', {shelly_ip: el.value.trim() || null}); await loadTopology(); }
    catch(e){ alert(e.message); }
  });
  // uitvinken wist meteen de rating (opzettelijke "geen sensor"-declaratie, geen halve toestand);
  // aanvinken opent alleen het invoerveld, de save gebeurt pas via de rating-onchange hierboven
  // zodra Mike er ook echt een waarde intypt
  genTable.querySelectorAll('[data-gen-heeft-sensor]').forEach(el=>el.onchange = async ()=>{
    const id = el.dataset.genHeeftSensor;
    const ratingInput = genTable.querySelector('[data-gen-rating="'+id+'"]');
    const shellyInput = genTable.querySelector('[data-gen-shelly="'+id+'"]');
    if(!el.checked){
      ratingInput.value = ''; ratingInput.disabled = true;
      shellyInput.value = ''; shellyInput.disabled = true;
      try{ await apiCall('/api/generators/'+id, 'PUT', {rating_a: '', shelly_ip: null}); await loadTopology(); }
      catch(e){ alert(e.message); }
    } else {
      ratingInput.disabled = false; ratingInput.focus();
      shellyInput.disabled = false;
    }
  });
  genTable.querySelectorAll('[data-gen-type]').forEach(el=>el.onchange = async ()=>{
    try{ await apiCall('/api/generators/'+el.dataset.genType, 'PUT', {type: el.value}); await loadTopology(); }
    catch(e){ alert(e.message); }
  });
  genTable.querySelectorAll('[data-gen-soort]').forEach(el=>el.onchange = async ()=>{
    try{ await apiCall('/api/generators/'+el.dataset.genSoort, 'PUT', {groep_soort: el.value}); await loadTopology(); }
    catch(e){ alert(e.message); }
  });
  genTable.querySelectorAll('[data-groep-toggle]').forEach(el=>el.onclick = ()=>{
    const id = el.dataset.groepToggle;
    if(expandedGroepen.has(id)) expandedGroepen.delete(id); else expandedGroepen.add(id);
    renderBeheer();
  });
  genTable.querySelectorAll('[data-lid-naam]').forEach(el=>el.onchange = async ()=>{
    const [genId, idx] = el.dataset.lidNaam.split('|');
    const leden = huidigeLeden(genId); leden[idx].naam = el.value;
    await saveLeden(genId, leden);
  });
  genTable.querySelectorAll('[data-lid-type]').forEach(el=>el.onchange = async ()=>{
    const [genId, idx] = el.dataset.lidType.split('|');
    const leden = huidigeLeden(genId); leden[idx].type = el.value;
    await saveLeden(genId, leden);
  });
  genTable.querySelectorAll('[data-lid-kva]').forEach(el=>el.onchange = async ()=>{
    const [genId, idx] = el.dataset.lidKva.split('|');
    const leden = huidigeLeden(genId); leden[idx].vermogen_kva = el.value ? Number(el.value) : null;
    await saveLeden(genId, leden);
  });
  genTable.querySelectorAll('[data-lid-rating]').forEach(el=>el.onchange = async ()=>{
    const [genId, idx] = el.dataset.lidRating.split('|');
    const leden = huidigeLeden(genId); leden[idx].rating_a = el.value ? Number(el.value) : null;
    await saveLeden(genId, leden);
  });
  genTable.querySelectorAll('[data-lid-shelly]').forEach(el=>el.onchange = async ()=>{
    const [genId, idx] = el.dataset.lidShelly.split('|');
    const leden = huidigeLeden(genId); leden[idx].shelly_ip = el.value.trim() || null;
    await saveLeden(genId, leden);
  });
  // zelfde opzettelijke-uitvinken-wist-meteen-patroon als bij data-gen-heeft-sensor hierboven
  genTable.querySelectorAll('[data-lid-heeft-sensor]').forEach(el=>el.onchange = async ()=>{
    const [genId, idx] = el.dataset.lidHeeftSensor.split('|');
    const ratingInput = genTable.querySelector('[data-lid-rating="'+genId+'|'+idx+'"]');
    const shellyInput = genTable.querySelector('[data-lid-shelly="'+genId+'|'+idx+'"]');
    if(!el.checked){
      ratingInput.value = ''; ratingInput.disabled = true;
      shellyInput.value = ''; shellyInput.disabled = true;
      const leden = huidigeLeden(genId); leden[idx].rating_a = null; leden[idx].shelly_ip = null;
      await saveLeden(genId, leden);
    } else {
      ratingInput.disabled = false; ratingInput.focus();
      shellyInput.disabled = false;
    }
  });
  genTable.querySelectorAll('[data-lid-del]').forEach(el=>el.onclick = async ()=>{
    const [genId, idx] = el.dataset.lidDel.split('|');
    const leden = huidigeLeden(genId); leden.splice(idx, 1);
    await saveLeden(genId, leden);
  });
  genTable.querySelectorAll('[data-lid-add]').forEach(el=>el.onclick = async ()=>{
    const genId = el.dataset.lidAdd;
    const naamEl = genTable.querySelector('[data-lid-new-naam="'+genId+'"]');
    const typeEl = genTable.querySelector('[data-lid-new-type="'+genId+'"]');
    const kvaEl = genTable.querySelector('[data-lid-new-kva="'+genId+'"]');
    const naam = naamEl.value.trim();
    if(!naam) return;
    expandedGroepen.add(genId);
    const leden = huidigeLeden(genId);
    leden.push({ naam, type: typeEl.value, vermogen_kva: kvaEl.value ? Number(kvaEl.value) : null });
    await saveLeden(genId, leden);
  });
  genTable.querySelectorAll('[data-gen-del]').forEach(el=>el.onclick = async ()=>{
    if(!confirm(t('beheer.confirmGeneratorVerwijderen'))) return;
    try{ await apiCall('/api/generators/'+el.dataset.genDel, 'DELETE'); await loadTopology(); }
    catch(e){ alert(e.message); }
  });

  renderKastSecties();

  // "nieuwe kast" formulier: generator/parent-dropdowns vullen
  const newGenSel = document.getElementById('newKastGen');
  const newParentSel = document.getElementById('newKastParent');
  const huidigeKeuze = newGenSel.value;
  vulGenSelect(newGenSel, huidigeKeuze);
  vulParentSelect(newParentSel, newGenSel.value, null, null);
  newGenSel.onchange = ()=> vulParentSelect(newParentSel, newGenSel.value, null, null);
}

// #addGenBtn zit nu ín de dynamisch opgebouwde tabel-HTML (zie de trailing <tr> hierboven in
// renderBeheer()), dus wordt bij elke render vervangen — de handler kan hier niet meer eenmalig
// op het element gebonden worden, renderBeheer() zet 'm elke keer opnieuw vast (zie onderaan die functie).
async function handleAddGenerator(){
  const naam = document.getElementById('newGenNaam').value.trim();
  const kva = document.getElementById('newGenKva').value;
  const rating = document.getElementById('newGenRating').value;
  if(!naam || !kva) return alert(t('beheer.alertVulNaamKva'));
  try{
    await apiCall('/api/generators', 'POST', {naam, vermogen_kva: kva, rating_a: rating || undefined});
    await loadTopology();
  }catch(e){ alert(e.message); }
}

// zet de generator + de hele parent-keten van een net toegevoegde kast open in de Kalibreren/Live-
// zijlijst (sidebarState — los van beheerState, de eigen in-/uitklapstatus van de Beheer-tabel
// zelf), zodat de nieuwe kast daar meteen zichtbaar is i.p.v. verstopt achter een dichtgeklapte
// sectie die je voorheen zelf had ingeklapt
function openAncestorsInSidebar(generatorId, parentId){
  sidebarState[generatorId] = true;
  let cur = parentId;
  while(cur){
    sidebarState[cur] = true;
    const k = state.TOPO.kasten.find(x=>x.id===cur);
    cur = k ? k.parent : null;
  }
  saveSidebarState();
}

document.getElementById('addKastBtn').onclick = async ()=>{
  const naam = document.getElementById('newKastNaam').value.trim();
  const afkorting = document.getElementById('newKastAfk').value.trim();
  const rating_a = document.getElementById('newKastRating').value;
  const generator = document.getElementById('newKastGen').value;
  const parent = document.getElementById('newKastParent').value;
  if(!naam || !rating_a || !generator) return alert(t('beheer.alertVulNaamAmpKast'));
  try{
    await apiCall('/api/kasten', 'POST', {naam, rating_a, generator, parent: parent || null, afkorting: afkorting || undefined});
    document.getElementById('newKastNaam').value=''; document.getElementById('newKastAfk').value=''; document.getElementById('newKastRating').value='';
    // vóór loadTopology() (die zelf al renderList() aanroept), anders toont die ene render nog de
    // oude, mogelijk dichtgeklapte sidebarState
    openAncestorsInSidebar(generator, parent || null);
    await loadTopology();
  }catch(e){ alert(e.message); }
};

document.getElementById('resetAllBtn').onclick = async ()=>{
  if(!confirm(t('beheer.confirmAllesWissen'))) return;
  await apiCall('/api/reset', 'POST');
  state.selectedId = null; state.armedId = null;
  await loadTopology();
};
