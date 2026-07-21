// ---------- MQTT live data ----------
// `mqtt` is een globale variabele van het classic <script> uit index.html (unpkg mqtt.min.js),
// vóór deze module geladen — modules mogen gewoon globals van eerdere classic scripts gebruiken.
import { state, liveData, liveEnergyData } from './state.js';
import { renderList } from './render-list.js';
import { renderPins } from './render-pins.js';
import { renderSchema } from './render-schema.js';
import { renderDetail } from './render-detail.js';
import { renderKastPopup } from './kastpopup.js';
import { t } from './i18n.js';
import { ververOverzichtLiveWeergave } from './overzicht.js';

document.getElementById('connectBtn').onclick = ()=>{
  const host = document.getElementById('brokerHost').value || 'localhost';
  const port = document.getElementById('brokerPort').value || '9001';
  const dot = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  if(state.mqttClient){ state.mqttClient.end(true); state.mqttClient=null; }
  dot.className = 'dot busy'; label.textContent = t('header.connVerbinden');
  try{
    state.mqttClient = mqtt.connect('ws://'+host+':'+port+'/mqtt');
    state.mqttClient.on('connect', ()=>{
      dot.className='dot ok'; label.textContent=t('header.connVerbonden');
      state.mqttClient.subscribe('fest/+/+/status/em:0');
      state.mqttClient.subscribe('fest/+/+/status/emdata:0');
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
      // databallon (specs/kast-popup-mqtt-spec.md) toont ook act_power/aprt_power/pf per fase
      liveData[kastId] = { ...data, ts: Date.now() };
      renderList(); renderPins(); if(state.mode==='schema') renderSchema(); if(state.selectedId===kastId) renderDetail();
      ververOverzichtLiveWeergave();
    });
  }catch(e){ dot.className='dot err'; label.textContent=t('header.connFout')+e.message; }
};
