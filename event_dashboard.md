# Event Stroomdashboard — projectdocument

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

**Topologiebeheer (Beheer-tabblad)**
- Generators aanmaken/bewerken/verwijderen (naam, kVA), met een type: gewone **generator**,
  **batterij** (los opslagsysteem), of **groep** — één logische krachtbron die intern uit meerdere
  generators/accu's bestaat (bijv. een centrale met meerdere aggregaten + een batterijcontainer die
  load-sharen of elkaar met auto-start back-uppen). Kasten koppelen aan de groep zelf, niet aan een
  los lid; de leden zijn beschrijvend (naam/kVA/type) en geen eigen topologie-node
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
  amber/rood; in-/uitklapstatus per item wordt onthouden
- Klikken op een kast-pin op de plattegrond opent een databallon ter plekke met de volledige
  MQTT-payload (stroom/spanning/act. en schijnbaar vermogen/cos φ per fase, totalen, cumulatieve
  energie in kWh, belastingsbalk, laatste-update-tijd) — naast de bestaande zij-detail, niet ter
  vervanging. Volgt de pin mee bij pannen/zoomen; sluit bij nogmaals klikken op dezelfde pin, klik
  elders op de kaart, het kruisje, of een tabwissel

**Testdata-tabblad** *(alleen in testmodus, zie hieronder)*
- Eén klik een voorbeeldtopologie laden: **eenvoudig** (2 generators, 6 kasten, 3 niveaus) voor een
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

**Grafana-dashboards**
- InfluxDB-datasource en start-dashboard worden automatisch geprovisioned bij het opstarten
- Paneel per kast (stroom per fase, geen los "totale stroom"-paneel — een CEE-aansluiting is per
  fase gerated, niet cumulatief) herhaalt automatisch via een `$kast`-variabele, inclusief
  batterij-/piekscheerderkasten
- `$editie`-variabele om meerdere jaren/edities te vergelijken (data blijft in dezelfde bucket)
- Alerting-condities (90%-drempel van `rating_a` per fase, niet van `total_current`) zijn per paneel handmatig toe te voegen
- Sankey-paneel ("Terugblik - energieverdeling", Netsage Sankey-plugin, automatisch geïnstalleerd
  via `GF_INSTALL_PLUGINS`) toont na afloop het geschatte energieverbruik per kast als
  stroomdiagram, met de volledige parent/child-keten (generator/groep → batterij/hoofdverdeler →
  kast, hoe diep ook) — via een Flux-`join()` tussen de vermogensdata en de `topology_edges`-reeks
  hierboven, dus automatisch actueel zodra de topologie in de webapp wijzigt

## Roadmap

- [ ] **Generator-EM rework.** De net toegevoegde generator/groep-monitoring (optionele rating_a,
      zelfde live status als een kast, self-meter via `fest/<generator>/<generator>/status/em:0`)
      voelt nog niet helemaal goed — nog niet scherp wát precies, dus eerst verder gebruiken/
      bekijken voor de volgende aanpassing.
- [ ] **Notificatiekanaal voor alerting naar telefoon.** Alert-condities in Grafana kunnen al
      aangemaakt worden; er moet nog gekozen worden welk kanaal het bericht ontvangt (opties:
      Telegram, Pushover, ntfy.sh, e-mail).
- [ ] **PDF-export van het Grafana-dashboard voor een terugblikrapport.** Grafana OSS heeft
      geen ingebouwde PDF-/reportfunctie (dat zit alleen in Grafana Enterprise/Cloud). Voor een
      deelbaar rapport na afloop van een editie: een losse, gratis tool zoals
      [IzakMarais/reporter](https://github.com/IzakMarais/reporter) of
      [cloudeteer/grafana-pdf-report-app](https://github.com/cloudeteer/grafana-pdf-report-app)
      toevoegen aan de stack. Tot die tijd kan het per paneel via "Inspect > Download CSV",
      of een browser-print-to-PDF van het dashboard.
- [ ] **Overzichtsdashboard met generator-totalen.** Eén pagina met de generator-totalen
      bovenaan (grote getallen/gauges), daaronder per generator een rij met de direct-gevoede
      kasten, en voor kasten die zelf weer vertakken (bijv. een terreinverdeler) een klikbare
      drill-down naar een sub-dashboard — via Grafana dashboard-links of variabelen.
