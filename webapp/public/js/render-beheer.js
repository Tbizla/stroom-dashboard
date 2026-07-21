// ---------- Beheer: generators & kasten aanmaken, bewerken, koppelen, verwijderen ----------
import { state, beheerState, saveBeheerState, isBeheerNodeOpen, expandedGroepen } from './state.js';
import { listChildrenOf, collectDescendantKasten, genNaam, typeIcon } from './topology.js';
import { apiCall } from './api.js';
import { loadTopology } from './topology.js';
import { t } from './i18n.js';

export function vulGenSelect(select, geselecteerd){
  select.innerHTML = state.TOPO.generators.map(g=>'<option value="'+g.id+'"'+(g.id===geselecteerd?' selected':'')+'>'+typeIcon(g)+' '+g.naam+'</option>').join('');
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
    kastVeld(tr, naamWrap);

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
    kastVeld(tr, genSel, {style:'min-width:150px'});
    kastVeld(tr, parentSel, {style:'min-width:190px'});

    const delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.textContent = t('common.verwijderen');
    delBtn.onclick = async ()=>{
      if(!confirm(t('beheer.confirmKastVerwijderen'))) return;
      try{ await apiCall('/api/kasten/'+k.id, 'DELETE'); await loadTopology(); }
      catch(e){ alert(e.message); }
    };
    kastVeld(tr, delBtn, {style:'min-width:80px'});

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
        '<th style="min-width:90px">'+t('beheer.thBypass')+'</th><th style="min-width:150px">'+t('beheer.thGenerator')+'</th><th style="min-width:190px">'+t('beheer.thGevoedVanaf')+'</th><th style="min-width:80px"></th></tr>';
      listChildrenOf(gen).forEach(k=>{
        if(searching && !subtreeMatches(k)) return;
        kastRij(tabel, k, 0);
      });
      sectie.appendChild(tabel);

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
  let gh = '<tr><th>'+t('beheer.thNaam')+'</th><th style="min-width:110px">'+t('beheer.thType')+'</th><th style="min-width:80px">'+t('beheer.thKva')+'</th><th style="min-width:90px">'+t('beheer.thRating')+'</th>'+
    '<th style="min-width:70px">'+t('beheer.thAantalKasten')+'</th><th style="min-width:140px">'+t('beheer.thSoortKoppeling')+'</th><th style="min-width:110px">'+t('beheer.thLeden')+'</th><th style="min-width:80px"></th></tr>';
  state.TOPO.generators.forEach(g=>{
    const aantal = state.TOPO.kasten.filter(k=>k.generator===g.id).length;
    const type = g.type || 'generator';
    const isGroep = type === 'groep';
    if(!Array.isArray(g.leden)) g.leden = []; // oudere generators (van vóór dit veld bestond) missen 'leden' nog
    gh += '<tr>'+
      '<td><input value="'+g.naam.replace(/"/g,'&quot;')+'" data-gen-naam="'+g.id+'"></td>'+
      '<td><select data-gen-type="'+g.id+'">'+
        '<option value="generator"'+(type==='generator'?' selected':'')+'>'+t('beheer.typeGenerator')+'</option>'+
        '<option value="batterij"'+(type==='batterij'?' selected':'')+'>'+t('beheer.typeBatterij')+'</option>'+
        '<option value="groep"'+(type==='groep'?' selected':'')+'>'+t('beheer.typeGroep')+'</option>'+
      '</select></td>'+
      '<td><input type="number" value="'+g.vermogen_kva+'" data-gen-kva="'+g.id+'"></td>'+
      '<td><input type="number" placeholder="—" value="'+(g.rating_a!=null?g.rating_a:'')+'" data-gen-rating="'+g.id+'" title="'+t('beheer.ratingTitle')+'"></td>'+
      '<td>'+aantal+'</td>'+
      '<td><select data-gen-soort="'+g.id+'" '+(isGroep?'':'disabled')+'>'+
        '<option value=""'+(!g.groep_soort?' selected':'')+'>'+t('beheer.soortLeeg')+'</option>'+
        '<option value="parallel"'+(g.groep_soort==='parallel'?' selected':'')+'>'+t('beheer.soortParallel')+'</option>'+
        '<option value="backup"'+(g.groep_soort==='backup'?' selected':'')+'>'+t('beheer.soortBackup')+'</option>'+
        '<option value="hybride"'+(g.groep_soort==='hybride'?' selected':'')+'>'+t('beheer.soortHybride')+'</option>'+
      '</select></td>'+
      '<td>'+(isGroep ? '<button data-groep-toggle="'+g.id+'">'+t('beheer.ledenBtn', {n: g.leden.length})+' '+(expandedGroepen.has(g.id)?'▴':'▾')+'</button>' : '—')+'</td>'+
      '<td><button data-gen-del="'+g.id+'" class="danger">'+t('common.verwijderen')+'</button></td>'+
      '</tr>';
    if(isGroep && expandedGroepen.has(g.id)){
      gh += '<tr class="ledenrow"><td colspan="8"><table class="btable ledentable">'+
        '<tr><th>'+t('beheer.ledenTableThNaam')+'</th><th style="min-width:110px">'+t('beheer.thType')+'</th><th style="min-width:90px">'+t('beheer.thKva')+'</th><th style="min-width:70px"></th></tr>'+
        g.leden.map((l,i)=>
          '<tr>'+
            '<td><input value="'+l.naam.replace(/"/g,'&quot;')+'" data-lid-naam="'+g.id+'|'+i+'"></td>'+
            '<td><select data-lid-type="'+g.id+'|'+i+'"><option value="generator"'+(l.type!=='batterij'?' selected':'')+'>'+t('beheer.typeGenerator')+'</option><option value="batterij"'+(l.type==='batterij'?' selected':'')+'>'+t('beheer.typeBatterij')+'</option></select></td>'+
            '<td><input type="number" value="'+(l.vermogen_kva!=null?l.vermogen_kva:'')+'" data-lid-kva="'+g.id+'|'+i+'"></td>'+
            '<td><button data-lid-del="'+g.id+'|'+i+'" class="danger">×</button></td>'+
          '</tr>'
        ).join('')+
        '<tr>'+
          '<td><input placeholder="'+t('beheer.ledenNewPlaceholder')+'" data-lid-new-naam="'+g.id+'"></td>'+
          '<td><select data-lid-new-type="'+g.id+'"><option value="generator">'+t('beheer.typeGenerator')+'</option><option value="batterij">'+t('beheer.typeBatterij')+'</option></select></td>'+
          '<td><input type="number" placeholder="'+t('beheer.kvaPlaceholder')+'" data-lid-new-kva="'+g.id+'"></td>'+
          '<td><button data-lid-add="'+g.id+'">+</button></td>'+
        '</tr>'+
        '</table></td></tr>';
    }
  });
  genTable.innerHTML = gh;

  // stuurt de volledige ledenlijst van een groep naar de server; index-gebaseerd (geen eigen id's nodig,
  // leden zijn puur beschrijvend en worden nergens anders naar verwezen)
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

document.getElementById('addGenBtn').onclick = async ()=>{
  const naam = document.getElementById('newGenNaam').value.trim();
  const kva = document.getElementById('newGenKva').value;
  const rating = document.getElementById('newGenRating').value;
  if(!naam || !kva) return alert(t('beheer.alertVulNaamKva'));
  try{
    await apiCall('/api/generators', 'POST', {naam, vermogen_kva: kva, rating_a: rating || undefined});
    document.getElementById('newGenNaam').value=''; document.getElementById('newGenKva').value=''; document.getElementById('newGenRating').value='';
    await loadTopology();
  }catch(e){ alert(e.message); }
};

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
    await loadTopology();
  }catch(e){ alert(e.message); }
};

document.getElementById('resetAllBtn').onclick = async ()=>{
  if(!confirm(t('beheer.confirmAllesWissen'))) return;
  await apiCall('/api/reset', 'POST');
  state.selectedId = null; state.armedId = null;
  await loadTopology();
};
