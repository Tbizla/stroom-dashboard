// ---------- anomaly-detectie: plotselinge sprong (dip of piek) los van de vaste 90%-rating-
// drempel, zie specs/anomaly-detectie-plan.md. Client-side op de al binnenkomende MQTT-stream
// (geen nieuwe databron, geen serverwijziging) — vergelijkt elke nieuwe waarde met een kort
// voortschrijdend gemiddelde en signaleert een relatieve sprong >50%, los van of de nieuwe waarde
// zelf boven/onder de rating-drempel zit.
import { t } from './i18n.js';

const VENSTER_MS = 60000;                // rollend venster voor de baseline
const BASELINE_MIN_LEEFTIJD_MS = 20000;  // baseline = gemiddelde van samples tussen deze leeftijd en VENSTER_MS
const SPRONG_DREMPEL = 0.5;              // >50% relatieve sprong t.o.v. de baseline
const BASELINE_MIN_WAARDE = 0.5;         // negeer ruis rond 0A (bijv. "van 0.1A naar 0.3A")
const AUTO_VERVAL_MS = 10 * 60000;       // badge verdwijnt vanzelf na 10 min als niemand 'm wegklikt

const samples = new Map();  // nodeId -> [{waarde, ts}, ...] — alléén "normale" (niet-episode) samples
const episodes = new Map(); // nodeId -> {baseline, sec, tekst, sindsTs, bevestigd}

function pruneSamples(arr, now){
  while(arr.length && now - arr[0].ts > VENSTER_MS) arr.shift();
}

function bouwTekst(baseline, waarde, sec){
  const richting = waarde < baseline ? 'daling' : 'stijging';
  return t('anomaly.'+richting, {
    pct: Math.round(Math.abs((waarde-baseline)/baseline)*100),
    sec, van: baseline.toFixed(1), naar: waarde.toFixed(1),
  });
}

export function verwerkAnomalyDetectie(nodeId, waarde){
  if(waarde==null) return;
  const now = Date.now();
  const episode = episodes.get(nodeId);

  // een lopende episode vergelijkt bewust tegen de bevroren baseline van het triggermoment, niet
  // tegen een steeds opnieuw berekend voortschrijdend gemiddelde — anders "haalt" een aanhoudende
  // storing (bijv. een kast die van 14A naar 0A valt en daar blijft) haar eigen baseline binnen
  // ~20-60s in en verdwijnt de badge vanzelf terwijl de storing nog actief is (bugfix n.a.v.
  // code-review, zie specs/vervolgticket-commit-37d57ff.md §1a)
  if(episode){
    const relatief = (waarde - episode.baseline) / episode.baseline;
    if(Math.abs(relatief) > SPRONG_DREMPEL){
      // percentage/van/naar mogen meebewegen met de actuele waarde, maar de tijdsduur (sec) blijft
      // vast op het triggermoment — anders groeit "sec" onbegrensd door zolang de storing aanhoudt
      // (bugfix n.a.v. code-review, zie specs/vervolgticket-commit-cdcef83.md §2)
      if(!episode.bevestigd) episode.tekst = bouwTekst(episode.baseline, waarde, episode.sec);
      return; // storing houdt aan: geen nieuwe baseline-sample bijhouden zolang dit zo is
    }
    episodes.delete(nodeId); // waarde is teruggekeerd richting de oorspronkelijke baseline: episode voorbij
  }

  let arr = samples.get(nodeId);
  if(!arr){ arr = []; samples.set(nodeId, arr); }
  pruneSamples(arr, now);
  const baselineSamples = arr.filter(s => now - s.ts >= BASELINE_MIN_LEEFTIJD_MS);
  arr.push({ waarde, ts: now });

  if(!baselineSamples.length) return;
  const baseline = baselineSamples.reduce((s,x)=>s+x.waarde, 0) / baselineSamples.length;
  if(baseline < BASELINE_MIN_WAARDE) return;

  const relatief = (waarde - baseline) / baseline;
  if(Math.abs(relatief) > SPRONG_DREMPEL){
    // sec ligt vast op het triggermoment (zie de lopende-episode-tak hierboven, die 'm hergebruikt
    // i.p.v. herberekent) — alleen percentage/van/naar bewegen mee met latere, actuelere waarden
    const sec = Math.round((now - baselineSamples[0].ts)/1000);
    episodes.set(nodeId, {
      baseline, sec,
      tekst: bouwTekst(baseline, waarde, sec),
      sindsTs: now, bevestigd: false,
    });
  }
}

export function heeftActieveAnomaly(nodeId){
  const e = episodes.get(nodeId);
  return !!(e && !e.bevestigd);
}
export function anomalyTekst(nodeId){
  const e = episodes.get(nodeId);
  return e ? e.tekst : '';
}
export function bevestigAnomaly(nodeId){
  const e = episodes.get(nodeId);
  if(e) e.bevestigd = true;
}
export function aantalActieveAnomalieen(){
  let n = 0;
  episodes.forEach(e => { if(!e.bevestigd) n++; });
  return n;
}

// periodieke opruiming van verlopen episodes — los van binnenkomende MQTT-data, anders blijft een
// badge onterecht staan zodra een kast stil valt i.p.v. herstelt. Toetst op sindsTs (vastgezet bij
// de trigger) i.p.v. een steeds ververst tijdstip, en geldt voor ALLE episodes, ook weggeklikte —
// anders blokkeert een bevestigde episode tijdens een aanhoudende storing voorgoed nieuwe detectie
// op diezelfde node (bugfix n.a.v. code-review, zie specs/vervolgticket-commit-cdcef83.md §1 + §3)
export function initAnomalyOpruiming(onGewijzigd){
  setInterval(()=>{
    const now = Date.now();
    let gewijzigd = false;
    episodes.forEach((e, id)=>{ if(now-e.sindsTs > AUTO_VERVAL_MS){ episodes.delete(id); gewijzigd = true; } });
    if(gewijzigd) onGewijzigd();
  }, 30000);
}
