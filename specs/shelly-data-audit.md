`🚧 DEV-V2 🚧`

# Audit: stuurt de Shelly alle data die 'm publiceren kan? (roadmap-item)

Analyse-document conform de roadmap-eis ("als blijkt dat dit niet het geval is: eerst een analyse-
document opstellen... geen code voordat die analyse er is"). Geen implementatie hieronder — puur
een vergelijking en een inschatting van wat elk gat zou toevoegen en vragen.

**Methode:** de velden die de app nu daadwerkelijk gebruikt/verwacht (`webapp/public/js/kastpopup.js`,
`render-detail.js`, `simulator/index.js`, `telegraf/telegraf.conf`) vergeleken met de officiële
Shelly Gen2+ API-documentatie voor de componenten die de Pro 3EM gebruikt (`EM` — komt overeen met
`status/em:0` — en `EMData` — komt overeen met `status/emdata:0`). Bronnen onderaan.

## Conclusie vooraf: ja, er mist data

Niet dramatisch veel, maar wel een paar velden met echte waarde voor een evenement-stroommonitor,
plus één architecturale laag (interval-aggregaten) die helemaal niet via de huidige opzet
binnenkomt. Onderstaand per gat: wat het is, wat het zou toevoegen, en wat het vraagt.

## 1. Frequentie per fase (`a_freq`/`b_freq`/`c_freq`) — ontbreekt, goedkoopste winst

**Status:** door de Shelly gepubliceerd in elke `status/em:0`-melding, maar nergens in de app
gebruikt (niet in `kastpopup.js`'s tabel, niet in `render-detail.js`, geen Telegraf/Grafana-gebruik).
Het zijn gewone scalaire getallen, dus die komen al probleemloos door Telegraf's standaard
JSON-parser heen naar InfluxDB — het is puur een kwestie van ze ophalen en tonen.

**Waarde:** het stroomnet is extreem stabiel rond 50,00 Hz; een generator die zwaar overbelast raakt
kan juist gaan "zakken" in frequentie (droop) vóórdat de stroom/vermogenswaarden zelf een probleem
laten zien. Voor een generator-gevoede kast is dit dus een vroege-waarschuwingssignaal dat er nu
domweg niet is — relevanter voor generators dan voor kasten op het net, maar de data komt sowieso
al van elke Shelly binnen.

**Wat het vraagt:**
- Telegraf/InfluxDB: niets, komt al mee (mits het veld niet ergens onbedoeld wordt weggefilterd —
  niet het geval, er is geen expliciete fieldlist in `telegraf.conf`).
- Webapp: veld tonen in `kastpopup.js`/`metingenHtml()`, evt. Grafana-paneel.

## 2. Per-fase fout-/vlagindicatoren (`a_errors`/`a_flags`/`b_*`/`c_*`) + neutrale stroom (`n_current`/`n_errors`) + component-brede `errors` — ontbreekt, mogelijk technisch belemmerd

**Status:** de Shelly berekent en publiceert dit zelf al: `a_flags` bevat bijv. `overvoltage`/
`overcurrent`/`overpower` zodra een drempel (die je op de Shelly zelf instelt via `EM.SetConfig`
`alarms`) wordt overschreden; `a_errors` bevat meetfouten (`out_of_range:...`); de component-brede
`errors` bevat hardware-/bekabelingsproblemen (`power_meter_failure`, `phase_sequence` — verkeerd
aangesloten fasevolgorde, `ct_type_not_set`). `n_current` (nulleider-stroom) wordt door de simulator
altijd op `null` gezet en is nergens in de app in beeld.

**Belangrijke technische kanttekening:** dit zijn allemaal **arrays van strings** in de JSON — en
Telegraf's standaard `json`-dataformat (wat `telegraf.conf` nu gebruikt, zonder extra parser-config)
kan array-velden niet zomaar naar InfluxDB-lineprotocol omzetten (dat kent alleen scalaire
veldtypen). Dat betekent dat deze velden **hoogstwaarschijnlijk nu al stilzwijgend verdwijnen tussen
Shelly en InfluxDB**, ook al zou de webapp ze willen gebruiken — dit moet bevestigd worden met een
echte Shelly of een Telegraf-test, niet aangenomen. `n_current` (een gewoon getal) heeft dat
probleem niet en zou al doorkomen als een echte Shelly 'm invult.

**Waarde:** dit is potentieel direct relevant voor het nog openstaande roadmap-item
"Notificatiekanaal voor alerting" — de Shelly berekent zelf al over/ondervoltage/-stroom/-vermogen
per fase, wat een directer signaal is dan de huidige aanpak (een 90%-drempel van `rating_a` in
Grafana vergelijken met de gemeten stroom). `phase_sequence` is bovendien relevant bij het opzetten
van een nieuwe kast/generator (verkeerd aangesloten fasevolgorde ontdek je nu pas als de meting
raar oogt, niet doordat de Shelly het zelf meldt).

**Wat het vraagt:**
- Telegraf: eerst verifiëren of de array-velden daadwerkelijk verdwijnen (test met een echte Shelly
  of een handmatig gepubliceerd MQTT-bericht + `telegraf --test`); zo ja, dan een aangepaste
  parser-config nodig (bijv. Telegraf's `json_v2`-parser, die wél arrays kan doorlopen, of een
  eigen omzetting naar losse boolean-velden per vlag).
- InfluxDB/webapp/Grafana: nieuwe velden/paneel, en mogelijk een alert-regel — maar dat raakt
  rechtstreeks het nog openstaande "Notificatiekanaal"-roadmap-item, dus niet in isolatie oppakken.

## 3. `EMData`-component-brede `errors` (`database_error`/`ct_type_not_set`) — zelfde array-kanttekening, lage urgentie

Zelfde technische kanttekening als hierboven (array-veld). Waarde is vooral device-zelfdiagnose
(is de Shelly's eigen flash-opslag stuk, is de CT-klem-instelling nooit gedaan) — nuttig om ooit een
keer te tonen, maar geen operationele meerwaarde tijdens een evenement zelf. Lage prioriteit.

## 4. Interval-aggregaten (`EMData.GetRecords`/`GetData`/`GetNetEnergies`) — komen helemaal niet binnen via de huidige architectuur

**Status:** de Shelly houdt zelf per interval (60s-blokken, opvraagbaar met een periode van 300/900/
1800/3600s) min/max/gemiddelde stroom en spanning per fase bij, plus reactief vermogen/energie
(`a_lag_react_energy`/`a_lead_react_energy`) en fundamentele (harmonischenvrije) energie — een
aanzienlijk rijkere dataset dan wat er nu over MQTT gepubliceerd wordt. **Dit loopt niet via de
`status/em:0`/`status/emdata:0`-MQTT-pushes** die de hele huidige architectuur op bouwt — het zijn
losse RPC/HTTP-methodes (`EMData.GetData` e.d.) die je actief moet opvragen bij het IP-adres van de
Shelly zelf, of een CSV-download-endpoint op het toestel.

**Waarde:** reactief vermogen/power factor-trends en min/max-pieken per interval zouden een rijker
PDF-rapport/analyse mogelijk maken dan de huidige "live snapshot elke ~1s"-aanpak, maar dit is een
wezenlijk andere databron, geen uitbreiding van het bestaande MQTT-pad.

**Wat het vraagt:** een volledig nieuwe ophaalmethode — ofwel een periodieke HTTP-poll per Shelly
(nieuwe Telegraf `http`-input, of een eigen scriptje), ofwel een Shelly Script (zoals het bestaande
`shelly/em-fast-publish.js`) dat deze data zelf periodiek alsnog over MQTT publiceert. Dit is een
apart architectuurbesluit, geen kleine aanvulling — expliciet **niet** meenemen in dezelfde slag als
de andere gaten hierboven.

## Wat al wél volledig wordt benut

`EMData.GetStatus` (de cumulatieve-energieteller, `status/emdata:0`) wordt al vrijwel 1-op-1
gebruikt: `a/b/c_total_act_energy`, `a/b/c_total_act_ret_energy`, `total_act`, `total_act_ret` dekken
het complete officiële veldenlijstje op de array-`errors` na (zie punt 3). De hoofdmeting
(`EM.GetStatus`) wordt voor de kernvelden (stroom/spanning/vermogen/pf per fase, totalen) ook al
volledig gebruikt — de gaten zitten in de secundaire velden (frequentie, fout-/vlagindicatoren),
niet in de kernmeting zelf.

## Aanbeveling (geen besluit — aan jou)

1. **Frequentie (punt 1)** — cheap win, geen architectuurwijziging, puur tonen wat er al binnenkomt.
2. **Fout-/vlagindicatoren (punt 2)** — waardevol en raakt het openstaande alerting-roadmap-item,
   maar eerst verifiëren of Telegraf de array-velden momenteel al dan niet doorlaat, vóór er een
   plan voor gemaakt wordt.
3. **EMData-`errors` (punt 3)** — lage prioriteit, geen haast.
4. **Interval-aggregaten (punt 4)** — apart traject, andere architectuur, alleen oppakken als er
   concrete behoefte aan blijkt (bijv. vanuit het PDF-rapport-vraagstuk).

## Bronnen

- [EM — Shelly Technical Documentation](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/EM/)
- [EMData — Shelly Technical Documentation](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/EMData/)
