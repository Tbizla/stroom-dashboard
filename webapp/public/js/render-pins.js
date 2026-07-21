import { state, svg, mapimg, mapinner } from './state.js';
import { allNodes, isGen, nodeById, getSurfaceEl, statusClass, savePositie, typeIcon } from './topology.js';
import { renderList } from './render-list.js';
import { renderDetail } from './render-detail.js';
import { renderKastPopup } from './kastpopup.js';

export function renderPins(){
  mapinner.querySelectorAll('.pin,.pinlabel').forEach(e=>e.remove());
  const surface = getSurfaceEl();
  const w = surface.clientWidth, h = surface.clientHeight;
  if(!w || !h) return;
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.innerHTML = '';

  state.TOPO.kasten.forEach(k=>{
    const from = k.parent ? nodeById(k.parent) : nodeById(k.generator);
    if(!from || !from.positie || from.positie.x_pct==null || !k.positie || k.positie.x_pct==null) return;
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', from.positie.x_pct/100*w);
    line.setAttribute('y1', from.positie.y_pct/100*h);
    line.setAttribute('x2', k.positie.x_pct/100*w);
    line.setAttribute('y2', k.positie.y_pct/100*h);
    line.setAttribute('stroke', 'rgba(79,209,197,0.55)');
    line.setAttribute('stroke-width', '2');
    svg.appendChild(line);
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
      if(state.mode==='live' && !isGen(n)){
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
  if(ev.target.classList.contains('pin') || ev.target.closest('.kastpopup')) return;
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
