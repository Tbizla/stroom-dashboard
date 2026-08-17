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
- **Favicon**: zelfde ⚡-icoon als de generator-marker in de zijbalk (`webapp/public/favicon.svg`,
  schaalbare SVG, geen aparte 16/32/180px-PNG-varianten nodig)
- **Fullscreen-knop** (⛶, rechter bovenhoek van de header, ná de sessiebalk) — zet de hele pagina in
  volledig scherm via de standaard browser Fullscreen-API, werkt hetzelfde ongeacht welk tabblad
  actief is. Handig voor een Live-/Schema-weergave op een groot scherm/beamer op locatie. Tooltip
  wisselt tussen "Volledig scherm"/"Volledig scherm verlaten" en blijft in sync ook als fullscreen
  op een andere manier verlaten wordt (Esc, F11, browser-UI)

**Vloeiende UI-schaling** — zie specs/ui-vloeiende-schaling-plan.md
- De hele UI-chrome (koppen, knoppen, tabellen, formulieren, zijbalken, kastpopup, grafieken)
  schaalt evenredig mee met het schermformaat i.p.v. op elke breedte even groot te blijven — was
  eerder een algeheel probleem (geen enkele `@media`-breakpoint, alle maten vaste px-waarden): op
  een klein laptopvenster raakte de UI eerder afgekapt/wrappend, op een groot beamer-scherm bleef
  alles een mini-UI in een zee van lege ruimte
- Mechanisme: `html{font-size:clamp(14px, 10px + 0.36vw, 24px)}` bepaalt de basiseenheid, de rest
  van `style.css` (font-sizes, padding, gaps, expliciete knop-/inputafmetingen, border-radius) staat
  in `rem` i.p.v. `px` en schaalt daar automatisch mee. Op een "normale" desktopbreedte
  (~1440-1920px) is het resultaat vrijwel identiek aan de oude vaste maten (bewust een
  schaal-toevoeging, geen visuele redesign); richting de uiterste breedtes (smal laptopvenster resp.
  groot 4K-scherm) wordt het merkbaar kleiner/groter — het plafond lag oorspronkelijk op 19px, maar
  bleek op écht brede/4K-viewports (bevestigd op een 16" 4K-laptop en een 32" 4K-scherm) al ruim vóór
  de werkelijke schermbreedte bereikt, waarna er niets meer meegroeide; opgehoogd naar 24px zodat een
  groot scherm ook echt merkbaar groter aanvoelt. Randdiktes en box-shadow-offsets blijven bewust
  `px` (een haarlijn hoort een haarlijn te blijven)
- **Beheer-content vult de beschikbare breedte**: `.beheercol` (de Topologie-/Instellingen-/
  Accounts-/Back-up-inhoud) had een vaste leesbare-regellengte-max-breedte die los stond van de
  font-schaling én, onafhankelijk daarvan, geen `flex-grow` had binnen zijn `display:flex`-
  oudercontainer — een flex-item zonder groei sizet op zijn eigen inhoud, dus de max-breedte was op
  smallere inhoud (bijv. weinig kolommen) meestal niet eens de daadwerkelijke beperking. Beide
  gefixt (`flex:1;min-width:0`), zodat vooral de kasten-/generatorentabel (tabulaire data, geen
  lopende tekst) de volledige beschikbare breedte gebruikt i.p.v. een smalle kolom naast een lege
  rand op een breed scherm
- **"+ nieuwe rij"-formulieren zijn nu echte tabelrijen**: de "+ Generator"/"+ Account aanmaken"/
  "+ Locatie"-formulieren (Beheer → Topologie/Accounts, Rapportages → Locaties) stonden als losse
  `<div>` onder de tabel en léken toevallig uit te lijnen met de kolomkoppen — brak zichtbaar zodra
  de tabel na de breedte-fix hierboven echt breed ging renderen, want de inputs hadden nooit
  daadwerkelijk dezelfde kolombreedte als de tabel erboven. Nu een laatste `<tr>` ín de tabel zelf
  (zelfde patroon als de al langer bestaande "+"-rij van de leden-subtabel), lijnt daardoor
  gegarandeerd uit ongeacht schermbreedte
- **Rijlijnen in de Generatoren-/leden-tabel lijnen weer recht**: de RATING (A)-kolom had
  `display:flex` rechtstreeks op het `<td>`-element staan (i.p.v. op een binnenliggend `<div>`,
  zoals de rest van de tabel) — daardoor rekte die ene cel niet betrouwbaar mee met de rijhoogte van
  de andere kolommen, wat als een "verspringende" scheidingslijn zichtbaar was. Checkbox+ratingveld
  zitten nu in een binnen-`<div>`, net als de Shelly-IP-kolom ernaast
- **Kritieke uitzondering**: het topologie-canvas (`.blankcanvas`, 4800×3000px) en alles binnen het
  percentage-gebaseerde pin-plaatsingssysteem (pins, pin-labels, lijnen/knikpunten — Kalibreren/
  Schema/Live) blijft bewust buiten dit werk — dat is een vaste logische coördinatenruimte met een
  eigen, al werkende content-aware fit-to-screen-`transform:scale()`, geen UI-chrome. De UI-chrome
  ERBOVENOP het canvas (zoomknoppen, koppen, zijbalk) schaalt wel gewoon mee
- **Chart.js/eigen-SVG-tekst en -maten** (Lijn/Staaf/Taart-lettergroottes, Heatmap-celgrootte,
  Sankey-nodedikte) lezen geen CSS — een aparte `schaalFactor()`-helper in `grafieken.js` leest de
  effectieve root-font-size uit en vermenigvuldigt die JS-eigen px-constanten er evenredig mee

**Login & toegangsbeheer** — zie specs/toegang-van-buitenaf-diagnose.md
- De hele app (elke pagina en elk `/api/*`-endpoint, inclusief de QR-code-deeplinks) zit achter een
  inlogscherm — losse accounts per persoon, geen gedeeld wachtwoord. Sessie blijft staan tot
  uitloggen (of een lange sessietermijn), geen steeds-opnieuw-inloggen tijdens een evenementdag
- Nieuwe "Accounts"-sectie in Beheer: naam/e-mail/laatst-ingelogd per account, wachtwoord resetten,
  verwijderen. Alleen een al-ingelogde editor kan een account aanmaken (geen publieke registratie);
  het gegenereerde wachtwoord wordt eenmalig getoond, daarna nergens meer op te vragen (alleen te
  resetten)
- Bij de allereerste opstart wordt automatisch één admin-account aangemaakt met een vast
  `admin`/`admin`-inlog (bewust makkelijk te onthouden/documenteren i.p.v. een willekeurig
  wachtwoord dat je uit de container-log moet vissen) — na de eerste succesvolle login wordt
  **verplicht** (server-side afgedwongen, geen overslaanbaar schermpje) om een eigen wachtwoord
  gevraagd vóórdat de rest van de app te gebruiken is. Bestaande installaties merken hier niets van
  (alleen relevant bij een écht lege `accounts.json`). Nieuwe accounts via Beheer → Accounts
  aanmaken/resetten blijven gewoon een willekeurig gegenereerd wachtwoord geven zoals altijd
- Live-monitoring (MQTT) valt onder dezelfde login-laag: de browser verbindt niet meer rechtstreeks
  met de MQTT-broker, maar via een eigen websocket-proxy op de webapp zelf (`/mqtt`), die een
  sessie-gebonden ticket vereist vóór 'ie doorverbindt — de broker zelf is niet meer van buiten het
  interne netwerk bereikbaar. Als bijvangst: geen handmatig in te vullen broker-host/-poort meer,
  Live verbindt vanzelf naar het juiste adres, ook van buitenaf
- Login-gate is hoofdletterongevoelig op elk `/api/*`-pad (incl. `/mqtt` en `/mqtt/`-varianten) —
  een gevonden bug waarbij bijv. `/API/topology` de gate omzeilde is gefixt en met alle
  hoofdlettervarianten hertest. `SESSION_SECRET` hoeft niet handmatig ingesteld te worden: ontbreekt
  die (of staat 'm nog op de `.env.example`-placeholder), dan genereert de webapp er bij de
  allereerste opstart zelf één en bewaart 'm. Simpele rate-limiters op het inlogscherm en het
  publieke HQ-statusendpoint
- Live-monitoring herstelt vanzelf na een netwerkstoring, mosquitto-herstart óf webapp-herstart (een
  vers, kortlevend MQTT-ticket per herverbinding), zonder handmatige pagina-ververs — ook een
  verbindingsdrop ná een eerder geslaagde verbinding wordt gedetecteerd en opnieuw opgebouwd (niet
  alleen de allereerste connectiepoging)
- Servicetoegang (de testmodus-`simulator` en Grafana's ntfy-webhook, zie Alert-notificaties
  hieronder) gebruikt een gedeeld `INTERNAL_API_TOKEN` — een niet-overschreven placeholderwaarde uit
  `.env.example` wordt genegeerd (telt als "niet ingesteld") i.p.v. als geldig geheim geaccepteerd
- `NODE_ENV=production` staat aan (plus een generieke laatste error-handler) zodat een fout nooit
  een stacktrace met serverpaden teruggeeft
- **TLS/reverse-proxy**: optionele `caddy`-service (alleen gestart met
  `docker compose --profile publiek up -d`, lokaal ontwikkelen blijft gewoon op
  `http://localhost:8080`) voor als deze locatie-instance ook over het publieke internet bereikbaar
  moet zijn — automatisch Let's Encrypt-certificaat via een ingesteld `PUBLIC_DOMEIN`, websocket-
  upgrades (inclusief `/mqtt`) werken vanzelf zonder aparte config. De sessiecookie wordt
  automatisch `secure`-only zodra verkeer via Caddy binnenkomt (volgt `req.secure`)
- **Rolverdeling (Editor/Viewer)**: elk account heeft een rol, in te stellen via een dropdown in de
  Accounts-tabel. **Editor** = huidig gedrag, ongewijzigd (volledige rechten). **Viewer** = alleen
  kijken — de mode-switch toont dan alleen Schema/Live/Rapportages/Grafieken; Beheer, Kalibreren en
  Testdata verdwijnen volledig uit de header (i.p.v. grijs-met-uitleg getoond te worden), en een
  viewer landt bij het inloggen automatisch op Schema i.p.v. Beheer. Server-side afgedwongen (niet
  alleen de tabbladen client-side verstopt): elke route die bij Beheer/Kalibreren/Testdata hoort
  geeft een viewer-sessie een 403, ook bij een rechtstreekse API-aanroep buiten de UI om — dit geldt
  ook voor het aanmaken/verwijderen van HQ-locaties (`/api/locaties`, GET blijft toegestaan) al zit
  die functie in de verder wél voor viewers toegankelijke Rapportages-tab. Bestaande accounts van
  vóór dit veld tellen automatisch als editor (geen ongevraagde rechten-inkrimping bij de upgrade).
  Het bootstrap-admin-account is altijd editor. Geen fijnmaziger systeem dan deze twee rollen (geen
  per-tabblad-matrix)

**Topologiebeheer (Beheer-tabblad)**
- Het Beheer-tabblad heeft een altijd-zichtbare subnav met vijf sub-tabs (zelfde patroon als de
  Rapportages-subnav): **Topologie** (standaard actief — Generators + Kasten + "Alles wissen"),
  **Instellingen** (Evenementlogo, Systeeminstellingen, Alert-notificaties — dingen die je typisch
  één keer per evenement instelt), **Accounts**, **Back-up** (Back-up maken, Automatische
  back-up, Back-up herstellen, ongewijzigd bij elkaar), en **Locaties** (de handmatige HQ-
  locatielijst beheren — naam/URL toevoegen/verwijderen; verplaatst vanuit de Rapportages >
  Locaties-subtab, die alleen nog de live statuskaarten toont, zie de Locaties-subtab hieronder).
  Welke sub-tab actief is blijft onthouden zolang je in de app blijft (zelfde gedrag als de
  Rapportages-subnav), ook bij het wisselen naar een ander hoofdtabblad en terug
- Generators aanmaken/bewerken/verwijderen (naam, kVA), met een type: gewone **generator**,
  **batterij** (los opslagsysteem), of **groep** — één logische krachtbron die intern uit meerdere
  generators/accu's bestaat (bijv. een centrale met meerdere aggregaten + een batterijcontainer die
  load-sharen of elkaar met auto-start back-uppen). Kasten koppelen aan de groep zelf, niet aan een
  los lid; een lid heeft naam/kVA/type en, sinds de generator-EM-rework, een eigen stabiele id +
  automatisch gegenereerde `mqtt_topic_prefix` en optionele rating (A) — alleen relevant als dat lid
  ook echt een eigen Shelly+CT-klem heeft. Leden zijn nog steeds geen losse topologie-node (niet los
  te plaatsen op de plattegrond)
- **Bestaande generators samenvoegen tot een groep**: "Generators groeperen"-knop boven de
  generatorentabel zet een selectiemodus aan (checkbox per rij, groepen zelf niet selecteerbaar —
  geen geneste groepen); bij ≥2 geselecteerd verschijnt een actiebalk met een bevestigingsdialoog
  (naam + optioneel soort koppeling + een waarschuwing hoeveel kasten geraakt worden). De
  geselecteerde generators worden leden van een nieuwe groep (kVA opgeteld als default), hun kasten
  verhuizen automatisch mee. **Let op**: dit wijzigt het MQTT-topic van elke meeverhuisde kast (en
  van de samengevoegde generators zelf) — de bijbehorende Shelly's moeten na het samenvoegen
  opnieuw ingesteld worden op het nieuwe topic, anders stopt live data binnenkomen (historische
  InfluxDB-data blijft gewoon staan, een grafiek toont vanaf dat moment een gat). Eén atomaire
  serveraanroep: een ongeldige selectie wijzigt niets (geen half-gemigreerde toestand)
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
- Evenementlogo uploaden, zichtbaar in de header. Logo-uploads zijn beperkt tot .png/.bmp/.svg (max.
  25 MB), plattegronduploads tot .png/.bmp/.svg/.pdf (max. 300 MB — ruimer dan het logo omdat een
  uit PDF geconverteerde SVG met veel vectorpaden een stuk groter kan zijn; zie de tegel-based
  rendering hieronder) — gecontroleerd aan de hand van de daadwerkelijke bestandsinhoud (niet alleen
  de bestandsnaam), zodat een verkeerd bestandstype met een vervalste extensie geweigerd wordt
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
  geen native Grafana-type en loopt via een webhook terug naar de webapp, die 'm doorstuurt —
  Grafana authenticeert die aanroep met het gedeelde `INTERNAL_API_TOKEN` (`Authorization: Bearer`),
  zelfde patroon als de testmodus-simulator). Het
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
- **Meetfactor voor kasten met een "dubbel veld"** (zie specs/dubbel-veld-meetfactor-plan.md): een
  grote kast (bijv. 4000A) met 2 parallelle Powerlock-sets naar dezelfde afnemer maar ruimte voor
  maar 1 CT-klem/Shelly krijgt zo de juiste (totale) waarde in het dashboard. Klein, optioneel
  getal-veld naast Shelly-IP in de kasten-tabel (bijv. `2` om te verdubbelen) — een modelmatige
  benadering (gaat uit van gelijke stroomverdeling over beide paden), geen echte tweede meting.
  Werkt consistent op alle plekken: live-weergave én Grafana-grafieken/PDF-rapportages/de bestaande
  90%-overbelastingsalerts (een server-side MQTT-relay corrigeert de meting vóórdat die op de kast
  se officiële topic terechtkomt, i.p.v. alleen in de browser — zie de roadmap voor de technische
  achtergrond). Bij het (opnieuw) automatisch configureren van de Shelly (⚙️-knop) wordt de
  publicatie-topic vanzelf op de bijbehorende "ruwe" subtopic gezet, geen handmatige actie nodig
- **Kast rechtstreeks op een specifiek aggregaat binnen een groep** (zie
  specs/kast-op-aggregaat-plan.md): een kast kan nu ook aan één los lid van een groep gekoppeld
  worden i.p.v. alleen aan de groep als geheel — voor het geval een kast fysiek rechtstreeks op één
  specifiek aggregaat is aangesloten (bijv. een CEE-stekker), los van de gedeelde/loadsharende bus.
  Zichtbaar in Beheer's Generator-dropdown (leden staan ingesprongen onder hun groep) en in het
  Schema-tabblad (zo'n aggregaat krijgt dan een eigen knoop in de boom, met de kast eronder). Geen
  eigen pin op de plattegrond voor een los aggregaat — de groep blijft één fysieke locatie, de
  verbindingslijn van de kast valt terug op de groep se positie.
  **Optionele correctie erbij**: als de CT-klem-meting van dat aggregaat de rechtstreeks-aangetapte
  kast niet al meetelt (afhankelijk van waar de klem fysiek zit), kan bij die kast "Optellen bij
  generator/aggregaat" aangevinkt worden — telt de kast se eigen meting softwarematig bij de
  aggregaat-meting op, weer consistent op alle plekken (live én Grafana/rapportages/alerts) via
  dezelfde server-side relay-aanpak als de meetfactor hierboven. Bewust geen automatische aanname
  (hangt af van de fysieke klemplaatsing) — expliciete, standaard uitgevinkte keuze per kast
- **Shelly/kast vervangen** (zie specs/shelly-vervanging-plan.md): 🔁-knop per kast-, generator- en
  groepslid-rij (naast de bestaande ⚙️-configureerknop) opent een klein inline formuliertje (nieuw
  Shelly-IP + "ook het snelheidsscript installeren"-vinkje, zelfde default aan) dat in één actie het
  IP bijwerkt én meteen configureert — i.p.v. het veld handmatig overtypen en daarna apart de
  configureerknop zoeken. De logische kast/generator (naam, positie, rating, koppelingen, en dus ook
  de historische Grafieken-/Rapportages-data — `mqtt_topic_prefix` is gebaseerd op de kast-id, niet
  het fysieke apparaat) blijft ongewijzigd, alleen het IP wijzigt. Elke shelly_ip-wijziging die een
  al eerder ingevuld IP vervangt wordt automatisch gelogd (nieuw `vervangingen`-array-veld: tijdstip
  + oud/nieuw IP) — ongeacht of dat via de nieuwe knop of het gewone inline IP-veld gebeurde; de
  allereerste keer een IP invullen telt niet als vervanging. Een 🔁-indicatortje bij de Shelly-IP-
  kolom (alleen zichtbaar zodra er iets vervangen is) toont de volledige geschiedenis in een tooltip.
  Geen apart voorraadbeheer/reserve-apparaten-concept — puur het moment van vervangen zelf
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
  internet op locatie. De losse "Printen"-knop in de QR-overlay geeft een eigen, groot gecentreerd
  single-sticker-printvoorbeeld (geen 4-koloms-sheet-layout meer voor maar 1 item) — bruikbaar om
  direct uit te knippen of op een labelvel te plakken; "Alle QR-codes printen" blijft de
  4-koloms-bulk-sheet voor alle kasten tegelijk
- **MQTT-topic-prefix zichtbaar + kopieerbaar**: bij elke kast/generator/lid staat naast het
  Shelly-IP-veld een 📋-knop die de `mqtt_topic_prefix` rechtstreeks naar het klembord kopieert
  (blijft alleen-lezen, geen bewerkbaar veld) — scheelt de omweg via Live-modus of een export op
  het moment dat je in Beheer een Shelly aan het instellen bent
- **Shelly automatisch configureren**: bij elke kast/generator/lid met een ingevuld Shelly-IP staat
  een ⚙️-knop (+ aanvinkvakje "ook het snelheidsscript installeren", standaard aan) die in één
  actie MQTT aanzet, de broker en het juiste topic-prefix instelt, de Shelly herstart, en optioneel
  het snelheidsscript (`shelly/em-fast-publish.js`) installeert+start — rechtstreeks via de
  Shelly Gen2+ lokale RPC-API (`http://<shelly-ip>/rpc`), server-side vanuit de webapp-container.
  Een toastje toont live voortgang en het eindresultaat (MQTT- en scriptstatus apart gerapporteerd
  — een mislukt script blokkeert niet een geslaagde MQTT-configuratie). "Alle Shelly's
  configureren" (boven de generatorentabel) doet dit voor alle apparaten met een ingevuld IP-adres
  tegelijk (max. 2 tegelijk, met een resultaatoverzicht per apparaat, één trage/onbereikbare Shelly
  blokkeert de rest niet). Idempotent: nogmaals toepassen op een al-geconfigureerd apparaat is altijd
  veilig. Blijft een aanvulling op, geen vervanging van, de handmatige route in README §3 (fallback
  als automatisch een keer niet lukt — bijv. een offline apparaat of een eigen apparaatwachtwoord)
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
- **Grote plattegronden renderen als tegels** (specs/plattegrond-tile-based-plan.md): een
  geüploade PNG boven ~2000px lange zijde/~3 megapixel wordt server-side (sharp/libvips) in een
  Deep-Zoom-tegel-piramide geknipt — de browser laadt dan alleen de tegels die op het huidige
  zoomniveau daadwerkelijk binnen beeld vallen, i.p.v. één grote afbeelding in zijn geheel te
  decoderen. Kleinere PNG's en BMP blijven op het bestaande, platte weergavepad (BMP altijd,
  ongeacht grootte — sharp/libvips ondersteunt geen betrouwbare BMP-tegelgeneratie). Voor de
  gebruiker verandert er verder niets: zelfde upload-knop, dezelfde percentage-gebaseerde
  pin-plaatsing en fit-to-screen-zoom werken ongewijzigd door, of de plattegrond nu getiled is of
  niet
- **Ook een PDF-plattegrond uploaden**: server-side eerst gerasteriseerd naar PNG
  (`poppler-utils`/`pdftoppm`, alleen de eerste pagina) — de renderresolutie wordt berekend uit de
  PDF's eigen paginaformaat (`pdfinfo`), gecapt op ~5500px lange zijde, i.p.v. een vaste DPI blind
  toe te passen. Het resultaat volgt daarna hetzelfde tegel-/drempelpad als elke andere PNG-upload
- **SVG-plattegrond wordt altijd gerasteriseerd**: een geüploade SVG (vaak een PDF→SVG-conversie —
  doorgaans duizenden losse paden, hoge precisie, laag-/groep-cruft van de conversietool, en dus
  potentieel zwaar om in de browser te downloaden/parsen) wordt server-side met sharp/libvips naar
  PNG omgezet vóór opslag, i.p.v. als vector bewaard te blijven — zelfde ~5500px-lange-zijde-cap en
  daarna hetzelfde tegel-/drempelpad als een PDF-upload. Geen nieuwe systeem-dependency nodig (sharp
  ondersteunt SVG-rasterisatie out-of-the-box). Bestaande, al eerder geüploade SVG-plattegronden
  worden niet automatisch gemigreerd — pas bij een nieuwe upload wordt een SVG gerasteriseerd. De
  ~5500px-cap wordt sinds een bugfix afgedwongen met een expliciete resize-stap ná de rasterisatie
  (`begrensAfmeting()`) i.p.v. alleen via de dpi-berekening — een SVG die zijn eigen afmeting in
  letterlijke, grote pixel-aantallen declareert (bijv. een CAD/PDF→SVG-tool die millimeters 1-op-1
  als px-eenheden wegschrijft) omzeilde anders de cap volledig en leverde een plattegrond van
  tienduizenden pixels breed, zwaar genoeg om zowel laden als pannen/zoomen onwerkbaar traag te
  maken
- **Vaste witte ondergrond achter de plattegrond**: een upload met transparante delen (bijv. een uit
  PDF geconverteerde SVG) toonde voorheen het donkere dashboardthema erdoorheen, waardoor donkere
  lijnen onleesbaar werden. De plattegrond-surface (platte afbeelding én getilede tegels) heeft nu
  een vaste witte achtergrond, los van het dashboardthema — geen her-upload nodig voor bestaand
  materiaal. Het lege werkvlak zonder plattegrond (donker gestippeld grid) blijft ongewijzigd
- Generators en kasten als pins plaatsen en verslepen. Pins, hun naamlabels, de status-/anomaly-
  badges en lijn-knikpunten houden een constante, leesbare schermgrootte ongeacht de kaart-zoom
  (net als markers op een kaartprogramma) — bij ver uitzoomen (bijv. 25%) blijven ze dus goed
  zichtbaar i.p.v. onleesbaar klein mee te krimpen met de plattegrond. Verbindingslijnen worden bij
  uitzoomen juist geleidelijk dikker (i.p.v. alleen maar constant te blijven) zodat de kabelroute
  ook op een uitgezoomd overzicht duidelijk zichtbaar blijft
- Lijnen tussen kasten en hun voedingsbron, afgeleid uit de parent/child-koppeling. Standaard een
  rechte lijn, maar met knikpunten aan te passen aan de daadwerkelijke kabelroute (obstakels,
  paden, hoeken om een gebouw): dubbelklik op een lijnsegment voegt een knikpunt toe op die
  positie, slepen verplaatst het, dubbelklik op een knikpunt verwijdert het weer. Rechtsklik op een
  lijnsegment opent een mini-menu ("Knikpunt hier invoegen" / "Rechte lijn terugzetten", dat
  laatste wist in één keer alle knikpunten van die lijn) als alternatief voor dubbelklikken;
  rechtsklik op een bestaand knikpunt zelf opent een eigen mini-menu ("Dit knikpunt verwijderen" —
  alternatief voor dubbelklikken, wist alleen dat ene punt — / "Rechte lijn terugzetten", dezelfde
  drastischere alles-in-één-keer-optie). Alleen bewerkbaar op Kalibreren; op Live volgt de lijn
  dezelfde route, puur ter weergave, zonder handles
- In-/uitzoomen (knoppen, scrollwiel, of het percentage tussen de +/- -knoppen rechtstreeks
  intypen — Enter of wegklikken past het toe, Escape zet 'm terug) en pannen (klikken en slepen),
  met een "fit to screen"-knop die alles in één keer in beeld brengt (incl. eventuele knikpunten)
  — handig bij een grote topologie. Scrollwiel-zoomen op Kalibreren/Live gebeurt rond de
  muispositie (het punt onder de cursor blijft op zijn plek staan), niet vanuit de linkerbovenhoek
  van de plattegrond — de zoomknoppen zelf blijven ongewijzigd (geen zinvol cursorpunt bij een
  klik op een vaste hoekknop)
- **Plattegrond 90° draaien** (specs/live-viewport-grote-monitor-plan.md, fase 2, ⟳-knop in de
  kaart-toolbar op Kalibreren/Live — niet op Schema, dat is een auto-gelayoutte SVG-boom zonder
  plattegrond): draait de weergave stapsgewijs 0°→90°→180°→270°→0°, voor als de brondata een
  liggende tekening is maar het scherm rechtop hangt (of andersom). Geldt voor Kalibreren én Live
  tegelijk (één gedeelde stand, geen aparte rotatie per tabblad — het is dezelfde fysieke
  plattegrond op hetzelfde fysieke scherm). Pin-/kastlabels en knikpunten blijven altijd leesbaar
  rechtop staan, ongeacht de rotatiestand van de plattegrond zelf (tegengeroteerd). Werkt ook op
  een getilede plattegrond (specs/plattegrond-tile-based-plan.md) — welke tegels geladen worden,
  houdt rekening met de rotatie. Draaien past automatisch "fit to screen" toe zodat de gedraaide
  weergave weer volledig in beeld komt
- **Viewport-kalibratie** (specs/live-viewport-grote-monitor-plan.md, fase 3, "Viewport-kalibratie"-
  knop in de kaartbalk op Kalibreren): een sleepbaar/verkleinbaar kader over de plattegrond om vast
  te leggen welk deel Live straks toont — handig om bijv. bouwterreindetails buiten het eigenlijke
  werkgebied uit te sluiten. Aanvulling op, geen vervanging van, de bestaande pin-plaatsing/-
  slepen/lijnen-functionaliteit — beide werken los van elkaar op hetzelfde tabblad. "Toepassen op
  Live" slaat het kader server-side op (percentages, niet pixels — blijft dus kloppen bij een
  andere plattegrond of canvas-afmeting); "Reset naar volledige tekening" zet 'm terug. Eén vaste,
  actieve viewport tegelijk (geen meerdere opgeslagen presets), en geldt voor iedereen die Live
  bekijkt (server-side, geen per-browser voorkeur zoals zoom/rotatie). Live toont daarna alléén die
  regio: "fit to screen" past zich aan, en pannen/uitzoomen voorbij de viewport-rand is niet
  mogelijk — het uitgesloten deel is dus nooit zichtbaar, ook niet als je verder probeert uit te
  zoomen. Werkt met én zonder geüploade plattegrond (ook op het lege 4800×3000-canvas), en houdt
  rekening met een eventuele rotatiestand

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
  amber/rood/**offline** (geen rating ingesteld of nog geen MQTT-data ontvangen); in-/uitklapstatus
  per item wordt onthouden. Een **"↓ Prioriteit"-schakelaar** sorteert generatoren op hun ergste
  onderliggende status (rood eerst, dan amber, dan offline, normaal laatst) i.p.v. de vaste
  topologie-volgorde. Een nieuw toegevoegde kast klapt de hele generator-/parent-keten in deze
  zij-lijst automatisch open, ook als die daarvoor dichtgeklapt stond — meteen zichtbaar in
  Kalibreren/Live na het aanmaken, geen handmatig uitklappen nodig. Een generatorrij toont twee
  losse regels:
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
- **Alert-ticker-strip** (specs/live-viewport-grote-monitor-plan.md, alleen op Live, direct onder
  de header): vaste tellingen rood/amber/normaal/offline, plus een doorlopend wisselende tekst
  (elke ~3,2s) van de actieve amber/rood-kasten ("generator · kast — belasting%"); toont een vaste
  "geen actieve alerts"-tekst als er niets aan de hand is. Pure reindexering van de al binnenkomende
  MQTT-data, geen nieuwe databron
- **KPI-tegels** (zelfde plek, bovenaan de zij-lijst, alleen op Live): tot. belasting (gemiddeld
  belastingspercentage over kasten met rating+data), piek (nu) (hoogste belastingspercentage op dit
  moment — een écht "piek vandaag" zou een InfluxDB-query vereisen, bewust buiten scope gehouden),
  actieve alerts (aantal kasten amber+rood) en offline (aantal kasten zonder rating of zonder
  MQTT-data)
- **Trendlijn in de zij-detail** (alleen op Live): een kleine sparkline van de belasting over de
  laatste ~60 punten sinds het laden van de pagina, voor de geselecteerde kast/generator/lid — een
  eigen, kleine client-side rolling buffer (`live-spark.js`, los van grafieken.js' eigen 60-min-
  live-buffer), geen historische InfluxDB-data. Overleeft geen page-reload
- **Portrait-lay-out** (specs/live-viewport-grote-monitor-plan.md, fase 1e — geldt voor de
  gedeelde Kalibreren/Live/Schema-aside): op een smal/hoog scherm (`@media (orientation:
  portrait)`, de enige `@media`-breakpoint in `style.css` — een bewuste uitzondering op de
  vloeiende-schaling-aanpak, want dit is een structurele lay-out-ombouw, geen chrome-grootte)
  staat de plattegrond boven de zij-lijst i.p.v. ernaast. De zij-lijst krijgt dan een
  "Statuslijst"/"Detail"-tabbalk (lijst en detail passen niet allebei tegelijk op de resterende
  hoogte) — op Live wisselt het selecteren van een kast/generator automatisch naar de Detail-tab;
  in landscape blijft deze tabbalk verborgen en werkt de aside ongewijzigd (lijst + detail allebei
  altijd zichtbaar, zoals nu)
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
  metric (Stroom A / Spanning V / Vermogen W / Energie kWh), fase (A/B/C/Totaal/Alle fasen — bij
  Spanning+Totaal het gemiddelde van de drie fasen, er is geen fysiek `total_voltage`-veld), periode
  (hele evenement/laatste 24u/aangepast) en editie (één, of "alle edities")
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
- **Alle fasen** (gebouwd, zie specs/grafieken-alle-fasen-plan.md en
  specs/grafieken-alle-fasen-staaf-taart-plan.md): vijfde fase-optie, zichtbaar/bruikbaar bij
  Lijn/Staaf/Taart (niet bij Heatmap/Sankey — die hebben geen natuurlijke "3 fasen tegelijk"-vorm),
  om fase-onbalans te spotten (bijv. één fase structureel zwaarder belast) zonder handmatig drie
  keer van fase te wisselen. Gedraagt zich per grafiektype anders:
  - **Lijn**: drie losse lijnen (vaste kleur + "Fase A/B/C"-label) voor precies één geselecteerd
    item — bij meerdere items zouden dat N×3 overlappende lijnen worden, dus de checklist gedraagt
    zich tijdelijk als enkele-keuze-lijst (nieuw vinkje zet het vorige automatisch uit) zolang
    "Alle fasen" actief is.
  - **Staaf**: gegroepeerde balken (3 per item, A/B/C naast elkaar), meerdere items blijven
    toegestaan — dat is juist het punt van fasebalans per kast/generator vergelijken. Vaste
    fasekleur + legenda i.p.v. de normale groen/amber/rood-statuskleuring; sortering op de som van
    de (tot 3) fasewaarden. Een item met een ontbrekende fase (bijv. eenfase-aansluiting) toont
    gewoon 1-2 balken i.p.v. 3, geen kunstmatige 0.
  - **Taart**: aandeel van fase A/B/C **binnen** het ene geselecteerde item (i.p.v. aandeel per
    item) — zelfde enkele-keuze-checklist-gedrag als Lijn.
  - Terugschakelen naar A/B/C/Totaal maakt de checklist weer gewoon (multi-)select, de selectie
    zelf blijft intact. Werkt voor alle vier metrics en ook in live-modus (dezelfde rolling buffer/
    MQTT-verbinding, geen aparte databron). Server-side afgedwongen dat `/api/grafieken/tijdreeks`
    (Lijn) precies 1 id krijgt bij fase "alle" (400 anders); `/api/grafieken/aggregaat` (Staaf/
    Taart) staat hier wél meerdere ids toe — de enkele-keuze-beperking voor Taart is daar puur een
    frontend-renderkeuze, de server kent het onderscheid Staaf/Taart niet
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
zien") — alleen zinvol als HQ-instance, maar staat in elke instance beschikbaar. Toont alleen nog
het live statusoverzicht (kaarten); de locatielijst zelf (naam/URL toevoegen/verwijderen) beheer je
via Beheer > Locaties (zie Topologiebeheer hierboven) — beide subtabs delen dezelfde
ververLocaties()-verversfunctie, dus een wijziging in Beheer is meteen zichtbaar in dit overzicht:
- Statuskaart per bekende locatie: groen/amber/rood-stip, aantal kasten, aantal amber/rood, en een
  "Beheer openen"-link die de volledige app van die locatie opent (zelfde rechten als ter plekke,
  geen aparte uitgeklede weergave — vraagt om een eigen login op die andere instance, geen
  single-sign-on tussen instances). Een niet-bereikbare locatie toont een grijze "offline"-kaart
  i.p.v. de hele pagina te laten hangen
- Onder de motorkap: elke instance heeft een nieuw, publiek `/api/hq-status`-endpoint (geen login
  nodig, geeft alleen tellingen terug) dat deze pagina server-naar-server ophaalt per bekende
  locatie, met een timeout per locatie
