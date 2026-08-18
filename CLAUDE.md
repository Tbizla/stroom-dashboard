# Richtlijnen voor Claude Code en Claude Cowork

Dit bestand is de gedeelde context tussen Claude Code (implementatie/techniek) en Claude Cowork
(UI-design) op dit project. Lees dit bestand opnieuw in als het sinds het begin van je sessie kan
zijn gewijzigd — het wordt niet automatisch live herladen tijdens een lopend gesprek.

Voor de rest van de projectcontext:
- [README.md](README.md) — installatie- en gebruiksinstructies
- [event_dashboard.md](event_dashboard.md) — omschrijving en featurelijst (bijhouden bij elke
  feature-wijziging, door wie die ook doorvoert)
- [roadmap.md](roadmap.md) — index naar de roadmap-bestanden per versie:
  [roadmap_v2.md](roadmap_v2.md) (afgerond), [roadmap_v3.md](roadmap_v3.md) (afgerond) en
  [roadmap_v4.md](roadmap_v4.md) (actief) — bijhouden bij elke roadmap-wijziging, door wie die ook
  doorvoert

## Rolverdeling

- **Claude Cowork**: UI/UX-design — visuele richting, layout-voorstellen, stijlgids, mockups.
- **Claude Code**: implementatie, databronnen (InfluxDB/MQTT/Grafana), en het vertalen van
  designvoorstellen naar de technische constraints hieronder.

Werk niet gelijktijdig in dezelfde bestanden. Als Cowork een visueel voorstel doet, liever als
losse mockup/spec (los HTML/CSS-fragment, beschrijving, screenshot) dan als directe edit in
`webapp/public/index.html` — dat bestand wordt live door Claude Code onderhouden en conflicten
zijn lastig te mergen omdat het één groot bestand zonder build-stap is.

## Technische constraints voor UI-voorstellen

`webapp/public/index.html` is één bestand: HTML, CSS en JS samen, geen framework, geen
build-stap. Een designvoorstel moet met het volgende rekening houden, anders werkt het niet of
moet het herbouwd worden:

- **Percentage-based plaatsing**: elke pin (generator/kast/batterij) heeft `positie.x_pct`/`y_pct`
  relatief aan een "surface" — ofwel de geüploade plattegrond, ofwel (zonder plattegrond) een vast
  leeg canvas van 4800×3000px. Nieuwe UI-elementen die iets "plaatsen" moeten in dit
  percentage-systeem passen, niet in pixels-op-viewport.
- **Vier weergavemodi**, elk met eigen zoom/pan/fit-to-screen-logica: Beheer (lijst/formulieren),
  Kalibreren (plattegrond + pins), Schema (auto-gegenereerd boomdiagram, SVG), Live
  (plattegrond + live status). "Fit to screen" is per mode content-aware: het fit't op de
  daadwerkelijk geplaatste content (bounding box), niet op de volledige 4800×3000 container —
  dat is bewust zo gefixt na een eerdere regressie, dus nieuwe fit/zoom-code moet dat patroon
  volgen.
- **Statuskleuren** groen/amber/rood zijn een vaste conventie (stroom t.o.v. ingestelde rating) —
  niet vervangen door een andere kleurcodering zonder dit met de databetekenis in lijn te houden.
- **Testmodus** is zichtbaar aan een los "Testdata"-tabblad dat alleen verschijnt als de
  `simulator`-service draait (`docker compose --profile test up -d`). Geen aparte env-var; UI die
  hierop reageert moet de bestaande `/api/test-mode`-check gebruiken, niet een nieuwe vlag
  verzinnen.
- **Taal**: UI-teksten en domeintermen zijn Nederlands (kast, generator, groep, batterij,
  verdeelkast, plattegrond, kalibreren). Houd dat aan in nieuwe teksten/labels.

## Overige afspraken

- Bestanden die door Cowork of andere tooling gegenereerd worden maar niet bij de repo horen
  (rapporten, exports, tijdelijke bestanden) horen in `.gitignore`, niet in een commit.
- Wijzig je iets aan features, werk dan [event_dashboard.md](event_dashboard.md) bij; wijzig je
  iets aan de roadmap, werk dan het bijbehorende [roadmap_v2.md](roadmap_v2.md)/
  [roadmap_v3.md](roadmap_v3.md)/[roadmap_v4.md](roadmap_v4.md) bij — allebei in dezelfde beurt
  als de wijziging zelf, dat zijn de canonieke overzichten, niet dit bestand.
- **Vanaf de v2-roadmap (zie roadmap_v2.md/roadmap_v3.md/roadmap_v4.md): eerst een uitgebreide
  spec/plan uitwerken en afstemmen vóórdat er gebouwd wordt.** Geldt voor zowel Cowork- als
  Code-kant, niet alleen voor UI-voorstellen — ook backend-/infra-werk op die roadmap start met
  een plan, niet met code.
- **Een roadmap-item pas als `[x]` aanvinken als het écht helemaal af is — niet bij een deel-
  oplevering.** Is een item gedeeltelijk gebouwd (bijv. één grafiektype van de vijf, of één
  bouwstap van een groter item), dan blijft het `[ ]` en beschrijft de tekst duidelijk wat al
  gebouwd is en wat nog niet — geen `[x]` met een "nog te bouwen"-lijstje erachteraan. Geldt voor
  wie de roadmap ook bijwerkt (Cowork of Code).

## Versionering (tags & releases)

Sinds 2026-08-01 echte [semantic versioning](https://semver.org/lang/nl/): MAJOR.MINOR.PATCH,
waarbij elk cijfer alleen omhoog gaat als de wijziging dat daadwerkelijk rechtvaardigt — niet
mechanisch "elke roadmap-golf is een nieuwe major" (dat was de vorige, inmiddels verlaten
afspraak).

- **MAJOR**: breaking/incompatibele wijziging (bijv. een API-/datamodelwijziging die bestaande
  topologie-data of integraties breekt zonder migratiepad).
- **MINOR**: nieuwe, backwards-compatible functionaliteit (het gangbare geval voor een
  roadmap-item — bijv. de knikpunten-feature: nieuw optioneel veld/endpoint, niets bestaands
  breekt).
- **PATCH**: backwards-compatible bugfix, geen nieuwe functionaliteit.
- Beoordeel dit **per wijziging**, niet per roadmap-bestand — roadmap_v2.md/roadmap_v3.md/
  roadmap_v4.md zijn een planningsindeling, geen garantie dat alles daarin uiteindelijk onder
  dezelfde major uitkomt.

**Branch**: één doorlopende `dev`-branch (geen versienummer in de naam — welk MAJOR/MINOR/PATCH-
cijfer een release straks krijgt hangt af van wat er daadwerkelijk gebouwd wordt, niet vooraf vast
te leggen in de branchnaam). `main` = laatst uitgebrachte versie, momenteel `v3.9.1`.

**Tags/releases**:
- Bij elke afgeronde feature/roadmap-item op `dev`: direct een pre-release tag zetten op het
  eerstvolgende MAJOR/MINOR/PATCH-niveau dat bij die wijziging past, met `-alpha.N` erachter
  (bijv. `v2.1.0-alpha.1`, en bij de eerstvolgende backwards-compatible feature daarna
  `v2.1.0-alpha.2` — pas een nieuw MINOR/PATCH-cijfer als de daadwérkelijke aard van de wijziging
  dat rechtvaardigt) + een GitHub Release (`--prerelease`) met de featurebullets als notes.
- Pas als `dev` daadwerkelijk naar productie gepromoveerd wordt: mergen naar `main`
  (fast-forward), taggen als het definitieve `v<major>.<minor>.<patch>` (geen `-alpha` meer) en
  een volwaardige Release aanmaken — dat is dan ook het moment waarop `main` weer verandert.
- Bestaande tags/releases: zie de [releases-pagina](https://github.com/Tbizla/stroom-dashboard/releases).
