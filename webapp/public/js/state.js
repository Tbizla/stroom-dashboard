// gedeelde mutable state + DOM-referenties, gebruikt door alle andere modules.
// `state` is één object-referentie (nooit zelf herwezen) zodat elke module dezelfde
// live waarden ziet zonder aparte getter/setter-functies per veld.
export const state = {
  TOPO: { generators: [], kasten: [] },
  mode: 'beheer',
  armedId: null,
  selectedId: null,
  mqttClient: null,
  openPopupKastId: null, // id van de kast waarvan de MQTT-databallon open staat op de plattegrond (Live-modus), zie specs/kast-popup-mqtt-spec.md — null = geen ballon open
  listSearchQuery: '',
  listStatusFilter: 'alles',
  kastZoekQuery: '',
  kastTypeFilter: 'alles',
  rapportPeriodeChip: 'alles',
  rapportPollHandle: null, // los van de globale 5s-poll (die slaat Beheer expliciet over) — alleen actief zolang een generatie loopt
  rapportSubnav: 'overzicht', // welke subtab van de Rapportages-tab actief is: 'overzicht' | 'pdf' | 'backup'
  overzichtPeriodeChip: '24u',
  overzichtGeneratorFilter: null, // id van de generator waarop de staven/boom in Overzicht gefilterd zijn (drill-down), null = geen filter
  backupPeriodeChip: 'alles',
  backupPollHandle: null,
  herstelPollHandle: null,
};

export const liveData = {};
export const liveEnergyData = {};

// welke groepen (bijv. "Centrale Noord — 6 generators + CAT-batterij") hun ledenlijst opengeklapt
// hebben staan; los van TOPO zodat het openklappen niet steeds dichtklapt na elke herlaad/opslaan-cyclus
export const expandedGroepen = new Set();

export const listEl = document.getElementById('list');
export const detailEl = document.getElementById('detail');
export const svg = document.getElementById('svgoverlay');
export const mapimg = document.getElementById('mapimg');
export const mapinner = document.getElementById('mapinner');
export const mapwrap = document.getElementById('mapwrap');
export const blankCanvas = document.getElementById('blankCanvas');

// ---------- sidebar: in-/uitklapstatus per generator/kast, onthouden in localStorage ----------
export const SIDEBAR_STORAGE_KEY = 'stroomdash_sidebar_v1';
export const MANY_GENERATORS_THRESHOLD = 3;
export const sidebarState = {};
try { Object.assign(sidebarState, JSON.parse(localStorage.getItem(SIDEBAR_STORAGE_KEY) || '{}')); } catch(e) {}
export function saveSidebarState(){
  try { localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(sidebarState)); } catch(e) {}
}
// levert de open/dicht-status voor een id op; als er nog geen onthouden waarde is (nieuw
// item), wordt de default toegepast en in het geheugen (niet meteen in localStorage) gezet —
// zo overschrijft een topologiewijziging de eerder onthouden keuzes van de gebruiker niet.
export function isNodeOpen(id, defaultOpen){
  if(!Object.prototype.hasOwnProperty.call(sidebarState, id)) sidebarState[id] = defaultOpen;
  return sidebarState[id];
}

// eigen, aparte opslag voor de Beheer-kastensecties (zelfde aanpak als hierboven, maar een eigen
// key): Beheer en de Kalibreren/Live-aside delen generator/kast-id's, en de aside's default-dicht-
// bij-veel-generators-regel zou anders de Beheer-secties (die standaard open moeten staan, zie
// renderKastSecties) al hebben "vastgezet" op dicht vóórdat Beheer ooit gerenderd is.
export const BEHEER_STORAGE_KEY = 'stroomdash_beheer_kasten_v1';
export const beheerState = {};
try { Object.assign(beheerState, JSON.parse(localStorage.getItem(BEHEER_STORAGE_KEY) || '{}')); } catch(e) {}
export function saveBeheerState(){
  try { localStorage.setItem(BEHEER_STORAGE_KEY, JSON.stringify(beheerState)); } catch(e) {}
}
export function isBeheerNodeOpen(id, defaultOpen){
  if(!Object.prototype.hasOwnProperty.call(beheerState, id)) beheerState[id] = defaultOpen;
  return beheerState[id];
}

// ---------- zoom: eigen, onthouden niveau per tabblad (cal/schema/live), ook na herladen van de pagina ----------
export const ZOOM_MIN = 0.05, ZOOM_MAX = 3, ZOOM_STEP = 0.15;
export const ZOOM_STORAGE_KEY = 'stroomdash_zoom_v1';
export const zoomLevels = { cal: null, schema: null, live: null, schemaSize: null };
try { Object.assign(zoomLevels, JSON.parse(localStorage.getItem(ZOOM_STORAGE_KEY) || '{}')); } catch(e) {}
