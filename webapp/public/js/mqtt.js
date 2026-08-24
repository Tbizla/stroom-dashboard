// ---------- MQTT live data ----------
// `mqtt` is een globale variabele van het classic <script> uit index.html (unpkg mqtt.min.js),
// vóór deze module geladen — modules mogen gewoon globals van eerdere classic scripts gebruiken.
// Verbindt via de webapp's eigen /mqtt-websocket-proxy (specs/toegang-van-buitenaf-diagnose.md
// bevinding #2) — altijd hetzelfde origin als de webapp zelf, geen handmatig in te vullen broker-
// host/-poort meer (dat veld had geen automatische adresdetectie en viel terug op een hardcoded
// 'localhost', wat alleen toevallig werkte zolang je op hetzelfde lokale netwerk zat). Het
// /api/mqtt-ticket-endpoint (al achter de gewone login-sessie) levert het bewijs dat de proxy nodig
// heeft vóórdat 'ie doorverbindt naar mosquitto — mosquitto zelf is niet meer publiek bereikbaar.
import { state, liveData, liveEnergyData, liveDataExtern, liveEnergyDataExtern } from './state.js';
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
import { maxFaseStroom, externIsPrimair, vindRuweBronInTopic, kastVoorRuweBron } from './topology.js';
import { ververLiveKpi } from './live-kpi.js';
import { verwerkLiveSparkPunt } from './live-spark.js';

// specs/externe-mqtt-ui-plan.md: mosquitto's bridge publiceert z'n eigen verbindingsstatus lokaal
// onder dit topic zodra `notifications true` + `remote_clientid extern-bron` op de bridge-config
// staat (zie bouwBridgeConf() in server.js) — retained, dus een verse subscriber krijgt de laatst
// bekende status meteen. Bestaat pas zodra ooit een bridge geconfigureerd is geweest; blijft
// onschadelijk (gewoon geen berichten) als dat nooit het geval was.
const BRIDGE_STATE_TOPIC = '$SYS/broker/connection/extern-bron/state';

// vervolgticket-toegang-van-buitenaf.md §4: een ticket is eenmalig bruikbaar en maar 30s geldig
// (server.js) — mqtt.js' eigen ingebouwde reconnect-logica zou na de eerste onderbreking blijven
// hangen op hetzelfde (dan al verlopen/verbruikte) ticket, dus reconnectPeriod:0 en zelf een verse
// ticket + nieuwe verbinding opzetten bij elke 'close'. Zonder dit bleef live-monitoring na een
// netwerkstoring of webapp-herstart eindeloos 401'en tot een handmatige pagina-ververs.
let reconnectTimer = null;

// aangeroepen zodra de Live-tab geopend wordt of vanuit een QR-deeplink (kaststatus.js) — een
// tweede aanroep terwijl er al een client is/wordt opgezet is een no-op
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
    planHerverbinding();
    return;
  }
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = protocol+'://'+location.host+'/mqtt?ticket='+encodeURIComponent(ticket);
  try{
    const client = mqtt.connect(url, { reconnectPeriod: 0, connectTimeout: 8000 });
    state.mqttClient = client;
    // reconnectPeriod:0 blijkt in de praktijk niet te voorkomen dat mqtt.js' onderliggende
    // websocket-stream zelf op transportniveau blijft doorproberen met DEZELFDE (dan al verlopen)
    // ticket, zonder ooit een 'error'/'close'-event op de client te vuren (bevestigd tijdens het
    // testen: na een webapp-herstart bleef de browser urenlang tegen hetzelfde ticket aan lopen,
    // zichtbaar in de netwerktab maar onzichtbaar voor client.on('error'/'close')). Vandaar een
    // eigen watchdog die de client hoe dan ook na een paar seconden hard afsluit en zelf, met een
    // vers ticket, opnieuw begint — vertrouwt niet op mqtt.js' eigen events voor de mislukt-paden.
    // vervolgticket-toegang-van-buitenaf-ronde2.md §2: `afgehandeld` mag ALLEEN de huidige
    // verbindingspoging afdekken (voorkomt dat de watchdog nog ingrijpt ná een net gelukte
    // 'connect'), niet de hele levensduur van de client — anders leidt een latere 'close' (broker-
    // herstart, netwerkstoring) ná een eerdere geslaagde verbinding tot een stille no-op: de
    // statusstip bleef dan groen tonen terwijl er allang geen live-data meer binnenkwam. Daarom
    // wordt de vlag in de 'connect'-handler weer teruggezet i.p.v. permanent aan te blijven.
    let afgehandeld = false;
    const opnieuw = ()=>{
      if(afgehandeld) return;
      afgehandeld = true;
      clearTimeout(watchdog);
      try{ client.end(true); }catch(e){}
      if(state.mqttClient === client) state.mqttClient = null;
      dot.className='dot'; label.textContent=t('header.connNietVerbonden');
      planHerverbinding();
    };
    const watchdog = setTimeout(opnieuw, 10000);
    client.on('connect', ()=>{
      // een late 'connect' van een client die de watchdog inmiddels al heeft afgesloten (en dus al
      // vervangen is door een nieuwere poging) mag deze niet alsnog als "verbonden" tonen
      if(afgehandeld || state.mqttClient !== client) return;
      clearTimeout(watchdog);
      // terugzetten (niet permanent true laten staan): een 'close'/'error' NA deze geslaagde
      // verbinding moet alsnog via opnieuw() een echte herverbindingspoging starten
      afgehandeld = false;
      dot.className='dot ok'; label.textContent=t('header.connVerbonden');
      client.subscribe('site/+/+/status/em:0');
      client.subscribe('site/+/+/status/emdata:0');
      // specs/externe-shelly-koppelen-plan.md: de externe (shellybeheerder/Rentman-)broker dekt de
      // hele klantsite met zijn eigen naamgeving (<ruwe-id>@<naam>), niet Mikes site/<generator>/
      // <kast>-vorm — dus hier breed op "extern/#" abonneren, precies zoals de bridge zelf (server.js
      // se bouwBridgeConf(), inmiddels "topic # in 0 extern/") en extern-bron-registry.js (server-
      // side) dat ook doen. Was eerder abusievelijk nog het smallere "extern/site/+/+/status/em:0" —
      // dat matcht de echte apparaat-topics domweg nooit (bugfix, gevonden na een meldering van Mike
      // dat er geen externe data binnenkwam ondanks een actieve, verbonden bridge).
      client.subscribe('extern/#');
      client.subscribe(BRIDGE_STATE_TOPIC);
    });
    client.on('error', (e)=>{ dot.className='dot err'; label.textContent=t('header.connFout')+e.message; opnieuw(); });
    client.on('close', opnieuw);
    client.on('message', (topic, payload)=>{
      // $SYS-topics zijn platte tekst ("1"/"0"), geen JSON-object — apart afgehandeld, vóór de
      // generieke JSON.parse hieronder (die zou een kale "1" overigens ook prima parsen, alleen als
      // getal 1 i.p.v. een object — dan zou de topic-routing hieronder 'm alsnog verkeerd interpreteren)
      if(topic===BRIDGE_STATE_TOPIC){
        const verbonden = payload.toString().trim()==='1';
        if(state.externBridgeVerbonden !== verbonden){
          state.externBridgeVerbonden = verbonden;
          state.externBridgeVerbrokenSinds = verbonden ? null : Date.now();
          renderPins(); renderList();
          if(state.openPopupKastId) renderKastPopup();
          if(state.selectedId) renderDetail();
          ververLiveKpi();
        }
        return;
      }
      const parts = topic.split('/');
      let data;
      try{ data = JSON.parse(payload.toString()); }catch(e){ return; }
      // extern/...-berichten dekken de HELE klantsite (shellybeheerder/Rentman-naamgeving), niet
      // Mikes eigen site/<generator>/<kast>-structuur — specs/externe-shelly-koppelen-plan.md.
      // vindRuweBronInTopic() haalt het "<ruwe-id>@<naam>"-segment eruit, kastVoorRuweBron() zoekt
      // via het handmatig gekoppelde kast.externe_bron_id-veld welke kast (indien enige) dat is.
      // Nog niet gekoppeld = niets om liveDataExtern mee te vullen (wél al zichtbaar in de
      // koppel-popover, die leest zijn eigen lijst via extern-bron-registry.js/GET
      // /api/externe-bronnen, niet via deze live MQTT-stream). anomaly-detectie/sparklijn draaien
      // hier alleen op mee als deze kast se PRIMAIRE weergave ook daadwerkelijk extern is (modus
      // "vervangt lokaal", zie externIsPrimair()) — in de andere modi is dit puur een extra,
      // niet-primaire databron (specs/externe-mqtt-ui-plan.md)
      if(parts[0]==='extern'){
        // "extern/#" levert ook alle andere subtopics die zo'n apparaat publiceert (bijv. Shelly's
        // eigen .../status/switch:0, .../online, .../events/rpc) — alleen de twee bekende EM-
        // subtopics zijn relevant hier, de rest genegeerd (voorkomt zowel onnodige her-renders als
        // dat vreemde velden per ongeluk in liveDataExtern terechtkomen)
        if(!topic.endsWith('/status/em:0') && !topic.endsWith('/status/emdata:0')) return;
        const gevonden = vindRuweBronInTopic(topic);
        const gekoppeldeKast = gevonden ? kastVoorRuweBron(gevonden.ruwe_id) : null;
        if(!gekoppeldeKast) return;
        const kastId = gekoppeldeKast.id;
        if(topic.endsWith('/status/emdata:0')){
          liveEnergyDataExtern[kastId] = { total_act: data.total_act, ts: Date.now() };
        } else {
          liveDataExtern[kastId] = { ...data, ts: Date.now() };
          if(externIsPrimair(gekoppeldeKast)){
            verwerkAnomalyDetectie(kastId, maxFaseStroom(liveDataExtern[kastId]));
            verwerkLiveSparkPunt(kastId, maxFaseStroom(liveDataExtern[kastId]));
          }
        }
        renderList(); renderPins(); if(state.mode==='schema') renderSchema(); if(state.selectedId===kastId) renderDetail();
        if(state.openPopupKastId===kastId) renderKastPopup();
        ververLiveKpi();
        return;
      }
      const kastId = parts[2];
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
      verwerkLiveSparkPunt(kastId, maxFaseStroom(liveData[kastId]));
      renderList(); renderPins(); if(state.mode==='schema') renderSchema(); if(state.selectedId===kastId) renderDetail();
      ververOverzichtLiveWeergave();
      ververKastStatusPagina();
      ververLiveKpi();
    });
  }catch(e){
    dot.className='dot err'; label.textContent=t('header.connFout')+e.message; state.mqttClient=null;
    planHerverbinding();
  }
}

// eigen reconnect-debounce (i.p.v. mqtt.js' ingebouwde) — telkens een vers ticket + nieuwe
// verbinding, nooit hetzelfde (kortlevende, eenmalige) ticket hergebruiken
function planHerverbinding(){
  if(reconnectTimer) return;
  reconnectTimer = setTimeout(()=>{ reconnectTimer = null; verbindMqtt(); }, 3000);
}
