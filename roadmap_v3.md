# Event Stroom-Dashboard — roadmap v3 (actief)

> Voor omschrijving en featurelijst: zie [event_dashboard.md](event_dashboard.md). Voor de
> afgeronde v2-roadmap: zie [roadmap_v2.md](roadmap_v2.md). Overzicht van alle roadmap-bestanden:
> [roadmap.md](roadmap.md).

## Roadmap v3 (actief)

v2 is afgerond, dit is de actieve roadmap — een deel van onderstaande punten is al gebouwd (zie de
`[x]`-items). Volgt dezelfde werkafspraak (spec/plan eerst, dan pas bouwen — zie "Overige
afspraken" in [CLAUDE.md](CLAUDE.md)).

> "v3" is hier een roadmap-generatienaam, geen belofte dat deze items als `v3.0.0` uitkomen: sinds
> de overstap naar echte [semantic versioning](CLAUDE.md) (§ Versionering) bepaalt de aard van elke
> individuele wijziging het MAJOR/MINOR/PATCH-cijfer bij release, niet welk roadmap-bestand 'm
> bevat. Zo werd het eerste afgeronde item hieronder (knikpunten) een MINOR-release (`v2.1.0`),
> geen `v3.0.0`.

> **3 augustus 2026**: vier punten die hier stonden (per-fase-fout-/vlagindicatoren, `EMData`-
> component-brede errors, interval-aggregaten, generator-EM-rework-vervolg/CAN-bus) zijn met Mike
> geprioriteerd naar [roadmap_v4.md](roadmap_v4.md), samen met vier punten uit de toenmalige
> "Ideeën van Claude"-sectie hieronder. Zie dat bestand voor de volledige items.

- [x] **Notificatiekanaal voor alerting naar telefoon.** Afgerond — gebouwd conform
      [specs/notificatiekanaal-plan.md](specs/notificatiekanaal-plan.md): "Alert-notificaties"-
      sectie in Beheer (Telegram/Pushover/ntfy.sh/e-mail, meerdere tegelijk aan), met testbericht-
      knop en Grafana-contact-point-/policy-provisioning. De "Overschrijdingen & alarmen"-sectie
      van het PDF-rapport blijft vooralsnog de bestaande placeholder (apart stukje werk, niet
      vanzelf meegekomen) en het uitgestelde "per-fase fout-/vlagindicatoren"-punt (nu op
      roadmap_v4.md) blijft los staan. Zie event_dashboard.md, Topologiebeheer (Beheer-tabblad).
- [x] **Lijnen tussen kasten aanpasbaar (bochten/knikpunten).** Afgerond — gebouwd conform
      [specs/lijnen-knikpunten-plan.md](specs/lijnen-knikpunten-plan.md): op Kalibreren een
      knikpunt toevoegen (dubbelklik op een lijnsegment of via het rechtsklik-menu), verslepen,
      verwijderen (dubbelklik op het knikpunt) of de hele lijn resetten (rechtsklik-menu). Op Live
      volgt de lijn dezelfde route, read-only. Zie event_dashboard.md, Kalibreren-tabblad.
- [x] **Automatische back-up** (lokaal en/of naar een externe server). Afgerond — gebouwd conform
      [specs/automatische-backup-plan.md](specs/automatische-backup-plan.md): aan/uit, frequentie
      (elk uur/dagelijks/wekelijks), meetdata optioneel meenemen, en tegelijk aan te zetten
      bestemmingen (lokaal, SFTP, S3-compatible) met een eigen bewaartermijn per bestemming.
      Rotatie gebeurt pas ná een bevestigd geslaagde nieuwe back-up en een geplande run wacht op een
      lopende handmatige back-up-/restore-/PDF-rapportflow i.p.v. gelijktijdig te draaien. Mislukte
      runs sturen een bericht naar de aangezette alert-notificatiekanalen. Geverifieerd tegen echte
      lokale/SFTP-/S3(MinIO)-testbestemmingen, inclusief rotatie na vier opeenvolgende runs. Zie
      event_dashboard.md, Back-up-subtab.
- [x] **Secrets afschermen in instellingen-API (bugfix).** Afgerond — gebouwd conform
      [specs/secrets-afscherming-plan.md](specs/secrets-afscherming-plan.md): `GET /api/instellingen`
      geeft geheimen (Telegram-bot-token, Pushover-API-token, SMTP-wachtwoord, SFTP-wachtwoord,
      S3-secret-key) niet meer terug, alleen een `<veld>_ingesteld`-boolean; een leeg gelaten veld
      bij het opslaan laat de bestaande waarde staan, een "Wissen"-link verwijdert 'm expliciet.
      Geverifieerd met een volledige round-trip (instellen → geredigeerd in GET → ongewijzigd na
      leeg opslaan → daadwerkelijk weg na Wissen). Nog steeds onafhankelijk van, en niet opgelost
      door, de login-laag van "Toegang van buitenaf" hieronder. Zie event_dashboard.md,
      Topologiebeheer (Beheer-tabblad).
- [x] **Evenementlogo in de header is te klein (tweak, geen spec nodig).** Afgerond — `#headerLogo`
      (`webapp/public/index.html`) van `height:26px` naar `height:42px` (binnen de gevraagde
      ~40-44px-marge), verder geen gedragswijziging. Geverifieerd met het ontvangen
      voorbeeldlogo ([specs/assets/captain-power-logo-voorbeeld.svg]
      (specs/assets/captain-power-logo-voorbeeld.svg)): past nog prima naast de modeswitch, geen
      omslag van de header-rij.
- [x] **Toegang van buitenaf (HQ meekijken).** Afgerond — gebouwd conform
      [specs/toegang-van-buitenaf-diagnose.md](specs/toegang-van-buitenaf-diagnose.md) en het
      technische implementatieplan daar bovenop. Beide blokkerende voorwaarden uit de diagnose
      opgelost: een login-laag voor de hele app (bevinding #1) én de losse, onbeveiligde
      MQTT-websocketverbinding (bevinding #2).
      **Login + accounts**: `cookie-session` (signed+encrypted cookie, geen server-side
      sessieopslag), wachtwoorden gehashed met `bcryptjs`. Eerste-opstart maakt automatisch één
      admin-account aan (wachtwoord eenmalig in de container-log). Nieuwe "Accounts"-sectie in
      Beheer (naam/e-mail/laatst-ingelogd, wachtwoord resetten, verwijderen — geen rol-onderscheid,
      dat is de latere "Rolverdeling/rechten"-stap). Login geldt voor de hele app zonder
      uitzondering, ook de QR-deeplink (`kaststatus.js` deelt dezelfde boot-gate). Accountnamen zijn
      uniek (dat is de inlog-identifier).
      **MQTT-websocketproxy**: mosquitto's poort is niet meer naar de host gepubliceerd (alleen nog
      intern bereikbaar, net als InfluxDB/Grafana) — de browser verbindt altijd naar hetzelfde
      origin als de webapp zelf (`/mqtt`), geproxied via `http-proxy-middleware` met een kortlevend,
      sessie-gebonden ticket (`/api/mqtt-ticket`) dat de upgrade valideert vóór 'ie wordt doorgezet.
      Loste meteen ook de bestaande adresdetectie-bug op: geen handmatig in te vullen broker-host/
      -poort meer, `mqtt.js`/`kaststatus.js` verbinden automatisch. De testmodus-`simulator` (die
      geen browser-sessie heeft) authenticeert zichzelf met een gedeeld `INTERNAL_API_TOKEN`.
      **HQ-Locaties-pagina**: nieuwe subtab onder Rapportages — een handmatige locatielijst
      (naam + URL) met live statuskaarten (kasten-aantal, aantal amber/rood, "Beheer openen"-link
      naar de volledige app van die locatie). Elke locatie-instance krijgt een nieuw, publiek
      (ongeauthenticeerd, geeft alleen tellingen terug) `/api/hq-status`-endpoint; de HQ-instance
      haalt dat server-naar-server op per bekende locatie, met een timeout per locatie zodat één
      onbereikbare locatie de rest niet blokkeert (toont dan een grijze "offline"-kaart).
      **TLS/reverse-proxy**: nieuwe, optionele `caddy`-service (alleen gestart met
      `docker compose --profile publiek up -d`, lokaal ontwikkelen blijft gewoon op
      `http://localhost:8080`) — automatische Let's Encrypt-certificaten via een `PUBLIC_DOMEIN`-
      env-var, websocket-upgrades (inclusief `/mqtt`) werken vanzelf zonder aparte config.
      Zie event_dashboard.md voor de volledige featurebeschrijving.
- [x] **Vinkje "meetdata beschikbaar" per generator/lid.** Afgerond — gebouwd conform
      [specs/generator-meetdata-vinkje-plan.md](specs/generator-meetdata-vinkje-plan.md): expliciete
      "Heeft sensor"-checkbox naast het rating-veld in Beheer (generatorrij + ledentabel), en een
      herkenbaar grijs "geen sensor"-label op de vier plekken die voorheen stil niets toonden
      (Live-zijlijst, aside-detail, schema-tabblad, kastpopup-ledentabel). Zie event_dashboard.md,
      Topologiebeheer (Beheer-tabblad).
- [x] **Grafieken-tabblad (vrije ad-hoc analyse).** Afgerond — alle vijf grafiektypes + live-modus +
      PNG-export gebouwd, en beide code-review-rondes (5 augustus 2026, zes + twee bugs) volledig
      gefixt en hertest: statuskleur bij fase Totaal, live-aggregatie-terugval, hardcoded kWh-label,
      Sankey-link-volgorde, "Alle edities" buiten het Lijndiagram, drie losse PNG-exportroutes
      (ronde 1), plus een heatmap-statuscel die vals-groen kleurde bij één ontbrekend fase-veld en
      een metric die na Lijn→Live→Taart→terug-naar-Lijn op de verkeerde waarde kon blijven staan
      (ronde 2) — zie specs/vervolgticket-grafieken-tabblad.md en
      specs/vervolgticket-grafieken-tabblad-ronde2.md. Zesde hoofdtabblad in de mode-switch,
      naast Beheer/Kalibreren/Schema/Live/Rapportages: zelf kasten/generators, metric (stroom/
      spanning/vermogen/energie), fase en periode/editie selecteren, zonder naar Grafana te hoeven
      wisselen voor een snelle ad-hoc vraag. Vijf grafiektypes (lijn, staaf, Sankey, taart, heatmap)
      plus een live-modus met schuifvenster, gebouwd conform
      [specs/grafieken-tabblad-plan.md](specs/grafieken-tabblad-plan.md) (v4, 4 augustus 2026),
      volgens de "Lijn eerst"-bouwvolgorde-suggestie uit die spec.
      **Lijndiagram**: tijdreeks, server-side downsampling (Flux `aggregateWindow`). **Staafdiagram**:
      `/api/grafieken/aggregaat`-endpoint (piek/gemiddelde via Flux `max()`/`mean()`, periode-totaal
      bij metric energie via `integral(unit: 1h)`), balken aflopend gesorteerd, kleur volgt groen/
      amber/rood-t.o.v.-rating bij metric stroom, categorisch palet bij de overige metrics. Bij fase
      "Totaal" vergelijkt de kleur (niet de getoonde balkhoogte) tegen de zwaarst-belaste van de drie
      fases i.p.v. de driefasen-som — `rating_a` is een per-fase rating, een som zou pas rond ~300%
      "rood" worden (bugfix, zie vervolgticket hierboven); dezelfde fix geldt voor de Heatmap.
      **Taartdiagram** (zelfde `/api/grafieken/aggregaat`-endpoint): metric+aggregatie vergrendeld op
      Energie/Periode-totaal, percentage + waarde per segment in de legenda (eenheid volgt de actieve
      metric — kWh normaal, W zodra live-modus naar Vermogen omzet). **Heatmap**:
      `/api/grafieken/heatmap`-endpoint, rij per kast/generator, kolom per uur-van-de-dag (of dag bij
      >~3 dagen), cel gekleurd via groen/amber/rood t.o.v. rating (zelfde zwaarst-belaste-fase-fix als
      Staaf — en null-tolerant: een cel met bijv. alleen fase A en B bekend krijgt nog steeds een
      terechte kleur, i.p.v. vals-groen zodra één fase-veld ontbreekt), metric vergrendeld op Stroom,
      eigen SVG (native `<title>`-tooltips per cel). **Sankey**:
      `/api/grafieken/sankey`-endpoint — de keten komt rechtstreeks uit de in-memory topologie, alleen
      de kWh-waarde per link uit InfluxDB; linkerkolom wisselt om naar een startpunt-dropdown, metric
      vergrendeld op Energie, eigen zelfgetekende SVG (geen d3-sankey-library nodig, de data is altijd
      een boom).
      **Live-modus**: vierde periode-optie "Live" met schuifvenster (5/15/30/60 min), hergebruikt de
      bestaande MQTT-websocketverbinding van het Live-tabblad via een client-side rolling buffer
      (altijd 60 min, ongeacht het gekozen venster) die per binnenkomend bericht gevuld wordt,
      ongeacht actief tabblad. Editie-select vastgezet zolang Live actief is; pulserende
      "LIVE"-indicator + pauzeren/hervatten-knop. Lijn toont een scrollende meerdere-kasten-
      tijdreeks; Staaf krijgt een eigen live-aggregatie-rij (Huidige waarde/Piek-in-venster/
      Gemiddelde-in-venster); Sankey/Taart springen automatisch naar metric Vermogen (Energie is een
      periode-optelling, niet zinvol live) — dezelfde Energie-uitsluiting geldt ook voor Lijn/Staaf,
      daar blijft de rest van de metric-keuze wel vrij; Heatmap heeft geen live-modus (Live-chip
      uitgeschakeld zolang Heatmap actief is, met terugval op de laatst gekozen niet-live periode).
      Live wordt bewust nooit in de "Kopieer link"-URL gecodeerd.
      **PNG-export**: twee technische paden i.p.v. de oorspronkelijke drie (bugfix) — Lijn/Staaf/
      Taart rechtstreeks vanaf de Chart.js-canvas, Sankey én Heatmap (allebei een zuivere SVG, geen
      HTML/foreignObject erin — een foreignObject-truc "taint" het canvas zodra er HTML in zit, een
      Chromium-beveiligingsbeperking) delen dezelfde svgNaarPngDataUrl()-rasterisatie-route, geen
      aparte tweede layout-implementatie die uit de pas kan lopen met de weergave zelf.
      Meerdere-edities-vergelijking (jaar-op-jaar) is bewust buiten deze v1-scope gelaten (zie de
      spec's "Wat het niet is") en wacht op de tijd-sinds-start-uitlijning uit
      voorspellende-piekbelasting-plan.md, als aparte latere uitbreiding. Zie event_dashboard.md,
      Grafieken-tabblad.
      **Eerste bugronde (5 augustus 2026)**: alle zes punten (statuskleur bij fase Totaal,
      live-aggregatie-terugval, hardcoded kWh-label, Sankey-link die het startpunt verloor, "Alle
      edities" buiten het Lijndiagram, drie losse PNG-exportroutes) opgepakt in commit `4b6b6f0` —
      zie [specs/vervolgticket-grafieken-tabblad.md](specs/vervolgticket-grafieken-tabblad.md).
      **Tweede bugronde (5 augustus 2026, code-review op die fix-commit)**: vijf van de zes punten
      kloppen nu, maar de statuskleur-fix (punt 1) zelf heeft nog een gat bij de Heatmap — een cel
      met een ontbrekend fase-veld valt terug op "geen status" i.p.v. de wél-aanwezige fases te
      gebruiken, en kleurt daardoor vals-groen (dezelfde soort fout die punt 1 net moest oplossen).
      Daarnaast kan een volgorde-detail in de metric-vergrendeling de verkeerde metric laten
      "vastklikken" na Lijn → Live → Taart → terug naar Lijn. (Het vermeende derde punt, "W" i.p.v.
      "kW" bij Vermogen, bleek bij natrekken geen codebug — Vermogen wordt overal elders in de app
      al in Watt getoond, de spec-tekst was fout en is gecorrigeerd, geen actie voor Code nodig.)
      Zie [specs/vervolgticket-grafieken-tabblad-ronde2.md]
      (specs/vervolgticket-grafieken-tabblad-ronde2.md).
- [x] **QR-code per kast.** Afgerond — gebouwd conform [specs/qr-code-plan.md](specs/qr-code-plan.md):
      "QR-code"-actieknop per kastrij in Beheer (overlay met downloaden/printen) + een
      "Alle QR-codes printen"-bulkknop, elk codeert `/?mode=live&kast=<id>`. Op een smal scherm
      opent die deep-link de nieuwe, lichte mobiele statuspagina i.p.v. de volledige Live-modus
      (bevestigde bevinding: vaste 320px-zijlijst, geen responsive CSS, geen touch-events); op een
      breed scherm het bestaande drill-down-gedrag naar Live-modus. Zie event_dashboard.md,
      Topologiebeheer (Beheer-tabblad).
- [x] **Anomaly-detectie los van de vaste 90%-drempel.** Afgerond — gebouwd conform
      [specs/anomaly-detectie-plan.md](specs/anomaly-detectie-plan.md): client-side op de bestaande
      MQTT-stream (rollend venster + sprong-drempel >50%, geen nieuwe databron), eigen pulserend
      ⚡-badge (in `--accent`) naast de status-stip in zij-lijst/aside-detail/plattegrond-pin,
      bevestigen/wegklikken + auto-verval na 10 min, en een "N anomalieën actief"-telkaartje op de
      Overzicht-subtab. Geverifieerd met een live gesimuleerde 82%-dip via MQTT (inclusief een
      pin-badge-opruimbug gevonden en gefixt tijdens het testen). Zie event_dashboard.md,
      Live-monitoring (Live-tabblad).
- [x] **Shelly-koppeling: "Open Shelly"-knop.** Afgerond — gebouwd conform
      [specs/shelly-ip-koppeling-plan.md](specs/shelly-ip-koppeling-plan.md): `shelly_ip` nu
      bewerkbaar in Beheer voor kasten én generators/leden-met-sensor, "Open Shelly ↗"-link in
      kastpopup/aside-detail/QR-statuspagina (alleen zichtbaar als het veld ingevuld is), met een
      tekstnoot dat dit alleen op het evenement-netwerk werkt. Zie event_dashboard.md,
      Topologiebeheer (Beheer-tabblad).
- [ ] **Rolverdeling/rechten.** Geaccordeerd (3 augustus 2026, vanuit de "Ideeën van Claude"-
      sectie gehaald) — daarmee is de "Ideeën van Claude"-sectie leeg. Nu heeft iedereen die de
      webapp-URL heeft volledige Beheer-rechten; dit voegt een viewer/editor-onderscheid toe
      (viewer ziet alleen Schema/Live/Rapportages, geen Back-up-sectie in Beheer). **Bouwt
      inhoudelijk voort op de accounts-/login-fundering uit "Toegang van buitenaf" hierboven** —
      kan pas na die basis gebouwd worden, niet onafhankelijk daarvan. Spec + mockup: zie
      [specs/rolverdeling-plan.md](specs/rolverdeling-plan.md).
- [x] **Vervolgticket op commit 37d57ff (logo/Shelly/QR-code/anomaly-detectie).** Afgerond — alle
      zes bugfixes uit de code-review doorgevoerd: anomaly-detectie-badge blijft nu correct
      zichtbaar tijdens een aanhoudende storing (de baseline wordt bij het triggermoment bevroren
      i.p.v. continu herberekend — geverifieerd met een 2 minuten volgehouden gesimuleerde
      MQTT-storing, badge bleef staan voorbij het oude ~60-90s zelf-heel-venster), QR-library lokaal
      gebundeld (`webapp/public/js/vendor/qrcode.min.js`, geen CDN meer), QR-deep-link t.o.v. het
      basispad i.p.v. hardcoded root, "Open Shelly"-link toegevoegd voor groepsleden
      (kastpopup-lidtabel + aside-detail-ledenblok), QR-codes uitgesloten voor kast-type "batterij"
      conform de oorspronkelijke spec (uitbreiding naar generators/batterijen bewust uitgesteld,
      zie roadmap_v4.md). Plus deel 2: **Back-up verplaatst van Rapportages naar Beheer** (eigen
      sectie onderaan de Beheer-kolom, ná Kasten; Rapportages-subnav geslonken naar
      Overzicht/PDF-rapport). Zie [specs/vervolgticket-commit-37d57ff.md]
      (specs/vervolgticket-commit-37d57ff.md), event_dashboard.md (Topologiebeheer-sectie).
- [x] **Vervolgticket op commit cdcef83 (anomaly-detectie-episode-logica).** Afgerond — alle drie
      neveneffecten van de baseline-bevries-fix opgelost, puur binnen `anomaly.js`: de opruimer
      toetst nu op `episode.sindsTs` (vastgezet bij de trigger) i.p.v. een steeds ververst
      tijdstip, en geldt voortaan voor alle episodes, ook weggeklikte — dus het 10-minuten-verval
      werkt weer tijdens een aanhoudende storing én een weggeklikte melding blokkeert een node niet
      langer permanent. De `sec`-waarde in de badgetekst ligt nu vast op het triggermoment
      (percentage/van/naar bewegen nog wel mee). Geverifieerd met een strak gesynchroniseerde
      live MQTT-test (publiceren en checken in hetzelfde script, geen cross-process timing-ruis):
      badge bleef exact dezelfde tekst tonen over meerdere checks, verviel correct tijdens een
      aanhoudende storing, en een nieuwe sprong ná verval werd weer als verse episode gedetecteerd.
      Zie [specs/vervolgticket-commit-cdcef83.md](specs/vervolgticket-commit-cdcef83.md).

## Ideeën van Claude (ongefilterd, nog niet besproken/geprioriteerd met Mike)

> Deze sectie is momenteel leeg — alle eerder voorgestelde ideeën zijn inmiddels met Mike
> geprioriteerd (zie de items hierboven en in [roadmap_v4.md](roadmap_v4.md)).
