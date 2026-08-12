// ---------- specs/live-viewport-grote-monitor-plan.md, fase 2: gedeelde reken-helpers voor de
// 90°-stapsgewijze plattegrond-rotatie ----------
// Bewust alleen 0/90/180/270 (geen vrije hoek) — dat maakt de wiskunde hieronder simpele
// fractie-swaps/-omkeringen i.p.v. algemene trigonometrie, en is ook precies wat de spec vraagt
// ("stapsgewijs draaien"). Twee soorten conversie, beide nodig omdat CSS-transform (rotate() op
// #mapinner) alles in één keer visueel roteert, maar de rest van de app (percentage-plaatsing,
// klikcoördinaten, fit-to-screen) in de ONgeroteerde content-ruimte blijft rekenen:
//
// 1) naarContentFractie(rx, ry, graden): een punt in de gerenderde (na rotatie zichtbare)
//    rechthoek — bijv. uit getBoundingClientRect(), die zelf al rotatiebewust is — terugrekenen
//    naar een fractie (0-1) in de ONgeroteerde content (x_pct/y_pct/100). Nodig voor elke klik-/
//    sleepinteractie (pin plaatsen/verslepen, knikpunt toevoegen/verslepen, leeg-vlak-klik).
// 2) offsetRoteren(ox, oy, graden): een px-offset t.o.v. het CONTENT-midden (ongeroteerd) omzetten
//    naar het equivalente px-offset t.o.v. het GERENDERDE midden (na rotatie) — beide middens
//    vallen samen op hetzelfde schermpunt (transform-origin:center center), dus dit is puur een
//    richtingsdraai, geen verschuiving. Nodig voor fit-to-screen en cursor-gecentreerd zoomen, die
//    een content-punt op een specifieke schermplek moeten houden/brengen.
//    offsetInverseRoteren is de omgekeerde richting (rendered-offset -> content-offset), gebruikt
//    om uit te rekenen welk content-punt onder de cursor ligt vóór een zoomwijziging — wiskundig
//    hetzelfde als offsetRoteren maar dan met de complementaire hoek (het rechtzetten van een R°-
//    draai is hetzelfde als (360-R)° verder draaien).

export function naarContentFractie(rx, ry, graden){
  switch(((graden % 360) + 360) % 360){
    case 90: return { fx: ry, fy: 1 - rx };
    case 180: return { fx: 1 - rx, fy: 1 - ry };
    case 270: return { fx: 1 - ry, fy: rx };
    default: return { fx: rx, fy: ry };
  }
}

export function offsetRoteren(ox, oy, graden){
  switch(((graden % 360) + 360) % 360){
    case 90: return { ox: -oy, oy: ox };
    case 180: return { ox: -ox, oy: -oy };
    case 270: return { ox: oy, oy: -ox };
    default: return { ox, oy };
  }
}

export function offsetInverseRoteren(ox, oy, graden){
  return offsetRoteren(ox, oy, (360 - (((graden % 360) + 360) % 360)) % 360);
}

// of de content-breedte/-hoogte visueel verwisseld zijn t.o.v. hun ongeroteerde betekenis —
// gebruikt door fitToScreenKaart()/map-tiles.js om de juiste dimensie tegen beschikbare
// breedte/hoogte af te zetten
export function isGewisseld(graden){
  const g = ((graden % 360) + 360) % 360;
  return g === 90 || g === 270;
}

// dunne, herbruikbare laag bovenop naarContentFractie() voor de twee plekken die een kale
// muisklik/-sleepbeweging (via getBoundingClientRect()) naar x_pct/y_pct moeten omrekenen —
// render-pins.js (pin/knikpunt-interactie) en viewport-kalibratie.js (kader-hoeken slepen)
export function muisNaarPct(ev, rect, graden){
  const { fx, fy } = naarContentFractie((ev.clientX-rect.left)/rect.width, (ev.clientY-rect.top)/rect.height, graden);
  return { x: Math.max(0,Math.min(100, fx*100)), y: Math.max(0,Math.min(100, fy*100)) };
}
