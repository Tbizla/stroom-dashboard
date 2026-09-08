// ---------- schema: automatisch gegenereerd stroomschema (parent/child-boom), geen plattegrond nodig ----------
import { state, zoomLevels } from './state.js';
import { isGen, statusClass, saveSchemaPin } from './topology.js';
import { renderList } from './render-list.js';
import { renderDetail } from './render-detail.js';
import { t } from './i18n.js';
import { fitToScreen, applyZoom } from './zoom.js';

export function schemaChildrenOf(node){
  if(!isGen(node)) return state.TOPO.kasten.filter(k=>k.parent===node.id);
  const eigenKasten = state.TOPO.kasten.filter(k=>k.generator===node.id && !k.parent);
  // specs/kast-op-aggregaat-plan.md: een groep se leden die zelf minstens 1 rechtstreeks
  // aangesloten kast hebben, worden als extra kind-node meegenomen — isGen() is ook waar voor een
  // lid-object (heeft altijd een vermogen_kva-key, zie normaliseerLeden() server.js), dus place()
  // recursief hierna vanzelf correct door voor zo'n lid-node, geen apart geval nodig
  const leden = node.type==='groep' ? (node.leden||[]).filter(l=>state.TOPO.kasten.some(k=>k.generator===l.id)) : [];
  return [...eigenKasten, ...leden];
}

const NODE_W = 150, NODE_H = 36, GAP_X = 30, LEVEL_H = 100, PAD = 50, BLOCK_GAP = 60;

// specs/schema-raster-layout-plan.md: elke powerplant (top-level generator/groep) krijgt zijn eigen,
// op zichzelf staande boom-layout — precies de oude place()-logica, maar met een verse cursor per
// powerplant i.p.v. één gedeelde cursor over de hele topologie. Zo blijft elke powerplant-kolom een
// losstaand blok dat straks als geheel in een rasterplek gezet kan worden.
function layoutPlant(gen){
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
  place(gen, 0);

  const maxDepth = positioned.reduce((m, p) => Math.max(m, p.depth), 0);
  const width = Math.max(cursor * (NODE_W + GAP_X) - GAP_X, NODE_W);
  const height = (maxDepth + 1) * LEVEL_H;
  return { gen, positioned, links, width, height };
}

// het aantal kolommen dat de beschikbare schema-ruimte het best benut: voor elk kandidaat-aantal
// (1..n) de resulterende fit-to-screen-schaal berekenen (zelfde denkwijze als fitToScreenSchema()
// in zoom.js) en het aantal met de grootste schaal kiezen — geen aparte instelling, puur automatisch.
function kiesKolomAantal(n, cellW, cellH, availW, availH){
  let beste = n, besteSchaal = -1;
  for(let c = 1; c <= n; c++){
    const rows = Math.ceil(n / c);
    const w = c*cellW + (c-1)*BLOCK_GAP + PAD*2;
    const h = rows*cellH + (rows-1)*BLOCK_GAP + PAD*2;
    const schaal = Math.min(availW / w, availH / h);
    if(schaal > besteSchaal){ besteSchaal = schaal; beste = c; }
  }
  return beste;
}

// gepinde powerplants eerst op hun opgeslagen (rij, kolom) zetten (geclampt aan nCols, bij een
// botsing naar de eerstvolgende vrije cel in dezelfde kolom), daarna de rest rij-voor-rij vullen in
// de bestaande volgorde van state.TOPO.generators
function verdeelRasterplekken(plantLayouts, nCols){
  const occupied = new Set();
  const slotVan = new Map();
  plantLayouts.forEach(p=>{
    const pin = p.gen.gepinde_positie;
    if(!pin) return;
    let row = pin.rij, col = Math.min(pin.kolom, nCols - 1);
    while(occupied.has(row+','+col)) row++;
    slotVan.set(p.gen.id, { row, col });
    occupied.add(row+','+col);
  });
  let scanRow = 0, scanCol = 0;
  plantLayouts.forEach(p=>{
    if(slotVan.has(p.gen.id)) return;
    while(occupied.has(scanRow+','+scanCol)){ scanCol++; if(scanCol>=nCols){ scanCol=0; scanRow++; } }
    slotVan.set(p.gen.id, { row:scanRow, col:scanCol });
    occupied.add(scanRow+','+scanCol);
    scanCol++; if(scanCol>=nCols){ scanCol=0; scanRow++; }
  });
  const nRows = Math.max(...Array.from(slotVan.values()).map(s=>s.row)) + 1;
  return { slotVan, nRows };
}

function computeSchemaLayout(){
  const plantLayouts = state.TOPO.generators.map(layoutPlant);
  if(!plantLayouts.length) return { positioned: [], links: [], width: 300, height: 200 };

  const wrap = document.getElementById('schemaWrap');
  const availW = Math.max((wrap && wrap.clientWidth || 0) - 24, 100);
  const availH = Math.max((wrap && wrap.clientHeight || 0) - 24, 100);
  const cellW = Math.max(...plantLayouts.map(p=>p.width));
  const cellH = Math.max(...plantLayouts.map(p=>p.height));
  const nCols = kiesKolomAantal(plantLayouts.length, cellW, cellH, availW, availH);
  const { slotVan, nRows } = verdeelRasterplekken(plantLayouts, nCols);

  // alle per-powerplant subtrees samenvoegen tot één lijst, elk verschoven naar zijn rastercel —
  // x/y hierna zijn dus meteen absolute schema-coördinaten, geen aparte depth-naar-y-vertaling meer nodig
  const positioned = [];
  const links = [];
  plantLayouts.forEach(p=>{
    const { row, col } = slotVan.get(p.gen.id);
    const offsetX = PAD + col*(cellW+BLOCK_GAP) + (cellW - p.width)/2;
    const offsetY = PAD + row*(cellH+BLOCK_GAP);
    p.positioned.forEach(pos=>{
      positioned.push({
        node: pos.node, x: pos.x + offsetX, y: offsetY + pos.depth*LEVEL_H,
        root: pos.depth===0, slot: pos.depth===0 ? { row, col } : null,
      });
    });
    links.push(...p.links);
  });

  const width = nCols*cellW + (nCols-1)*BLOCK_GAP + PAD*2;
  const height = nRows*cellH + (nRows-1)*BLOCK_GAP + PAD*2;
  return { positioned, links, width, height };
}

export function renderSchema(){
  const { positioned, links, width, height } = computeSchemaLayout();
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

  links.forEach(({ from, to })=>{
    const fp = positioned.find(p=>p.node.id===from.id);
    const tp = positioned.find(p=>p.node.id===to.id);
    if(!fp || !tp) return;
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', fp.x); line.setAttribute('y1', fp.y + NODE_H/2);
    line.setAttribute('x2', tp.x); line.setAttribute('y2', tp.y - NODE_H/2);
    line.setAttribute('stroke', 'rgba(79,209,197,0.55)');
    line.setAttribute('stroke-width', '2');
    schemaSvg.appendChild(line);
  });

  positioned.forEach(p=>{
    const gen = isGen(p.node);
    const cx = p.x, cy = p.y;
    const gepind = p.root && !!p.node.gepinde_positie;
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
    // specs/schema-raster-layout-plan.md: een gepinde powerplant krijgt een accent-rand, zichtbaar
    // voor iedereen — geselecteerd (wit) wint als beide tegelijk gelden, dat is de actieve interactie
    rect.setAttribute('stroke', p.node.id===state.selectedId ? '#fff' : gepind ? 'var(--accent)' : 'var(--border)');
    rect.setAttribute('stroke-width', p.node.id===state.selectedId ? '2' : gepind ? '2' : '1');
    g.appendChild(rect);

    const text = document.createElementNS('http://www.w3.org/2000/svg','text');
    text.setAttribute('x', cx); text.setAttribute('y', cy + 4);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '11');
    text.setAttribute('font-family', 'var(--sans)');
    text.setAttribute('fill', gen ? '#0b1210' : '#e8eaed');
    const naamMetIcon = (!gen && p.node.type==='batterij' ? '🔋 ' : '') + p.node.naam;
    const label = naamMetIcon.length > 18 ? naamMetIcon.slice(0, 17) + '…' : naamMetIcon;
    text.textContent = label;
    if(p.node.rating_a!=null){
      text.textContent += ' (' + p.node.rating_a + 'A)';
    } else if(gen){
      // alleen generators/groepen/batterijen kunnen een lege rating_a hebben (kasten hebben 'm
      // altijd verplicht) — expliciete "geen sensor"-notitie i.p.v. de rating-suffix stil weglaten
      const geenSensorSpan = document.createElementNS('http://www.w3.org/2000/svg','tspan');
      geenSensorSpan.setAttribute('fill', 'rgba(11,18,16,0.55)');
      geenSensorSpan.setAttribute('font-size', '9');
      geenSensorSpan.textContent = ' · ' + t('common.geenSensor');
      text.appendChild(geenSensorSpan);
    }
    g.appendChild(text);

    // specs/schema-raster-layout-plan.md: pin-knop alleen op de wortel van een powerplant (niet op
    // kasten/leden erbinnen), en alleen daadwerkelijk klikbaar voor een editor — een viewer ziet de
    // gepinde staat (accent-rand hierboven) wel, maar kan niet (ont)pinnen, zelfde rolverdeling als
    // de rest van Beheer/Kalibreren.
    if(p.root && state.rol==='editor'){
      const pinGroep = document.createElementNS('http://www.w3.org/2000/svg','g');
      pinGroep.style.cursor = 'pointer';
      const pinCirkel = document.createElementNS('http://www.w3.org/2000/svg','circle');
      pinCirkel.setAttribute('cx', cx + NODE_W/2 - 11); pinCirkel.setAttribute('cy', cy - NODE_H/2 + 11);
      pinCirkel.setAttribute('r', 8);
      pinCirkel.setAttribute('fill', gepind ? 'var(--accent)' : 'rgba(11,18,16,.35)');
      pinGroep.appendChild(pinCirkel);
      const pinText = document.createElementNS('http://www.w3.org/2000/svg','text');
      pinText.setAttribute('x', cx + NODE_W/2 - 11); pinText.setAttribute('y', cy - NODE_H/2 + 14.5);
      pinText.setAttribute('text-anchor', 'middle'); pinText.setAttribute('font-size', '9');
      pinText.style.opacity = gepind ? '1' : '.55';
      pinText.textContent = '📌';
      pinGroep.appendChild(pinText);
      pinGroep.addEventListener('click', (ev)=>{
        ev.stopPropagation(); // niet ook nog de node-selectie triggeren (g.onclick hierboven)
        const nieuw = gepind ? null : { rij: p.slot.row, kolom: p.slot.col };
        p.node.gepinde_positie = nieuw;
        saveSchemaPin(p.node.id, nieuw);
        renderSchema();
      });
      g.appendChild(pinGroep);
    }

    schemaSvg.appendChild(g);
  });
}

// specs/schema-raster-layout-plan.md: het aantal kolommen hangt af van de beschikbare ruimte in
// #schemaWrap, dus een resize (bijv. een ander scherm, of het venster verkleinen) moet het raster
// kunnen herberekenen — zelfde debounce-patroon als map-tiles.js se resize-listener.
let resizeHandle = null;
window.addEventListener('resize', ()=>{
  if(state.mode!=='schema') return;
  clearTimeout(resizeHandle);
  resizeHandle = setTimeout(()=>{
    renderSchema();
    if(zoomLevels.schema == null) fitToScreen(); else applyZoom();
  }, 80);
});
