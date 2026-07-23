# Event Stroom-Dashboard — roadmap v3 (nog niet gestart)

> Voor omschrijving en featurelijst: zie [event_dashboard.md](event_dashboard.md). Voor de
> afgeronde v2-roadmap: zie [roadmap_v2.md](roadmap_v2.md). Overzicht van alle roadmap-bestanden:
> [roadmap.md](roadmap.md).

## Roadmap v3 (nog niet gestart)

Bewust nog niet oppakken — komt aan de beurt ná de huidige v2-roadmap. Volgt dezelfde
werkafspraak (spec/plan eerst, dan pas bouwen — zie "Overige afspraken" in
[CLAUDE.md](CLAUDE.md)) zodra dat zover is.

- [ ] **Per-fase fout-/vlagindicatoren + neutrale stroom** (`a_errors`/`a_flags`/`b_*`/`c_*`/
      `n_current`/`n_errors`/component-brede `errors`) — uit de Shelly-audit. Waardevol (directe
      device-eigen overvoltage/overcurrent/overpower/bekabelingsfout-detectie), maar eerst moet
      geverifieerd worden of Telegraf's standaard JSON-parser deze array-velden momenteel al dan
      niet stilzwijgend laat vallen. Hangt bovendien samen met het nog openstaande
      "Notificatiekanaal voor alerting"-item hierboven — niet in isolatie oppakken. Korte spec
      (geen mockup, backend-first): zie
      [specs/backend-only-specs.md](specs/backend-only-specs.md), sectie 1.
- [ ] **`EMData`-component-brede `errors`** (`database_error`/`ct_type_not_set`) — zelfde
      array-kanttekening als hierboven, device-zelfdiagnose, lage prioriteit. Korte spec:
      [specs/backend-only-specs.md](specs/backend-only-specs.md), sectie 2.
- [ ] **Interval-aggregaten** (`EMData.GetRecords`/`GetData`/`GetNetEnergies`: min/max/gemiddelde
      per fase, reactief vermogen) — komen niet binnen via de huidige MQTT-architectuur, vereisen
      een fundamenteel andere ophaalmethode (HTTP-polling of een Shelly Script). Alleen oppakken bij
      concrete behoefte, bijv. vanuit een rijker PDF-rapport. Korte spec:
      [specs/backend-only-specs.md](specs/backend-only-specs.md), sectie 3.
- [ ] **Generator-EM-rework-vervolg: native telemetrie-protocolintegratie.** Bewust uitgesteld
      tijdens de Generator-EM-rework — generators die niet via Shelly+CT-klem maar via een eigen
      protocol uit te lezen zijn. Conceptspec (CAN-bus/SAE J1939, nog niet besproken/geaccordeerd)
      geconsolideerd in [specs/backend-only-specs.md](specs/backend-only-specs.md), sectie 4.
- [ ] **Notificatiekanaal voor alerting naar telefoon.** Alert-condities in Grafana kunnen al
      aangemaakt worden; er moet nog gekozen worden welk kanaal het bericht ontvangt (opties:
      Telegram, Pushover, ntfy.sh, e-mail). Zodra dit er is, kan de "Overschrijdingen & alarmen"-
      sectie van het PDF-rapport ook echt gevuld worden i.p.v. de huidige placeholder-pagina. Hangt
      ook samen met het uitgestelde "per-fase fout-/vlagindicatoren"-punt hierboven. Spec + mockup:
      zie [specs/notificatiekanaal-plan.md](specs/notificatiekanaal-plan.md).
- [ ] **Lijnen tussen kasten aanpasbaar (bochten/knikpunten).** Op Kalibreren/Live is de lijn tussen
      een kast en zijn voedingsbron nu een rechte lijn tussen de twee pin-posities; in het echt loopt
      een stroomkabel vaak niet recht (obstakels, paden, kabelgoten, hoeken om een gebouw). Wens:
      knikpunten kunnen toevoegen/verslepen zodat de lijn de daadwerkelijke kabelroute volgt op de
      plattegrond. Raakt alleen Kalibreren/Live — niet Schema, dat is een los auto-gegenereerd
      boomdiagram zonder fysieke plaatsing. Cowork-voorstel uitgewerkt: zie
      [specs/lijnen-knikpunten-plan.md](specs/lijnen-knikpunten-plan.md).
- [ ] **Automatische back-up** (lokaal en/of naar een externe server) — vult de bestaande handmatige
      Back-up-subtab aan met een geplande, onbeheerde variant. Spec + mockup: zie
      [specs/automatische-backup-plan.md](specs/automatische-backup-plan.md).
- [ ] **Toegang van buitenaf (HQ meekijken).** Diagnose afgerond en besluiten met Mike bevestigd
      (losse accounts per persoon, HQ-pagina in een bestaande instance, handmatige locatielijst) —
      mockups (login-scherm, HQ-locatiesoverzicht) staan klaar, wachten op akkoord. Zie
      [specs/toegang-van-buitenaf-diagnose.md](specs/toegang-van-buitenaf-diagnose.md).
- [ ] **Vinkje "meetdata beschikbaar" per generator/lid.** Sommige generators hebben geen sensors, of
      (nog) geen toegang om er een Shelly aan te hangen — nu blijkt dat alleen impliciet uit een leeg
      rating (A)-veld, zonder duidelijke reden/label in de UI. Expliciet vinkje in Beheer + een
      herkenbaar "geen sensor"-label op de plekken die nu gewoon niets tonen (Live-zijlijst,
      aside-detail, schema) i.p.v. stil weglaten — zie
      [specs/generator-meetdata-vinkje-plan.md](specs/generator-meetdata-vinkje-plan.md).

## Ideeën van Claude (ongefilterd, nog niet besproken/geprioriteerd met Mike)

> Onderstaande punten zijn door Claude voorgesteld tijdens een brainstormsessie, niet door Mike
> bedacht of al geaccordeerd. Volgen dezelfde werkafspraak (spec/plan eerst, zie "Overige
> afspraken" in [CLAUDE.md](CLAUDE.md)) zodra iets hiervan opgepakt wordt — en moeten eerst nog
> besproken/geprioriteerd worden voordat ze als "echt" roadmap-item gelden.

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
- [ ] **Anomaly-detectie los van de vaste 90%-drempel.** Een plotselinge stroom-dip (kabel
      losgetrokken, generator uitgevallen) is heel iets anders dan een langzame stijging naar de
      rating, maar krijgt nu dezelfde amber/rood-behandeling. Spec + mockup: zie
      [specs/anomaly-detectie-plan.md](specs/anomaly-detectie-plan.md).
- [ ] **QR-code per kast.** Sticker op de kast zelf, scannen opent direct de databallon/status,
      zonder te zoeken in de zij-lijst. Handig voor rondlopend personeel. Spec + mockup: zie
      [specs/qr-code-plan.md](specs/qr-code-plan.md).
- [ ] **Rolverdeling/rechten.** Nu heeft iedereen die de webapp-URL heeft blijkbaar volledige
      Beheer-rechten. Voor een HQ- of multi-persoon-scenario (zie ook het "toegang van
      buitenaf"-punt) is een viewer/editor-onderscheid relevant. Spec + mockup: zie
      [specs/rolverdeling-plan.md](specs/rolverdeling-plan.md).
- [ ] **Brandstofkosten/CO2 in het PDF-rapport.** Logische aanvulling op de bestaande
      generator-energietotalen. Spec + mockup: zie
      [specs/brandstofkosten-co2-plan.md](specs/brandstofkosten-co2-plan.md).
