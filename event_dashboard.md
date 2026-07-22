# Event Stroom-Dashboard — projectdocument

> Voor installatie- en gebruiksinstructies (stack starten, Shelly's koppelen, Grafana-queries):
> zie [README.md](README.md). Dit document beschrijft wat het project ís, welke features er zijn,
> en wat er nog op de roadmap staat. Houd dit bij als de featurelijst of roadmap wijzigt.

## Omschrijving

Zelf-gehost dashboard om de stroomvoorziening tijdens een evenement (festival, kermis, ...) in
de gaten te houden: hoeveel stroom trekt elke verdeelkast, hoe dicht zit die bij de zekering, en
hoe verhoudt dat zich tot de generator waar 'ie op hangt. Elke verdeelkast heeft een Shelly Pro
3EM-meter die live metingen over MQTT publiceert; die data wordt opgeslagen in InfluxDB en
gevisualiseerd in Grafana. Generators zijn vaak ook zelf uit te lezen (native telemetrie, of —
waar dat niet kan — een los toegevoegde Shelly met CT-klem op de uitgaande kabel), en krijgen dan
dezelfde live-monitoring als een kast. Een losse webapp is er specifiek voor het **beheren van de
stroomtopologie** (welke generator, welke kasten, hoe hangen ze aan elkaar) en het **live
volgen** van de status op een plattegrond — dingen waar Grafana zelf niet geschikt voor is,
omdat het geen begrip heeft van de fysieke opstelling of de parent/child-stroomketen.

Architectuur (zie `docker-compose.yml`):
- **mosquitto** — MQTT-broker waar de Shelly's (of de simulator) naar publiceren
- **telegraf** — leest MQTT-berichten en schrijft ze weg naar InfluxDB
- **influxdb** — tijdreeksdatabase voor de meetdata
- **grafana** — dashboards/grafieken/alerting bovenop InfluxDB
- **webapp** — topologiebeheer, plattegrond-kalibratie, live-status, testtools (dit repo)
- **simulator** — publiceert fake meetdata voor alle kasten, voor testen zonder Shelly-hardware

De hele stack is generiek en evenement-onafhankelijk: er zit geen vaste branding in, en via een
eigen logo-upload en een `EVENT_EDITION`-variabele in `.env` is 'm elk jaar/editie opnieuw in te
zetten zonder code aan te passen.

## Features

**Meertalige UI (NL/EN)**
- Taalkeuze-toggle in de header (naast de mode-switch-pill, zelfde visuele stijl), onthouden in
  `localStorage`. Dekt alle tabbladen (Beheer/Kalibreren/Schema/Live/Testdata/Rapportages) en het
  PDF-rapport (het rapport volgt de UI-taal die actief was op het moment van genereren)
- Domeintermen zijn bewust vertaald, niet automatisch: "kast" → "distribution box" (of "box" kort
  in tabelkoppen/dropdowns), "Beheer" → "Manage", "Kalibreren" → "Calibrate", "Schema" → "Diagram"
- Vertalingen zitten in platte dot-key JSON-bestanden (`webapp/i18n/nl.json`/`en.json`), gedeeld
  tussen de webapp-UI (client-fetch) en het PDF-rapport (server-`require`) — één bron van waarheid

**Topologiebeheer (Beheer-tabblad)**
- Generators aanmaken/bewerken/verwijderen (naam, kVA), met een type: gewone **generator**,
  **batterij** (los opslagsysteem), of **groep** — één logische krachtbron die intern uit meerdere
  generators/accu's bestaat (bijv. een centrale met meerdere aggregaten + een batterijcontainer die
  load-sharen of elkaar met auto-start back-uppen). Kasten koppelen aan de groep zelf, niet aan een
  los lid; een lid heeft naam/kVA/type en, sinds de generator-EM-rework, een eigen stabiele id +
  automatisch gegenereerde `mqtt_topic_prefix` en optionele rating (A) — alleen relevant als dat lid
  ook echt een eigen Shelly+CT-klem heeft. Leden zijn nog steeds geen losse topologie-node (niet los
  te plaatsen op de plattegrond)
- Kasten aanmaken/bewerken/verwijderen (naam, afkorting, ampèrage, gekoppelde generator/groep), met
  een type: gewone **kast**, of **batterij** (piekscheerder die tussen een generator(groep) en de
  eronder hangende kasten in zit, met optioneel een bypass-vlag voor als 'm bij overbelasting
  zichzelf omzeilt en het vermogen rechtstreeks doorgeeft)
- Kasten aan elkaar koppelen via "Gevoed vanaf" om de stroomketen (parent/child) vast te leggen,
  met bescherming tegen cyclussen; verwijderen van een tussenliggende kast koppelt de keten
  automatisch door
- Kasten-tabel is gegroepeerd per generator/groep (in-/uitklapbaar per sectie, met kVA en het
  aantal kasten erbij) i.p.v. één platte lijst; geneste kasten (op een andere kast aangesloten)
  staan ingesprongen met een eigen in-/uitklaptoggle. Zoekbalk (naam/afkorting/stroombron) en
  typefilters (Kasten/Batterijen/Bypass actief), een "+ Kast op <bron>"-snelkoppeling per sectie,
  en een "Alles in-/uitklappen"-knop; in-/uitklapstatus per sectie wordt onthouden
- Automatisch gegenereerde `mqtt_topic_prefix` per kast, direct bruikbaar in de Shelly-config
- Generators/groepen kunnen optioneel een rating (A) per fase krijgen, voor de generators die ook
  echt uitgelezen worden — zonder rating gewoon een topologie-plek zonder status/belastingberekening
- Evenementlogo uploaden, zichtbaar in de header. Logo- en plattegronduploads zijn beperkt tot
  .png/.bmp/.svg, gecontroleerd aan de hand van de daadwerkelijke bestandsinhoud (niet alleen de
  bestandsnaam), zodat een verkeerd bestandstype met een vervalste extensie geweigerd wordt
- **Systeeminstellingen**: evenementnaam en editie zijn nu bewerkbaar vanuit Beheer i.p.v. alleen
  via `.env` bij het opstarten (`GET`/`PUT /api/instellingen`, opgeslagen in `instellingen.json`) —
  gebruikt voor de `editie`/`evenement`-tags op meetdata en de naamsbotsing-check bij een
  back-up-herstel (zie Back-up-subtab). Omdat Telegraf zijn tags alleen bij het *aanmaken* van
  z'n container inleest (niet bij een kale restart), herstart "Wijzigingen doorvoeren" Telegraf op
  de achtergrond via een klein, doelbewust beperkt `telegraf-herstarter`-servicetje dat de
  Docker-socket heeft maar naar buiten toe maar precies één actie aanbiedt — de webapp zelf krijgt
  geen Docker-toegang
- Export/import van de volledige topologie als JSON (back-up, of hergebruik voor een nieuwe editie)
- Elke wijziging in Beheer wordt automatisch als `topology_edges`-reeks naar InfluxDB gesynct
  (kast → parent/generator), zodat Grafana de actuele parent/child-structuur kan gebruiken
  zonder dat de Shelly's of MQTT-topics daarvoor aangepast hoeven te worden

**Plattegrond & kalibratie (Kalibreren-tabblad)**
- Plattegrond (afbeelding) uploaden, of zonder plattegrond werken op een leeg, ruim canvas
  (4800×3000) als er nog geen kaart is — de posities blijven gewoon staan zodra je er later een
  toevoegt
- Generators en kasten als pins plaatsen en verslepen
- Lijnen tussen kasten en hun voedingsbron, afgeleid uit de parent/child-koppeling
- In-/uitzoomen (knoppen of scrollwiel) en pannen (klikken en slepen), met een "fit to screen"-knop
  die alles in één keer in beeld brengt — handig bij een grote topologie

**Schema-tabblad**
- Automatisch gegenereerd stroomschema (boomdiagram) van de volledige parent/child-keten, generator
  → groep/batterij/hoofdverdeler → kast, hoe diep ook — geen plattegrond of handmatige plaatsing
  nodig. Groepen, generators, batterijen en kasten krijgen elk een eigen kleur; de status van elke
  kast (groen/amber/rood) is direct zichtbaar in het schema
- Dezelfde zoom/pan/fit-to-screen-bediening als het Kalibreren-tabblad; het onthouden zoomniveau
  wordt automatisch ongeldig (en opnieuw gefit) zodra de topologie van grootte verandert

**Live-monitoring (Live-tabblad)**
- Rechtstreekse MQTT-verbinding vanuit de browser (via websockets) naar de broker
- Status per kast (groen/amber/rood) op basis van actuele stroom t.o.v. de ingestelde rating —
  ook voor generators/groepen met een ingevulde rating, zowel in de zij-lijst als op de
  plattegrond (pin) en in het schema (boxkleur)
- Live meetwaarden (stroom per fase, spanning, vermogen) in het detailpaneel, voor kasten en
  (indien uitgelezen) generators/groepen
- Zij-lijst met generators en kasten is in-/uitklapbaar (met status-badges per generator en een
  "N onderliggend"-indicator bij geneste kasten), doorzoekbaar op naam/afkorting en filterbaar op
  amber/rood; in-/uitklapstatus per item wordt onthouden. Een generatorrij toont twee losse regels:
  bovenaan de eigen self-meter-status (stip) van de generator/groep zelf, daaronder expliciet
  gelabeld "onderliggend:" de opgetelde groen/amber/rood-badges van de kasten die eraan hangen — zelfde
  onderscheid ook op de Overzicht-kaarten (Rapportages-tabblad)
- Frequentie per fase (`a_freq`/`b_freq`/`c_freq`, Hz): eigen rij in de kastpopup-tabel (1 decimaal,
  zelfde patroon als Stroom/Spanning/Act. vermogen) en toegevoegd aan de per-fase metric-regel in de
  aside-detail ("Fase A: X A · Y V · Z Hz"). Geen nieuwe databron (komt al
  ongewijzigd door Telegraf heen) en geen eigen statuskleur/alert-drempel
- Klikken op een kast-, generator- of groep-pin op de plattegrond opent een databallon ter plekke:
  voor een kast of los aggregaat/generator de volledige MQTT-payload (stroom/spanning/act. en
  schijnbaar vermogen/cos φ per fase, totalen, cumulatieve energie in kWh, belastingsbalk,
  laatste-update-tijd); voor een **groep** een compacte per-lid-tabel (stroom + belasting per lid,
  i.p.v. een A/B/C-fasetabel die de groep zelf niet zinvol heeft) — naast de bestaande zij-detail,
  niet ter vervanging. Volgt de pin mee bij pannen/zoomen, maar houdt zelf een vast schermformaat
  (schrompelt niet mee ineen bij uitzoomen); sluit bij nogmaals klikken op dezelfde pin, klik elders
  op de kaart, het kruisje, of een tabwissel
- Leden van een groep krijgen individuele live-status in de zij-detail: een `.ledenblok` onder de
  bestaande ledenlijst toont per lid type-icoon, naam, live stroom + belastingspercentage en een
  eigen groen/amber/rood-stip (op basis van dat lid's eigen optionele rating) — een lid zonder eigen
  rating/self-meter toont gewoon geen stip/waarde, geen verplichte migratie-actie voor bestaande
  topologieën (bestaande leden krijgen bij de eerstvolgende load automatisch een stabiele id +
  `mqtt_topic_prefix`, zelfde patroon als bij kasten)
- Fasekleuren NL-conventie: een klein rond kleurvlakje (bruin/antraciet/grijs, `--fase1`/`--fase2`/
  `--fase3`) vóór het fase-label in de kastpopup-tabelkop (A/B/C) en de aside-detail (Fase A/B/C-
  rijen) — losstaand naast de bestaande groen/amber/rood-statuskleur, geen samensmelting van de
  twee conventies

**Testdata-tabblad** *(alleen in testmodus, zie hieronder)*
- Eén klik een voorbeeldtopologie laden: **eenvoudig** (3 generators, 11 kasten, 3 niveaus) voor een
  snelle demo, of **uitgebreid** (5 generators — waarvan één een groep van 4 aggregaten + batterij
  met bypass, en 2 daisy-chained routes van 8 kasten — 80 kasten totaal, tot 10 niveaus diep) als
  stresstest van de lijst/schema/plattegrond/Sankey en de Telegraf/InfluxDB/simulator-doorvoer
- Beide varianten komen meteen kant-en-klaar geplaatst op de plattegrond: groepen/generators/
  batterijen op een rij links, elke stroomketen daarvandaan in een rechte lijn naar rechts (die bij
  een vertakking symmetrisch uitwaaiert en daarna weer recht doorloopt) — geen 80 kasten met de hand
  hoeven te slepen om meteen iets bruikbaars op het scherm te hebben
- Meetdata in InfluxDB wissen (alleen `shelly_em`/`shelly_emdata`, niet de topologie of de
  `topology_edges`-reeks voor de Sankey) voor een schone start na een korte test

**Testmodus**
- Simulator en Testdata-tabblad (testtopologie laden, simulator starten/stoppen, meetdata wissen)
  staan aan met precies één commando: `docker compose --profile test up -d`. De `simulator`-service
  start dan mee, en de webapp herkent dat zelf (een DNS-lookup op de hostnaam `simulator` — die
  bestaat alleen op het docker-netwerk als het profile actief is) om de bijbehorende endpoints vrij
  te geven en het Testdata-tabblad te tonen. Geen aparte instelling in `.env` nodig. Start weer op
  met het gewone `docker compose up -d` (zonder `--profile test`) om alles dicht te zetten, zodat
  niemand tijdens een echt evenement per ongeluk de topologie overschrijft, de simulator aanzet of
  meetdata wist.

**Simulator**
- Publiceert realistische, langzaam variërende meetdata voor alle kasten in de huidige topologie,
  met incidentele belastingspieken — geen Shelly-hardware nodig om te testen
- De stroom van een kast met eigen kinderen (bijv. een hoofdverdeler) is de daadwerkelijke som van
  wat die kinderen (recursief) verbruiken, plus een klein eigen aandeel — niet meer los-willekeurig
  per kast. Een generator/groep met een ingevulde rating (A) telt op dezelfde manier op uit alles
  wat er rechtstreeks op is aangesloten, dus de hele keten (generator → hoofdverdeler → eindkast)
  klopt getalsmatig van beneden naar boven, zoals in het echt
- Publiceert ook `status/emdata:0` (cumulatieve energie per fase, Shelly-veldnamen als
  `a_total_act_energy`/`total_act`) naast `status/em:0`, geïntegreerd uit de daadwerkelijk
  gepubliceerde stroom — begint bij 0 zodra de simulator start en loopt op zolang 'ie draait
- Ververst de topologie elke 5 seconden vanuit de webapp, dus wisselen tussen testtopologieën
  (of wijzigingen tijdens een editie) werkt zonder de simulator-container te herstarten
- Publiceert ook per lid van een groep (als dat lid een eigen rating (A) heeft) — onafhankelijke
  meetpunten, geen optel-keten zoals bij kasten, want elk lid heeft in het echt zijn eigen
  Shelly+CT-klem

**Grafana-dashboards**
- InfluxDB-datasource en start-dashboard worden automatisch geprovisioned bij het opstarten
- "Totaal energieverbruik $generator"-paneel bovenaan het dashboard: telt het geschatte
  energieverbruik (kWh, `integral(unit: 1h)` van `total_act_power`) op van alleen de kasten die
  rechtstreeks op die generator/groep hangen (`parent == generator` in `topology_edges`) —
  automatisch, geen handmatige kastenlijst nodig zoals de voorbeeldquery in `README.md` sectie 6.
  Klikken op de waarde is een drill-down: de `$kast`-variabele (en dus het paneel hieronder)
  beperkt zich dan tot alleen de kasten van die generator, recursief hoe diep de keten ook
  vertakt (bijv. via een terreinverdeler) — via `topology_edges`, geen losse sub-dashboards nodig
- Paneel per kast (stroom per fase, geen los "totale stroom"-paneel — een CEE-aansluiting is per
  fase gerated, niet cumulatief) herhaalt automatisch via een `$kast`-variabele, inclusief
  batterij-/piekscheerderkasten
- `$editie`-variabele om meerdere jaren/edities te vergelijken (data blijft in dezelfde bucket), en
  een `$evenement`-variabele ernaast om ook tussen verschillende evenementen te kunnen filteren die
  toevallig dezelfde editie-waarde gebruiken
- Alerting-condities (90%-drempel van `rating_a` per fase, niet van `total_current`) zijn per paneel handmatig toe te voegen
- Sankey-paneel ("Terugblik - energieverdeling", Netsage Sankey-plugin, automatisch geïnstalleerd
  via `GF_INSTALL_PLUGINS`) toont na afloop het geschatte energieverbruik per kast als
  stroomdiagram, met de volledige parent/child-keten (generator/groep → batterij/hoofdverdeler →
  kast, hoe diep ook) — via een Flux-`join()` tussen de vermogensdata en de `topology_edges`-reeks
  hierboven, dus automatisch actueel zodra de topologie in de webapp wijzigt. `topology_edges`
  wordt nu per `editie`+`evenement` getagd en de sync wist bij een Beheer-wijziging alleen de
  huidige editie/evenement (i.p.v. de hele reeks) — oudere edities' edges blijven dus los bewaard,
  zodat de Sankey ook historisch (via een teruggezette editie, zie Back-up-subtab) blijft kloppen

**Rapportages-tabblad** (vijfde tab in de mode-switch, met een altijd-zichtbare subnav:
Overzicht/PDF-rapport/Back-up)

*Overzicht-subtab* — eigen hoofddashboard binnen de webapp zelf, i.p.v. te moeten wisselen naar
Grafana:
- Metric-cards per generator/groep: periode-kWh-totaal (alleen de rechtstreeks aangesloten kasten,
  downstream-verbruik zit al in die meting) + een live status-stip; plus een "Kasten totaal"-kaartje
  (aantal + hoeveel daarvan boven de 90%-belastingsdrempel zitten)
- Staafdiagram: zwaarst belaste fase per kast, groen/amber/rood zoals overal in de app, live
  bijgewerkt via dezelfde MQTT-data als het Live-tabblad
- Compacte Sankey-achtige boomweergave (generator → eerste kast, "+ N kasten" voor de rest van de
  keten) i.p.v. een volledige schemakopie
- Periode-keuze (hele evenement/laatste 24u/aangepast) voor de kWh-cijfers; klik op een
  generator-kaart filtert de staven/boom tot die generator, klik op een staaf/boomknoop springt naar
  het Live-tabblad met die kast geselecteerd en de databallon open (drill-down)

*PDF-rapport-subtab* (was: "Rapport exporteren" onderaan Beheer, nu hier verplaatst — zelfde flow):
- PDF-terugblikrapport van een editie samenstellen en downloaden: editie + periode (hele
  evenement/laatste 24u/aangepast) kiezen, en een checklist van onderdelen (generator-totalen,
  stroom per kast, Sankey-energieverdeling, overschrijdingen & alarmen)
- Genereren gebeurt op de achtergrond (statuskaart tijdens het wachten, resultaat-/foutkaart erna
  met "Opnieuw proberen"; geen stille failure) — maar één generatie tegelijk
- Onder de motorkap: Grafana's eigen `/render`-endpoint (via de `grafana-image-renderer`-service,
  geen extra plugin nodig) geeft per aangevinkt paneel een PDF terug, die de webapp met `pdf-lib`
  samenvoegt tot één bestand — geen Grafana Enterprise en geen losse rapportagetool nodig
- Rapport heeft nu een lichte/print-vriendelijke opmaak (bewust anders dan het donkere webapp-thema):
  een coverpagina (logo, titel, editie/periode/gegenereerd-op, en een inhoudsopgave die precies
  toont welke onderdelen wel/niet zijn aangevinkt), een voettekststrook met logo/editie/paginanummer
  op elke paneelpagina, en een herstylede "Overschrijdingen & alarmen"-pagina (nette kop + duidelijk
  vlak met icoon i.p.v. de vorige kale tekstregel). Rapport volgt standaard de UI-taal, met een
  eigen schuifknop (los van de header-taalkeuze) om de rapporttaal per generatie op NL of EN te
  zetten. Logo-embedding werkt alleen met een PNG-logo (BMP/SVG worden overgeslagen)

*Back-up-subtab* — één zip-bestand voor een volledige restore op een andere instance:
- Topologie (JSON) en plattegrond/logo staan altijd aangevinkt (niet uit te zetten); meetdata
  (InfluxDB-dump) is een losse optie met dezelfde periode-keuze als het PDF-rapport, i.v.m.
  bestandsgrootte. Bij meetdata zit sinds kort ook een `topology_edges`-snapshot (huidige
  editie/evenement) en een `meetdata.lp`-bestand (InfluxDB line-protocol) naast de bestaande
  leesbare `meetdata.csv` — nodig om de nieuwe "Back-up herstellen"-sectie hieronder te voeden
- Zelfde status/resultaat/foutkaart-patroon als de PDF-rapportflow ("Opnieuw proberen" bij een
  mislukte poging), gebouwd met de `archiver`-library
- **Back-up herstellen** (restore, tegenhanger van bovenstaande): een eerder gemaakte back-up-zip
  terugzetten, in twee modi — **volledige restore** (topologie + media + meetdata, voor een
  verse/lege instance na bijv. een hardwarewissel, geen nieuwe editie maar een voortzetting) of
  **editie toevoegen aan archief** (alleen de meetdata, topologie/media blijven ongemoeid, voor het
  naast elkaar zetten van meerdere jaargangen). Geblokkeerd met een duidelijke melding bij een
  editie/evenement-naamsbotsing in de doelinstance, nooit stil overschreven/vermengd. Zip wordt
  serverside herkend/uitgepakt met `adm-zip`; leesbaar via `GET /api/instellingen`
  (`event_name`/`event_edition`, opgeslagen in `instellingen.json`, gebruikt voor de tags op
  `topology_edges` en de naamsbotsing-check)

## Roadmap v2 (afgerond, uitgebracht als [v2.0.0](https://github.com/Tbizla/stroom-dashboard/releases/tag/v2.0.0))

> **Werkafspraak vanaf nu**: voor elk van onderstaande punten eerst een uitgebreide spec/plan
> uitwerken en afstemmen vóórdat er gebouwd wordt — geldt voor zowel de Cowork- als de Code-kant
> (zie ook de afspraak hierover in CLAUDE.md). Geen van de items hieronder is dus "zomaar" te
> starten, ook niet de kleine.

- [x] **MQTT-topic-prefix van `fest` naar `site`, plus InfluxDB-org `festival` → `site`.** Afgerond
      — zie README.md §14 voor de migratiestappen op een bestaande instance (InfluxDB-org hernoemen,
      topologie-data bijwerken, fysieke Shelly's herconfigureren). **Laatste openstaande punt voor
      v2 — v2-roadmap is hiermee compleet.**
- [x] **Audit: stuurt de Shelly alle data die 'm publiceren kan?** Afgerond. Conclusie: er mist
      data. Eén bevinding (fasefrequenties) wordt nu opgepakt, zie hieronder; de rest is
      doorgeschoven naar v3 (zie Roadmap v3).
- [x] **Fasefrequenties tonen (`a_freq`/`b_freq`/`c_freq`).** Afgerond — zie de
      Live-monitoring-feature hierboven.
- [ ] *(meer volgt)*

## Roadmap v3 (nog niet gestart)

Bewust nog niet oppakken — komt aan de beurt ná de huidige v2-roadmap. Volgt dezelfde
werkafspraak (eerst spec/plan, dan pas bouwen) zodra dat zover is.

- [ ] **Per-fase fout-/vlagindicatoren + neutrale stroom** (`a_errors`/`a_flags`/`b_*`/`c_*`/
      `n_current`/`n_errors`/component-brede `errors`) — uit de Shelly-audit. Waardevol (directe
      device-eigen overvoltage/overcurrent/overpower/bekabelingsfout-detectie), maar eerst moet
      geverifieerd worden of Telegraf's standaard JSON-parser deze array-velden momenteel al dan
      niet stilzwijgend laat vallen. Hangt bovendien samen met het nog openstaande
      "Notificatiekanaal voor alerting"-item hierboven — niet in isolatie oppakken.
- [ ] **`EMData`-component-brede `errors`** (`database_error`/`ct_type_not_set`) — zelfde
      array-kanttekening als hierboven, device-zelfdiagnose, lage prioriteit.
- [ ] **Interval-aggregaten** (`EMData.GetRecords`/`GetData`/`GetNetEnergies`: min/max/gemiddelde
      per fase, reactief vermogen) — komen niet binnen via de huidige MQTT-architectuur, vereisen
      een fundamenteel andere ophaalmethode (HTTP-polling of een Shelly Script). Alleen oppakken bij
      concrete behoefte, bijv. vanuit een rijker PDF-rapport.
- [ ] **Generator-EM-rework-vervolg: native telemetrie-protocolintegratie.** Bewust uitgesteld
      tijdens de Generator-EM-rework — generators die niet via Shelly+CT-klem maar via een eigen
      protocol uit te lezen zijn.
      **Conceptspec — CAN-bus/SAE J1939** (door Claude uitgewerkt op verzoek van Mike, nog niet
      besproken/geaccordeerd, dus nog geen "echte" spec in de zin van de werkafspraak hierboven):
      - De meeste generatoren met CAN-bus praten **SAE J1939**, een gestandaardiseerd protocol.
        Basisdata (toerental, brandstofniveau, motortemperatuur, draaiuren, oliedruk, alarmen)
        zit er als Parameter Group Numbers (PGN's) al standaard in. Fabrikant-specifieke waarden
        (custom sensoren) vereisen wel de eigen DBC/PGN-lijst van die fabrikant — dat deel is dus
        niet universeel plug-and-play.
      - **Hardware**: een USB-CAN-adapter (bijv. CANable, Innodisk EMUC-B202, ViewTool Ginkgo)
        die op Linux native als SocketCAN-device verschijnt, aangesloten op de CAN-H/CAN-L-lijnen
        van de generator (vaak een Deutsch 9-pins J1939-connector).
      - **Software**: `python-can` + de `can-j1939`-library (PyPI) decoderen de PGN's naar
        leesbare waarden. Geen kant-en-klare J1939→MQTT-bridge gevonden bij het uitzoeken hiervan —
        zelf te bouwen door `can-j1939` te combineren met `paho-mqtt`, qua omvang vergelijkbaar met
        de bestaande `telegraf-herstarter`- of simulator-service. Publiceert op een eigen
        MQTT-topic, Telegraf pikt het net als de Shelly-data op, komt zo gewoon in
        InfluxDB/Grafana terecht.
      - Raakt ook het "Brandstof-/onderhoudstracking"-idee hieronder (Ideeën van Claude) —
        draaiuren/brandstofniveau/motortemperatuur zitten al in de J1939-data, geen aparte sensor
        nodig als de generator toch al CAN-bus heeft.
- [ ] **Notificatiekanaal voor alerting naar telefoon.** Alert-condities in Grafana kunnen al
      aangemaakt worden; er moet nog gekozen worden welk kanaal het bericht ontvangt (opties:
      Telegram, Pushover, ntfy.sh, e-mail). Zodra dit er is, kan de "Overschrijdingen & alarmen"-
      sectie van het PDF-rapport ook echt gevuld worden i.p.v. de huidige placeholder-pagina. Hangt
      ook samen met het uitgestelde "per-fase fout-/vlagindicatoren"-punt hierboven.
- [ ] **Lijnen tussen kasten aanpasbaar (bochten/knikpunten).** Op Kalibreren/Live is de lijn tussen
      een kast en zijn voedingsbron nu een rechte lijn tussen de twee pin-posities; in het echt loopt
      een stroomkabel vaak niet recht (obstakels, paden, kabelgoten, hoeken om een gebouw). Wens:
      knikpunten kunnen toevoegen/verslepen zodat de lijn de daadwerkelijke kabelroute volgt op de
      plattegrond. Raakt alleen Kalibreren/Live — niet Schema, dat is een los auto-gegenereerd
      boomdiagram zonder fysieke plaatsing. Dit is in de kern een bewerkinteractie-ontwerpvraag
      (hoe voeg je een knikpunt toe, hoe versleep/verwijder je 'm) — eerst een Cowork-voorstel nodig
      vóór Code het datamodel (knikpunten waarschijnlijk als extra percentage-coördinaten per lijn,
      zie de percentage-plaatsing-afspraak in CLAUDE.md) en de opslag invult.
- [ ] **Automatische back-up** (lokaal en/of naar een externe server) — vult de bestaande handmatige
      Back-up-subtab aan met een geplande, onbeheerde variant. Nog te bepalen: frequentie, lokale
      bestemming, externe-bestemming-protocol, bewaartermijn/rotatie.
- [ ] **Toegang van buitenaf (HQ meekijken).** Drie mogelijke richtingen, nog open: (a) gewoon
      externe toegang tot deze ene lokale instance, (b) deze app blijft puur lokaal/per locatie en
      HQ krijgt een aparte instance die meerdere locaties samenbrengt, (c) alles in één app: dezelfde
      instance kan zowel lokaal per-locatie als (met deze extra features) een multi-locatie
      HQ-aanzicht zijn. Aanzienlijke architectuurvraag (multi-instance-aggregatie/beveiliging), eerst
      een diagnose met Mike vóór er een voorstel komt.
- [ ] **Vinkje "meetdata beschikbaar" per generator/lid.** Sommige generators hebben geen sensors, of
      (nog) geen toegang om er een Shelly aan te hangen — nu blijkt dat alleen impliciet uit een leeg
      rating (A)-veld, zonder duidelijke reden/label in de UI. Expliciet vinkje in Beheer + een
      herkenbaar "geen sensor"-label op de plekken die nu gewoon niets tonen (Live-zijlijst,
      aside-detail, schema) i.p.v. stil weglaten — zie
      [specs/generator-meetdata-vinkje-plan.md](specs/generator-meetdata-vinkje-plan.md).

## Ideeën van Claude (ongefilterd, nog niet besproken/geprioriteerd met Mike)

> Onderstaande punten zijn door Claude voorgesteld tijdens een brainstormsessie, niet door Mike
> bedacht of al geaccordeerd. Volgen dezelfde werkafspraak (eerst spec/plan) zodra iets hiervan
> opgepakt wordt — en moeten eerst nog besproken/geprioriteerd worden voordat ze als "echt"
> roadmap-item gelden.

- [ ] **Brandstof-/onderhoudstracking per generator.** Draaiuren, brandstofniveau, laatste
      onderhoud, met een refuel-alert. Sluit aan bij de bestaande generator-rating-structuur. Voor
      generators met CAN-bus (J1939) zit deze data er mogelijk al in — zie de conceptspec bij
      "Generator-EM-rework-vervolg" in Roadmap v3 hierboven.
- [ ] **Batterij state-of-charge.** Voor losse batterijen/piekscheerders is nu alleen stroom/
      belasting zichtbaar, niet hoeveel capaciteit er nog in zit.
- [ ] **Voorspellende piekbelasting.** Op basis van historische data van vorige edities (zelfde
      editie-tag) een verwacht piekmoment tonen, bijv. "foodtrucks pieken meestal rond 18:00".
- [ ] **Anomaly-detectie los van de vaste 90%-drempel.** Een plotselinge stroom-dip (kabel
      losgetrokken, generator uitgevallen) is heel iets anders dan een langzame stijging naar de
      rating, maar krijgt nu dezelfde amber/rood-behandeling.
- [ ] **QR-code per kast.** Sticker op de kast zelf, scannen opent direct de databallon/status,
      zonder te zoeken in de zij-lijst. Handig voor rondlopend personeel.
- [ ] **Rolverdeling/rechten.** Nu heeft iedereen die de webapp-URL heeft blijkbaar volledige
      Beheer-rechten. Voor een HQ- of multi-persoon-scenario (zie ook het "toegang van
      buitenaf"-punt) is een viewer/editor-onderscheid relevant.
- [ ] **Brandstofkosten/CO2 in het PDF-rapport.** Logische aanvulling op de bestaande
      generator-energietotalen.
