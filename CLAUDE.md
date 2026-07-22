# Richtlijnen voor Claude Code en Claude Cowork

Dit bestand is de gedeelde context tussen Claude Code (implementatie/techniek) en Claude Cowork
(UI-design) op dit project. Lees dit bestand opnieuw in als het sinds het begin van je sessie kan
zijn gewijzigd — het wordt niet automatisch live herladen tijdens een lopend gesprek.

Voor de rest van de projectcontext:
- [README.md](README.md) — installatie- en gebruiksinstructies
- [event_dashboard.md](event_dashboard.md) — omschrijving en featurelijst (bijhouden bij elke
  feature-wijziging, door wie die ook doorvoert)
- [roadmap.md](roadmap.md) — index naar de roadmap-bestanden per versie:
  [roadmap_v2.md](roadmap_v2.md) (afgerond) en [roadmap_v3.md](roadmap_v3.md) (actief, incl.
  ongefilterde ideeën) — bijhouden bij elke roadmap-wijziging, door wie die ook doorvoert

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
  [roadmap_v3.md](roadmap_v3.md) bij — allebei in dezelfde beurt als de wijziging zelf, dat zijn
  de canonieke overzichten, niet dit bestand.
- **Vanaf de v2-roadmap (zie roadmap_v2.md/roadmap_v3.md): eerst een uitgebreide spec/plan
  uitwerken en afstemmen vóórdat er gebouwd wordt.** Geldt voor zowel Cowork- als Code-kant, niet
  alleen voor UI-voorstellen — ook backend-/infra-werk op die roadmap start met een plan, niet met
  code.

## Versionering (tags & releases)

- `main` = laatst uitgebrachte versie, momenteel `v2.0.0` (v1 was `v1.0.0`). `dev` = eerstvolgende
  versie in ontwikkeling (nu v3), nog niet gepromoveerd.
- Bij elke afgeronde roadmap-golf op `dev` (zoals nu al bijgehouden in roadmap_v3.md): een
  pre-release tag `v<volgende-major>.0.0-alpha.N` zetten + een GitHub Release
  (`--prerelease`) met de bijbehorende featurebullets als notes. Gebruik de eerstvolgende vrije
  `N`; er is geen vaste koppeling tussen alpha-nummer en specifiek roadmap-item.
- Pas als `dev` daadwerkelijk naar productie gepromoveerd wordt: mergen naar `main` (fast-forward,
  dev loopt altijd rechtdoor op main), taggen als `v<major>.0.0` (geen `-alpha` meer) en een
  volwaardige Release aanmaken — dat is dan ook het moment waarop `main` weer verandert.
- Bestaande tags/releases: zie de [releases-pagina](https://github.com/Tbizla/stroom-dashboard/releases).
