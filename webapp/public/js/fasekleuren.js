// ---------- fasekleuren NL-conventie (bruin/zwart/grijs i.p.v. de Shelly-afgeleide labels A/B/C) ----------
// klein rond kleurvlakje vóór het fase-label, losstaand naast de bestaande groen/amber/rood-
// statusindicator — geen wijziging aan statusOf()/
// statusClass() in topology.js, puur presentatielaag.
const FASE_VARS = ['--fase1', '--fase2', '--fase3'];

export function faseSwatch(index){
  return '<span class="faseswatch" style="background:var('+FASE_VARS[index]+')"></span>';
}
