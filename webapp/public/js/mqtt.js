// ---------- MQTT live data ----------
// `mqtt` is een globale variabele van het classic <script> uit index.html (unpkg mqtt.min.js),
// vóór deze module geladen — modules mogen gewoon globals van eerdere classic scripts gebruiken.
// Verbindt via de webapp's eigen /mqtt-websocket-proxy (specs/toegang-van-buitenaf-diagnose.md
// bevinding #2) — altijd hetzelfde origin als de webapp zelf, geen handmatig in te vullen broker-
// host/-poort meer (dat veld had geen automatische adresdetectie en viel terug op een hardcoded
// 'localhost', wat alleen toevallig werkte zolang je op hetzelfde lokale netwerk zat). Het
// /api/mqtt-ticket-endpoint (al achter de gewone login-sessie) levert het bewijs dat de proxy nodig
// heeft vóórdat 'ie doorverbindt naar mosquitto — mosquitto zelf is niet meer publiek bereikbaar.
import { state, liveData, liveEnergyData } from './state.js';
import { apiCall } from './api.js';
import { renderList } from './render-list.js';
import { renderPins } from './render-pins.js';
import { renderSchema } from './render-schema.js';
import { renderDetail } from './render-detail.js';
import { renderKastPopup } from './kastpopup.js';
import { t } from './i18n.js';
import { ververOverzichtLiveWeergave } from './overzicht.js';
import { ververKastStatusPagina } from './kaststatus.js';
import { verwerkAnomalyDetectie } from './anomaly.js';
import { verwerkGrafiekenLiveMessage } from './grafieken.js';
import { maxFaseStroom } from './topology.js';

// aangeroepen zodra de Live-tab geopend wordt of vanuit een QR-deeplink (kaststatus.js) — een
// tweede aanroep terwijl er al een client is/wordt opgezet is een no-op, mqtt.js herverbindt zelf
// automatisch bij een netwerkonderbreking (geen los "Verbind"-knop meer nodig)
export async function verbindMqtt(){
  if(state.mqttClient) return;
  const dot = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  dot.className = 'dot busy'; label.textContent = t('header.connVerbinden');
  let ticket;
  try{
    ({ ticket } = await apiCall('/api/mqtt-ticket', 'GET'));
  }catch(e){
    dot.className='dot err'; label.textContent=t('header.connFout')+e.message;
    return;
  }
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = protocol+'://'+location.host+'/mqtt?ticket='+encodeURIComponent(ticket);
  try{
    state.mqttClient = mqtt.connect(url);
    state.mqttClient.on('connect', ()=>{
      dot.className='dot ok'; label.textContent=t('header.connVerbonden');
      state.mqttClient.subscribe('site/+/+/status/em:0');
      state.mqttClient.subscribe('site/+/+/status/emdata:0');
    });
    state.mqttClient.on('error', (e)=>{ dot.className='dot err'; label.textContent=t('header.connFout')+e.message; });
    state.mqttClient.on('close', ()=>{ dot.className='dot'; label.textContent=t('header.connNietVerbonden'); });
    state.mqttClient.on('message', (topic, payload)=>{
      const parts = topic.split('/');
      const kastId = parts[2];
      let data;
      try{ data = JSON.parse(payload.toString()); }catch(e){ return; }
      if(topic.endsWith('/status/emdata:0')){
        liveEnergyData[kastId] = { total_act: data.total_act, ts: Date.now() };
        if(state.openPopupKastId===kastId) renderKastPopup();
        return;
      }
      // alle velden bewaren (niet alleen de subset die de aside-detail gebruikt) — de MQTT-
      // databallon toont ook act_power/aprt_power/pf per fase
      liveData[kastId] = { ...data, ts: Date.now() };
      verwerkGrafiekenLiveMessage(kastId, liveData[kastId]);
      verwerkAnomalyDetectie(kastId, maxFaseStroom(liveData[kastId]));
      renderList(); renderPins(); if(state.mode==='schema') renderSchema(); if(state.selectedId===kastId) renderDetail();
      ververOverzichtLiveWeergave();
      ververKastStatusPagina();
    });
  }catch(e){ dot.className='dot err'; label.textContent=t('header.connFout')+e.message; state.mqttClient=null; }
}
