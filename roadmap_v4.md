# Event Stroom-Dashboard — roadmap v4 (nog niet gestart)

> Voor omschrijving en featurelijst: zie [event_dashboard.md](event_dashboard.md). Overzicht van
> alle roadmap-bestanden: [roadmap.md](roadmap.md).

## Roadmap v4 (nog niet gestart)

Bewust nog niet oppakken — komt aan de beurt ná de huidige [roadmap_v3.md](roadmap_v3.md). Volgt
dezelfde werkafspraak (spec/plan eerst, dan pas bouwen — zie "Overige afspraken" in
[CLAUDE.md](CLAUDE.md)) zodra dat zover is.

> "v4" is hier, net als bij v3, een roadmap-generatienaam, geen belofte dat deze items als
> `v4.0.0` uitkomen — sinds de overstap naar echte [semantic versioning](CLAUDE.md)
> (§ Versionering) bepaalt de aard van elke individuele wijziging het MAJOR/MINOR/PATCH-cijfer bij
> release, niet welk roadmap-bestand 'm bevat.

Met Mike geprioriteerd op 3 augustus 2026, verplaatst vanuit roadmap_v3.md (deels uit de
confirmed-lijst, deels uit de toen nog ongefilterde "Ideeën van Claude"-sectie — met deze keuze
gelden onderstaande punten allemaal als besproken/geaccordeerd, niet meer als los idee).

- [ ] **Per-fase fout-/vlagindicatoren + neutrale stroom** (`a_errors`/`a_flags`/`b_*`/`c_*`/
      `n_current`/`n_errors`/component-brede `errors`) — uit de Shelly-audit. Waardevol (directe
      device-eigen overvoltage/overcurrent/overpower/bekabelingsfout-detectie). **Telegraf-
      verificatie afgerond (24 juli 2026)**: bevestigd dat de array-velden stilzwijgend verdwijnen
      met de huidige `json`-parser-config — een `json_v2`-parser-wissel + een omzetting naar
      losse boolean-/string-velden is nodig (InfluxDB kent geen array-veldtype). Hangt bovendien
      samen met het inmiddels afgeronde "Notificatiekanaal voor alerting"-item (zie
      roadmap_v3.md) — die basis staat er nu, dus dit kan er nu op voortbouwen. Korte spec (geen
      mockup, backend-first): zie [specs/backend-only-specs.md](specs/backend-only-specs.md),
      sectie 1.
- [ ] **`EMData`-component-brede `errors`** (`database_error`/`ct_type_not_set`) — zelfde
      array-kanttekening als hierboven, ook geverifieerd (zelfde bevinding), device-zelfdiagnose,
      lage prioriteit. Korte spec: [specs/backend-only-specs.md](specs/backend-only-specs.md),
      sectie 2.
- [ ] **Interval-aggregaten** (`EMData.GetRecords`/`GetData`/`GetNetEnergies`: min/max/gemiddelde
      per fase, reactief vermogen) — komen niet binnen via de huidige MQTT-architectuur, vereisen
      een fundamenteel andere ophaalmethode (HTTP-polling of een Shelly Script). Alleen oppakken bij
      concrete behoefte, bijv. vanuit een rijker PDF-rapport. Korte spec:
      [specs/backend-only-specs.md](specs/backend-only-specs.md), sectie 3.
- [ ] **Generator-EM-rework-vervolg: native telemetrie-protocolintegratie.** Bewust uitgesteld
      tijdens de Generator-EM-rework — generators die niet via Shelly+CT-klem maar via een eigen
      protocol uit te lezen zijn. Bevestigd: er zijn CAN-bus/J1939-generators in het park.
      Conceptspec geconsolideerd in
      [specs/backend-only-specs.md](specs/backend-only-specs.md), sectie 4.
- [ ] **Brandstof-/onderhoudstracking per generator.** Draaiuren, brandstofniveau, laatste
      onderhoud, met een refuel-alert. Sluit aan bij de bestaande generator-rating-structuur. Voor
      generators met CAN-bus (J1939) zit deze data er mogelijk al in — zie de conceptspec bij
      "Generator-EM-rework-vervolg" hierboven. Spec + mockup: zie
      [specs/brandstof-onderhoud-plan.md](specs/brandstof-onderhoud-plan.md).
- [ ] **Batterij state-of-charge.** Voor losse batterijen/piekscheerders is nu alleen stroom/
      belasting zichtbaar, niet hoeveel capaciteit er nog in zit. Spec + mockup: zie
      [specs/batterij-soc-plan.md](specs/batterij-soc-plan.md).
- [ ] **Voorspellende piekbelasting.** Op basis van historische data van vorige edities (zelfde
      editie-tag) een verwacht piekmoment tonen, bijv. "foodtrucks pieken meestal rond 18:00".
      Spec + mockup: zie
      [specs/voorspellende-piekbelasting-plan.md](specs/voorspellende-piekbelasting-plan.md).
- [ ] **Brandstofkosten/CO2 in het PDF-rapport.** Logische aanvulling op de bestaande
      generator-energietotalen. Spec + mockup: zie
      [specs/brandstofkosten-co2-plan.md](specs/brandstofkosten-co2-plan.md).
- [ ] **QR-code voor generators/batterijen.** Bewust uitgesteld (4 augustus 2026) tijdens het
      afhandelen van [specs/vervolgticket-commit-37d57ff.md](specs/vervolgticket-commit-37d57ff.md)
      — de v3-implementatie van "QR-code per kast" ([specs/qr-code-plan.md](specs/qr-code-plan.md))
      sluit generators/batterijen bewust uit (geen mockup/ontwerp voor die variant). Dit item is
      de losse vervolgstap om die uitbreiding alsnog te ontwerpen, mocht daar behoefte aan blijken
      — geen spec/mockup nu.
- [ ] **Benamingschema voor PNG-downloads bedenken.** Vandaag krijgen niet alle PNG-downloads een
      onderscheidende bestandsnaam: een grafiek (`grafieken.js`) heet altijd letterlijk
      `grafiek.png`, ongeacht welke kast/generator/periode/grafiektype het is — elke download
      overschrijft dus dezelfde naam, niet meer te onderscheiden zonder handmatig hernoemen. Een
      QR-code-download (`qrcodes.js`) heeft al wel een onderscheidende naam
      (`qr-<afkorting-of-id>.png`). Uitzoeken welk schema logisch is (bijv. kastnaam/-afkorting +
      grafiektype + periode) en dat toepassen waar het ontbreekt — geen spec/mockup nu.
- [x] **Meer opties + dropdown voor het live-venster op het Grafieken-tabblad (tweak, geen spec
      nodig).** Afgerond — Mike vond 5/15/30/60 min te weinig keus. Erbij: 2/3/6/12 uur, en de
      losse knoppenrij is vervangen door één dropdown (`#grafLiveVensterSelect`, zelfde stijl als de
      Editie-select ernaast). De client-side rolling buffer (`liveBuffer`, grafieken.js) ging van een
      vaste 60 minuten retentie naar 12 uur om de langere vensters ook daadwerkelijk te vullen, met
      een nieuwe harde limiet van 3000 punten per kast/generator (`LIVE_BUFFER_MAX_PUNTEN`) als
      geheugengrens onafhankelijk van de publicatiefrequentie — anders zou het optionele
      snelheidsscript (~1 bericht/seconde) over 12 uur al ruim 43.000 punten per kast opleveren. Zie
      event_dashboard.md, Grafieken-tabblad.
- [x] **Bulk-"Alle Shelly's configureren"-knop verwijderd (tweak, geen spec nodig).** Mike: gaf in
      de praktijk meer problemen dan 'm opluste — MQTT-instellingen op een fysieke Shelly wijzigen
      moet alleen na een expliciete actie per apparaat gebeuren, nooit automatisch voor meerdere
      tegelijk. Knop + overlay + de onderliggende bulk-loop (`alleShellyDoelen()`,
      `shellyBulkBtn`-handler) verwijderd uit render-beheer.js/index.html, incl. de bijbehorende
      ongebruikt geworden i18n-strings en CSS. De losse ⚙️-knop per kast/generator/lid (één
      apparaat, één expliciete klik) blijft ongewijzigd staan — dat is en blijft de bedoelde manier
      om een Shelly te (her)configureren.
