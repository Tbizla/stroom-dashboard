`🚧 DEV-V2 🚧`

# Rebuild-plan Event Stroomdashboard — v2 (designkant)

**Old-Status [S1]:** afgestemd met Mike (§10 beantwoord) — scope en fasering zijn akkoord. Volgende
stap: Claude Code neemt dit plan op, te beginnen met de vier open technische fundamentvragen in §3.
**Old-Status [S2]:** drie van de vier technische fundamentvragen in §3 zijn beantwoord door Claude
Code (zie §11) — bestandsstructuur, i18n-model, backup-formaat. De hub-dashboard-vraag (§3.3) gaat
terug naar Cowork: eerst mockups uitdenken (iframe-embed vs. herbouwen) vóór die technische keuze
wordt gemaakt.
**Old-Status [S3]:** Cowork heeft twee mockups + een vergelijking opgeleverd voor §3.3, zie
[mockups/hub-optie-a-iframe-embed.html](mockups/hub-optie-a-iframe-embed.html),
[mockups/hub-optie-b-herbouwd.html](mockups/hub-optie-b-herbouwd.html) en
[mockups/hub-dashboard-vergelijking.md](mockups/hub-dashboard-vergelijking.md). Voorlopige
designvoorkeur: optie B (herbouwen), maar het technische besluit ligt bij Claude Code — zie de
afweging in de vergelijkingsnotitie.
**Old-Status [S4]:** Mike bevestigt de voorkeur voor **optie B (herbouwen als native component)**
voor het hub-dashboard (roadmap-item 6 / §3.3). Dit is nu de gedragen designrichting vanuit Cowork;
de technische haalbaarheids-/onderhoudsafweging (zie kanttekeningen in
[mockups/hub-dashboard-vergelijking.md](mockups/hub-dashboard-vergelijking.md)) ligt bij Claude Code
om te bevestigen of alsnog bij te sturen. §3.3 is voor de designkant afgerond. Bal ligt bij Claude
Code.
**Old-Status [S5]:** Claude Code bevestigt optie B (herbouwen) als **technisch haalbaar met
gemiddelde bouwinspanning** — zie toelichting in §11.3. Nog niet gestart met bouwen; dit is alleen
de technische bevestiging, in afwachting van akkoord om verder te gaan met de fasering (§8).
**Old-Status [S6]:** Mike geeft akkoord om door te gaan met de fasering (§8). Alle vier de
fundamentvragen uit §3 zijn nu afgerond (moduleren, i18n-model, hub-dashboard optie B, backup-
formaat). Cowork pakt fase 2 van §8 op: de i18n-proof-of-concept mockup op de Beheer-tab.
**Old-Status [S7]:** Fase 2 (i18n proof-of-concept, Beheer-tab) opgeleverd — zie
[mockups/i18n-beheer-poc.html](mockups/i18n-beheer-poc.html) (interactieve NL/EN-toggle) en
[mockups/i18n-beheer-poc-bevindingen.md](mockups/i18n-beheer-poc-bevindingen.md). Geen showstopper;
belangrijkste concrete aanpassing voor Code: filter-chips en smalle tabelkolommen (nu vaste
pixelbreedtes in `webapp/public/index.html`) hebben een flexibelere min-breedte nodig, en
"Verdeelkast" heeft in tabelcellen een kortere EN-variant nodig dan de volledige vertaling. Mike
gaat akkoord met deze mockup.
**Old-Status [S8]:** Fase 3 (§8) opgeleverd: fasekleuren-mockup — zie
[mockups/fasekleuren-mockup.html](mockups/fasekleuren-mockup.html). Toont het voorstel uit §5 in de
kastpopup (tabelkoppen A/B/C) en de aside-detail (Fase A/B/C-rijen): een klein rond kleurvlakje
(bruin/zwart-antraciet/grijs) vóór het fase-label, losstaand van de bestaande groen/amber/rood-
statuskleur (dot/badge/balk) — de twee systemen smelten niet samen, zoals de roadmap vereist. Nieuwe
CSS-variabelen `--fase1`/`--fase2`/`--fase3`. Akkoord van Mike.
**Old-Status [S9]:** Fase 4 (§8) opgeleverd: hub-ingang + Backup-scherm mockup — zie
[mockups/hub-backup-scherm.html](mockups/hub-backup-scherm.html). Toont de hub-ingang als dropdown-
menu (Overzicht/PDF-rapport/Back-up) en het nieuwe Back-up-scherm: topologie en plattegrond/logo
altijd aangevinkt en uitgeschakeld ("altijd inbegrepen"), meetdata als losse optie met dezelfde
periode-chips als het bestaande PDF-rapport, en het status/resultaat/foutkaart-patroon 1-op-1
hergebruikt van de PDF-rapport-flow (`addform` + `dot busy/ok/err`) — geen nieuw interactiepatroon.
**Old-Status [S10]:** Mike geeft terecht feedback dat de dropdown/popup-hubmenu uit de toon valt —
de rest van de app kent geen verborgen/hover-menu's, alles staat altijd zichtbaar (pills, tabs,
chips). Mockup aangepast: de hub-ingang is nu een statisch label in de header, met een altijd-
zichtbare subnav-balk eronder (Overzicht/PDF-rapport/Back-up).
**Old-Status [S11]:** Ook het statische label naast de mode-switch bleek nog niet goed — Mike wil de
hub-ingang gewoon als vijfde knop ín dezelfde mode-switch-pill, naast Live, in exact dezelfde stijl.
Mockup aangepast: `.modeswitch` bevat nu Beheer/Kalibreren/Schema/Live/**Rapportages**, inclusief de
bestaande accent-teal `active`-stijl; de subnav-balk (Overzicht/PDF-rapport/Back-up) staat er nog
steeds onder zodra die tab actief is. §4 is bijgewerkt: de eerdere "geen vijfde tab"-aanname is
losgelaten. Mike geeft akkoord op deze versie.
**Old-Status [S12]:** Fase 4 (§8) hiermee volledig afgerond en akkoord. Cowork start fase 5: het
PDF-rapport-formatting-review als apart deelproject (§6/roadmap-item 7) — eerst de huidige
PDF-opbouw doornemen en mockups met logo-plaatsing maken, vóór Code de logo-implementatie bouwt.
**Old-Status [S13]:** Fase 5 opgeleverd — zie [mockups/pdf-rapport-mockup.html](mockups/pdf-rapport-mockup.html)
en [mockups/pdf-rapport-formatting-review.md](mockups/pdf-rapport-formatting-review.md). Bevinding:
het huidige rapport heeft helemaal geen bestaand format (geen cover, geen voettekst, geen
paginanummering — puur aaneengeschakelde Grafana-paneelpagina's + één kale placeholder-regel voor
alarmen). Voorstel: nieuwe coverpagina (logo, editie/periode, inhoudsopgave van aangevinkte
onderdelen), een dunne voettekststrook over elke paneelpagina (logo/eventnaam/paginanummer via
pdf-lib-overlay, paneel zelf ongewijzigd), en een herstyled alarmen-pagina. Open vraag aan Mike:
licht/print-vriendelijk thema voor het rapport (i.p.v. het donkere webapp-thema doortrekken) — nog
te bevestigen.
**Old-Status [S14]:** Mike bevestigt akkoord met het lichte/print-vriendelijke thema. Fase 5 is
hiermee volledig afgerond. **Daarmee zijn alle fasen 2 t/m 5 uit §8 opgeleverd en akkoord**: i18n-
proof-of-concept, fasekleuren, hub-navigatie (incl. twee ontwerp-iteraties op feedback) +
Backup-scherm, en PDF-rapport-formatting-review. Fase 6 (overige roadmap-items: Generator-EM-rework,
single-use-vraagstuk) is zoals afgesproken in §2/§8 **bewust niet onderdeel van deze rebuild-golf**
— die krijgen later hun eigen aparte spec. Dit designplan gaat nu in zijn geheel terug naar Claude
Code voor implementatie van alles wat hierboven is afgestemd (§11 fundamentvragen + alle mockups in
`specs/mockups/`).
**Status [S15]:** Claude Code heeft het technisch implementatieplan uitgewerkt — zie
[rebuild-plan-v2-implementatie.md](rebuild-plan-v2-implementatie.md): bouwvolgorde (bestandsstructuur
→ i18n → fasekleuren → hub-tab/back-up → PDF-herontwerp), concrete bestanden/endpoints per fase, en
één nieuwe dependency (`archiver`, voor de back-up-zip). Nog niet gestart met bouwen. Vervolgens gaat
Mike met Cowork verder om roadmap-fase 6 (Generator-EM-rework, single-use-vraagstuk) uit te werken —
dat krijgt een eigen spec, los van dit document.
**Auteur:** Cowork (design). Technische paragrafen zijn voorstellen, geen besluiten — die liggen
bij afstemming met Claude Code, zoals de werkafspraak in `CLAUDE.md` voorschrijft.
**Basis:** huidige `webapp/public/index.html` (1995 regels, één bestand, geen framework/build-stap),
`webapp/server.js` (709 regels, ~25 REST-endpoints), roadmap in `event_dashboard.md`.

---

## 1. Aanleiding & doel

De v2-roadmap bevat tien punten van wisselend gewicht (van een kleine kleurconventie tot een
fundamentele vraag over single-use vs. edities-vergelijken). In plaats van ze één voor één als
losse patches op het bestaande 2000-regelsbestand te stapelen, is de vraag: bouw de webapp in één
keer opnieuw op, zó dat alle tien punten er logisch in passen — i.p.v. steeds opnieuw rond
bestaande structuur heen te moeten ontwerpen.

Dit document is die "uitgebreide spec" die `CLAUDE.md` verplicht stelt vóórdat er gebouwd wordt.
Het is een designplan (informatiearchitectuur, schermen, componenten, taal/kleursystemen) — geen
technisch implementatieplan. Waar een designkeuze een technisch fundament raakt (bijv. blijft het
één HTML-bestand?), is dat expliciet gemarkeerd als **af te stemmen met Claude Code**, niet als
besluit van dit document.

## 2. Scope

**In scope voor dit rebuild-traject:**
- `webapp/public/index.html` (UI/UX, alle vier de weergavemodi + testtabblad)
- De schermen/flows die nieuw bijkomen door de roadmap (taalkeuze, backup-scherm, evt. hub-start)
- Visuele kant van het PDF-rapport (logo, opmaak)

**Buiten scope (blijft ongewijzigd, of is een Code-only aangelegenheid zonder designimpact):**
- InfluxDB/Telegraf/Mosquitto/Grafana-configuratie zelf
- MQTT-topic-prefix-migratie (`fest` → `event`) — puur backend/config, geen zichtbare UI-wijziging
- Simulator-logica
- Databronnen/architectuurkeuzes (blijven zoals ze zijn tenzij hieronder als open vraag genoemd)

**Wat sowieso blijft, ongeacht rebuild:**
- Percentage-based plaatsing (`x_pct`/`y_pct`) op plattegrond of 4800×3000 leeg canvas
- De vier bestaande weergavemodi (Beheer/Kalibreren/Schema/Live) als concept ongewijzigd, inclusief
  hun content-aware fit-to-screen per mode. *(Bijgewerkt na S11: er komt een vijfde tab
  "Rapportages" bij — dat is een toevoeging naast dit uitgangspunt, geen wijziging aan hoe deze vier
  zelf werken; Rapportages heeft geen eigen canvas/zoom-/pan-logica nodig, net als Beheer.)*
- Groen/amber/rood als statuskleur-conventie (belasting t.o.v. rating)
- Testmodus-detectie via bestaande `/api/test-mode`-check
- Nederlandstalige domeintermen als basis (kast, generator, groep, batterij, verdeelkast,
  plattegrond, kalibreren) — Engels komt er *naast*, niet in plaats van

## 3. Open technische fundamentvragen — af te stemmen met Claude Code

Deze bepalen hoe het designwerk uit dit plan technisch landt. Ik beslis ze niet zelf; ik noem ze
zodat ze in het volgende gesprek tussen jou, mij en Code expliciet worden afgekaderd.

1. **Eén HTML-bestand blijven, of moduleren?** ✅ **Beantwoord, zie §11.1.**
2. **i18n-datamodel.** ✅ **Beantwoord, zie §11.2.**
3. **Hub-dashboard aanpak (roadmap-item 6).** ✅ **Designvoorkeur bepaald: optie B (herbouwen).**
   Mockups en vergelijking zijn opgeleverd (zie §11.3 en `mockups/hub-dashboard-vergelijking.md`);
   Mike en Cowork kiezen beiden voor het herbouwen van de relevante Grafana-content als eigen
   webapp-component, i.p.v. iframe-embed. Technische bevestiging/haalbaarheid ligt nu bij Claude
   Code.
4. **Backup-bestandsformaat (roadmap-item 8).** ✅ **Beantwoord, zie §11.4.**

## 4. Informatiearchitectuur — voorstel

Huidige IA: header met vier mode-knoppen (Beheer/Kalibreren/Schema/Live) + los Testdata-tabblad
in testmodus, aside rechts met lijst, main-canvas links. Dit blijft het skelet; wat verandert:

- **Taalkeuze** komt in de header naast de mode-switch (vlagletters of "NL/EN"-toggle, zelfde
  visuele stijl als de bestaande modeswitch-pill).
- **Hub-gedachte (roadmap-item 6)**: **herzien naar aanleiding van S11** — toch gewoon een vijfde
  tab ("Rapportages") in dezelfde `.modeswitch`-pill als Beheer/Kalibreren/Schema/Live, exact
  dezelfde stijl (inclusief de accent-teal `active`-status). Binnen die tab een altijd-zichtbare
  subnav-balk (Overzicht/PDF-rapport/Back-up). Geen dropdown/popup-menu (zie S10) — dat
  interactiepatroon komt nergens anders in de app voor. De eerdere aanname dat een vijfde tab de
  bestaande structuur zou "opbreken" bleek in de praktijk geen probleem: de pill-groep schaalt
  gewoon met een extra knop mee.
- **Beheer-tab** verliest het "Rapport exporteren"-blok onderaan (verhuist naar de nieuwe hub-
  ingang) — Beheer blijft dan zuiver topologiebeheer, wat de tab weer overzichtelijker maakt nu er
  toch al veel op staat (generators/groepen/kasten/leden/logo/export-import).

## 5. Design system

**Basis blijft het bestaande dark theme** — het is consistent, leesbaar in een tent/regie-omgeving
bij wisselend licht, en er is geen aanleiding om dat bij een rebuild weg te gooien. Bestaande
CSS-variabelen (`--bg`, `--panel`, `--accent` #4fd1c5 teal, `--green`/`--amber`/`--red`/`--grey`,
`--mono`/`--sans`) blijven het uitgangspunt. Wat de rebuild toevoegt:

- **Fasekleur-laag (roadmap-item 4)**: bruin/zwart/grijs als *klein label/vlakje* naast elke
  fase-waarde (kastpopup, aside-detail, evt. lijst) — nadrukkelijk niet de rij zelf inkleuren, om
  verwarring met de groen/amber/rood statuskleur te voorkomen. Voorstel: een 8×8px rond kleurvlakje
  vóór het label "Fase 1/2/3", met de bestaande status-badge (groen/amber/rood) er los naast op
  dezelfde regel. Nieuwe CSS-variabelen `--fase1` (bruin), `--fase2` (zwart/antraciet — puur zwart
  leest slecht op het donkere thema, dus een iets lichtere antraciettint), `--fase3` (grijs).
- **Taalkeuze-component**: compacte NL/EN-toggle (twee knoppen, geen dropdown/popup — zie de
  precedent in S10: de app kent nergens verborgen/hover-menu's), zelfde visuele familie als de
  bestaande `.modeswitch`-pill. Zo ook uitgevoerd in
  [mockups/i18n-beheer-poc.html](mockups/i18n-beheer-poc.html).
- **Tekstlengte-marge**: NL-labels zijn vaak langer dan EN (of omgekeerd, bijv. "verdeelkast" vs.
  "distribution box"). Componenten die nu tekst tight laten passen (badges, kastpopup-koppen,
  sidebar-rijen) hebben in de rebuild wat meer flexibele breedte/ellipsis-afhandeling nodig — dit
  is een expliciet aandachtspunt bij elk component-mockup, niet iets dat achteraf gepatcht wordt.

## 6. Per-scherm rebuild-aanpak

**Beheer**: structuur blijft (generators/groepen aanmaken, kasten gegroepeerd per bron, zoek/filter,
in-/uitklappen), minus het rapport-blok (zie §4). Taalkeuze-omschakeling raakt hier het meest
zichtbaar omdat dit de tekst-dichtste tab is (formuliervelden, tabelkoppen) — eerste tab om als
i18n-proof-of-concept te mocken.

**Kalibreren**: geen structurele wijziging nodig vanuit de roadmap; blijft plattegrond/canvas +
pins + zoom/pan/fit-to-screen zoals nu.

**Schema**: geen structurele wijziging; fasekleur-laag is hier minder relevant (schema toont
boxkleur per node-type + status, geen per-fase detail).

**Live**: hier landen zowel de fasekleur-laag (kastpopup, aside-detail) als — indirect — het
notificatiekanaal-item: zodra er een alertkanaal is, kan een klein "alert actief"-indicator bij een
kast interessant zijn, maar dat is pas relevant ná de Grafana-kant (roadmap-item 2), niet nu al
meebouwen.

**Testdata**: geen wijziging nodig.

**Nieuw: Backup-scherm (roadmap-item 8)**: *(bijgewerkt na S9–S11)* geen modal, maar een eigen
**Back-up-subtab** binnen de "Rapportages"-tab (naast Overzicht en PDF-rapport), zelfde subnav-stijl.
Een keuzescherm met checkboxes (topologie, plattegrond+logo altijd inbegrepen; meetdata optioneel
met periode-chips) boven een primaire "Volledige back-up maken"-knop, en een status/download-
kaart-patroon hergebruikt van het bestaande PDF-rapport-flow (statuskaart tijdens genereren →
downloadkaart of foutkaart met "Opnieuw proberen") — dat patroon bestaat al en werkt goed, geen
nieuw interactiepatroon nodig. Zie [mockups/hub-backup-scherm.html](mockups/hub-backup-scherm.html).

**PDF-rapport (roadmap-item 7)**: expliciet genoemd in de roadmap als item dat **eerst** een
formatting-review met mockups nodig heeft vóór de logo-implementatie gebouwd wordt. Dit pak ik als
apart, kleiner deelproject op zodra dit rebuild-plan is afgestemd — niet in dezelfde slag, dat
verdient eigen aandacht met echte voorbeeldrapporten.

## 7. Roadmap-item → designimpact (overzicht)

- **Generator-EM rework** — nog geen designactie; expliciet "eerst verder gebruiken/bekijken" in
  de roadmap. Niet meenemen in dit rebuild, wel structuur openhouden (geen aannames die dit later
  in de weg zitten).
- **Notificatiekanaal** — vrijwel geen webapp-designimpact (Grafana Contact Points); enige raakvlak
  is de PDF-rapport "Overschrijdingen & alarmen"-sectie die van placeholder naar echt gevuld gaat
  zodra dit er is — komt terug bij het PDF-deelproject (§6).
- **Meertalige UI** — grootste designimpact; zie §4/§5, alle schermen.
- **Fasekleuren NL** — zie §5; raakt kastpopup, aside-detail, evt. lijst.
- **MQTT-prefix fest→event** — geen designimpact.
- **Eén hoofddashboard** — zie §4 (hub-ingang, vijfde tab "Rapportages"); besloten in §3.3/§11.3
  (optie B, herbouwen), technisch bevestigd door Claude Code.
- **Logo in PDF + formatting-review** — apart deelproject, zie §6.
- **Backup-functie** — nieuw scherm, zie §6.
- **Single-use vs. edities-vergelijken** — conceptueel/architectuur, geen directe schermimpact nu;
  wel relevant voor hoe een eventuele "editie-kiezer" in de UI wordt gepresenteerd zodra dit is
  uitgekristalliseerd. Niet meenemen in dit rebuild.
- **Audit Shelly-datacompleetheid** — geen designimpact tenzij de analyse nieuwe velden oplevert;
  dan pas een aanvullend mockup voor kastpopup/detail.

## 8. Voorgestelde fasering

1. Dit plan afstemmen (jij + Claude Code) — vooral de vier open vragen in §3.
2. Mockup i18n-proof-of-concept op Beheer-tab (kleinste risico, grootste dekking van het
   tekstlengte-vraagstuk).
3. Fasekleuren-mockup (klein, op zichzelf staand, snel te valideren).
4. Hub-ingang + Backup-scherm mockup (afhankelijk van besluit §3.3/§3.4).
5. PDF-rapport formatting-review als apart deelproject (§6), los van de rest.
6. Overige roadmap-items volgen hun eigen aparte spec zodra ze aan de beurt zijn (Generator-EM
   rework, single-use-vraagstuk) — expliciet niet in deze rebuild-golf.

## 9. Werkwijze & levering

Conform `CLAUDE.md`: alle designvoorstellen komen als losse mockup/spec in `specs/` (zoals dit
document), nooit als directe edit in `webapp/public/index.html`. Claude Code vertaalt vanaf hier
naar implementatie.

## 10. Openstaande vragen aan jou — beantwoord

- **Scope-afbakening (§2) akkoord.** Single-use-vraagstuk, Generator-EM-rework en MQTT-prefix
  blijven losse, latere trajecten — niet in deze rebuild-golf.
- **Fundamentvragen (§3) eerst met Claude Code doornemen.** Mike stemt de vier open technische
  vragen (single-file vs. moduleren, i18n-datamodel, hub-dashboard aanpak, backup-formaat) af met
  Claude Code, en komt daarna bij Cowork terug voor een eventuele follow-up op het designwerk
  (bijv. als een van de antwoorden een mockup-aanpak verandert).
- **Fasering (§8) akkoord**, inclusief volgorde (i18n-proof-of-concept → fasekleuren → hub/backup
  → PDF-deelproject apart → overige items apart).

**Vervolg:** dit plan gaat nu naar Claude Code ter verwerking/implementatie-planning.

## 11. Antwoorden Claude Code op de fundamentvragen (§3)

Afgestemd met Mike op 2026-07-20. Drie van de vier vragen zijn beslist; punt 3 gaat terug naar
Cowork.

1. **Eén bestand vs. moduleren → moduleren, zonder build-stap.** Broncode wordt gesplitst: JS als
   ES modules onder `webapp/public/js/` (`<script type="module">`), CSS in een los bestand
   (`<link>`). `server.js` serveert dit al statisch — geen concatenatie, geen bundelaar nodig.
   Gedrag voor gebruiker en deploy verandert niet.
2. **i18n-datamodel → platte dot-keys, gedeeld client+server.** Eén JSON per taal (`nl.json`/
   `en.json`) met keys als `beheer.generator.naam`, in een gedeelde locatie die zowel de frontend
   (fetch) als de server (`require`, voor PDF-teksten) gebruikt. Eén bron van waarheid, geen
   dubbele vertalingen.
3. **Hub-dashboard aanpak → besloten: optie B, herbouwen. Technisch bevestigd.** Cowork leverde
   mockups van beide richtingen (`mockups/hub-optie-a-iframe-embed.html`,
   `mockups/hub-optie-b-herbouwd.html`) plus een vergelijking
   (`mockups/hub-dashboard-vergelijking.md`). Mike en Cowork kiezen beiden voor optie B: de
   relevante Grafana-content herbouwen als eigen webapp-component, consistent met de bestaande
   visuele taal.
   **Technische bevestiging (Claude Code):** haalbaar met gemiddelde bouwinspanning, dankzij
   hergebruik van drie bestaande subsystemen:
   - Live metric-cards/staafdiagrammen: hergebruiken dezelfde client-side MQTT-over-websocket
     live data (`liveData`/`liveEnergyData`, zie `webapp/public/index.html` rond regel 386/1968)
     die Live/Schema al gebruiken — geen nieuwe databron of server-tussenlaag nodig.
   - Periode-kWh-totalen: hergebruiken de bestaande Flux-queryhelper (`influxQuery`,
     `webapp/server.js` rond regel 544) die nu al voor het PDF-rapport periodestatistieken uit
     InfluxDB haalt.
   - Sankey-achtige boomweergave: hergebruikt de bestaande Schema-tab-renderlogica, zoals Cowork
     al aangaf.
   Enige echte nieuwbouw: tijdrange-keuze en drill-down-interactie specifiek voor dit
   overzichtsscherm (export was in de mockup niet meegenomen, dus geen aandachtspunt hier). Geen
   van deze drie hergebruikte subsystemen vereist een architectuurwijziging.
4. **Backup-bestandsformaat → topologie + media altijd, meetdata optioneel.** Zip bevat
   topologie-JSON (bestaande export/import-functie) en plattegrond-afbeeldingen/logo altijd; een
   InfluxDB-dump (CSV/line-protocol, met periode-keuze) is een losse aanvinkbare optie i.v.m.
   bestandsgrootte. Dit bepaalt de UI-copy in het keuzescherm uit §6 (checkboxes, geen aparte
   grootte-indicatie nodig voor de altijd-inbegrepen onderdelen).

**Vervolg:** roadmap-item 6 (hub-dashboard, §3.3) is nu ook designmatig besloten (optie B). Dit plan
gaat terug naar Claude Code voor de technische bevestiging daarvan en om de implementatieplanning
op te pakken. De overige fasering (§8) kan parallel doorlopen zodra Cowork daarmee verder wil.
