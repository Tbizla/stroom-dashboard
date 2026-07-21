# Event Stroomdashboard — installatie & gebruik

Praktische handleiding: stack opzetten, Shelly's koppelen, Grafana-queries en export/import.
Voor een projectoverzicht (omschrijving, features, roadmap) zie [event_dashboard.md](event_dashboard.md).

## 1. Generators en kasten invoeren

Alles begint leeg. Open de webapp (zie stap 3), je start automatisch in **Beheer**-modus:
- Maak eerst je generators aan (naam + kVA)
- Maak per generator de kasten aan (naam, ampèrage, eventueel een afkorting zoals "P1")
- Koppel elke kast aan de kast waar 'ie stroomtechnisch op doorgelust is via het dropdown-veld **"Gevoed vanaf"** (leeg = rechtstreeks op de generator). De app voorkomt dat je per ongeluk een lus/cyclus maakt.
- Kast verwijderen? Kasten die daarop waren doorgelust, worden automatisch doorgekoppeld naar wat erboven zat, zodat de keten intact blijft.

Elke kast krijgt automatisch een `mqtt_topic_prefix` (`fest/<generator_id>/<kast_id>`) — die vul je in de Shelly zelf in onder Settings > MQTT > Custom MQTT prefix.

Is een generator een **groep** (bijv. meerdere aggregaten + een batterijcontainer die samen als één krachtbron optreden)? Kasten koppel je dan aan de groep zelf. Wil je ook de losse leden van die groep live volgen, geef het lid dan een eigen rating (A) in de ledentabel (uitklapbaar via de generatorregel) — het lid krijgt dan net als een kast automatisch een eigen `mqtt_topic_prefix` (`fest/<generator_id>/<lid_id>`).

## 2. Shelly's instellen (eenmalig, per kast/generator/lid)

Op elke Shelly Pro 3EM: Settings > MQTT
- Enable MQTT: aan
- Server: IP-adres van de machine bij NHQ, poort 1883
- Custom MQTT prefix: de waarde die de webapp gegenereerd heeft. Zichtbaar door in **Live**-modus op de betreffende pin te klikken (kast, generator, of groep) — de databallon toont 'm onder de naam — of in een export (`/api/export`). Voor een generator die zelf ook uitgelezen wordt geldt hetzelfde (rating (A) invullen bij die generator/groep), en voor een los lid van een groep ook (rating (A) invullen bij dat lid in de ledentabel).

Na deze stap publiceert elke Shelly automatisch naar o.a.:
- `fest/<generator>/<kast>/status/em:0` — live spanning/stroom/vermogen per fase. Standaard op een vast interval van **~15 seconden**, dat niet via de UI te verkorten is (met tussendoor eerder een update bij een grote sprong in de meting).
- `fest/<generator>/<kast>/status/emdata:0` — cumulatieve energietelling (kWh), ongeveer eens per minuut

### Optioneel: sneller dan 15s met een Shelly Script

Voor een responsievere Live-weergave in de webapp (die zelf al direct reageert op elk binnenkomend MQTT-bericht, zonder eigen vertraging) kun je het vaste 15s-interval omzeilen met een **Shelly Script** — de ingebouwde scripting-engine van de Shelly, dus géén custom firmware nodig (en dat raden we ook af: Tasmota/ESPHome ondersteunen de Pro 3EM-hardware niet goed en kunnen 'm onbruikbaar maken).

Het script staat kant-en-klaar in [`shelly/em-fast-publish.js`](shelly/em-fast-publish.js) en publiceert elke seconde de actuele meting naar hetzelfde topic, in dezelfde vorm als de standaard-push — dus zonder dat Telegraf of de webapp aangepast hoeven te worden. Installatie per Shelly (identiek script, niets aan te passen):
1. Stel eerst de "Custom MQTT prefix" in zoals hierboven — het script leest die zelf uit.
2. Settings > Scripts > "+ Add script", plak de inhoud van `em-fast-publish.js`, Save.
3. Zet "Run on startup" aan en start het script.

## 3. Stack starten

```
cp .env.example .env
# vul .env in met eigen wachtwoorden/token
docker compose up -d --build
```

Dit start alles in één keer: Mosquitto, Telegraf, InfluxDB, Grafana (poort 3000) én het stroomdashboard zelf (poort 8080). Niets hoeft meer los gekopieerd of ingesteld te worden.

Open `http://<ip-van-de-nhq-machine>:8080` — dat werkt vanaf elk apparaat op hetzelfde lokale netwerk, dus je hele crew kan tegelijk meekijken. De eerste keer: gebruik de knop **"Plattegrond uploaden"** om de veldtekening in te laden, en plaats daarna de kasten via de kalibratiemodus. Upload optioneel ook een **evenementlogo** onderaan Beheer — dat verschijnt in de header. Posities, plattegrond en logo worden centraal op de server bewaard (in een Docker-volume), dus dat hoeft maar één keer per editie, door één persoon.

Grafana zelf: de InfluxDB data source wordt automatisch geprovisioned (`grafana/provisioning/datasources/influxdb.yml`, met de token uit `.env`) — je hoeft 'm niet meer handmatig toe te voegen. Er staat ook een start-dashboard klaar ("Stroomdashboard - overzicht", `grafana/dashboards/stroomdashboard.json`) met een generator-totalenpaneel bovenaan, een paneel per kast (stroom per fase, geen los "totale stroom"-paneel — zie sectie 5 hieronder waarom) dat automatisch herhaald wordt via een `$kast`-variabele, en een `$editie`-variabele. Alarmdrempels bevat het dashboard bewust niet — die vereisen `rating_a` uit de webapp-topologie, die niet in InfluxDB zit; zie sectie 6 hieronder om die zelf toe te voegen.

## 4. Voorbeeldquery — één kast (paneel per kast)

De onderstaande queries gebruiken voorbeeldnamen (`podium1`, `foodtrucks_zuid`, ...). Jouw eigen kast-id's zie je in de Beheer-modus van de webapp — dat zijn de namen die je zelf hebt ingevoerd, verwerkt tot een technische naam (bijv. "Podium 1" → `podium1`).

Totale stroom van bijvoorbeeld podium 1, laatste 15 minuten:

```flux
from(bucket: "stroomdata")
  |> range(start: -15m)
  |> filter(fn: (r) => r._measurement == "shelly_em")
  |> filter(fn: (r) => r.kast == "podium1")
  |> filter(fn: (r) => r._field == "total_current")
```

Voor stroom per fase (a/b/c) vervang je de laatste filter door `r._field == "a_current" or r._field == "b_current" or r._field == "c_current"` — zo krijg je drie lijnen in één paneel.

**Let op:** `total_current` is de som van alle drie de fasen, en is dus alleen geschikt om een indruk te krijgen van het totale verbruik — niet om tegen `rating_a` af te zetten (zie sectie 6).

## 5. Voorbeeldquery — generator-totaal

Sinds kort staat er ook automatisch een "Totaal energieverbruik $generator"-paneel bovenaan het
Grafana-dashboard (geprovisioned, geen handmatig werk nodig) — die telt zelf alleen de kasten op
die rechtstreeks op de generator/groep hangen, via dezelfde `topology_edges`-koppeling als de
Sankey. De onderstaande query is er nog als naslag voor ad-hoc analyse (bijv. een live stroom-
indicatie per fase, wat het geprovisionede paneel niet doet — zie de toelichting hieronder).

Belangrijk: alleen de kasten met `parent: null` in de JSON optellen (die rechtstreeks op de generator zitten), downstream-kasten NIET meetellen — hun verbruik zit al in de bovenliggende meting.

Ook belangrijk: `rating_a` is een stroom **per fase**, dus voor een generator-belasting die je tegen een rating wilt afzetten, moet je per fase optellen (alle a_current's bij elkaar, alle b_current's bij elkaar, enz.) en niet de kant-en-klare `total_current` (som van de 3 fasen per kast) van de kasten bij elkaar optellen — dat vermenigvuldigt de vertekening.

Generator zuid (podium1 + foodtrucks_zuid + terreinverdeler), stroom per fase opgeteld:

```flux
from(bucket: "stroomdata")
  |> range(start: -5m)
  |> filter(fn: (r) => r._measurement == "shelly_em")
  |> filter(fn: (r) => r._field == "a_current" or r._field == "b_current" or r._field == "c_current")
  |> filter(fn: (r) => r.kast == "podium1" or r.kast == "foodtrucks_zuid" or r.kast == "terreinverdeler")
  |> aggregateWindow(every: 10s, fn: last, createEmpty: false)
  |> group(columns: ["_time", "_field"])
  |> sum()
```

Dit geeft drie lijnen (a/b/c) met de opgetelde stroom van die fase over alle drie de kasten — vergelijk elke lijn apart met de generator-rating (zie sectie 6), of neem er met een `max()`-transform in het paneel nog de zwaarst belaste fase uit.

Generator noord (podium2 + bar2) werkt hetzelfde, met die twee kasten in de filter.

Vermogen (kVA-schatting) werkt hetzelfde, maar met `r._field == "total_aprt_power"` in plaats van de fase-velden — vermogen optellen over kasten heen is geen probleem, dat is al een 3-fasen-som per kast en dus prima cumulatief.

## 6. Alarmdrempels per kast

Elke kast heeft in de webapp (Beheer-modus) een `rating_a` — dat is de stroom die de **aansluiting per fase** aankan (standaard bij CEE-koppelingen: een "63A"-kast mag op élke fase 63A dragen, niet 63A in totaal over de drie fasen samen). Zet in Grafana een drempel op bijvoorbeeld 90% van die waarde tegen de **zwaarst belaste fase** (`a_current`, `b_current` of `c_current`, per timestamp de hoogste van de drie) — bijvoorbeeld een 63A-kast op 56,7A, een 32A-kast op 28,8A. Gebruik hiervoor **niet** `total_current`: dat is de som van alle drie de fasen en zal bij een normale, redelijk gebalanceerde belasting al rond de 300% van `rating_a` liggen voordat er überhaupt een fase overbelast is — een drempel daarop levert dus valse rust (of, bij ongebalanceerde belasting, een gemiste waarschuwing). De ratings van al je eigen kasten zie je in één oogopslag terug in de kasten-tabel in Beheer-modus, of in de export (`/api/export`).

Voor de generatoren reken je de kVA om naar een ruwe stroomindicatie per fase (kVA x 1000 / (3 x 230V) voor een driefasesysteem) en gebruik je diezelfde 90%-vuistregel tegen de zwaarst belaste fase-som uit sectie 5, of je laat het gewoon bij een kVA-drempel op het totaalpaneel (vermogen mag wel cumulatief, zie hierboven).

## 7. Testen met fake data

Er zit een simulator bij die realistisch ogende meetdata voor alle kasten publiceert, zonder dat er Shelly's aangesloten hoeven te zijn. Hij haalt de kastenlijst automatisch op bij de webapp en ververst die elke 5 seconden, dus je hoeft niets handmatig te synchroniseren of te herstarten als je van testtopologie wisselt. Elke kast krijgt een langzaam wisselende belasting, en af en toe (standaard ~1% kans per tik) een kunstmatige piek — handig om de groen/amber/rood-status en later de alerts te testen.

**Dit alles staat aan met precies één commando**, zodat je nooit per ongeluk tijdens een echt evenement de topologie overschrijft, de simulator aanzet of meetdata wist:

```
docker compose --profile test up -d
```

Dit start ook daadwerkelijk de `simulator`-container mee (die anders niet meedraait, ook niet bij een gewone `docker compose up -d`). De webapp herkent zelf of dat profile actief is — geen aparte instelling in `.env` nodig — en geeft dan pas de testendpoints en het **Testdata**-tabblad vrij; zonder `--profile test` geven die endpoints een 404 en blijft het tabblad verborgen.

Op het **Testdata**-tabblad in de webapp, twee varianten:
- **"Laad eenvoudige testtopologie"** — 3 generators, 11 kasten, 3 niveaus diep. Snelle demo van de werking.
- **"Laad uitgebreide testtopologie (stresstest)"** — 5 generators (waarvan Centrum een **groep** is: 4 aggregaten van 550 kVA + een batterijcontainer met bypass, die op zijn beurt 2 daisy-chained routes van 8 kasten voedt), 80 kasten totaal, tot 10 niveaus diep per generator. Voor het testen van de lijst/schema/plattegrond/Sankey en de doorvoer van Telegraf/InfluxDB/de simulator onder realistische belasting, inclusief generatorgroepen en batterij-/piekscheerderkasten.

Beide overschrijven de huidige generators en kasten, en je kunt op elk moment tussen de twee wisselen — de simulator pikt de wijziging binnen enkele seconden op.

**"Wis meetdata"** wist alle meetdata uit InfluxDB (de topologie blijft staan, inclusief de `topology_edges`-reeks voor de Sankey) — handig om na een korte test met een schone grafiek te beginnen.

Zodra het echte evenement begint: start gewoon opnieuw op zonder `--profile test` (`docker compose up -d`) — de simulator-container stopt dan mee en de testendpoints/het tabblad zijn meteen niet meer bereikbaar.

## 8. Data exporteren

Twee soorten export, voor twee soorten data:

- **Topologie + posities** (welke kasten, ratings, kaart-coördinaten): knop "Exporteer data" bovenin de webapp (`/api/export`) — downloadt één JSON-bestand. Handig als back-up, of om over te zetten naar een nieuwe editie via "Importeer data".
- **Historische meetdata** (stroom/spanning/vermogen over tijd): dat hoort bij InfluxDB/Grafana. Open het paneel in Grafana, klik het menu (⋮) rechtsboven in het paneel > **Inspect > Data > Download CSV**. Voor grotere exports kun je ook rechtstreeks een Flux-query op InfluxDB loslaten en het resultaat als CSV wegschrijven.

## 9. PDF-rapport exporteren

Tab **Rapportages > PDF-rapport**: editie en periode kiezen, aanvinken welke
onderdelen erin moeten (generator-totalen, stroom per kast, Sankey-energieverdeling,
overschrijdingen & alarmen), eventueel de rapporttaal omzetten met de schuifknop (NL/EN, staat los
van de taal van de UI zelf), en op "Genereer PDF-rapport" klikken. Kan tot een minuut duren; de
knop laat een statuskaart zien terwijl het loopt en daarna een downloadkaart (of een foutkaart met
"Opnieuw proberen"). Er kan maar één rapport tegelijk gegenereerd worden.

Onder de motorkap gebruikt dit Grafana's eigen `/render`-endpoint (via de meegeleverde
`grafana-image-renderer`-service, `docker-compose.yml`) om per aangevinkt paneel een PDF op te
halen, die de webapp met `pdf-lib` samenvoegt tot één bestand — geen Grafana Enterprise en geen
losse rapportagetool nodig.

**Eenmalige setup** (na de allereerste `docker compose up -d --build`): de webapp heeft een eigen
Grafana Service Account nodig om het render-endpoint te mogen aanroepen.
1. Open Grafana (poort 3000) > Administration > Service accounts > "Add service account"
2. Naam bijv. `pdf-rapport-webapp`, rol **Viewer**, aanmaken
3. Binnen dat service account: "Add service account token", token genereren en kopiëren
4. Plak die waarde in `.env` bij `GRAFANA_REPORT_TOKEN`, en herstart de webapp-container
   (`docker compose up -d webapp`)

Zonder deze stap geeft de knop een duidelijke foutmelding ("GRAFANA_REPORT_TOKEN is niet
ingesteld") in plaats van stil te falen.

## 10. Meerdere edities/jaren vergelijken

Elke keer dat je de stack opnieuw start, vul je in `.env` de `EVENT_EDITION` in (bijv. "2027"). Telegraf plakt dat als tag `editie` op elke meting, dus alle jaren blijven in dezelfde InfluxDB-bucket staan en kun je in Grafana filteren op editie, of meerdere edities naast elkaar in één grafiek zetten (bijv. via een `editie`-variabele bovenaan het dashboard).

## 11. Alarmering (Grafana Alerting)

Grafana kan per paneel een alert-regel krijgen die afgaat zodra de zwaarst belaste fase boven de 90%-drempel van `rating_a` komt (zie sectie 6 hierboven — gebruik hiervoor niet `total_current`). De alert-regels kun je nu al aanmaken; het **notificatiekanaal** (waar het bericht naartoe gestuurd wordt) hoef je pas te koppelen als je een keuze hebt gemaakt.

Voorbeeld alert-conditie in Grafana (per kast-paneel):
- Query: `a_current`, `b_current` en `c_current` van de betreffende kast, laatste 1 minuut, met een `max()`-transform (of Flux `pivot` + `map` om per timestamp de hoogste fase te berekenen) zodat je één "hoogste fase"-reeks overhoudt
- Conditie: `is above` [90% van rating_a]
- For: 30s (voorkomt vals alarm bij een korte piek)

Zodra je een kanaal kiest, voeg je die toe onder Alerting > Contact points, en koppel je 'm aan een notification policy. Ondersteunde opties: Telegram, Pushover, ntfy.sh, e-mail, Slack, webhook, en meer.
