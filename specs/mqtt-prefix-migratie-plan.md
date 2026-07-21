`🚧 DEV-V2 🚧`

# MQTT-topic-prefix migratie: `fest` → `event`

Laatste openstaande punt voor v2 (zie roadmap in [event_dashboard.md](../event_dashboard.md)).
Diagnose + migratieplan, conform de werkafspraak (eerst spec/plan afstemmen, dan pas bouwen).

## Waar "fest" nu overal zit

Gevonden met een repo-brede grep, alleen de code-/config-/documentatieplekken (niet de
test-topologie-JSON's, die komen hieronder apart terug):

- **`webapp/server.js:148`** — `mqttPrefix(generatorId, kastId)` genereert `'fest/' + generatorId
  + '/' + kastId`. Wordt aangeroepen bij het aanmaken van elke generator, kast en (sinds de
  generator-EM-rework) elk lid van een groep, en het resultaat wordt opgeslagen als
  `mqtt_topic_prefix`-veld op dat object in de topologie-JSON.
- **`simulator/index.js:228`** — bouwt zelf ook een `'fest/' + gen.id + '/' + gen.id`-prefix (voor
  het zelfreferentiële generator-topic), los van `mqttPrefix()` in server.js (andere taal-context,
  geen gedeelde functie).
- **`telegraf/telegraf.conf`** — twee `mqtt_consumer`-inputs subscriben letterlijk op
  `fest/+/+/status/em:0` en `fest/+/+/status/emdata:0`; de `topic_parsing`-tags-config
  (`_/generator/kast/_/_`) negeert het eerste segment sowieso — het wordt nooit als tag opgeslagen,
  puur gebruikt om de subscribe-topic te matchen.
- **`webapp/public/js/mqtt.js:24-25`** — de browser subscribet zelf ook rechtstreeks (los van
  Telegraf) op dezelfde twee topics, voor de live-weergave.
- **`README.md`** — instrueert de gebruiker (jij, bij het opzetten van een Shelly) om onder
  Settings > MQTT > Custom MQTT prefix precies de door de app gegenereerde waarde in te vullen
  (`fest/<generator_id>/<kast_id>`, ook genoemd voor leden van een groep).

**Los, maar met dezelfde "festival"-naamgevingsgeur:** `INFLUX_ORG`/`DOCKER_INFLUXDB_INIT_ORG` in
`docker-compose.yml`, de `organization = "festival"`-regel in `telegraf.conf`, en de InfluxDB-org in
`grafana/provisioning/datasources/influxdb.yml` gebruiken alle drie letterlijk `"festival"` als
InfluxDB-organisatienaam. Dat is functioneel iets heel anders dan de MQTT-topic-prefix (het raakt
InfluxDB's eigen org/multi-tenancy-concept, niet de MQTT-topicboom), maar het is wel dezelfde
verouderde naamgeving. De roadmap-tekst noemt expliciet "MQTT-topic-prefix", dus ik behandel dit als
een aparte, kleinere vraag hieronder — niet automatisch meegenomen.

## De echte complicatie: dit is geen kale zoek-en-vervang

Het eerste topic-segment ("fest") is in de huidige code een vaste, niet-configureerbare letterlijke
string — Telegraf's `topic_parsing` negeert 'm toch al (zie boven). Voor **nieuwe** topologieën
(aangemaakt ná de codewijziging) is de migratie dus triviaal: `mqttPrefix()` teruggeeft voortaan
`event/...`, en alles matcht meteen.

Het probleem zit bij **bestaande** topologieën:
1. Elke generator/kast/lid die al bestaat (in jouw echte, live-draaiende instances, én de twee
   testtopologie-JSON's in de repo — `test_topologie_uitgebreid.json` en de eenvoudige variant) heeft
   een `mqtt_topic_prefix`-veld met de letterlijke waarde `fest/...` al **opgeslagen** staan. Die
   wordt niet opnieuw berekend — hij staat gewoon in de topologie-JSON.
2. Belangrijker: elke **fysieke Shelly** die je al hebt geconfigureerd, heeft in zijn eigen
   apparaatinstellingen (Settings > MQTT > Custom MQTT prefix) letterlijk die `fest/...`-waarde
   staan — dat is firmware-configuratie op het apparaat zelf, niet iets wat een softwarewijziging
   in deze repo kan raken.

Als je puur de code aanpast (Telegraf/mqtt.js laten voortaan subscriben op `event/+/+/...` i.p.v.
`fest/+/+/...`) zonder verder iets te doen, gaat elke *al geconfigureerde* Shelly per direct
onzichtbaar worden voor de app — hij publiceert nog naar `fest/...`, niemand luistert daar meer naar.

## Twee migratiestrategieën

**Optie A — harde knip.** Code + subscribe-topics + README naar `event/...`. Vereist daarna:
(a) een eenmalige opschoning van bestaande topologie-JSON's (`mqtt_topic_prefix`: `fest/` →
`event/`, gewoon een string-replace, geen datamodelwijziging), én (b) dat je zelf op elke reeds
geconfigureerde fysieke Shelly de "Custom MQTT prefix"-instelling handmatig bijwerkt naar de nieuwe
waarde. Voor een instance die middenin een lopend evenement zit is dat een moment van live-monitoring
die stilvalt totdat alle Shelly's zijn bijgewerkt — dus wél te doen tussen evenementen door (zoals nu,
op de `dev`-branch), niet aan te raden vlak voor of tijdens een evenement.

**Optie B — segment-agnostisch maken.** Telegraf en `mqtt.js` laten subscriben op een wildcard die
het eerste segment niet meer vastlegt (`+/+/+/status/em:0` i.p.v. `fest/+/+/status/em:0` —
functioneel identiek, want dat segment werd toch al genegeerd/alleen gebruikt om te matchen). Dan
maakt het voor de dataverwerking niet meer uit of een Shelly onder `fest/...` of `event/...`
publiceert: beide komen gewoon binnen. `mqttPrefix()` genereert voortaan `event/...` voor *nieuwe*
kasten/generators/leden (en dat is ook wat er in Beheer/README getoond wordt als de "in te stellen
waarde" voor nieuwe hardware), maar bestaande, al werkende Shelly's hoef je niet aan te raken — hun
`fest/...`-waarde blijft gewoon werken, voor altijd of totdat je 'm zelf ooit een keer overzet.
Kanttekening: de MQTT-broker draait sowieso geïsoleerd per evenement (zie `mosquitto.conf`), dus het
niet meer vastleggen van het eerste segment introduceert geen reëel botsingsrisico met andere
apparaten op hetzelfde netwerk.

**Aanbeveling: optie B.** Geen risico op een live-monitoring-blackout, geen verplichte
Shelly-herconfiguratie-ronde, en de code wordt er zelfs eenvoudiger van (één minder stukje vaste
tekst om synchroon te houden tussen server.js/telegraf.conf/mqtt.js/simulator). Het enige nadeel:
oude en nieuwe kasten tonen straks een net iets ander prefix-voorvoegsel naast elkaar in Beheer/
README — puur cosmetisch, geen functioneel verschil.

## Besluiten (bevestigd door Mike)

1. **Optie A — harde knip.** Bewust tegen mijn aanbeveling (optie B) in gekozen; zie hieronder voor
   de migratiestappen die dit vraagt.
2. **`INFLUX_ORG`/`organization = "festival"` wél meenemen** in dezelfde slag.
3. **Nieuwe naam: `site`** (niet "event") — met als redenering: "alles is een -site" (festival-site,
   construction-site, event-site etc.), dus `site` dekt de volledige doelgroep beter dan het eerder
   voorgestelde "event". Geldt zowel voor de MQTT-topic-prefix als (per besluit 2) de InfluxDB-org-
   naam, voor consistentie — dat laatste was niet expliciet gevraagd maar volgt logisch uit dezelfde
   redenering; laat het weten als je daar toch een andere naam voor wilt dan voor de topic-prefix.

`fest/<generator>/<kast>/...` wordt dus `site/<generator>/<kast>/...`, en de InfluxDB-org "festival"
wordt "site".

## Technisch fundament voor Code

**MQTT-topic-prefix (`fest` → `site`), overal waar hierboven gevonden:**
- `webapp/server.js:148` — `mqttPrefix()` literal.
- `simulator/index.js:228` — eigen literal (los van `mqttPrefix()`).
- `telegraf/telegraf.conf` — beide `topics`-regels + beide `topic_parsing.topic`-regels.
- `webapp/public/js/mqtt.js:24-25` — beide `subscribe()`-calls.
- `README.md` — alle voorbeeldwaarden/instructies (§1 en §2).

**InfluxDB-org (`festival` → `site`):**
- `docker-compose.yml` — `DOCKER_INFLUXDB_INIT_ORG` én `INFLUX_ORG` (twee losse regels).
- `telegraf/telegraf.conf` — `organization = "festival"`.
- `grafana/provisioning/datasources/influxdb.yml` — `organization: festival`.
- **Aandachtspunt voor Code, geen ontwerpvraag:** InfluxDB-organisaties zijn niet "zomaar" hernoembaar
  door de configwaarde te wijzigen — als er al een org "festival" met data bestaat, resulteert een
  kale configwijziging vermoedelijk in een nieuwe, lege org "site" bij de eerstvolgende opstart, niet
  in een hernoeming van de bestaande org (en dus ogenschijnlijk "verdwenen" bestaande data, terwijl
  die nog gewoon in de oude org staat). Dit moet expliciet gecontroleerd/opgelost worden (InfluxDB
  heeft een eigen rename-mechanisme, of een eenmalige `influx org` CLI-actie) — niet aannemen dat de
  configwijziging alleen voldoende is.

**Migratiestappen (nodig omdat voor optie A is gekozen):**
1. **Bestaande topologie-data**: elke al opgeslagen `mqtt_topic_prefix`-waarde (generators, kasten,
   leden van groepen) heeft nog de letterlijke `fest/...`-tekst staan — dit is pure opgeslagen tekst,
   geen afgeleide waarde, dus een eenmalige string-replace (`fest/` → `site/`) in de topologie-JSON
   volstaat, zowel voor elke live-instance z'n eigen data als voor de twee testtopologie-fixtures in
   de repo (`test_topologie_uitgebreid.json` + de eenvoudige variant).
2. **Fysieke Shelly's**: elke Shelly die al is ingesteld met de oude `fest/...`-waarde (Settings >
   MQTT > Custom MQTT prefix) moet **handmatig** worden bijgewerkt naar de nieuwe `site/...`-waarde —
   dit is een per-apparaat actie op de hardware zelf, niet iets wat vanuit deze codebase te
   automatiseren is. Praktisch voor jou: relevant zodra bestaande hardware opnieuw wordt ingezet.
3. **Blackout-window**: zodra de Telegraf-/mqtt.js-subscribes zijn omgezet naar `site/...`, wordt
   elke Shelly die nog niet handmatig is bijgewerkt per direct onzichtbaar voor de app (publiceert
   nog naar `fest/...`, niemand luistert daar meer naar) totdat je 'm zelf hebt omgezet. Nu op de
   `dev`-branch, tussen evenementen door, is hiervoor het juiste moment — niet vlak voor of tijdens
   een evenement.

## Vervolg

Klaar voor Claude Code.

## Status

Afgerond en geverifieerd (2026-07-21). `fest` → `site` (MQTT-topic-prefix) en `festival` → `site`
(InfluxDB-org) doorgevoerd in `server.js` (`mqttPrefix()`, `INFLUX_ORG`-default, comments),
`simulator/index.js`, `telegraf.conf` (topics + `topic_parsing` + `organization`), `mqtt.js`
(subscribes), `docker-compose.yml` (`DOCKER_INFLUXDB_INIT_ORG`/`INFLUX_ORG`),
`grafana/provisioning/datasources/influxdb.yml`, README.md (§1/§2), en de drie topologie-JSON's
(`test_topologie_simpel.json`, `test_topologie_uitgebreid.json`, `default_topologie.json` —
`mqtt_topic_prefix`-waarden). De Grafana-dashboard-tag `"festival"` in
`grafana/dashboards/stroomdashboard.json` (los van de InfluxDB-org) is bewust **niet** meegenomen —
puur een cosmetisch zoeklabel, geen onderdeel van de besproken scope.

Nieuw **README.md §13** documenteert de eenmalige migratie voor een reeds bestaande instance:
InfluxDB-org hernoemen (`influx org update --id <id> --name site`, niet een nieuwe org aanmaken —
bestaande data blijft onder hetzelfde org-ID staan), topologie-export bijwerken
(`fest/` → `site/`), en elke fysieke Shelly handmatig omzetten.

Volledig end-to-end geverifieerd tegen een InfluxDB-volume met een écht bestaande, vooraf
aangemaakte `festival`-org (overgehouden uit eerdere sessies) — dus niet slechts tegen een verse
lege instance: de org-rename-stap zelf uitgevoerd en bevestigd (`influx org list` vóór/ná), daarna
de volledige stack gestart en gecontroleerd dat Telegraf naar de hernoemde org schrijft (rechtstreekse
Flux-query bevestigt `site/...`-topic-tags in `shelly_em`), dat Grafana's datasource-health-check
slaagt tegen diezelfde org, en dat de Live-tab met de nieuwe `site/+/+/...`-subscribe nog steeds
live data toont.
