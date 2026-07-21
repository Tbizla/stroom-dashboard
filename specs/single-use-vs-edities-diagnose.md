`🚧 DEV-V2 🚧`

# Single-use container vs. edities vergelijken — diagnose (nog géén spec)

**Status: akkoord van Mike, klaar voor Claude Code.** Scope: restore-functie (volledige restore /
editie toevoegen aan archief, keuze vooraf), `topology_edges` + `evenement`-tag-uitbreiding voor
historische Sankey per editie, en `EVENT_NAME`/`EVENT_EDITION` bewerkbaar vanuit Beheer i.p.v.
alleen via `.env`. Openstaande technische fundamenten staan hieronder expliciet gemarkeerd.

Bij roadmap-item "Spanningsveld: single-use container per evenement vs. edities vergelijken" in
[event_dashboard.md](../event_dashboard.md). Het item zegt zelf expliciet nog geen concreet plan te
zijn ("nog goed over nadenken voordat hier een aanpak voor gekozen wordt") — dit is dus, net als bij
de Generator-EM-rework eerder, geen mockup maar een doordenking van de huidige architectuur, om de
kern van de spanning scherp te krijgen vóórdat er een richting gekozen wordt.

Dit onderwerp is bovendien overwegend een infra-/architectuurvraagstuk (Docker-volumes, InfluxDB),
niet een UI-vraagstuk — dus ik hou dit bewust op het niveau van "wat is de kern van de keuze en
welke richtingen zijn er", niet op het niveau van technische uitwerking. Die hoort, zodra de richting
duidelijk is, bij Claude Code.

## Wat er nu al staat

- **Docker-volumes zijn persistent per naam** (`docker-compose.yml`): `influxdb-data`, `grafana-data`,
  `webapp-data`, enz. blijven gewoon op schijf staan tussen `docker compose up`/`down` in — ze
  verdwijnen alleen bij een expliciete `docker compose down -v`, of als de stack op andere hardware
  (nieuwe schijf) opnieuw wordt opgezet.
- **Edities vergelijken bestaat al, zolang de InfluxDB-data blijft staan**: elke meting krijgt een
  `editie`-tag (`EVENT_EDITION` in `.env`, doorgezet door Telegraf), en Grafana heeft al een
  `$editie`-variabele om edities naast elkaar te zetten in dezelfde bucket (`stroomdata`) — zie
  README.md sectie 10. Dit werkt dus al **mits dezelfde InfluxDB-instance/volume blijft bestaan**
  tussen edities.
- **Topologie is altijd single-instance**: de webapp kent maar één actieve topologie tegelijk
  (`readTopo()`/`writeTopo()`), met `/api/export`/`/api/import` als enige manier om die tussen
  instanties over te zetten.
- **De net gebouwde Back-up-functie** (Generator-EM-rework-buurman, Rapportages-tab) bundelt
  topologie + media + optioneel een InfluxDB-CSV-dump in één zip — maar dat is **alleen een export**.
  Er is nu geen tegenhanger die zo'n meetdata-CSV weer **terug** een InfluxDB-instance in importeert
  — `/api/import` accepteert alleen de topologie-JSON, geen meetdata.

## Waar de spanning daadwerkelijk in zit

De twee wensen ("single-use container" en "edities vergelijken") staan alleen op gespannen voet als
"single-use" betekent dat ook de **data zelf** verdwijnt tussen evenementen (nieuwe hardware, of
bewust een schone lei per editie). Als "single-use" alleen slaat op de **applicatiecontainers**
(webapp/simulator/Grafana herstarten, topologie resetten) terwijl dezelfde InfluxDB-volume op
dezelfde machine blijft staan, dan is er eigenlijk al geen probleem — dat werkt nu al via de
`$editie`-variabele.

De kernvraag is dus niet "hoe combineren we deze twee features", maar: **wat betekent "single-use"
operationeel voor jou?** Drie mogelijke situaties, met heel andere consequenties:

1. **Zelfde machine/locatie, elke editie een schone applicatie-herstart.** Geen probleem — het
   bestaande `$editie`-mechanisme volstaat al. Hooguit een operationele afspraak nodig ("nooit `-v`
   gebruiken tussen edities"), geen nieuwe bouw.
2. **Andere machine/schijf per evenement (bijv. gehuurde hardware ter plekke), data moet toch
   vergeleken kunnen worden.** Dan is er een apart, langer levend "archief" nodig: elke single-use
   instance back-upt zijn meetdata vóór afbreken (bestaat al, zie hierboven), en die back-ups moeten
   ergens **samenkomen** — hetzij in een centrale archief-InfluxDB die nooit wordt afgebroken, hetzij
   door bij het maken van een vergelijkend rapport meerdere back-ups tijdelijk in één instance te
   importeren. Dit vereist de ontbrekende "meetdata-restore"-kant van import — die is er nu niet.
3. **Bewust een schone lei per editie, vergelijken is een apart/incidenteel proces** (niet
   continu beschikbaar, maar wel af en toe gewenst — bijv. eind van het seizoen alle edities samen
   in één rapport). Vergelijkbaar met optie 2, maar dan hoeft er geen permanent archief te draaien;
   een tijdelijke "vergelijk-instance" waar je meerdere back-ups in importeert voor de duur van dat
   ene rapport kan dan volstaan.

## Wat dit (nog niet) betekent voor de webapp-UI

Bij optie 1: geen enkele wijziging nodig. Bij optie 2/3: de ontbrekende schakel is een
**meetdata-restore** (tegenhanger van de Back-up-CSV-export, nu alleen `/api/import` voor topologie)
— dat is in de kern een Code/infra-vraagstuk (hoort dat via `/api/import` uitgebreid te worden, of
via een apart "Archief"-concept in de Rapportages-tab, met een eigen scherm om meerdere back-ups te
selecteren/samenvoegen?). Ik ga daar nu geen mockup van maken zolang niet duidelijk is of dit
scenario 2 of 3 überhaupt aan de orde is — dat zou koffiedik kijken zijn.

## Antwoord van Mike — de praktijksituatie is een mix

- **Jaarlijkse eenmalige evenementen**: reëel risico op andere hardware elk jaar (scenario 2/3).
- **Locaties van 3+ maanden**: grotendeels scenario 1 (zelfde hardware een lange periode), maar met
  een extra wrinkle — het komt voor dat hardware en/of plattegrond **1-2 keer tijdens die periode**
  wisselt. Dat is een vierde situatie die de eerdere drie niet dekten: geen jaarwisseling, maar een
  **migratie halverwege een lopende editie**, waarbij de data gewoon door moet lopen als
  "dezelfde editie", niet als een nieuwe.

**Conclusie: ongeacht welk scenario, de ontbrekende schakel is dezelfde** — een manier om
meetdata (en topologie/media) weer **terug** een InfluxDB-instance in te krijgen, tegenhanger van de
bestaande Back-up-export. Zowel de jaarlijkse-archivering-behoefte als de mid-editie-hardwaremigratie
lossen op met die ene restore-functie; het verschil zit 'm in **hoe** die data terugkomt:

- **Migratie (3+ maanden-locatie, hardwarewissel halverwege)**: een verse instance krijgt de back-up
  volledig terug, inclusief dezelfde `editie`-tag — geen nieuwe editie, gewoon een voortzetting.
  Eenvoudig: fris begonnen instance, niets om mee te conflicteren.
- **Archivering (jaarlijkse evenementen)**: de back-ups van meerdere jaren moeten **naast elkaar**
  in dezelfde InfluxDB komen te staan (elk met hun eigen `editie`-tag) om ze te kunnen vergelijken —
  dus een import die **toevoegt**, niet overschrijft.

Beide gebruiken dezelfde onderliggende restore-functionaliteit; het verschil is alleen of de
doelinstance leeg is (migratie) of al andere edities bevat (archivering) — geen aparte
implementatie nodig, wel iets om in de UI-copy/flow rekening mee te houden (bijv. een waarschuwing
als je een editie zou importeren die al bestaat in de doelinstance).

## Besluit: keuze vooraf, twee modi

Mike kiest voor een expliciete keuze vooraf tussen de twee modi, geen automatische detectie. Zie
[mockups/backup-herstellen-mockup.html](mockups/backup-herstellen-mockup.html) — nieuwe sectie
"Back-up herstellen" onder de bestaande "Back-up maken"-sectie in dezelfde Back-up-subtab:

- **Volledige restore**: alle drie onderdelen (topologie/media/meetdata) aanvinkbaar zoals bij het
  maken van een back-up, bedoeld voor een verse/lege instance na een hardwarewissel — geen nieuwe
  editie, een voortzetting.
- **Editie toevoegen aan archief**: topologie/media-checkboxes zijn niet van toepassing (uitgeschakeld
  getoond, niet verborgen — zodat duidelijk is dát ze bewust zijn uitgesloten); alleen meetdata wordt
  toegevoegd als nieuwe editie. Bij een naamsbotsing met een al bestaande `editie`-tag in de
  doelinstance wordt het herstel geblokkeerd (niet stil overschreven/vermengd) — zie mockup, tweede
  variant met de waarschuwingsbox.

## Technisch fundament — open punt voor Claude Code

Naamsbotsing-detectie kan hergebruiken wat er al is: `/api/rapport/edities` haalt via
`schema.tagValues(bucket: ..., tag: "editie")` de bestaande editie-waarden op — dezelfde helper kan
vóór een "editie toevoegen"-herstel checken of de editie uit de back-up al bestaat in de
doelinstance. Voor Code te bevestigen: waar de daadwerkelijke meetdata-restore (CSV/line-protocol
terug de bucket in) technisch het beste landt — een uitbreiding van `/api/import`, of een nieuw
`/api/backup/herstel`-endpoint naast de bestaande backup-endpoints. Verder geen nieuwe architectuur:
dit is dezelfde soort bestandsverwerking als de bestaande export/import- en backup-flows.

## Uitbreiding (bevestigd door Mike): historische Sankey/drilldown per editie bewaren

Losstaand gevonden bij het beantwoorden van Mikes vraag of "een schone instance opstarten puur om
meerdere datasets te vergelijken" ook de Sankey/generator-drilldown meeneemt: dat werkt nu **niet**,
ook niet in de gewone (niet-single-use) situatie. `topology_edges` (`server.js`,
`syncTopologyToInflux()`) heeft geen `editie`-tag en wordt bij élke wijziging in Beheer volledig
gewist en herschreven — het weerspiegelt dus altijd alleen de nú actieve topologie, nooit een
historische snapshot per editie. De Sankey van een oude editie leeft nu alleen voort als afbeelding
in het destijds gegenereerde PDF-rapport.

Mike wil dit meenemen als feature, niet alleen als kanttekening. Dat vergt drie samenhangende
wijzigingen (technisch fundament voor Code, geen designbeslissing):

1. **`topology_edges` krijgt een `editie`-tag.** `syncTopologyToInflux()` wist en herschrijft dan
   alleen de rijen van de huidige editie (predicate uitbreiden met `editie="<huidige>"`) i.p.v. de
   hele measurement — zo blijven oudere edities' edges los bewaard i.p.v. overschreven.
2. **Grafana's Sankey-paneel filtert/joint mee op `$editie`.** De bestaande Flux-`join()` tussen de
   vermogensdata en `topology_edges` (zie README.md sectie 5/event_dashboard.md) moet de editie
   erbij betrekken, anders lopen edges van verschillende edities door elkaar zodra er meerdere in
   dezelfde bucket staan.
3. **Back-up/herstel neemt `topology_edges` mee als onderdeel van "meetdata".** Nu expliciet
   uitgesloten (`voerBackupGeneratieUit()` filtert alleen op `shelly_em`/`shelly_emdata`) — voor
   "editie toevoegen aan archief" (zie hierboven) moet de export/import ook een `topology_edges`-
   snapshot van de betreffende editie/periode bevatten, additief geschreven (niet de bestaande
   measurement wissend, zoals de live-Beheer-sync dat wél doet).

Geen nieuwe UI nodig t.o.v. de mockup hierboven — de bestaande "Meetdata"-optie in het
herstelscherm dekt dit gewoon mee; alleen de beschrijvende tekst ("Historische stroom-/spanningsdata
+ topologiestructuur, editie: ...") hoeft aangepast om dit te reflecteren.

## Verdere uitbreiding (bevestigd door Mike): evenementnaam als eigen tag, naast editie

Reden: `editie` alleen (bijv. "2026") disambigueert prima tússen jaargangen van hetzelfde
evenement, maar **niet** tussen verschillende evenementen die toevallig dezelfde editie-waarde
gebruiken (bijv. "Zomerfestival 2026" én "Kermis 2026"). Zonder een aparte evenementnaam-tag zou het
importeren van alles in één master-database die twee kunnen laten botsen/vermengen. Er bestaat op
dit moment nog geen "evenementnaam"-concept in de data (`EVENT_EDITION` is de enige tag; een
evenementnaam is nu alleen impliciet aanwezig als logo-upload, nergens als tekst/tag opgeslagen).

Wijzigingen (technisch fundament voor Code, vervolg op de punten hierboven):

- **Nieuwe `EVENT_NAME`-omgevingsvariabele** (`.env.example`, naast het bestaande `EVENT_EDITION`),
  doorgegeven aan Telegraf net als nu al met de editie gebeurt.
- **Telegraf `[global_tags]` krijgt een tweede tag**: `evenement = "$EVENT_NAME"` naast de bestaande
  `editie = "$EVENT_EDITION"` — geldt dan automatisch voor `shelly_em`/`shelly_emdata`.
- **`topology_edges` krijgt ook de `evenement`-tag** (naast de `editie`-tag uit punt 1 hierboven) —
  zelfde scoped-delete-redenering, nu op de combinatie van beide.
- **Naamsbotsing-check bij "editie toevoegen aan archief" wordt op het párgetoetst**, niet op
  `editie` alleen: dezelfde editie-waarde van een ánder evenement is geen botsing, dezelfde editie
  van hétzelfde evenement wél. De bestaande `/api/rapport/edities`-achtige opzet (schema.tagValues)
  moet dan op beide tags tegelijk kijken.
- **Grafana krijgt een `$evenement`-variabele** naast `$editie`, zodat je in een master-database ook
  op evenement kunt filteren/vergelijken, niet alleen op jaargang.

## Besluit (Mike): naam én editie worden bewerkbaar vanuit Beheer, niet alleen via `.env`

Mike wil `EVENT_NAME` en `EVENT_EDITION` beide kunnen aanpassen vanuit de Beheer-pagina — net als
het logo en de topologie nu al bewerkbaar zijn via de UI, i.p.v. alleen bij het opstarten via
`.env` in te stellen. Dit lost meteen ook zijn tweede punt op: **een master/archief-instance is dan
gewoon een normale instance waar je zelf een eigen naam aan geeft** (bijv. "Archief — alle
evenementen") — geen apart "masterdatabase-naam"-veld nodig, hetzelfde `EVENT_NAME`-veld dekt dat.

**Technisch aandachtspunt voor Code (belangrijker dan een simpel formulierveld):** `EVENT_EDITION`
wordt momenteel door Telegraf zelf als `global_tags` toegepast, ingelezen bij het *opstarten* van de
Telegraf-container vanuit `.env` — een extern proces met een vast configbestand, niet iets wat de
webapp runtime kan aanpassen. Zodra `EVENT_NAME`/`EVENT_EDITION` vanuit Beheer wijzigbaar worden,
moet er dus ook worden opgelost **hoe** die wijziging bij Telegraf terechtkomt: bijv. de webapp
herschrijft `telegraf.conf` en triggert een herstart/reload van die container, of de tagging
verhuist van Telegraf naar de webapp zelf (die dan zelf de tag aan de doorgestuurde meting toevoegt
vóór/bij het schrijven naar InfluxDB). Dat is een reëel architectuurbesluit, geen designdetail — ik
laat 'm expliciet aan Code, met de kanttekening dat een wijziging halverwege een editie ook betekent
dat metingen van vóór die wijziging nog de oude naam/editie-tag dragen (geen retroactieve
hertagging, tenzij Code daar apart voor kiest).

## Vervolg

Dit is klein genoeg voor één spec, geen aparte fasering. Zodra Code het technische fundament
hierboven (inclusief de topology_edges-uitbreiding) heeft bevestigd, kan dit gebouwd worden.

## Status: Deel A gebouwd en geverifieerd, Deel B nog open

Code heeft het plan (`C:\Users\m_kuy\.claude\plans\fizzy-yawning-tome.md`) in twee delen gesplitst
en met Mike afgestemd: Deel A (de kern van deze diagnose — restore, tagging, Grafana) zonder nieuwe
rechten, en Deel B (`EVENT_NAME`/`EVENT_EDITION` bewerkbaar vanuit Beheer, incl. een
Telegraf-herstart-mechanisme) apart omdat dat wél nieuwe Docker-toegang vergt. Mike koos voor "een
herstart vanuit de UI" i.p.v. Telegraf vervangen of een handmatige `.env`-bewerking — Deel B's
concrete aanpak (docker-socket-proxy, scoped tot alleen container-acties) staat in het plan-bestand
en wordt in een vervolgsessie gebouwd.

**Deel A — gebouwd, geverifieerd via `docker compose --profile test` + Playwright + directe
InfluxDB-queries:**
- `topology_edges` krijgt `editie`+`evenement`-tags; de sync-delete is gescoped tot de huidige
  editie/evenement i.p.v. de hele measurement (`syncTopologyToInflux()` in `server.js`).
- Nieuwe `instellingen.json` (`event_name`/`event_edition`) + `GET`/`PUT /api/instellingen` — de
  enige bron van waarheid aan de webapp-kant, gebruikt door zowel de topology_edges-tagging als de
  restore-collision-check.
- Back-up-export neemt nu ook een `topology_edges`-snapshot mee en genereert `meetdata.lp`
  (InfluxDB line-protocol) naast de bestaande `meetdata.csv`, via een dynamische
  tag-kolom-detectie (`schema.tagKeys()`) i.p.v. een hardcoded lijst — nodig gebleken tijdens het
  testen, want Telegraf's `mqtt_consumer`-input zet zelf ook `host`/`topic`-tags die niet in de
  oorspronkelijke aanname zaten.
- Nieuw restore-endpoint `POST /api/backup/herstel` (`adm-zip`), twee modi (`volledig` /
  `editie_toevoegen`), met een geblokkeerde naamsbotsing-check op de editie+evenement-combinatie.
  End-to-end geverifieerd: back-up maken → topologie/InfluxDB volledig leegmaken → herstellen →
  topologie en alle meetdata (incl. `topology_edges`) kwamen correct terug; een tweede
  "editie toevoegen"-poging met dezelfde back-up werd correct geblokkeerd.
- Grafana: nieuwe `$evenement`-variabele, alle `topology_edges`-subqueries (Sankey,
  generator-totalenpaneel, de `generator`/`kast`-variabelen zelf) filteren nu mee op
  `editie`+`evenement`.
- `EVENT_NAME` nieuwe omgevingsvariabele (`.env.example`, `docker-compose.yml`,
  `telegraf.conf` `[global_tags]`) — dit specifieke stukje was oorspronkelijk in Deel B gepland,
  maar is statisch (zelfde mechanisme als het bestaande `EVENT_EDITION`, geen Telegraf-herstart
  nodig) en dus naar Deel A verplaatst zodat nieuw binnenkomende meetdata vanaf nu al consistent
  getagd wordt.
- Frontend: nieuwe "Back-up herstellen"-sectie in de Back-up-subtab, exact volgens
  `mockups/backup-herstellen-mockup.html`.

Nog niet gecommit op moment van schrijven — volgt na Mikes review.
