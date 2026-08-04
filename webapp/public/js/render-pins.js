import { state, svg, mapimg, mapinner } from './state.js';
import { allNodes, isGen, nodeById, getSurfaceEl, statusClass, savePositie, saveKnikpunten, typeIcon } from './topology.js';
import { renderList } from './render-list.js';
import { renderDetail } from './render-detail.js';
import { renderKastPopup } from './kastpopup.js';
import { t } from './i18n.js';
import { heeftActieveAnomaly, anomalyTekst, bevestigAnomaly } from './anomaly.js';

// ---------- rechtsklik-mini-menu (knikpunten toevoegen/resetten) — enige contextmenu-gebruiker in
// de app, dus geen apart module nodig; sluit op klik erbuiten of Escape ----------
let openCtxMenu = null;
function closeCtxMenu(){
  if(!openCtxMenu) return;
  openCtxMenu.remove(); openCtxMenu = null;
  document.removeEventListener('mousedown', onDocMouseDownForCtx, true);
  document.removeEventListener('keydown', onDocKeydownForCtx, true);
}
function onDocMouseDownForCtx(ev){ if(openCtxMenu && !openCtxMenu.contains(ev.target)) closeCtxMenu(); }
function onDocKeydownForCtx(ev){ if(ev.key==='Escape') closeCtxMenu(); }
function showCtxMenu(clientX, clientY, items){
  closeCtxMenu();
  const menu = document.createElement('div');
  menu.className = 'ctxmenu';
  items.forEach(it=>{
    const row = document.createElement('div');
    row.className = 'item' + (it.danger ? ' danger' : '');
    row.textContent = it.label;
    row.onclick = ()=>{ closeCtxMenu(); it.onClick(); };
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  menu.style.left = clientX + 'px';
  menu.style.top = clientY + 'px';
  openCtxMenu = menu;
  // pas volgende tick meeluisteren, anders sluit de rightclick die het menu opent 'm meteen weer
  setTimeout(()=>{
    document.addEventListener('mousedown', onDocMouseDownForCtx, true);
    document.addEventListener('keydown', onDocKeydownForCtx, true);
  }, 0);
}

// ---------- knikpunten-datamutaties: telkens de hele array vervangen + opslaan + herrenderen,
// zelfde "muteer het TOPO-object direct, sla op, render opnieuw"-patroon als savePositie() ----------
function insertKnikpunt(k, segIdx, x_pct, y_pct){
  const knikpunten = (k.knikpunten || []).slice();
  knikpunten.splice(segIdx, 0, {x_pct, y_pct});
  k.knikpunten = knikpunten;
  saveKnikpunten(k);
  renderPins();
}
function verwijderKnikpunt(k, idx){
  const knikpunten = (k.knikpunten || []).slice();
  knikpunten.splice(idx, 1);
  k.knikpunten = knikpunten;
  saveKnikpunten(k);
  renderPins();
}
function resetLijn(k){
  k.knikpunten = [];
  saveKnikpunten(k);
  renderPins();
}

export function renderPins(){
  mapinner.querySelectorAll('.pin,.pinlabel,.knik,.pin-anomaly').forEach(e=>e.remove());
  const surface = getSurfaceEl();
  const w = surface.clientWidth, h = surface.clientHeight;
  if(!w || !h) return;
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.innerHTML = '';

  // alleen op Kalibreren bewerkbaar (handles, hover, dubbelklik/rechtsklik) — op Live volgt de
  // lijn dezelfde route, maar puur ter weergave, geen bewerkinteractie
  const bewerkbaar = state.mode === 'cal';

  state.TOPO.kasten.forEach(k=>{
    const from = k.parent ? nodeById(k.parent) : nodeById(k.generator);
    if(!from || !from.positie || from.positie.x_pct==null || !k.positie || k.positie.x_pct==null) return;
    const knikpunten = k.knikpunten || [];
    const points = [from.positie, ...knikpunten, k.positie];

    for(let i=0; i<points.length-1; i++){
      const p1 = points[i], p2 = points[i+1];
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1', p1.x_pct/100*w);
      line.setAttribute('y1', p1.y_pct/100*h);
      line.setAttribute('x2', p2.x_pct/100*w);
      line.setAttribute('y2', p2.y_pct/100*h);
      line.setAttribute('class', 'edgeline' + (bewerkbaar ? ' hoverable' : ''));
      if(bewerkbaar){
        const segIdx = i; // knikpunten[segIdx] = nieuw punt, splitst dit segment in tweeën
        // voorkomt dat mapwrap's pan-drag start (die luistert op elke mousedown, ook rechtsklik)
        line.onmousedown = (ev)=> ev.stopPropagation();
        line.ondblclick = (ev)=>{
          ev.stopPropagation();
          const rect = getSurfaceEl().getBoundingClientRect();
          const x = Math.max(0,Math.min(100, ((ev.clientX-rect.left)/rect.width)*100));
          const y = Math.max(0,Math.min(100, ((ev.clientY-rect.top)/rect.height)*100));
          insertKnikpunt(k, segIdx, x, y);
        };
        line.oncontextmenu = (ev)=>{
          ev.preventDefault(); ev.stopPropagation();
          const rect = getSurfaceEl().getBoundingClientRect();
          const x = Math.max(0,Math.min(100, ((ev.clientX-rect.left)/rect.width)*100));
          const y = Math.max(0,Math.min(100, ((ev.clientY-rect.top)/rect.height)*100));
          showCtxMenu(ev.clientX, ev.clientY, [
            { label: t('knikpunt.invoegen'), onClick: ()=>insertKnikpunt(k, segIdx, x, y) },
            { label: t('knikpunt.rechtzetten'), danger:true, onClick: ()=>resetLijn(k) },
          ]);
        };
      }
      svg.appendChild(line);
    }

    if(bewerkbaar){
      knikpunten.forEach((p, idx)=>{
        const knik = document.createElement('div');
        knik.className = 'knik';
        knik.style.left = (p.x_pct/100*w)+'px';
        knik.style.top = (p.y_pct/100*h)+'px';
        knik.title = t('knikpunt.sleepTitel');
        knik.onmousedown = (ev)=>{
          ev.stopPropagation();
          // alleen bij daadwerkelijke sleepbeweging opslaan+herrenderen — een kale klik (het begin
          // van een dubbelklik) mag de knik-div niet vervangen, anders ziet de browser de tweede
          // klik van de dubbelklik als een klik op een ander element en vuurt 'dblclick' nooit
          let moved = false;
          const move = (mv)=>{
            moved = true;
            const rect = getSurfaceEl().getBoundingClientRect();
            let x = ((mv.clientX-rect.left)/rect.width)*100;
            let y = ((mv.clientY-rect.top)/rect.height)*100;
            x = Math.max(0,Math.min(100,x)); y = Math.max(0,Math.min(100,y));
            p.x_pct = x; p.y_pct = y;
            knik.style.left = (x/100*w)+'px'; knik.style.top = (y/100*h)+'px';
          };
          const up = ()=>{
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            if(moved){ saveKnikpunten(k); renderPins(); }
          };
          document.addEventListener('mousemove', move);
          document.addEventListener('mouseup', up);
        };
        knik.ondblclick = (ev)=>{ ev.stopPropagation(); verwijderKnikpunt(k, idx); };
        knik.oncontextmenu = (ev)=>{
          ev.preventDefault(); ev.stopPropagation();
          showCtxMenu(ev.clientX, ev.clientY, [
            { label: t('knikpunt.rechtzetten'), danger:true, onClick: ()=>resetLijn(k) },
          ]);
        };
        mapinner.appendChild(knik);
      });
    }
  });

  allNodes().forEach(n=>{
    if(!n.positie || n.positie.x_pct==null) return;
    const pin = document.createElement('div');
    pin.className = 'pin' + (isGen(n)?' gen':'') + ' ' + statusClass(n) + (n.id===state.selectedId?' selected':'');
    pin.style.left = (n.positie.x_pct/100*w)+'px';
    pin.style.top = (n.positie.y_pct/100*h)+'px';
    pin.title = n.naam;
    pin.dataset.id = n.id;
    pin.onmousedown = (ev)=>{
      ev.stopPropagation();
      state.selectedId = n.id; renderList(); renderDetail(); renderPins();
      if(state.mode==='live'){
        state.openPopupKastId = (state.openPopupKastId===n.id) ? null : n.id;
        renderKastPopup();
      }
      if(state.mode!=='cal') return;
      const move = (mv)=>{
        const rect = getSurfaceEl().getBoundingClientRect();
        let x = ((mv.clientX-rect.left)/rect.width)*100;
        let y = ((mv.clientY-rect.top)/rect.height)*100;
        x = Math.max(0,Math.min(100,x)); y = Math.max(0,Math.min(100,y));
        n.positie = {x_pct:x, y_pct:y};
        pin.style.left = (x/100*w)+'px'; pin.style.top = (y/100*h)+'px';
      };
      const up = ()=>{
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        savePositie(n); renderList(); renderPins(); renderDetail();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };
    mapinner.appendChild(pin);

    if(heeftActieveAnomaly(n.id)){
      const anomalyBadge = document.createElement('div');
      anomalyBadge.className = 'pin-anomaly';
      anomalyBadge.textContent = '⚡';
      anomalyBadge.style.left = (n.positie.x_pct/100*w)+'px';
      anomalyBadge.style.top = (n.positie.y_pct/100*h)+'px';
      anomalyBadge.title = t('anomaly.badgeTitel') + ' — ' + anomalyTekst(n.id);
      anomalyBadge.onmousedown = (ev)=>{ ev.stopPropagation(); bevestigAnomaly(n.id); renderPins(); };
      mapinner.appendChild(anomalyBadge);
    }

    const label = document.createElement('div');
    label.className = 'pinlabel';
    label.style.left = (n.positie.x_pct/100*w)+'px';
    label.style.top = (n.positie.y_pct/100*h)+'px';
    label.textContent = isGen(n) ? typeIcon(n)+' '+n.naam : (n.type==='batterij'?'🔋 ':'')+n.naam;
    mapinner.appendChild(label);
  });

  renderKastPopup();
}

mapinner.addEventListener('click', (ev)=>{
  if(ev.target.classList.contains('pin') || ev.target.classList.contains('knik') ||
     ev.target.classList.contains('edgeline') || ev.target.closest('.kastpopup')) return;
  if(state.mode==='live' && state.openPopupKastId){ state.openPopupKastId = null; renderKastPopup(); }
  if(state.mode!=='cal' || !state.armedId) return;
  const rect = getSurfaceEl().getBoundingClientRect();
  const x = ((ev.clientX-rect.left)/rect.width)*100;
  const y = ((ev.clientY-rect.top)/rect.height)*100;
  const n = nodeById(state.armedId);
  n.positie = {x_pct:x, y_pct:y};
  savePositie(n);
  state.armedId = null;
  document.getElementById('armedLabel').textContent = '';
  renderList(); renderPins(); renderDetail();
});

mapimg.addEventListener('load', renderPins);
window.addEventListener('resize', renderPins);
