`🚧 DEV-V2 🚧`

# Generator-EM rework — spec (roadmap-item 1)

Vervolg op [generator-em-rework-diagnose.md](generator-em-rework-diagnose.md). Alle drie
gediagnosticeerde punten zijn door Mike bevestigd als reële pijnpunten, en de twee openstaande
vragen zijn beantwoord: per-lid live status is haalbaar, en de klik-interactie-fix (punt 2) wordt
in dezelfde slag meegenomen — geen aparte deelfasering nodig, dit is klein genoeg voor één spec.

**Scope-afbakening (bevestigd):** native-telemetrie-protocolintegratie voor generators is expliciet
v3 — deze rework gaat overal uit van Shelly+CT-klem-gebaseerde self-metering, dezelfde MQTT-vorm
(`status/em:0`) als een kast gebruikt.

Mockup: [mockups/generator-em-rework-mockup.html](mockups/generator-em-rework-mockup.html) — drie
secties, één per onderstaand punt.

## 1. Technisch fundament — open vraag voor Claude Code

Per-lid live status vereist dat een lid van een groep niet langer puur beschrijvend is. Huidige
situatie (`webapp/server.js`, `render-beheer.js`): leden zijn index-based in een array, zonder eigen
`id` of `mqtt_topic_prefix` — expliciet zo gecommentarieerd ("leden zijn puur beschrijvend en worden
nergens anders naar verwezen"). Voor live monitoring per lid is minimaal nodig:

- een **stabiele `id`** per lid (niet de array-index — die verschuift bij verwijderen/herordenen, en
  een MQTT-prefix moet stabiel blijven ook als een ander lid ervoor wordt verwijderd)
- een **automatisch gegenereerde `mqtt_topic_prefix`** per lid, zelfde patroon als bij kasten
- een **optionele `rating_a`** per lid (net als bij een generator: alleen relevant als dat lid ook
  echt wordt uitgelezen)

Goed nieuws: dit vereist **geen wijziging aan de MQTT-laag zelf**. De bestaande subscribe-wildcard
in `mqtt.js` (`fest/+/+/status/em:0`) matcht al op elke 2-segment-topic — een lid-topic in de vorm
`fest/<generator_id>/<lid_id>/status/em:0` komt er vanzelf doorheen, `liveData[lid_id]` wordt
gevuld zonder dat er iets aan de MQTT-verbinding hoeft te veranderen. Dit is dus een
databasemodel/`server.js`-uitbreiding (leden-schema + prefix-generatie + migratie van bestaande
index-based leden naar id-based), geen nieuwe databron of protocol — maar wel een technisch besluit
dat bij Code hoort, niet bij dit designdocument. Concreet te bevestigen: hoe de migratie van
bestaande topologieën (leden zonder `id`) eruitziet, en of `id`-generatie bij het aanmaken van een
lid net zo werkt als de bestaande `mqttPrefix()`-functie voor kasten.

## 2. Design: per-lid live rows in de aside-detail

Zie mockup-sectie 1. Onder de bestaande ledenlijst (naam/kVA/soort-koppeling, blijft ongewijzigd)
komt een nieuw blokje `.ledenblok` met per lid: type-icoon, naam, live stroom + belastingspercentage,
en een kleine statusstip (dezelfde groen/amber/rood-conventie, gebaseerd op de eigen optionele
`rating_a` van dat lid). Een lid zonder eigen rating/self-meter toont gewoon geen stip/percentage
(zelfde graceful-fallback als nu al bij generators zonder rating_a) — geen verplichte migratie-actie
voor bestaande, niet-uitgelezen leden.

## 3. Design: generator/groep-pins krijgen dezelfde klik-interactie als kasten

Zie mockup-sectie 2. `render-pins.js` regel 39 (`if(state.mode==='live' && !isGen(n))`) — de
uitsluiting van generatoren vervalt. Voor een los aggregaat/generator: identieke popup als een kast
(hergebruikt `kastpopup.js` ongewijzigd, want de databorm is al gedeeld). Voor een **groep**: een
uitgebreide variant van dezelfde popup met een compacte per-lid-tabel (naam, stroom, belasting)
i.p.v. de A/B/C-fasetabel — de groep zelf heeft immers geen eigen enkele fasemeting die zinvol is
los van zijn leden. Zelfde positioneringslogica (ankerpunt aan de pin, blijft binnen `#mapwrap`,
ontwijkt de zoom-knoppen) blijft ongewijzigd; alleen de tabel-inhoud verschilt per node-type.

## 4. Design: sidebar-rij maakt "eigen" en "onderliggend" visueel expliciet

Zie mockup-sectie 3. De generatorregel in de zijbalk (`render-list.js`) krijgt een tweede regel
onder de bestaande naam/stip/waarde: een klein `onderliggend:`-label vóór de bestaande badges. De
bovenste stip blijft de eigen self-meter-status van de generator/groep zelf; de badges eronder, nu
duidelijk gelabeld, blijven de opgetelde status van de eronder hangende kasten
(`statusCounts()`, ongewijzigd). Zelfde aanpassing is klein genoeg om ook direct in de
Overzicht-tab-kaarten (`overzicht.js`) door te voeren, waar dezelfde tweeledigheid speelt.

## Wat hier bewust buiten blijft

- Native telemetrie-protocolintegratie (v3, zie scope-afbakening hierboven)
- Wijzigingen aan `statusOf()`/de groen-amber-rood-drempellogica zelf — puur een presentatie- en
  datamodel-uitbreiding, geen nieuwe statuslogica

## Vervolg

Eén spec, geen aparte fasering — klein genoeg om in één keer te bouwen. Technisch fundament (§1) ligt
bij Claude Code ter bevestiging; secties 2-4 zijn designmatig klaar zodra §1 is afgerond.

## Status: gebouwd en geverifieerd

§1 bevestigd (zie boven) en secties 2-4 in één keer gebouwd:
- `server.js`: leden krijgen een stabiele `id` + automatisch gegenereerde `mqtt_topic_prefix`
  (`fest/<generator_id>/<lid_id>`) en een optionele `rating_a`, precies zoals bevestigd. Migratie
  van bestaande topologieën gebeurt lazy in `readTopo()` (ook generators zelf krijgen daarbij alsnog
  hun eigen `mqtt_topic_prefix` als die nog ontbrak).
- `render-pins.js`: de `!isGen(n)`-uitsluiting voor de klik-interactie is vervallen — generator/
  groep-pins openen nu dezelfde databallon als een kast.
- `kastpopup.js`: zoekt nodes nu via `nodeById()` (generators + kasten), toont voor een los
  aggregaat/generator dezelfde A/B/C-fasetabel als een kast, en voor een **groep** een compacte
  per-lid-tabel (stroom + belasting) i.p.v. die fasetabel.
- `render-detail.js`: nieuw `.ledenblok` onder de bestaande ledenlijst van een groep, met per lid
  live stroom/belasting + een eigen statusstip (alleen als dat lid een `rating_a` heeft).
- `render-list.js` + `overzicht.js`: generatorrij/kaart tonen nu twee losse regels — eigen
  self-meter-status bovenaan, een expliciet gelabeld "onderliggend:" voor de badges van de
  eronder hangende kasten.
- `simulator/index.js`: uitgebreid om ook per lid (met een eigen `rating_a`) losse, onafhankelijke
  fake meetdata te publiceren — puur testtooling, geen wijziging aan de MQTT-laag van de app zelf.

Geverifieerd via `docker compose --profile test` + Playwright: migratie van een bestaande
groep-topologie (geen `id`/`rating_a` op de leden), lid-rating opslaan in Beheer (id blijft stabiel),
live per-lid-status in zowel de aside-detail als de groep-popup op de kaart (met de simulator als
databron), regressie van de bestaande kast-popup en solo-generator-popup, en de NL/EN-vertalingen
van alle nieuwe teksten.
