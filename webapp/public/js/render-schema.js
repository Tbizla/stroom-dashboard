// ---------- schema: automatisch gegenereerd stroomschema (parent/child-boom), geen plattegrond nodig ----------
import { state, zoomLevels } from './state.js';
import { isGen, statusClass } from './topology.js';
import { renderList } from './render-list.js';
import { renderDetail } from './render-detail.js';

export function schemaChildrenOf(node){
  return isGen(node)
    ? state.TOPO.kasten.filter(k=>k.generator===node.id && !k.parent)
    : state.TOPO.kasten.filter(k=>k.parent===node.id);
}

function computeSchemaLayout(){
  const NODE_W = 150, NODE_H = 36, GAP_X = 30, LEVEL_H = 100, PAD = 50;
  let cursor = 0;
  const positioned = [];
  const links = [];

  function place(node, depth){
    const kids = schemaChildrenOf(node);
    let x;
    if(kids.length === 0){
      x = cursor * (NODE_W + GAP_X) + NODE_W / 2;
      cursor++;
    } else {
      const xs = kids.map(k=>{ const kx = place(k, depth + 1); links.push({ from: node, to: k }); return kx; });
      x = (Math.min(...xs) + Math.max(...xs)) / 2;
    }
    positioned.push({ node, depth, x });
    return x;
  }

  state.TOPO.generators.forEach(g => place(g, 0));

  const maxDepth = positioned.reduce((m, p) => Math.max(m, p.depth), 0);
  const width = Math.max(cursor * (NODE_W + GAP_X) + PAD, 300);
  const height = PAD * 2 + (maxDepth + 1) * LEVEL_H;
  return { positioned, links, width, height, NODE_W, NODE_H, LEVEL_H, PAD };
}

export function renderSchema(){
  const { positioned, links, width, height, NODE_W, NODE_H, LEVEL_H, PAD } = computeSchemaLayout();
  const schemaSvg = document.getElementById('schemaSvg');
  document.getElementById('schemaEmptyHint').style.display = positioned.length ? 'none' : 'block';
  schemaSvg.setAttribute('width', width);
  schemaSvg.setAttribute('height', height);
  // zonder expliciete CSS-breedte/hoogte rekt een display:block <svg> zich uit naar de containerbreedte
  // i.p.v. de width/height-attributen te respecteren — daarmee viel alles voorbij die breedte letterlijk
  // buiten het svg-viewport (geen scroll-probleem, het werd o(nzichtbaar) geclipt)
  schemaSvg.style.width = width + 'px';
  schemaSvg.style.height = height + 'px';
  // een onthouden zoomniveau is alleen geldig voor de boomgrootte waarvoor het ooit is bepaald — het schema
  // groeit/krimpt met de topologie (andere testset, kasten toegevoegd/verwijderd), dus bij een gewijzigde
  // afmeting is het onthouden percentage zinloos en moet opnieuw gefit worden i.p.v. blind toegepast
  const sizeMismatch = !zoomLevels.schemaSize || Math.abs(zoomLevels.schemaSize.w - width) > 2 || Math.abs(zoomLevels.schemaSize.h - height) > 2;
  if(zoomLevels.schema != null && sizeMismatch){
    zoomLevels.schema = null;
    // de DOM draagt tot de volgende applyZoom()/fitToScreen() nog de oude, inmiddels ongeldige transform;
    // die moet nu al gereset zodat een eventuele fitToScreen()-meting niet tegen een verkeerde schaal aanmeet
    schemaSvg.style.transform = 'scale(1)';
  }
  schemaSvg.innerHTML = '';
  const yOf = depth => PAD + depth * LEVEL_H;

  links.forEach(({ from, to })=>{
    const fp = positioned.find(p=>p.node.id===from.id);
    const tp = positioned.find(p=>p.node.id===to.id);
    if(!fp || !tp) return;
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', fp.x + PAD/2); line.setAttribute('y1', yOf(fp.depth) + NODE_H/2);
    line.setAttribute('x2', tp.x + PAD/2); line.setAttribute('y2', yOf(tp.depth) - NODE_H/2);
    line.setAttribute('stroke', 'rgba(79,209,197,0.55)');
    line.setAttribute('stroke-width', '2');
    schemaSvg.appendChild(line);
  });

  positioned.forEach(p=>{
    const gen = isGen(p.node);
    const cx = p.x + PAD/2, cy = yOf(p.depth);
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.style.cursor = 'pointer';
    g.onclick = ()=>{ state.selectedId = p.node.id; renderList(); renderDetail(); renderSchema(); };

    const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x', cx - NODE_W/2); rect.setAttribute('y', cy - NODE_H/2);
    rect.setAttribute('width', NODE_W); rect.setAttribute('height', NODE_H);
    rect.setAttribute('rx', gen ? 6 : 18);
    const cls = statusClass(p.node);
    const typeFill = gen ? (p.node.type==='batterij' ? '#5b8def' : p.node.type==='groep' ? '#b18cf0' : 'var(--accent)') : 'var(--panel2)';
    const fill = cls==='status-red' ? 'var(--red)' : cls==='status-amber' ? 'var(--amber)' : cls==='status-green' ? 'var(--green)' : typeFill;
    rect.setAttribute('fill', fill);
    rect.setAttribute('stroke', p.node.id===state.selectedId ? '#fff' : 'var(--border)');
    rect.setAttribute('stroke-width', p.node.id===state.selectedId ? '2' : '1');
    g.appendChild(rect);

    const text = document.createElementNS('http://www.w3.org/2000/svg','text');
    text.setAttribute('x', cx); text.setAttribute('y', cy + 4);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '11');
    text.setAttribute('font-family', 'var(--sans)');
    text.setAttribute('fill', gen ? '#0b1210' : '#e8eaed');
    const naamMetIcon = (!gen && p.node.type==='batterij' ? '🔋 ' : '') + p.node.naam;
    const label = naamMetIcon.length > 18 ? naamMetIcon.slice(0, 17) + '…' : naamMetIcon;
    text.textContent = label + (p.node.rating_a!=null ? ' (' + p.node.rating_a + 'A)' : '');
    g.appendChild(text);

    schemaSvg.appendChild(g);
  });
}
