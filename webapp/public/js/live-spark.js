// ---------- specs/live-viewport-grote-monitor-plan.md: kleine trendlijn (sparkline) in het Live-
// detailpaneel ----------
// Puur client-side, gevoed door dezelfde MQTT-stream als de rest van de app (geen nieuwe databron,
// geen InfluxDB-query) — bewust een kleine, losse buffer i.p.v. grafieken.js' eigen (grotere, 60-
// min) live-buffer te hergebruiken: dat zou dit bestand koppelen aan grafieken.js' fase-/metric-
// keuzelogica voor iets wat hier alleen een klein visueel trendlijntje hoeft te zijn.
import { liveSparkBuffer, LIVE_SPARK_MAX_PUNTEN } from './state.js';

export function verwerkLiveSparkPunt(nodeId, waarde){
  if(waarde==null) return;
  const buf = liveSparkBuffer[nodeId] || (liveSparkBuffer[nodeId] = []);
  buf.push({ ts: Date.now(), val: waarde });
  if(buf.length > LIVE_SPARK_MAX_PUNTEN) buf.shift();
}

// SVG-polylijn van de laatste punten voor deze node — null als er te weinig data is voor een
// zinvolle lijn (net geselecteerd, nog geen MQTT-bericht binnengekomen sinds het laden van de pagina)
export function sparklineSvg(nodeId, breedte, hoogte){
  const buf = liveSparkBuffer[nodeId];
  if(!buf || buf.length < 2) return null;
  const waarden = buf.map(p=>p.val);
  const min = Math.min(...waarden), max = Math.max(...waarden);
  const spread = (max - min) || 1; // voorkomt delen door 0 bij een compleet vlakke lijn
  const stapX = breedte / (waarden.length - 1);
  const punten = waarden.map((v,i)=>{
    const x = i*stapX;
    const y = hoogte - ((v-min)/spread)*hoogte;
    return x.toFixed(1)+','+y.toFixed(1);
  }).join(' ');
  return '<svg width="'+breedte+'" height="'+hoogte+'" viewBox="0 0 '+breedte+' '+hoogte+'" preserveAspectRatio="none">'+
    '<polyline points="'+punten+'" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>'+
    '</svg>';
}
