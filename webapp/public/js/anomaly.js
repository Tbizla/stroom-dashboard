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

const samples = new Map();    // nodeId -> [{waarde, ts}, ...], laatste VENSTER_MS
const anomalieen = new Map(); // nodeId -> {tekst, ts, bevestigd}

function pruneSamples(arr, now){
  while(arr.length && now - arr[0].ts > VENSTER_MS) arr.shift();
}

export function verwerkAnomalyDetectie(nodeId, waarde){
  if(waarde==null) return;
  const now = Date.now();
  let arr = samples.get(nodeId);
  if(!arr){ arr = []; samples.set(nodeId, arr); }
  pruneSamples(arr, now);

  const baselineSamples = arr.filter(s => now - s.ts >= BASELINE_MIN_LEEFTIJD_MS);
  arr.push({ waarde, ts: now });

  if(!baselineSamples.length){ return; }
  const baseline = baselineSamples.reduce((s,x)=>s+x.waarde, 0) / baselineSamples.length;
  const bestaande = anomalieen.get(nodeId);

  if(baseline >= BASELINE_MIN_WAARDE){
    const relatief = (waarde - baseline) / baseline;
    if(Math.abs(relatief) > SPRONG_DREMPEL){
      const richting = relatief < 0 ? 'daling' : 'stijging';
      const tekst = t('anomaly.'+richting, {
        pct: Math.round(Math.abs(relatief)*100),
        sec: Math.round((now - baselineSamples[0].ts)/1000),
        van: baseline.toFixed(1), naar: waarde.toFixed(1),
      });
      if(!bestaande){
        anomalieen.set(nodeId, { tekst, ts: now, bevestigd: false });
      } else if(!bestaande.bevestigd){
        bestaande.tekst = tekst; // lopende, niet-weggeklikte episode: cijfers verversen
      }
      // else: al weggeklikt voor deze episode, blijf stil tot de sprong voorbij is (zie hieronder)
      return;
    }
  }
  // conditie niet (meer) waar: episode voorbij, klaar voor een verse melding bij een latere sprong
  if(bestaande) anomalieen.delete(nodeId);
}

export function heeftActieveAnomaly(nodeId){
  const a = anomalieen.get(nodeId);
  return !!(a && !a.bevestigd);
}
export function anomalyTekst(nodeId){
  const a = anomalieen.get(nodeId);
  return a ? a.tekst : '';
}
export function bevestigAnomaly(nodeId){
  const a = anomalieen.get(nodeId);
  if(a) a.bevestigd = true;
}
export function aantalActieveAnomalieen(){
  let n = 0;
  anomalieen.forEach(a => { if(!a.bevestigd) n++; });
  return n;
}

// periodieke opruiming van verlopen (niet-weggeklikte) anomalieën — los van binnenkomende MQTT-
// data, anders blijft een badge onterecht staan zodra een kast stil valt i.p.v. herstelt
export function initAnomalyOpruiming(onGewijzigd){
  setInterval(()=>{
    const now = Date.now();
    let gewijzigd = false;
    anomalieen.forEach((a, id)=>{ if(!a.bevestigd && now-a.ts > AUTO_VERVAL_MS){ anomalieen.delete(id); gewijzigd = true; } });
    if(gewijzigd) onGewijzigd();
  }, 30000);
}
