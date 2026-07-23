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
      "Notificatiekanaal voor alerting"-item hierboven — niet in isolatie oppakken.
- [ ] **`EMData`-component-brede `errors`** (`database_error`/`ct_type_not_set`) — zelfde
      array-kanttekening als hierboven, device-zelfdiagnose, lage prioriteit.
- [ ] **Interval-aggregaten** (`EMData.GetRecords`/`GetData`/`GetNetEnergies`: min/max/gemiddelde
      per fase, reactief vermogen) — komen niet binnen via de huidige MQTT-architectuur, vereisen
      een fundamenteel andere ophaalmethode (HTTP-polling of een Shelly Script). Alleen oppakken bij
      concrete behoefte, bijv. vanuit een rijker PDF-rapport.
- [ ] **Generator-EM-rework-vervolg: native telemetrie-protocolintegratie.** Bewust uitgesteld
      tijdens de Generator-EM-rework — generators die niet via Shelly+CT-klem maar via een eigen
      protocol uit te lezen zijn.
      **Conceptspec — CAN-bus/SAE J1939** (door Claude uitgewerkt op verzoek van Mike, nog niet
      besproken/geaccordeerd, dus nog geen "echte" spec in de zin van de werkafspraak hierboven):
      - De meeste generatoren met CAN-bus praten **SAE J1939**, een gestandaardiseerd protocol.
        Basisdata (toerental, brandstofniveau, motortemperatuur, draaiuren, oliedruk, alarmen)
        zit er als Parameter Group Numbers (PGN's) al standaard in. Fabrikant-specifieke waarden
        (custom sensoren) vereisen wel de eigen DBC/PGN-lijst van die fabrikant — dat deel is dus
        niet universeel plug-and-play.
      - **Hardware**: een USB-CAN-adapter (bijv. CANable, Innodisk EMUC-B202, ViewTool Ginkgo)
        die op Linux native als SocketCAN-device verschijnt, aangesloten op de CAN-H/CAN-L-lijnen
        van de generator (vaak een Deutsch 9-pins J1939-connector).
      - **Software**: `python-can` + de `can-j1939`-library (PyPI) decoderen de PGN's naar
        leesbare waarden. Geen kant-en-klare J1939→MQTT-bridge gevonden bij het uitzoeken hiervan —
        zelf te bouwen door `can-j1939` te combineren met `paho-mqtt`, qua omvang vergelijkbaar met
        de bestaande `telegraf-herstarter`- of simulator-service. Publiceert op een eigen
        MQTT-topic, Telegraf pikt het net als de Shelly-data op, komt zo gewoon in
        InfluxDB/Grafana terecht.
      - Raakt ook het "Brandstof-/onderhoudstracking"-idee hieronder (Ideeën van Claude) —
        draaiuren/brandstofniveau/motortemperatuur zitten al in de J1939-data, geen aparte sensor
        nodig als de generator toch al CAN-bus heeft.
- [ ] **Notificatiekanaal voor alerting naar telefoon.** Alert-condities in Grafana kunnen al
      aangemaakt worden; er moet nog gekozen worden welk kanaal het bericht ontvangt (opties:
      Telegram, Pushover, ntfy.sh, e-mail). Zodra dit er is, kan de "Overschrijdingen & alarmen"-
      sectie van het PDF-rapport ook echt gevuld worden i.p.v. de huidige placeholder-pagina. Hangt
      ook samen met het uitgestelde "per-fase fout-/vlagindicatoren"-punt hierboven.
- [ ] **Lijnen tussen kasten aanpasbaar (bochten/knikpunten).** Op Kalibreren/Live is de lijn tussen
      een kast en zijn voedingsbron nu een rechte lijn tussen de twee pin-posities; in het echt loopt
      een stroomkabel vaak niet recht (obstakels, paden, kabelgoten, hoeken om een gebouw). Wens:
      knikpunten kunnen toevoegen/verslepen zodat de lijn de daadwerkelijke kabelroute volgt op de
      plattegrond. Raakt alleen Kalibreren/Live — niet Schema, dat is een los auto-gegenereerd
      boomdiagram zonder fysieke plaatsing. Dit is in de kern een bewerkinteractie-ontwerpvraag
      (hoe voeg je een knikpunt toe, hoe versleep/verwijder je 'm) — eerst een Cowork-voorstel nodig
      vóór Code het datamodel (knikpunten waarschijnlijk als extra percentage-coördinaten per lijn,
      zie de percentage-plaatsing-afspraak in CLAUDE.md) en de opslag invult.
- [ ] **Automatische back-up** (lokaal en/of naar een externe server) — vult de bestaande handmatige
      Back-up-subtab aan met een geplande, onbeheerde variant. Nog te bepalen: frequentie, lokale
      bestemming, externe-bestemming-protocol, bewaartermijn/rotatie.
- [ ] **Toegang van buitenaf (HQ meekijken).** Drie mogelijke richtingen, nog open: (a) gewoon
      externe toegang tot deze ene lokale instance, (b) deze app blijft puur lokaal/per locatie en
      HQ krijgt een aparte instance die meerdere locaties samenbrengt, (c) alles in één app: dezelfde
      instance kan zowel lokaal per-locatie als (met deze extra features) een multi-locatie
      HQ-aanzicht zijn. Aanzienlijke architectuurvraag (multi-instance-aggregatie/beveiliging), eerst
      een diagnose met Mike vóór er een voorstel komt.
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
      "Generator-EM-rework-vervolg" hierboven.
- [ ] **Batterij state-of-charge.** Voor losse batterijen/piekscheerders is nu alleen stroom/
      belasting zichtbaar, niet hoeveel capaciteit er nog in zit.
- [ ] **Voorspellende piekbelasting.** Op basis van historische data van vorige edities (zelfde
      editie-tag) een verwacht piekmoment tonen, bijv. "foodtrucks pieken meestal rond 18:00".
- [ ] **Anomaly-detectie los van de vaste 90%-drempel.** Een plotselinge stroom-dip (kabel
      losgetrokken, generator uitgevallen) is heel iets anders dan een langzame stijging naar de
      rating, maar krijgt nu dezelfde amber/rood-behandeling.
- [ ] **QR-code per kast.** Sticker op de kast zelf, scannen opent direct de databallon/status,
      zonder te zoeken in de zij-lijst. Handig voor rondlopend personeel.
- [ ] **Rolverdeling/rechten.** Nu heeft iedereen die de webapp-URL heeft blijkbaar volledige
      Beheer-rechten. Voor een HQ- of multi-persoon-scenario (zie ook het "toegang van
      buitenaf"-punt) is een viewer/editor-onderscheid relevant.
- [ ] **Brandstofkosten/CO2 in het PDF-rapport.** Logische aanvulling op de bestaande
      generator-energietotalen.
