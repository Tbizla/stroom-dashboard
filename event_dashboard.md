# Event Stroom-Dashboard — projectdocument

> Voor installatie- en gebruiksinstructies (stack starten, Shelly's koppelen, Grafana-queries):
> zie [README.md](README.md). Dit document beschrijft wat het project ís en welke features er
> zijn. Voor de roadmap zie [roadmap.md](roadmap.md) — een index naar
> [roadmap_v2.md](roadmap_v2.md) (afgerond) en [roadmap_v3.md](roadmap_v3.md) (actief, plus
> ongefilterde ideeën). Houd dit bestand bij als de featurelijst wijzigt, en het bijbehorende
> roadmap-bestand als de roadmap wijzigt.

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
  `localStorage`. Dekt alle tabbladen (Beheer/Kalibreren/Schema/Live/Testdata/Rapportages/
  Grafieken) en het PDF-rapport (het rapport volgt de UI-taal die actief was op het moment van
  genereren)
- Domeintermen zijn bewust vertaald, niet automatisch: "kast" → "distribution box" (of "box" kort
  in tabelkoppen/dropdowns), "Beheer" → "Manage", "Kalibreren" → "Calibrate", "Schema" → "Diagram"
- Vertalingen zitten in platte dot-key JSON-bestanden (`webapp/i18n/nl.json`/`en.json`), gedeeld
  tussen de webapp-UI (client-fetch) en het PDF-rapport (server-`require`) — één bron van waarheid

**Login & toegangsbeheer** — zie specs/toegang-van-buitenaf-diagnose.md
- De hele app (elke pagina en elk `/api/*`-endpoint, inclusief de QR-code-deeplinks) zit achter een
  inlogscherm — losse accounts per persoon, geen gedeeld wachtwoord. Sessie blijft staan tot
  uitloggen (of een lange sessietermijn), geen steeds-opnieuw-inloggen tijdens een evenementdag
- Nieuwe "Accounts"-sectie in Beheer: naam/e-mail/laatst-ingelogd per account, wachtwoord resetten,
  verwijderen. Alleen een al-ingelogde editor kan een account aanmaken (geen publieke registratie);
  het gegenereerde wachtwoord wordt eenmalig getoond, daarna nergens meer op te vragen (alleen te
  resetten). Bij de allereerste opstart wordt automatisch één admin-account aangemaakt, met het
  wachtwoord eenmalig in de container-log
- Live-monitoring (MQTT) valt onder dezelfde login-laag: de browser verbindt niet meer rechtstreeks
  met de MQTT-broker, maar via een eigen websocket-proxy op de webapp zelf (`/mqtt`), die een
  sessie-gebonden ticket vereist vóór 'ie doorverbindt — de broker zelf is niet meer van buiten het
  interne netwerk bereikbaar. Als bijvangst: geen handmatig in te vullen broker-host/-poort meer,
  Live verbindt vanzelf naar het juiste adres, ook van buitenaf
- Optionele `caddy`-service (TLS/reverse-proxy, alleen gestart met
  `docker compose --profile publiek up -d`) voor als deze locatie-instance over het publieke
  internet bereikbaar moet zijn — automatisch Let's Encrypt-certificaat via een ingesteld domein.
  Lokaal ontwikkelen/testen blijft gewoon rechtstreeks op `http://localhost:8080`. De sessiecookie
  wordt automatisch `secure`-only zodra dat domein ingesteld staat
- Login-gate is hoofdletterongevoelig op elk `/api/*`-pad (incl. `/mqtt`) — een gevonden bug waarbij
  bijv. `/API/topology` de gate omzeilde is gefixt en met alle hoofdlettervarianten hertest.
  `SESSION_SECRET` hoeft niet handmatig ingesteld te worden: ontbreekt die, dan genereert de webapp
  er bij de allereerste opstart zelf één en bewaart 'm. Simpele rate-limiters op het inlogscherm en
  het publieke HQ-statusendpoint. Live-monitoring herstelt vanzelf na een netwerkstoring of
  webapp-herstart (een vers, kortlevend MQTT-ticket per herverbinding), zonder handmatige
  pagina-ververs
- **Nog niet gebouwd**: rol-onderscheid tussen accounts (alle accounts hebben nu gelijke, volledige
  rechten) — aparte, latere roadmap-stap ("Rolverdeling/rechten")

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
- Expliciete **"Heeft sensor"-checkbox** naast het rating-veld van elke generator/groep en elk lid
  van een groep (kasten hebben altijd verplicht een rating, dus geen checkbox nodig): uitgevinkt
  (default) grijst het rating-veld uit en wist een eventuele waarde, aangevinkt maakt het weer
  invulbaar. Puur een opzettelijke UI-bevestiging bovenop het bestaande `rating_a`-veld (geen nieuw
  databaseveld) — zodat "bewust geen sensor" onderscheiden is van "per ongeluk leeg gelaten". Overal
  waar tot nu toe stil niets werd getoond bij een ontbrekende rating (Live-zijlijst, aside-detail,
  schema-tabblad, kastpopup-ledentabel) staat nu een herkenbaar grijs "geen sensor"-label
- Evenementlogo uploaden, zichtbaar in de header. Logo- en plattegronduploads zijn beperkt tot
  .png/.bmp/.svg, gecontroleerd aan de hand van de daadwerkelijke bestandsinhoud (niet alleen de
  bestandsnaam), zodat een verkeerd bestandstype met een vervalste extensie geweigerd wordt
- **Systeeminstellingen**: evenementnaam en editie zijn nu bewerkbaar vanuit Beheer i.p.v. alleen
  via `.env` bij het opstarten (`GET`/`PUT /api/instellingen`, opgeslagen in `instellingen.json`) —
  gebruikt voor de `editie`/`evenement`-tags op meetdata en de naamsbotsing-check bij een
  back-up-herstel (zie de Back-up-sectie hieronder). Omdat Telegraf zijn tags alleen bij het *aanmaken* van
  z'n container inleest (niet bij een kale restart), herstart "Wijzigingen doorvoeren" Telegraf op
  de achtergrond via een klein, doelbewust beperkt `telegraf-herstarter`-servicetje dat de
  Docker-socket heeft maar naar buiten toe maar precies één actie aanbiedt — de webapp zelf krijgt
  geen Docker-toegang
- Export/import van de volledige topologie als JSON (back-up, of hergebruik voor een nieuwe editie)
- Elke wijziging in Beheer wordt automatisch als `topology_edges`-reeks naar InfluxDB gesynct
  (kast → parent/generator), zodat Grafana de actuele parent/child-structuur kan gebruiken
  zonder dat de Shelly's of MQTT-topics daarvoor aangepast hoeven te worden
- **Alert-notificaties**: sectie naast Systeeminstellingen om het kanaal in te stellen waarop de
  bestaande Grafana-alert-condities (90%-belastingsdrempel per fase) een bericht sturen — Telegram,
  Pushover, ntfy.sh en/of e-mail, meerdere tegelijk aan mag. Elk kanaal een eigen kaart (aan/uit-
  toggle, kanaalvelden, "Stuur testbericht"-knop met live status) en een gedeelde "Wijzigingen
  doorvoeren"-knop die de instellingen opslaat (`PUT /api/instellingen/notificaties`) én Grafana's
  contact-point-/notification-policy-provisioning-API bijwerkt (Telegram/Pushover/e-mail als
  Grafana-native contact-point-types onder één gedeeld contact point "Stroomdashboard"; ntfy heeft
  geen native Grafana-type en loopt via een webhook terug naar de webapp, die 'm doorstuurt). Het
  testbericht gaat altijd rechtstreeks (buiten Grafana om), met dezelfde verstuurfunctie als de
  webhook. Provisioning is best effort — mislukt die stap (Grafana onbereikbaar, onvolledig
  ingevuld kanaal), dan blijven de al opgeslagen instellingen en de overige, wél correcte kanalen
  gewoon staan; alleen het mislukte kanaal wordt gemeld
- **Geheimen afgeschermd**: `GET /api/instellingen` geeft echte geheimen (Telegram-bot-token,
  Pushover-API-token, SMTP-wachtwoord, en bij Automatische back-up het SFTP-wachtwoord/S3-
  secret-key) nooit in platte tekst terug — alleen een `<veld>_ingesteld`-boolean. Een leeg gelaten
  geheim veld bij het opslaan laat de bestaande waarde ongewijzigd; een expliciete "Wissen"-link per
  veld verwijdert 'm. Niet-geheime velden (chat-ID, ntfy-topic, SFTP-host/gebruiker, S3-access-key,
  enz.) blijven gewoon zichtbaar/bewerkbaar
- **Shelly-koppeling**: optioneel "Shelly IP"-veld per kast en per generator/lid-met-sensor (alleen
  invulbaar/getoond als "Heeft sensor" aan staat), naast de bestaande `mqtt_topic_prefix`. Overal
  waar de live status van een kast/generator/groepslid getoond wordt (kastpopup — incl. de compacte
  per-lid-tabel van een groep, aside-detail — incl. het ledenblok, de mobiele QR-statuspagina)
  verschijnt een "Open Shelly ↗"-link die de lokale Shelly-webinterface in een nieuw tabblad opent
  (alleen bruikbaar op het evenement-netwerk) — geen link zichtbaar als het veld leeg is
- **QR-code per kast** (niet voor generators/batterijen): "QR-code"-knop per rij in de kasten-tabel
  (overlay met QR, naam/afkorting, downloaden als PNG of printen) en een "Alle QR-codes
  printen"-knop die in één keer een printvriendelijk stickervel voor alle kasten opent. Elke QR
  codeert een deep-link (`?mode=live&kast=<id>`, t.o.v. het huidige basispad — blijft dus ook
  kloppen als de instance ooit achter een reverse-proxy op een subpad draait); op een breed scherm
  (desktop/tablet) opent die gewoon de bestaande Live-modus met de databallon van die kast open. Op
  een smal scherm (telefoon) opent in plaats daarvan een eigen lichte, responsive statuspagina (geen
  zij-lijst/plattegrond/pan-zoom-chrome, waar de bestaande Live-modus niet geschikt voor is op een
  klein scherm) met dezelfde live meetwaarden, de "Open Shelly"-knop, en een "Bekijk op
  plattegrond →"-link naar de volledige Live-modus. Een verwijderde kast toont een duidelijke
  "bestaat niet meer"-melding i.p.v. een kale foutmelding. QR-generatie gebeurt met een lokaal
  meegeleverde library (`webapp/public/js/vendor/qrcode.min.js`, geen CDN) — werkt dus ook zonder
  internet op locatie
- **Back-up** (eigen sectie onderaan de Beheer-kolom, ná Kasten — verhuisd vanuit de
  Rapportages-tab, puur een locatiewijziging): één zip-bestand voor een volledige restore op een
  andere instance. Topologie (JSON) en plattegrond/logo staan altijd aangevinkt (niet uit te
  zetten); meetdata (InfluxDB-dump) is een losse optie met dezelfde periode-keuze als het
  PDF-rapport, i.v.m. bestandsgrootte. Bij meetdata zit ook een `topology_edges`-snapshot (huidige
  editie/evenement) en een `meetdata.lp`-bestand (InfluxDB line-protocol) naast de bestaande
  leesbare `meetdata.csv` — nodig om de "Back-up herstellen"-sectie hieronder te voeden. Zelfde
  status/resultaat/foutkaart-patroon als de PDF-rapportflow ("Opnieuw proberen" bij een mislukte
  poging), gebouwd met de `archiver`-library
  - **Back-up herstellen** (restore, tegenhanger van bovenstaande): een eerder gemaakte back-up-zip
    terugzetten, in twee modi — **volledige restore** (topologie + media + meetdata, voor een
    verse/lege instance na bijv. een hardwarewissel, geen nieuwe editie maar een voortzetting) of
    **editie toevoegen aan archief** (alleen de meetdata, topologie/media blijven ongemoeid, voor
    het naast elkaar zetten van meerdere jaargangen). Geblokkeerd met een duidelijke melding bij
    een editie/evenement-naamsbotsing in de doelinstance, nooit stil overschreven/vermengd. Zip
    wordt serverside herkend/uitgepakt met `adm-zip`; leesbaar via `GET /api/instellingen`
    (`event_name`/`event_edition`, opgeslagen in `instellingen.json`, gebruikt voor de tags op
    `topology_edges` en de naamsbotsing-check)
  - **Automatische back-up**: geplande, onbeheerde variant tussen "Back-up maken" en "Back-up
    herstellen" — aan/uit-toggle, frequentie (elk uur/dagelijks/wekelijks + tijdstip), optioneel
    meetdata meenemen, en één of meer bestemmingen tegelijk (lokaal pad op de server, extern via
    SFTP, extern via een S3-compatible endpoint — MinIO/Backblaze B2/Wasabi enz.), elk met een
    eigen bewaartermijn ("bewaar laatste N"). Rotatie gebeurt altijd pas ná een bevestigd geslaagde
    nieuwe back-up (nooit oudere back-ups wissen vóór de nieuwe veilig staat) en een geplande run
    wacht op een eventuele handmatige back-up-/restore-/PDF-rapportflow i.p.v. er gelijktijdig mee
    te draaien. Statusregel toont de laatste run (geslaagd/deels mislukt/mislukt, per bestemming)
    en de eerstvolgende geplande run. Bij een mislukte of deels mislukte run gaat er, als het
    Alert-notificatiekanaal geconfigureerd is, een bericht naar alle aangezette kanalen — zonder
    kanaal blijft het bij de statusregel

**Plattegrond & kalibratie (Kalibreren-tabblad)**
- Plattegrond (afbeelding) uploaden, of zonder plattegrond werken op een leeg, ruim canvas
  (4800×3000) als er nog geen kaart is — de posities blijven gewoon staan zodra je er later een
  toevoegt
- Generators en kasten als pins plaatsen en verslepen
- Lijnen tussen kasten en hun voedingsbron, afgeleid uit de parent/child-koppeling. Standaard een
  rechte lijn, maar met knikpunten aan te passen aan de daadwerkelijke kabelroute (obstakels,
  paden, hoeken om een gebouw): dubbelklik op een lijnsegment voegt een knikpunt toe op die
  positie, slepen verplaatst het, dubbelklik op een knikpunt verwijdert het weer. Rechtsklik op een
  lijn of knikpunt opent een mini-menu ("Knikpunt hier invoegen" / "Rechte lijn terugzetten") als
  alternatief voor dubbelklikken. Alleen bewerkbaar op Kalibreren; op Live volgt de lijn dezelfde
  route, puur ter weergave, zonder handles
- In-/uitzoomen (knoppen of scrollwiel) en pannen (klikken en slepen), met een "fit to screen"-knop
  die alles in één keer in beeld brengt (incl. eventuele knikpunten) — handig bij een grote
  topologie

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
- **Anomaly-detectie**: eigen, pulserend ⚡-badge (in `--accent`, geen vierde statuskleur) naast de
  status-stip in de zij-lijst, aside-detail en op de plattegrond-pin, onafhankelijk van de vaste
  90%-rating-drempel. Client-side op de al binnenkomende MQTT-stream: een relatieve sprong van meer
  dan 50% t.o.v. een kort voortschrijdend gemiddelde (rollend venster van laatste ~20-60 sec)
  triggert de badge, zowel bij een plotselinge dip (kabel los, generator uit) als een abnormaal
  snelle stijging — een kast kan dus tegelijk "groen" staan én een anomalie tonen. Hover/klik toont
  de tekst (bijv. "Stroom daalde 82% in 33 sec (van 14.0A naar 2.5A)"); klik bevestigt/verbergt 'm,
  en verdwijnt vanzelf na 10 minuten als niemand dat doet. Overzicht-subtab heeft een eigen
  "N anomalieën actief"-telkaartje, naast de bestaande generator-/kasten-kaarten

**Grafieken-tabblad (vrije ad-hoc analyse)** — zie specs/grafieken-tabblad-plan.md
- Zesde hoofdtabblad, naast Beheer/Kalibreren/Schema/Live/Rapportages: zelf kasten/generators,
  metric/fase/periode/editie kiezen en in een grafiek zetten, zonder naar Grafana te hoeven
  wisselen voor een snelle ad-hoc vraag ("hoe deed kast 12 het gisteren t.o.v. kast 13?")
- Linkerkolom: doorzoekbare, aan-/uitvinkbare boomlijst van generators/kasten (meerdere tegelijk),
  metric (Stroom A / Spanning V / Vermogen W / Energie kWh), fase (A/B/C/Totaal — bij Spanning+
  Totaal het gemiddelde van de drie fasen, er is geen fysiek `total_voltage`-veld), periode (hele
  evenement/laatste 24u/aangepast) en editie (één, of "alle edities")
- **Lijndiagram** (gebouwd): tijdreeks, één lijn per geselecteerde kast/generator. Server-side
  downsampling (InfluxDB `aggregateWindow`, venstergrootte berekend uit de periodelengte) — bij
  "hele evenement" komt nooit de ruwe ~1s-puntenreeks naar de browser
- **Staafdiagram** (gebouwd): één balk per geselecteerde kast/generator over de gekozen periode,
  met een aggregatie-keuze (Piekwaarde/Gemiddelde/Periode-totaal — periode-totaal alleen actief bij
  metric Energie, elders uitgeschakeld en valt terug op Piekwaarde). Balken aflopend gesorteerd op
  waarde. Kleur volgt de groen/amber/rood-belastingsconventie (t.o.v. rating) bij metric Stroom; bij
  fase "Totaal" vergelijkt de kleur (niet de getoonde balkhoogte) tegen de zwaarst-belaste van de
  drie fases, niet de driefasen-som (`rating_a` is een per-fase rating, een som zou pas rond ~300%
  "rood" worden). Bij de overige metrics (geen rating-vergelijking mogelijk in W/V/kWh) hetzelfde
  categorische palet als het lijndiagram
- **Taartdiagram/donut** (gebouwd): aandeel van elke geselecteerde kast/generator in het totaal,
  plat (geen boomstructuur, gewone checklist). Metric ligt hier vast op Energie (kWh) en aggregatie
  op Periode-totaal — beide knoppenrijen blijven zichtbaar maar zijn vergrendeld zolang Taart actief
  is (geen zinvol "aandeel" bij een piek/gemiddelde of een niet-optelbare grootheid), en de vorige
  metric-keuze wordt automatisch hersteld zodra je naar een ander grafiektype wisselt. Legenda toont
  percentage + waarde per segment, eenheid volgt de actieve metric (kWh normaal, W zodra live-modus
  naar Vermogen omzet)
- **Belasting-heatmap** (gebouwd): rij per geselecteerde kast/generator, kolom per tijdvak (uur-van-
  de-dag bij een periode tot ~3 dagen, anders per dag — voorkomt honderden kolommen bij een
  meerdaags evenement). Celkleur volgt de groen/amber/rood-belastingsconventie (zelfde zwaarst-
  belaste-fase-vergelijking bij fase "Totaal" als het Staafdiagram, null-tolerant — een cel met
  bijv. alleen fase A en B bekend krijgt nog een terechte kleur i.p.v. vals-groen); metric ligt hier
  net als bij Taart vast (op Stroom, om dezelfde reden als het Staafdiagram: de celkleur ís "t.o.v.
  rating", geen zinvolle vergelijking in W/V/kWh). Aggregatie per cel is Piekwaarde of Gemiddelde (Periode-
  totaal is geen zinvolle aggregatie binnen één tijdvak-cel). Een ontbrekende meting toont een lege
  cel, geen kunstmatige 0. Eigen SVG (native `<title>`-tooltip per cel), geen chartlibrary nodig
- **Sankey** (gebouwd, laatste van de vijf grafiektypes): energieverdeling vanaf één gekozen
  startpunt-generator/-groep. De linkerkolom wisselt hier om naar een startpunt-dropdown (alleen
  generators/groepen, bewust geen "Alles"-optie — een fictieve top-node bij meerdere onafhankelijke
  generators zou verwarrend zijn) i.p.v. de gewone kasten-checklist; Fase verdwijnt volledig uit de
  linkerkolom en metric ligt vast op Energie (kWh, W zodra live-modus naar Vermogen omzet). De eerder
  gekozen kasten-checklist-selectie blijft ondertussen intact en komt terug zodra je naar een ander
  grafiektype wisselt. Breedte van elke stroom = kWh in de gekozen periode/editie; kleur per
  node-type (groep/generator/batterij/kast), zelfde kleurcodering als het Schema-tabblad. Eigen,
  zelfgetekende SVG (geen d3-sankey- of andere library nodig — de data is altijd een boom, geen
  algemene DAG)
- **Editie(s)**: "Alle edities" is alleen bij het Lijndiagram bruikbaar (het enige type waar
  "meerdere lijnen, één per editie" ondubbelzinnig is) — bij Staaf/Taart/Heatmap/Sankey valt de
  select automatisch terug naar de meest recente enkele editie zodra je naar zo'n type wisselt
- **Live-modus** (gebouwd): vierde periode-optie "Live" naast hele evenement/laatste 24u/aangepast
  — een schuifvenster (5/15/30/60 min) dat continu doorschuift, geen vast begin/eind. Hergebruikt
  dezelfde MQTT-websocketverbinding als het Live-tabblad (geen nieuwe databron); een client-side
  rolling buffer (altijd 60 min, ongeacht het gekozen venster) wordt gevuld zodra er een MQTT-
  bericht binnenkomt, ongeacht welk tabblad actief is. Editie-select staat vast op de huidige editie
  zolang Live actief is. Pulserende "LIVE"-indicator naast de grafiektype-knoppenrij (zelfde
  visuele taal als de anomaly-badge) en een pauzeren/hervatten-knop (puur client-side, de buffer
  blijft ondertussen doorlopen). Per grafiektype:
  - **Lijndiagram**: scrollende live-tijdreeks, meerdere kasten/generators in één grafiek.
  - **Staafdiagram**: aggregatie-keuze wisselt naar Huidige waarde (default)/Piek-in-venster/
    Gemiddelde-in-venster (eigen knoppenrij, vervangt Piekwaarde/Gemiddelde/Periode-totaal).
  - **Sankey & Taart**: metric springt automatisch van Energie (kWh) naar Vermogen (W) en wordt
    tijdelijk vastgezet — een live-aandeel/-verdeling toont de actuele vermogensverdeling, geen
    cumulatieve energie. Dezelfde Energie-uitsluiting geldt ook voor Lijn/Staaf (alleen de
    Energie-chip wordt daar uitgeschakeld, de rest van de metric-keuze blijft vrij).
  - **Heatmap**: geen live-modus (draait per definitie om een afgerond patroon over meerdere uren)
    — de Live-chip is uitgeschakeld zolang Heatmap actief is, en wisselen naar Heatmap terwijl Live
    aanstond valt automatisch terug op de laatst gekozen niet-live periode.
  - Live wordt bewust nooit in de "Kopieer link"-URL gecodeerd (valt terug op Laatste 24u).
- "Downloaden als PNG" (gebouwd, technologie-onafhankelijk voor alle vijf typen) en "Kopieer link"
  (codeert de huidige selectie inclusief grafiektype als leesbare query-string, `?mode=grafieken&...`
  — opent bij het laden automatisch dit tabblad in dezelfde staat, geen opslag/database erbij).
  Lijn/Staaf/Taart downloaden rechtstreeks vanaf de Chart.js-canvas; Sankey en Heatmap zijn allebei
  een zuivere SVG (geen HTML/foreignObject erin — dat "taint" het canvas zodra er HTML in zit, een
  Chromium-beveiligingsbeperking) en delen dezelfde rasterisatie-route (SVG naar canvas via een
  Image, de browser kan dat zelf)
- **Nog niet gebouwd**: meerdere-edities-vergelijking (jaar-op-jaar, alleen bij het lijndiagram) is
  nog niet meegenomen, dat volgt samen met de tijd-sinds-start-uitlijning uit
  voorspellende-piekbelasting-plan.md

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
  zodat de Sankey ook historisch (via een teruggezette editie, zie de Back-up-sectie in
  Topologiebeheer hierboven) blijft kloppen

**Rapportages-tabblad** (vijfde tab in de mode-switch, met een altijd-zichtbare subnav:
Overzicht/PDF-rapport/Locaties — Back-up verhuisde naar Beheer, zie Topologiebeheer hierboven)

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

*Locaties-subtab* (specs/toegang-van-buitenaf-diagnose.md, uitgangspunt "meerdere locaties tegelijk
zien") — alleen zinvol als HQ-instance, maar staat in elke instance beschikbaar:
- Handmatige locatielijst (naam + URL per locatie-instance) beheren — geen auto-discovery
- Statuskaart per bekende locatie: groen/amber/rood-stip, aantal kasten, aantal amber/rood, en een
  "Beheer openen"-link die de volledige app van die locatie opent (zelfde rechten als ter plekke,
  geen aparte uitgeklede weergave — vraagt om een eigen login op die andere instance, geen
  single-sign-on tussen instances). Een niet-bereikbare locatie toont een grijze "offline"-kaart
  i.p.v. de hele pagina te laten hangen
- Onder de motorkap: elke instance heeft een nieuw, publiek `/api/hq-status`-endpoint (geen login
  nodig, geeft alleen tellingen terug) dat deze pagina server-naar-server ophaalt per bekende
  locatie, met een timeout per locatie
