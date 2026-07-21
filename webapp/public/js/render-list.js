import { state, listEl, sidebarState, saveSidebarState, isNodeOpen, MANY_GENERATORS_THRESHOLD } from './state.js';
import { listChildrenOf, collectDescendantKasten, statusCounts, statusOf, statusClass, maxFaseStroom, isGen, typeIcon } from './topology.js';
import { liveData } from './state.js';
import { renderDetail } from './render-detail.js';
import { renderPins } from './render-pins.js';
import { t } from './i18n.js';

function makeBadge(kind, n){
  const b = document.createElement('span');
  b.className = 'badge badge-'+kind;
  b.textContent = n;
  return b;
}

// bepaalt, voor de hele boom, welke generatoren/kasten-met-kinderen open of dicht staan —
// leest/vult sidebarState (met defaults uit punt 3 van de spec) zodat dit overal (rendering
// én de "alles in-/uitklappen"-knop) dezelfde bron van waarheid gebruikt
function computeOpenStates(){
  const states = {};
  const manyGenerators = state.TOPO.generators.length > MANY_GENERATORS_THRESHOLD;
  function visit(node, isGenerator){
    const kids = listChildrenOf(node);
    if(kids.length){
      const defaultOpen = isGenerator ? (!manyGenerators || statusCounts(node).amber>0 || statusCounts(node).red>0) : false;
      states[node.id] = isNodeOpen(node.id, defaultOpen);
    }
    kids.forEach(k=>visit(k, false));
  }
  state.TOPO.generators.forEach(g=>visit(g, true));
  return states;
}

export function renderList(){
  listEl.innerHTML = '';
  const query = state.listSearchQuery.trim().toLowerCase();
  const filter = state.listStatusFilter;
  const searching = !!query || filter!=='alles';
  const openStates = computeOpenStates();

  function kastMatchesFilter(k){
    const textOk = !query || k.naam.toLowerCase().includes(query) || (k.afkorting && k.afkorting.toLowerCase().includes(query));
    if(!textOk) return false;
    if(filter==='alles') return true;
    const s = statusOf(k);
    if(filter==='rood') return s==='red';
    return s==='amber' || s==='red';
  }
  const subtreeMatchCache = new Map();
  function subtreeMatches(node){
    if(subtreeMatchCache.has(node.id)) return subtreeMatchCache.get(node.id);
    let result = !isGen(node) && kastMatchesFilter(node);
    if(!result) result = listChildrenOf(node).some(subtreeMatches);
    subtreeMatchCache.set(node.id, result);
    return result;
  }

  function renderChildren(container, node, depth){
    listChildrenOf(node).forEach(k=>{
      if(searching && !subtreeMatches(k)) return;
      const heeftKinderen = listChildrenOf(k).length > 0;
      const row = document.createElement('div');
      row.className = 'row' + (k.id===state.selectedId?' selected':'') + (state.mode==='cal' && k.id===state.armedId?' selected':'') + (heeftKinderen?' parent':'');
      row.style.paddingLeft = (14 + depth*14) + 'px';

      const chev = document.createElement('span');
      chev.className = 'chev';
      let open = false;
      if(heeftKinderen){
        open = searching ? true : openStates[k.id];
        chev.textContent = open ? '▾' : '▸';
        chev.onclick = (e)=>{ e.stopPropagation(); sidebarState[k.id] = !openStates[k.id]; saveSidebarState(); renderList(); };
      }
      row.appendChild(chev);

      const dot = document.createElement('div');
      dot.className = 'dot2 ' + statusClass(k);
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = (k.type==='batterij'?'🔋 ':'') + k.naam + (k.afkorting ? ' (' + k.afkorting + ')' : '');
      row.appendChild(dot); row.appendChild(name);

      if(heeftKinderen){
        const sub = document.createElement('div');
        sub.className = 'sub2';
        sub.textContent = t('aside.onderliggend', {n: collectDescendantKasten(k).length});
        row.appendChild(sub);
      } else {
        const val = document.createElement('div');
        val.className = 'val';
        const maxFase = maxFaseStroom(liveData[k.id]);
        val.textContent = maxFase!=null ? maxFase.toFixed(1)+'A' : (k.positie && k.positie.x_pct!=null?'—':t('aside.nietGeplaatst'));
        row.appendChild(val);
      }

      row.onclick = ()=>{
        if(state.mode==='cal'){ state.armedId = k.id; document.getElementById('armedLabel').textContent = t('calbar.armedLabel', {naam: k.naam}); }
        state.selectedId = k.id; renderList(); renderDetail(); renderPins();
      };
      container.appendChild(row);

      if(heeftKinderen && open) renderChildren(container, k, depth+1);
    });
  }

  state.TOPO.generators.forEach(gen=>{
    if(searching && !subtreeMatches(gen)) return;
    const heeftKinderen = listChildrenOf(gen).length > 0;
    const gh = document.createElement('div');
    gh.className = 'genrow' + (gen.id===state.selectedId?' selected':'') + (state.mode==='cal' && gen.id===state.armedId?' selected':'');

    // bovenste regel: chev + eigen statusstip (self-meter t.o.v. eigen rating_a) + naam + eigen
    // waarde. Onderste regel (sub, alleen als er kinderen zijn): expliciet gelabeld "onderliggend:"
    // vóór de badges, zodat niet twee losse signalen (eigen status vs. status van de kasten
    // eronder) door elkaar naast de naam lijken te staan — zie generator-em-rework-plan.md §4.
    const top = document.createElement('div');
    top.className = 'genrow-top';

    const chev = document.createElement('span');
    chev.className = 'chev';
    let open = false;
    if(heeftKinderen){
      open = searching ? true : openStates[gen.id];
      chev.textContent = open ? '▾' : '▸';
      chev.onclick = (e)=>{ e.stopPropagation(); sidebarState[gen.id] = !openStates[gen.id]; saveSidebarState(); renderList(); };
    }
    top.appendChild(chev);

    if(gen.rating_a!=null){
      const dot = document.createElement('div');
      dot.className = 'dot2 ' + statusClass(gen);
      top.appendChild(dot);
    }

    const genName = document.createElement('div');
    genName.className = 'name';
    genName.textContent = typeIcon(gen)+' '+gen.naam + ' · ' + gen.vermogen_kva + ' kVA' + (gen.type==='groep' ? ' '+t('aside.ledenSuffix', {n: gen.leden.length}) : '');
    top.appendChild(genName);

    const genVal = document.createElement('div');
    genVal.className = 'val';
    const genMaxFase = maxFaseStroom(liveData[gen.id]);
    genVal.textContent = genMaxFase!=null ? genMaxFase.toFixed(1)+'A' : (gen.positie && gen.positie.x_pct!=null ? '—' : t('aside.nietGeplaatst'));
    top.appendChild(genVal);
    gh.appendChild(top);

    if(heeftKinderen){
      const counts = statusCounts(gen);
      const sub = document.createElement('div');
      sub.className = 'genrow-sub';
      const label = document.createElement('span');
      label.className = 'taglabel';
      label.textContent = t('aside.onderliggendLabel');
      sub.appendChild(label);
      const badges = document.createElement('div');
      badges.className = 'badges';
      if(counts.green) badges.appendChild(makeBadge('green', counts.green));
      if(counts.amber) badges.appendChild(makeBadge('amber', counts.amber));
      if(counts.red) badges.appendChild(makeBadge('red', counts.red));
      sub.appendChild(badges);
      gh.appendChild(sub);
    }

    gh.onclick = ()=>{
      if(state.mode==='cal'){ state.armedId = gen.id; document.getElementById('armedLabel').textContent = t('calbar.armedLabel', {naam: gen.naam}); }
      state.selectedId = gen.id; renderList(); renderDetail(); renderPins();
    };
    listEl.appendChild(gh);

    if(heeftKinderen && open) renderChildren(listEl, gen, 0);
  });

  const collapsibleIds = Object.keys(openStates);
  const openCount = collapsibleIds.filter(id=>openStates[id]).length;
  const toggleAllBtn = document.getElementById('listToggleAllBtn');
  const expandAction = openCount===0 && collapsibleIds.length>0;
  toggleAllBtn.textContent = expandAction ? t('common.allesUitklappen') : t('common.allesInklappen');
  toggleAllBtn.onclick = ()=>{
    collapsibleIds.forEach(id=>{ sidebarState[id] = expandAction; });
    saveSidebarState();
    renderList();
  };
}

document.getElementById('listSearch').addEventListener('input', (e)=>{
  state.listSearchQuery = e.target.value;
  renderList();
});
// scoped op #listtools (i.p.v. het bredere ".listfilters .chip" uit de originele monoliet, dat ook
// de Beheer-kastfilters en rapport-periodechips raakte en alleen klopte dankzij toevallige
// script-volgorde/last-write-wins op .onclick) — zelfde eindresultaat, maar niet meer afhankelijk
// van de volgorde waarin modules geladen worden.
document.querySelectorAll('#listtools .chip').forEach(chip=>{
  chip.onclick = ()=>{
    state.listStatusFilter = chip.dataset.filter;
    document.querySelectorAll('#listtools .chip').forEach(c=>c.classList.toggle('active', c===chip));
    renderList();
  };
});
