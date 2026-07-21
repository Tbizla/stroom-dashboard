`🚧 DEV-V2 🚧`

# Implementatieplan v2 (technische kant, Claude Code)

**Status:** Fase A (§1) is gebouwd en handmatig geverifieerd — `webapp/public/index.html` is
gesplitst in shell + `css/style.css` + 14 ES-modules onder `webapp/public/js/` (`state.js`, `api.js`,
`topology.js`, `zoom.js`, `render-list.js`, `render-detail.js`, `render-pins.js`, `kastpopup.js`,
`render-schema.js`, `render-beheer.js`, `rapport.js`, `mqtt.js`, `modes.js`, `main.js`), zonder
build-stap (`<script type="module" src="js/main.js">`). Gedeelde mutable state (TOPO, mode,
selectedId, ...) zit in één `state`-object in `state.js` i.p.v. losse module-`let`s, zodat elke
module dezelfde live waarden ziet zonder aparte setter-functies. Geverifieerd door de stack lokaal
te draaien (`docker compose --profile test up -d --build`) en met een headless-browserscript alle
vier weergavemodi + Testdata-tabblad te doorlopen: topologie-CRUD (Beheer), pins/kalibratie,
schema-boom, live MQTT-data + kastpopup-databallon — geen consolefouten, gedrag identiek aan vóór
de split. `server.js` is ongewijzigd (serveert de nieuwe bestanden al via de bestaande
`express.static`).

Fase B (§2, i18n) is ook gebouwd en geverifieerd: `webapp/i18n/nl.json`/`en.json` (172 platte
dot-keys, bijv. `beheer.thNaam`, `kastpopup.ratingSub`), `server.js` heeft één nieuwe route
(`GET /api/i18n/:taal`, `require()`'t dezelfde JSON-bestanden — klaar voor hergebruik door het
PDF-rapport in Fase E) en `webapp/public/js/i18n.js` (`t(key, vars)` met `{var}`-interpolatie,
`applyStaticI18n()` voor statische markup via `data-i18n`/`data-i18n-html`/`data-i18n-placeholder`/
`data-i18n-title`, taalkeuze onthouden in `localStorage`). Taalkeuze-toggle in de header
(`.langswitch`, zelfde visuele familie als `.modeswitch`, conform de i18n-PoC-mockup). Alle acht
concrete PoC-bevindingen zijn verwerkt: vaste `width:Npx` op tabelkoppen/-cellen in
`render-beheer.js` is `min-width:Npx` geworden, en domeintermen zijn bewust vertaald (niet
automatisch) — "kast" → "distribution box"/"box" (kort in dropdowns/tabelkoppen), "Beheer" →
"Manage", "Kalibreren" → "Calibrate", "Schema" → "Diagram", conform de reeds afgestemde
i18n-PoC-vertalingen.

**Implementatiekeuze (niet in het designplan vastgelegd, tijdens de bouw gekozen):** taalwissel
herlaadt de pagina (na het wegschrijven van de keuze in `localStorage`) i.p.v. elk render*()-pad
los opnieuw te vertalen zonder herlaad. Bij een build-loze vanilla-JS-opzet met zoveel
losse render-functies is dat aanzienlijk minder foutgevoelig dan overal handmatig een
retranslate-in-place-pad bouwen, en de server draait lokaal dus een herlaad is vrijwel instant.
Enige zichtbare gevolg: de huidige tabselectie/kastselectie gaat verloren bij het wisselen van
taal (zoom-/inklap-/taalstate zelf blijven via localStorage gewoon staan) — geen regressie op een
bestaand patroon, want dat gedrag bestond niet eerder.

Geverifieerd met hetzelfde soort headless-browserscript als Fase A: testtopologie geladen, NL→EN→NL
gewisseld, alle vier weergavemodi + Testdata-tabblad + het (nog in Beheer zittende) rapport-blok +
de MQTT-kastpopup gecontroleerd in beide talen, taalkeuze blijft staan na een paginaherlaad — geen
consolefouten.

Fase C (fasekleuren) is gebouwd en geverifieerd: nieuwe CSS-variabelen `--fase1`/`--fase2`/`--fase3`
(bruin/antraciet/grijs) en een `.faseswatch`-klasje (8×8px rond vlakje) in `css/style.css`, een
kleine gedeelde helper `js/fasekleuren.js` (`faseSwatch(index)`) gebruikt door zowel
`kastpopup.js` (tabelkop A/B/C) als `render-detail.js` (aside-detail Fase A/B/C-rijen) — geen
wijziging aan `statusOf()`/`statusClass()` in `topology.js`, puur presentatielaag zoals gepland.
Geverifieerd via browserscreenshot met live MQTT-data: kleurvlakjes verschijnen los naast de
bestaande groen/amber/rood-statuskleur, geen samensmelting van de twee conventies.

Fase D (hub-tab "Rapportages") is gebouwd en geverifieerd: vijfde knop in `.modeswitch`
(`#modeRapportages`) met een altijd-zichtbare subnav (Overzicht/PDF-rapport/Back-up,
`.subnav`-klasse). Het "Rapport exporteren"-blok is 1-op-1 verplaatst van Beheer naar de
PDF-rapport-subtab (zelfde ids, geen functionele wijziging aan `rapport.js`). Overzicht-subtab
(`js/overzicht.js`) hergebruikt drie bestaande subsystemen zoals in §11.3 bevestigd: live
metric-cards + staafdiagram per kast op basis van de bestaande `liveData`/`statusOf()` (geen nieuwe
databron), periode-kWh-totalen per generator via een nieuw endpoint `GET /api/overzicht/energie`
(hergebruikt `influxQuery()`, alleen `parent:null`-kasten meetellen — zelfde conventie als het
Grafana-generatorpaneel), en een compacte Sankey-achtige boomweergave op basis van
`listChildrenOf()`/`collectDescendantKasten()` uit `topology.js` (eerste kind + "+N kasten"-rij
i.p.v. een volledige boomkopie). Nieuwbouw: tijdrange-keuze (periode-chips, zelfde patroon als
PDF-rapport) en drill-down (klik op een generator-kaart filtert de staven/boom; klik op een staaf/
boomknoop springt naar de Live-tab met die kast geselecteerd + databallon open — hergebruikt
bestaande Live-machinery, geen nieuw detailscherm). Back-up-subtab (`js/backup.js` +
`/api/backup/genereer`/`/status`/`/download` in `server.js`) genereert een zip via de nieuwe
`archiver`-dependency: `topologie.json` (via `readTopo()`) en plattegrond/logo altijd, meetdata als
CSV-dump (via `influxQuery()`, Flux CSV-output rechtstreeks in de zip) optioneel met periode-keuze
— zelfde status/resultaat/foutkaart-patroon (`addform`/`dot busy/ok/err`) als de PDF-rapportflow,
eigen jobstatus (`backupJob`). Geverifieerd end-to-end in beide talen: cards/staven/boom met live
data, drill-down (kaart-filter én staaf-klik-naar-Live), PDF-rapport-flow op de nieuwe locatie, en
een echte back-up-zip gedownload en met `unzip -l`/inhoud gecontroleerd (topologie.json + een
meerdere-MB's-grote meetdata.csv met echte InfluxDB-Flux-CSV-inhoud).

Fase E (PDF-rapport herontwerp) is gebouwd en geverifieerd: nieuwe coverpagina
(`voegCoverPaginaToe`, logo indien PNG + titel + editie/periode/gegenereerd-op + inhoudsopgave die
aangevinkte onderdelen genummerd toont en niet-aangevinkte grijs met "(niet aangevinkt voor dit
rapport)"), een voettekststrook op elke niet-cover-pagina (`voegVoettekstToe`, wit blok + lijn +
logo + "Stroomdashboard · editie X" + paginanummer "N / totaal" — leest de eigen paginagrootte per
pagina uit omdat Grafana-paneelpagina's geen vast A4-formaat hebben) en een herstylede
alarmen-pagina (`voegAlarmenPaginaToe`, kop + amber icoonvlak + uitleg, vervangt de kale
`voegPlaceholderPaginaToe`-tekstregel voor dit specifieke onderdeel — die generieke functie blijft
alleen nog over voor de randgeval "geen onderdelen geselecteerd"). Licht/print-vriendelijk thema
(wit/lichtgrijs met het bestaande accent-teal), bevestigd door Mike. Taal: de client stuurt de
actieve UI-taal (`huidigeTaal` uit `i18n.js`) mee bij het genereren (`POST /api/rapport/genereer`
body-veld `taal`, default `nl` als afwezig/ongeldig) — dezelfde `nl.json`/`en.json`-bronnen als de
webapp-UI, geen apart vertaalbestand voor het rapport. Logo-embedding is beperkt tot PNG (pdf-lib
kan geen BMP/SVG direct embedden; bij een ander formaat wordt het logo overgeslagen, geen
conversie-dependency erbij voor dit randgeval). Geverifieerd door een editie/InfluxDB-token-vrij
pad te testen (alleen "Overschrijdingen & alarmen" aangevinkt, dus geen Grafana-aanroep nodig) en de
resulterende PDF met PyMuPDF naar PNG te renderen voor visuele controle, in beide talen en met/
zonder geüpload logo — cover + alarmenpagina + voettekst kloppen exact met de mockup. De
Grafana-paneelpagina's zelf (bestaande `haalPaneelPdfOp`/`copyPages`-code, ongewijzigd) konden niet
end-to-end getest worden omdat het `GRAFANA_REPORT_TOKEN` in dit verse test-Grafana-exemplaar niet
geldig was (service-account-token hoort na eerste Grafana-opstart handmatig aangemaakt te worden) —
de voettekst-overlay-code zelf is identiek voor elke pagina ongeacht herkomst en dus al gedekt door
de alarmenpagina-verificatie.

**Aanvulling op Fase E (na oplevering, op verzoek van Mike):** de rapporttaal volgt standaard de
UI-taal, maar is nu per generatie apart om te zetten via een schuifknop (`.toggleswitch`, nieuwe
CSS-component — bewust een schuifknop i.p.v. de pill-stijl van `.langswitch`, op expliciet verzoek)
in de PDF-rapport-subtab, naast de editie-select. `rapport.js` houdt een lokale `rapportTaal`-
variabele bij die start op `huidigeTaal` en bij het omzetten van de schuifknop bijwerkt; die waarde
gaat mee in het `taal`-veld van `POST /api/rapport/genereer` i.p.v. rechtstreeks `huidigeTaal`.
Geen serverwijziging nodig — `server.js` accepteerde dat veld al los van de sessie-taal. Geverifieerd:
UI in het Nederlands gehouden, schuifknop naar EN gezet, rapport gegenereerd en met PyMuPDF
gecontroleerd — de PDF-tekst is volledig Engels ("Recap report — power supply", "Overruns & alarms",
...) terwijl de rest van de interface (header, tabs) Nederlands bleef.

**Alle vijf fasen (A t/m E) uit dit implementatieplan zijn hiermee gebouwd en geverifieerd.** Nog
niet gecommit — ligt klaar voor review.

**Auteur:** Claude Code. **Basis:** `webapp/public/index.html` (1995 regels), `webapp/server.js`
(709 regels), alle mockups in `specs/mockups/`.

---

## 0. Volgorde en waarom

Fasen worden na elkaar gebouwd, niet parallel, om te voorkomen dat een latere fase op een verplaatst
stuk code uit een eerdere fase moet mikken:

1. **Bestandsstructuur** (§11.1) — eerst, want elke volgende fase raakt `index.html`; beginnen op de
   gesplitste structuur voorkomt dat i18n/fasekleuren/hub straks in een net-gemodulariseerd bestand
   opnieuw moeten landen. Zuivere refactor, geen gedragswijziging — kleinste risico om als eerste te
   verifiëren (alles moet er na deze stap nog precies hetzelfde uitzien en werken).
2. **i18n-laag** (§11.2, mockup-bevindingen fase 2) — raakt alle schermen, dus liever op de schone
   modulestructuur dan er nog een keer doorheen.
3. **Fasekleuren** (mockup fase 3) — klein en op zichzelf staand, kan na i18n zonder op iets anders
   te wachten.
4. **Hub-tab "Rapportages"** (mockup fase 4) — inclusief Overzicht-subtab, verplaatsing PDF-rapport,
   en het nieuwe Back-up-scherm + endpoint.
5. **PDF-rapport herontwerp** (roadmap-item 7, mockup fase 5) — losstaand van de frontend-fasen
   hierboven (raakt vrijwel alleen `server.js`), maar sequentieel laatst omdat dat ook zo in de
   afgestemde fasering staat en er geen afhankelijkheid vanuit eerdere fasen naartoe is.

Roadmap-items die bewust buiten deze golf blijven (Generator-EM-rework, single-use-vraagstuk) volgen
straks hun eigen spec — zie afsluiting.

---

## 1. Fase A — Bestandsstructuur (moduleren zonder build-stap)

**Wat:** `webapp/public/index.html` splitsen in losse bestanden, zonder gedragswijziging.

- `webapp/public/index.html` — blijft de shell: `<head>` met `<link rel="stylesheet">`,
  `<body>`-markup, en `<script type="module" src="js/main.js">` aan het eind.
- `webapp/public/css/style.css` — alle huidige `<style>`-inhoud, incl. CSS-variabelen
  (`--bg`/`--panel`/`--accent`/`--green`/`--amber`/`--red`/`--grey`/`--mono`/`--sans`).
- `webapp/public/js/` — huidige inline `<script>`-inhoud opgesplitst per verantwoordelijkheid, bijv.:
  - `state.js` — `TOPO`, `liveData`, `liveEnergyData`, mode-/sidebar-state
  - `api.js` — `apiCall()` en overige `fetch`-wrappers
  - `render-list.js`, `render-pins.js`, `render-schema.js`, `render-detail.js` — per weergavemodus
  - `mqtt.js` — de live MQTT-over-websocket-verbinding (rond huidige regel 1940-1970)
  - `rapport.js` — PDF-rapportflow (status pollen, genereren, downloaden)
  - `main.js` — bootstraps alles, event listeners, entrypoint
  - Exacte opsplitsing mag tijdens implementatie verschuiven; bovenstaande is een richting, geen
    contract.
- `webapp/server.js` blijft static files serveren zoals nu (`express.static`) — geen serverwijziging
  nodig, ES modules worden gewoon als aparte HTTP-requests opgehaald.

**Definition of done:** alle vier weergavemodi + Testdata-tabblad werken identiek aan vóór de split
(handmatig doorlopen: Beheer CRUD, Kalibreren pins/zoom, Schema-boom, Live MQTT-status, testtopologie
laden). Geen enkele zichtbare wijziging voor de gebruiker.

---

## 2. Fase B — i18n-laag

**Wat:** meertalige UI (roadmap "Meertalige UI"), volgens het in §11.2 afgesproken model.

- Nieuwe map, bijv. `webapp/i18n/` met `nl.json` en `en.json` — platte dot-keys
  (`beheer.generator.naam`, `kastpopup.fase.label`, ...).
- `webapp/public/js/i18n.js` — laadt de actieve taal (fetch naar `/api/i18n/<taal>` of rechtstreeks
  het JSON-bestand als static asset), een `t(key)`-helper, en een taalkeuze-toggle in de header naast
  de mode-switch-pill (zelfde visuele familie als `.modeswitch`, zie §5). Onthouden in
  `localStorage`, zelfde patroon als bestaande zoom-/sidebar-state.
- `server.js`: `require('../i18n/nl.json')`/`en.json` voor servergegenereerde teksten (PDF-rapport,
  zie Fase E) — dezelfde brontaalbestanden, geen aparte vertaalset.
- Concrete aanpassingen uit de i18n-PoC-bevindingen (`specs/mockups/i18n-beheer-poc-bevindingen.md`)
  meenemen tijdens de implementatie, niet achteraf patchen:
  - Filter-chips en tabelkolommen met vaste `width:70px`/`80px`-inline-styles krijgen een flexibelere
    min-breedte i.p.v. een vaste pixelbreedte.
  - "Verdeelkast" krijgt een kortere EN-tabelvariant ("Main board"); de volledige term ("Main
    distribution board") alleen in detailpaneel/tooltip.
- Domeintermen (kast, generator, groep, batterij, plattegrond, kalibreren) bewust vertalen, niet
  automatisch — zie de aandacht hiervoor in de roadmap.

**Definition of done:** NL/EN-toggle werkt op alle vier tabbladen + hub-tab (zodra die er is, zie
Fase D) en het PDF-rapport (zodra Fase E is afgerond — tot dan blijft het rapport NL-only, dat is
geen regressie want het is dat nu ook al).

---

## 3. Fase C — Fasekleuren (bruin/zwart/grijs)

**Wat:** roadmap "Fasekleuren NL-conventie", conform `specs/mockups/fasekleuren-mockup.html`.

- Nieuwe CSS-variabelen in `css/style.css`: `--fase1` (bruin), `--fase2` (antraciet, geen puur
  zwart), `--fase3` (grijs).
- Klein rond kleurvlakje (8×8px) vóór het fase-label, losstaand naast de bestaande
  groen/amber/rood-statusindicator — niet de rij zelf inkleuren. Raakt:
  - `metingenHtml()` (kastpopup + aside-detail, huidige regel ~851)
  - de kastpopup-tabelkoppen A/B/C
- Geen wijziging aan de statuskleur-logica zelf (`statusOf()`), puur presentatielaag.

**Definition of done:** fasekleur-labels zichtbaar in kastpopup en aside-detail, in beide talen (na
Fase B), zonder dat de groen/amber/rood-status conventie erdoor verandert.

---

## 4. Fase D — Hub-tab "Rapportages"

**Wat:** roadmap "Eén hoofddashboard" + "Backup-functie", conform de definitieve mockup-iteratie
(`specs/mockups/hub-backup-scherm.html`, na de S10/S11-koerswijziging: vijfde tab in `.modeswitch`,
geen dropdown).

### 4a. Navigatiestructuur
- Vijfde knop **"Rapportages"** in dezelfde `.modeswitch`-pill als Beheer/Kalibreren/Schema/Live,
  zelfde actieve-teal-stijl.
- Subnav-balk (altijd zichtbaar zodra deze tab actief is): **Overzicht / PDF-rapport / Back-up**.
- "Rapport exporteren"-blok verhuist uit de Beheer-tab naar de PDF-rapport-subtab (zuivere
  verplaatsing van bestaande markup/logica, geen functionele wijziging aan de rapportflow zelf).

### 4b. Overzicht-subtab (roadmap-item 6, optie B — herbouwen, technisch bevestigd in §11.3)
Hergebruikt drie bestaande subsystemen, geen nieuwe architectuur:
- **Metric-cards + staafdiagram per kast**: dezelfde client-side `liveData`/`liveEnergyData` die
  Live/Schema al vullen via de MQTT-websocket-verbinding — nieuwe render-functie
  (`renderOverzichtCards()`/`renderOverzichtBars()`), geen nieuwe databron.
- **Periode-kWh-totalen**: nieuw endpoint in `server.js` dat de bestaande `influxQuery()`-helper
  hergebruikt (zelfde Flux-patroon als `/api/rapport/periode`), bijv. `/api/overzicht/energie`.
- **Sankey-achtige boomweergave**: hergebruikt de renderlogica van de Schema-tab
  (`schemaChildrenOf()` en omliggende functies), in de compactere stijl uit de mockup.
- **Nieuwbouw** (geen bestaand patroon om te hergebruiken): tijdrange-keuze voor de Overzicht-subtab
  en de drill-down-interactie (klik op een kaart/staaf → detail) — relatief kleine losse
  UI-componenten, geen nieuwe databronnen.

### 4c. Back-up-subtab (roadmap "Backup-functie")
- Keuzescherm: topologie + plattegrond/logo altijd aangevinkt en uitgeschakeld ("altijd
  inbegrepen"), meetdata als losse aanvinkbare optie met dezelfde periode-chips als het
  PDF-rapport (§11.4).
- Status/resultaat/foutkaart hergebruikt 1-op-1 het bestaande `addform`/`dot busy/ok/err`-patroon
  van de PDF-rapportflow — geen nieuw interactiepatroon, wel een nieuwe jobstatus
  (`backupJob`, zelfde vorm als het bestaande `rapportJob`).
- **Nieuw endpoint** `/api/backup/genereer` (+ `/status`, `/download`) in `server.js`:
  - topologie-JSON: hergebruikt `readTopo()` (zelfde data als `/api/export`)
  - media: bestaande plattegrond-/logobestanden (`MAP_BASENAME`/`LOGO_BASENAME`)
  - meetdata (optioneel): CSV-export via `influxQuery()` over de gekozen periode
  - **Nieuwe dependency: `archiver`** (bevestigd door Mike). Er is nog geen zip-library in
    `webapp/package.json` (alleen `pdf-lib`, `multer`, `express`) — `archiver` wordt toegevoegd
    (lichtgewicht, streamt naar disk, geen native build-stap).

**Definition of done:** Rapportages-tab werkt met de drie subtabs; PDF-rapport-flow functioneel
identiek aan voorheen (alleen verplaatst); Overzicht toont live cards/bars/boom; Back-up genereert
een downloadbare zip met minimaal topologie+media, optioneel meetdata.

---

## 5. Fase E — PDF-rapport herontwerp (roadmap-item 7)

**Wat:** conform `specs/mockups/pdf-rapport-mockup.html` en
`specs/mockups/pdf-rapport-formatting-review.md`. Raakt vrijwel alleen `server.js`
(`voerRapportGeneratieUit` en omliggende helpers), geen structurele frontend-wijziging.

- **Coverpagina** (nieuwe pdf-lib-pagina vóór de bestaande paneelpagina's): logo (uit
  `LOGO_BASENAME`), eventnaam, titel, editie/periode/gegenereerd-op, en een inhoudsopgave die precies
  toont welke `onderdelen` zijn aangevinkt (incl. expliciet vermelden wat is overgeslagen).
- **Voettekststrook** op elke bestaande paneelpagina: na `copyPages()` een dunne overlay
  (`drawImage`/`drawText`) met logo-merkje, eventnaam/editie en paginanummer — de Grafana-render zelf
  blijft ongewijzigd.
- **Alarmen-pagina herstyled**: vervangt `voegPlaceholderPaginaToe()` door een nette kop + duidelijk
  vlak met icoon, met dezelfde voettekst als de paneelpagina's.
- **Licht/print-vriendelijk thema** (bevestigd door Mike): wit/lichtgrijs met het bestaande
  accent-teal als merkkleur, in plaats van het donkere webapp-thema — alleen voor dit PDF-artefact,
  geen wijziging aan `--bg`/`--panel` etc. in de webapp zelf.
- i18n (Fase B): rapporttitels/kop-labels via dezelfde `nl.json`/`en.json`-bronnen, taal meegeven
  bij het genereren (of altijd de taal van de editie-instelling — te bepalen tijdens implementatie,
  geen designbeslissing meer nodig).

**Definition of done:** een gegenereerd rapport heeft een coverpagina, voettekst+paginanummering op
elke pagina, een herstylede alarmenpagina, en oogt licht/print-vriendelijk — zonder dat de
onderliggende Grafana-paneel-PDF's zelf wijzigen.

---

## 6. Niet in deze golf

Generator-EM-rework en het single-use-vs.-edities-vraagstuk (roadmap-punten die hierboven al bewust
buiten scope zijn gehouden, zie `rebuild-plan-v2.md` §2/§7) volgen straks hun eigen aparte spec,
zoals de v2-roadmap-werkafspraak in `CLAUDE.md` vereist — niet meebouwen in Fase A–E hierboven.

---

## 7. Open technische aandachtspunten om te bevestigen vóór/tijdens de bouw

- **Fase D**: exacte opsplitsing tijdrange-keuze/drill-down-UI op de Overzicht-subtab is in de
  mockup niet tot in detail uitgewerkt (de mockup toont een statische snapshot) — tijdens de bouw
  zelf verder in te vullen, geen designblokkade.
- **Fase E**: of het PDF-rapport de taal van de gebruiker (die op dat moment de generatie start)
  volgt, of altijd een vaste taal gebruikt — kleine losse beslissing, geen impact op de rest van het
  plan.
