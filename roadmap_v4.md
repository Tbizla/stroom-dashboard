# Event Stroom-Dashboard — roadmap v4 (nog niet gestart)

> Voor omschrijving en featurelijst: zie [event_dashboard.md](event_dashboard.md). Overzicht van
> alle roadmap-bestanden: [roadmap.md](roadmap.md).

## Roadmap v4 (nog niet gestart)

Bewust nog niet oppakken — komt aan de beurt ná de huidige [roadmap_v3.md](roadmap_v3.md). Volgt
dezelfde werkafspraak (spec/plan eerst, dan pas bouwen — zie "Overige afspraken" in
[CLAUDE.md](CLAUDE.md)) zodra dat zover is.

> "v4" is hier, net als bij v3, een roadmap-generatienaam, geen belofte dat deze items als
> `v4.0.0` uitkomen — sinds de overstap naar echte [semantic versioning](CLAUDE.md)
> (§ Versionering) bepaalt de aard van elke individuele wijziging het MAJOR/MINOR/PATCH-cijfer bij
> release, niet welk roadmap-bestand 'm bevat.

Met Mike geprioriteerd op 3 augustus 2026, verplaatst vanuit roadmap_v3.md (deels uit de
confirmed-lijst, deels uit de toen nog ongefilterde "Ideeën van Claude"-sectie — met deze keuze
gelden onderstaande punten allemaal als besproken/geaccordeerd, niet meer als los idee).

- [ ] **Per-fase fout-/vlagindicatoren + neutrale stroom** (`a_errors`/`a_flags`/`b_*`/`c_*`/
      `n_current`/`n_errors`/component-brede `errors`) — uit de Shelly-audit. Waardevol (directe
      device-eigen overvoltage/overcurrent/overpower/bekabelingsfout-detectie). **Telegraf-
      verificatie afgerond (24 juli 2026)**: bevestigd dat de array-velden stilzwijgend verdwijnen
      met de huidige `json`-parser-config — een `json_v2`-parser-wissel + een omzetting naar
      losse boolean-/string-velden is nodig (InfluxDB kent geen array-veldtype). Hangt bovendien
      samen met het inmiddels afgeronde "Notificatiekanaal voor alerting"-item (zie
      roadmap_v3.md) — die basis staat er nu, dus dit kan er nu op voortbouwen. Korte spec (geen
      mockup, backend-first): zie [specs/backend-only-specs.md](specs/backend-only-specs.md),
      sectie 1.
- [ ] **`EMData`-component-brede `errors`** (`database_error`/`ct_type_not_set`) — zelfde
      array-kanttekening als hierboven, ook geverifieerd (zelfde bevinding), device-zelfdiagnose,
      lage prioriteit. Korte spec: [specs/backend-only-specs.md](specs/backend-only-specs.md),
      sectie 2.
- [ ] **Interval-aggregaten** (`EMData.GetRecords`/`GetData`/`GetNetEnergies`: min/max/gemiddelde
      per fase, reactief vermogen) — komen niet binnen via de huidige MQTT-architectuur, vereisen
      een fundamenteel andere ophaalmethode (HTTP-polling of een Shelly Script). Alleen oppakken bij
      concrete behoefte, bijv. vanuit een rijker PDF-rapport. Korte spec:
      [specs/backend-only-specs.md](specs/backend-only-specs.md), sectie 3.
- [ ] **Generator-EM-rework-vervolg: native telemetrie-protocolintegratie.** Bewust uitgesteld
      tijdens de Generator-EM-rework — generators die niet via Shelly+CT-klem maar via een eigen
      protocol uit te lezen zijn. Bevestigd: er zijn CAN-bus/J1939-generators in het park.
      Conceptspec geconsolideerd in
      [specs/backend-only-specs.md](specs/backend-only-specs.md), sectie 4.
- [ ] **Brandstof-/onderhoudstracking per generator.** Draaiuren, brandstofniveau, laatste
      onderhoud, met een refuel-alert. Sluit aan bij de bestaande generator-rating-structuur. Voor
      generators met CAN-bus (J1939) zit deze data er mogelijk al in — zie de conceptspec bij
      "Generator-EM-rework-vervolg" hierboven. Spec + mockup: zie
      [specs/brandstof-onderhoud-plan.md](specs/brandstof-onderhoud-plan.md).
- [ ] **Batterij state-of-charge.** Voor losse batterijen/piekscheerders is nu alleen stroom/
      belasting zichtbaar, niet hoeveel capaciteit er nog in zit. Spec + mockup: zie
      [specs/batterij-soc-plan.md](specs/batterij-soc-plan.md).
- [ ] **Voorspellende piekbelasting.** Op basis van historische data van vorige edities (zelfde
      editie-tag) een verwacht piekmoment tonen, bijv. "foodtrucks pieken meestal rond 18:00".
      Spec + mockup: zie
      [specs/voorspellende-piekbelasting-plan.md](specs/voorspellende-piekbelasting-plan.md).
- [ ] **Brandstofkosten/CO2 in het PDF-rapport.** Logische aanvulling op de bestaande
      generator-energietotalen. Spec + mockup: zie
      [specs/brandstofkosten-co2-plan.md](specs/brandstofkosten-co2-plan.md).
- [ ] **QR-code voor generators/batterijen.** Bewust uitgesteld (4 augustus 2026) tijdens het
      afhandelen van [specs/vervolgticket-commit-37d57ff.md](specs/vervolgticket-commit-37d57ff.md)
      — de v3-implementatie van "QR-code per kast" ([specs/qr-code-plan.md](specs/qr-code-plan.md))
      sluit generators/batterijen bewust uit (geen mockup/ontwerp voor die variant). Dit item is
      de losse vervolgstap om die uitbreiding alsnog te ontwerpen, mocht daar behoefte aan blijken
      — geen spec/mockup nu.
- [ ] **Benamingschema voor PNG-downloads bedenken.** Vandaag krijgen niet alle PNG-downloads een
      onderscheidende bestandsnaam: een grafiek (`grafieken.js`) heet altijd letterlijk
      `grafiek.png`, ongeacht welke kast/generator/periode/grafiektype het is — elke download
      overschrijft dus dezelfde naam, niet meer te onderscheiden zonder handmatig hernoemen. Een
      QR-code-download (`qrcodes.js`) heeft al wel een onderscheidende naam
      (`qr-<afkorting-of-id>.png`). Uitzoeken welk schema logisch is (bijv. kastnaam/-afkorting +
      grafiektype + periode) en dat toepassen waar het ontbreekt — geen spec/mockup nu.
- [x] **Meer opties + dropdown voor het live-venster op het Grafieken-tabblad (tweak, geen spec
      nodig).** Afgerond — Mike vond 5/15/30/60 min te weinig keus. Erbij: 2/3/6/12 uur, en de
      losse knoppenrij is vervangen door één dropdown (`#grafLiveVensterSelect`, zelfde stijl als de
      Editie-select ernaast). De client-side rolling buffer (`liveBuffer`, grafieken.js) ging van een
      vaste 60 minuten retentie naar 12 uur om de langere vensters ook daadwerkelijk te vullen, met
      een nieuwe harde limiet van 3000 punten per kast/generator (`LIVE_BUFFER_MAX_PUNTEN`) als
      geheugengrens onafhankelijk van de publicatiefrequentie — anders zou het optionele
      snelheidsscript (~1 bericht/seconde) over 12 uur al ruim 43.000 punten per kast opleveren. Zie
      event_dashboard.md, Grafieken-tabblad.
- [x] **Bulk-"Alle Shelly's configureren"-knop verwijderd (tweak, geen spec nodig).** Mike: gaf in
      de praktijk meer problemen dan 'm opluste — MQTT-instellingen op een fysieke Shelly wijzigen
      moet alleen na een expliciete actie per apparaat gebeuren, nooit automatisch voor meerdere
      tegelijk. Knop + overlay + de onderliggende bulk-loop (`alleShellyDoelen()`,
      `shellyBulkBtn`-handler) verwijderd uit render-beheer.js/index.html, incl. de bijbehorende
      ongebruikt geworden i18n-strings en CSS. De losse ⚙️-knop per kast/generator/lid (één
      apparaat, één expliciete klik) blijft ongewijzigd staan — dat is en blijft de bedoelde manier
      om een Shelly te (her)configureren.
- [x] **Bevestigingsvraag bij de ⚙️-configureerknop (tweak, geen spec nodig).** Vervolg op de
      bulk-knop-verwijdering hierboven — Mike wilde ook op de overgebleven, losse ⚙️-knop een
      confirm() ertussen, zodat een misklik niet direct instellingen naar een fysiek apparaat
      stuurt. Nieuwe gedeelde helper `bevestigShellyConfiguratie()` (render-beheer.js), gebruikt op
      beide bestaande aanroeppaden (kast-rijen via `maakShellyConfigureerControl()`, generator-/
      lid-rijen via de gedelegeerde `data-shelly-cfg-type`-binding). Bewust NIET toegevoegd aan de
      "Shelly vervangen"-flow (`maakVervangForm()`) — die vereist al een nieuw IP intypen +
      expliciet op "Vervangen" klikken, dus een misklik kan daar al niet optreden.
- [x] **Kant-en-klare images op ghcr.io, `docker compose pull` i.p.v. lokaal bouwen.** Afgerond —
      gebouwd conform [specs/registry-images-plan.md](specs/registry-images-plan.md). Aanleiding:
      Mike wilde op locatie kunnen updaten zonder eerst van GitHub te clonen en lokaal te bouwen.
      Bleek 7 services te raken, niet alleen `webapp` — elke zelf-gebouwde service (webapp,
      mosquitto, telegraf, telegraf-herstarter, grafana, caddy, simulator) bakt zijn configbestand(en)
      al in bij het bouwen (`COPY telegraf.conf ...`, `COPY provisioning ...`, enz.), dus zodra al
      die images vooraf gepubliceerd zijn is er voor een update geen enkel configbestand meer lokaal
      nodig. Nieuwe workflow `.github/workflows/publish-images.yml`: matrix-build over alle 7
      services, triggert op een definitieve release-tag (`v*`, expliciet niet de `-alpha.N`-reeks op
      `dev`), publiceert multi-arch (amd64+arm64) naar `ghcr.io/tbizla/stroom-dashboard-<service>`
      met zowel het versienummer als `latest` als tag. `docker-compose.yml`: elke service kreeg
      `image:` toegevoegd NAAST de bestaande `build:` (niet i.p.v.) — `docker compose build` bouwt
      dan nog steeds gewoon lokaal (ontwikkelen/testen ongewijzigd), `docker compose pull` haalt in
      plaats daarvan de gepubliceerde image op. Nieuwe `STROOM_DASHBOARD_VERSION`-variabele in `.env`
      pint een specifieke versie (leeg = `latest`) — bewust geen automatische meeloop naar `latest`
      voor een al-lopend evenement, zelfde "expliciete actie, geen verrassingen"-principe als de
      Shelly-configuratie hierboven. Enige overgebleven repo-afhankelijkheid was
      `shelly/em-fast-publish.js` (bind-mount buiten webapp's build-context) — verplaatst naar
      `webapp/shelly-script/em-fast-publish.js` (nu gewoon meegebakken via de bestaande `COPY . .`,
      `SHELLY_SCRIPT_FILE`-pad in server.js aangepast) zodat ook die laatste afhankelijkheid weg is.
      Eindresultaat: een bestaande installatie updaten is voortaan alleen `docker-compose.yml` +
      `.env`, geen repo-clone meer nodig — zie het nieuwe README §4-onderdeel "Updaten zonder lokaal
      te bouwen". Geverifieerd: volledige stack lokaal herbouwd en gezond opgestart (webapp,
      mosquitto, telegraf, telegraf-herstarter, grafana), incl. een round-trip-test dat het
      snelheidsscript vanaf zijn nieuwe pad nog steeds correct gelezen wordt door
      `/api/shelly/configureren`. Ook de workflow zelf inmiddels geverifieerd bij de eerste echte
      release-tag (`v3.9.0`): alle 7 jobs slaagden. De veronderstelde "eenmalige handmatige
      package-op-publiek-zetten-stap" bleek niet nodig — een package die via de Actions-`GITHUB_TOKEN`
      aan een publieke repo gekoppeld wordt, erft die publieke zichtbaarheid automatisch. Bevestigd
      met een échte, uitgelogde `docker pull ghcr.io/tbizla/stroom-dashboard-webapp:v3.9.0` — lukt
      zonder inloggen.
- [x] **Externe MQTT-broker (kopie-feed) als extra bron.** Afgerond — gebouwd conform
      [specs/externe-mqtt-broker-plan.md](specs/externe-mqtt-broker-plan.md). Aanleiding: Mikes MQTT
      gaat straks (ook) naar een externe partij, die een "kopie broker" teruggeeft — wilde die als
      extra, apart herkenbare bron kunnen toevoegen zonder de bestaande lokale opstelling
      (Shelly's/mosquitto/Telegraf/live-weergave) te wijzigen, en zonder dat een kast se lokale en
      externe meting elkaar overschrijven.
      Architectuur: mosquitto's eigen **bridge**-functionaliteit (server-naar-server, geen tweede
      verbinding vanuit Telegraf/de browser) neemt `site/#` van de externe broker over en
      herpubliceert dat lokaal onder een `extern/`-prefix — alles wat al op de lokale mosquitto
      leest blijft daardoor ongewijzigd werken. Telegraf kreeg een permanent aanwezig (maar tot een
      bridge actief is stil, want blijft op de LOKALE mosquitto lezen) tweede inputblok voor
      `extern/site/+/+/status/em:0`/`emdata:0`, getagd `bron="extern"` (bestaande inputs kregen ter
      symmetrie `bron="lokaal"`). Nieuwe sectie in Beheer → Instellingen (host/poort/TLS/optioneel
      eigen CA-cert/gebruikersnaam/wachtwoord, zelfde geheimen-patroon als de notificatiekanalen) —
      opslaan schrijft `bridge.conf` op een met mosquitto gedeeld volume en laat mosquitto herstarten
      via `telegraf-herstarter` (uitgebreid met een `doel`-parameter — ondanks de naam nu ook
      mosquitto toegestaan, nog steeds maar twee vaste whitelisted doelen). De browser houdt een
      externe meting apart bij (`liveDataExtern`/`liveEnergyDataExtern`, `mqtt.js`) — **bewust nog
      geen zichtbare UI ervoor**, dat is een aparte, nog niet ontworpen stap (zie het plan).
      Geverifieerd met een volledige live end-to-end-test: een tijdelijke tweede mosquitto-container
      als "externe broker", een testbericht daarop gepubliceerd, en bevestigd dat het via de bridge
      lokaal op `extern/site/...` verschijnt én in InfluxDB met `bron="extern"` terechtkomt (los van
      de bestaande `bron="lokaal"`-data) — plus de aan/uit-cyclus (bridge.conf verschijnt/verdwijnt,
      mosquitto herstart schoon in beide gevallen). Tijdens het bouwen bleek mosquitto's
      `topic`-bridge-syntax een expliciete qos-level nodig te hebben (`topic site/# in 0 extern/`,
      niet `topic site/# in extern/`) — zonder die qos-level zette de bridge stilletjes niets door,
      pas ontdekt via de live test.
- [x] **Externe MQTT-broker: de zichtbare UI-laag.** Afgerond — vervolg op het databron-item
      hierboven, gebouwd conform [specs/externe-mqtt-ui-plan.md](specs/externe-mqtt-ui-plan.md)
      (Cowork-mockups) + drie afstemvragen die Mike beantwoordde: groepen slaan het Extern-blok
      altijd over (geen eigen enkele externe meting), default weergavemodus bij eerste activering is
      "naast lokaal", en de bridge-verbindingsstatus-koppeling is meteen meegebouwd (niet als losse
      vervolgstap).
      **Live weergave**: in-/uitklapbaar "Extern"-blok (volledige fase-tabel, zelfde opbouw als de
      lokale meting) in de kastpopup (plattegrond) en het aside-detailpaneel, standaard open zolang de
      bron site-breed actief staat. Nieuwe site-brede weergavemodus in Beheer → Instellingen (naast de
      bestaande verbindingsvelden): "alleen lokaal" / "naast lokaal" / "extern vervangt lokaal", als
      3 mutueel-exclusieve modus-kaarten (hergebruikt het `.modechoice`/`.modecard`-patroon van Back-up
      → Herstellen, met een eigen `--extern`-kleur i.p.v. `--accent`). In "extern vervangt lokaal"
      worden pins/tabellen/statuskleuren/sparklijn overal de externe meting (nooit een stille
      terugval op lokaal); "geen data" toont dan expliciet één van drie redenen (bridge verbroken /
      wacht op eerste bericht / verouderd-stil), compact binnen het Extern-blok of groot-centraal als
      enige inhoud, met een grijze (niet rode) pin — een databronprobleem, geen overbelasting.
      **Site-brede storingsmelding** bij een verbroken bridge: een pinned bericht vóór de gewone
      rood/amber-ticker-rotatie op Live, plus (optioneel, aan-/uitvinkbaar) een alert-notificatie via
      het bestaande kanaal (Telegram/Pushover/ntfy/e-mail).
      **Bridge-verbindingsstatus**: mosquitto's `$SYS/broker/connection/extern-bron/state` (retained,
      "1"/"0"), rechtstreeks door de browser afgeluisterd voor de UI én door een nieuw, klein
      server-side wachtprocesje (`extern-bridge-watchdog.js`, zelfde opzet als
      `meetcorrectie-relay.js`: eigen MQTT-client naar de lokale mosquitto) voor de alert-notificatie
      — bewust server-side i.p.v. vanuit de browser getriggerd, want (a) een storing moet ook gemeld
      worden als er niemand een tabblad open heeft staan, en (b) voorkomt dubbele meldingen bij
      meerdere open tabbladen/apparaten. Tijdens het bouwen bleek de bridge-config van het vorige item
      dit topic per ongeluk had uitgezet (`notifications false`) en zonder vaste `remote_clientid` zou
      mosquitto zelf een onvoorspelbare clientid (op basis van de containerhostname) gebruikt hebben —
      beide gefixt (`notifications true` + `remote_clientid extern-bron`) en bevestigd met dezelfde
      live-test-opzet (tijdelijke tweede mosquitto-container): het topic levert nu betrouwbaar "1"/"0"
      op bij connect/disconnect, en de watchdog stuurt daadwerkelijk een notificatiepoging op de
      overgang. De Cowork-mockup opperde hiervoor een Grafana "no data"-alertregel (naar analogie van
      de bestaande 90%-drempel-alerts) — bleek bij nader inzien niet te bestaan als code-geprovisioneerde
      regel (alleen contact points worden geprovisioneerd, alert-*regels* zijn kennelijk handmatig in
      Grafana aangemaakt); de server-side watchdog hierboven levert dezelfde belofte aan Mike ("je
      krijgt een melding als de bron wegvalt") zonder een nieuwe, ongeteste Grafana-alerting-integratie
      te bouwen.
- [x] **Externe Shelly koppelen aan een kast.** Afgerond — gebouwd conform
      [specs/externe-shelly-koppelen-plan.md](specs/externe-shelly-koppelen-plan.md), na twee
      afstemvragen die Mike beantwoordde: een korte bevestigingsstap bij het her-koppelen van een
      al-gekoppelde bron, en de MAC-eerst-detectie-aanname voor het schema (mac/rentman) bevestigd.
      Aanleiding: de vorige twee items namen aan dat de externe (shellybeheerder/Rentman-)broker
      Mikes eigen `site/<generator>/<kast>`-topicstructuur zou volgen — bleek niet te kloppen, die
      partij dekt de **hele klantsite** met zijn eigen naamgeving
      (`<macadres-of-rentman-id>@<naam>`), niet alleen Mikes eigen kasten.
      **Bugfix in de bridge-config zelf** (vorig item, `bouwBridgeConf()`): `topic site/# in 0
      extern/` werd `topic # in 0 extern/` — zonder deze wijziging zou de bridge de externe partij se
      eigen topics (die niet met `site/` beginnen) domweg nooit doorgegeven hebben. Geverifieerd met
      dezelfde live-test-opzet (tijdelijke tweede mosquitto-container, nu met een niet-`site/`-topic
      als `3c61054a2f10@Foodtruck-Noord-3/status/em:0`) — komt na de fix correct lokaal aan.
      **Nieuw, klein server-proces** `extern-bron-registry.js` (zelfde opzet als
      `meetcorrectie-relay.js`/`extern-bridge-watchdog.js`) onthoudt site-breed elke ooit-geziene
      ruwe bron (ruwe-id, naam, schema, laatste bericht, laatste stroomwaarde) — schema-detectie
      eerst strikt tegen een MAC-patroon (12 hex-tekens, met/zonder scheidingstekens), de rest is
      `rentman`. Nieuw `GET /api/externe-bronnen` (kruist de registry met de topologie voor "al
      gekoppeld aan"). Kast kreeg een nieuw, optioneel `externe_bron_id`-veld (alleen instelbaar via
      de tabelrij/PUT, net als `shelly_ip` — niet in het aanmaak-formulier).
      **UI**: nieuwe "Externe bron"-kolom in de kasten-tabel (Beheer > Topologie), naast (niet i.p.v.)
      de bestaande Shelly-IP-kolom — een gestippelde "+ Koppelen"-knop of een chip met naam +
      schema-badge + ontkoppelknop. Klikken opent een zoek-/filterbare popover (Alles/MAC/Rentman,
      gesorteerd op laatst gezien, met de laatste stroomwaarde als extra houvast om fysiek te
      verifiëren) — een al-gekoppelde bron blijft zichtbaar (uitgegrijsd, met een "al gekoppeld
      aan..."-label) i.p.v. verborgen, en her-koppelen vraagt eerst een korte `confirm()`-bevestiging.
      **mqtt.js aangepast**: het live-databericht-naar-kast-matchen voor `extern/#`-berichten ging van
      "topic-positie 3 = kastId" (de oude, onjuiste aanname) naar "zoek het `<ruwe-id>@<naam>`-segment
      in het topic, kijk via `kast.externe_bron_id` welke kast dat is" (nieuwe `vindRuweBronInTopic()`/
      `kastVoorRuweBron()` in `topology.js`) — raakt niet hoe de rest van de externe-mqtt-ui-plan.md-UI
      (Extern-blok, weergavemodus, geen-data-met-reden) werkt, alleen hoe die aan de juiste kast komt.
