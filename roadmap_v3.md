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
- [x] **Toegang van buitenaf (HQ meekijken).** Afgerond — login-laag, accounts, beveiligde
      MQTT-proxy, HQ-Locaties-pagina én de Caddy-TLS/reverse-proxy-laag staan allemaal, over drie
      ticketrondes grondig gefixt en (na het Caddy-herstel hieronder) opnieuw end-to-end getest.
      **Correctie (6 augustus 2026)**: de eerdere "scope-inperking" die hier stond — Caddy/de
      publieke-internet-laag weer verwijderen — bleek op een misverstand te berusten. Mike's
      verzoek "de wrapper die om de docker heen zit weg halen" sloeg op `start.sh` (het
      LAN-IP-detectiescriptje), niet op Caddy; publieke bereikbaarheid moet gewoon beschikbaar
      blijven. De verwijdering (commits `f567e17`/`a13b913`) is teruggedraaid conform
      [specs/caddy-herstel-plan.md](specs/caddy-herstel-plan.md), met behoud van de legitieme
      ronde-2-productiefixes die in diezelfde commits zaten (die hoefden niet te wijzigen, zie
      hieronder). `trust proxy` staat weer aan (terecht: Caddy is de enige, vertrouwde hop ervoor).
      Bij het herstellen bleek een **nieuwe bug** (nooit eerder end-to-end getest, want dat kon pas
      nadat de service ooit echt draaide): `docker-compose.yml` zette `PUBLIC_DOMEIN` altijd als
      env-var op de `caddy`-service, ook leeg — Caddy's eigen `{$PUBLIC_DOMEIN:localhost}`-fallback
      in `caddy/Caddyfile` valt alleen terug op de default als de variabele volledig ontbreekt, niet
      als 'm leeg-maar-gezet is, dus zonder een ingevuld `PUBLIC_DOMEIN` in `.env` crashte Caddy in
      een restart-loop ("unrecognized global option: reverse_proxy" — een lege site-adres-regel werd
      als het globale-opties-blok geparsed). Gefixt door de default op compose-niveau te leggen
      (`PUBLIC_DOMEIN=${PUBLIC_DOMEIN:-localhost}`). Geverifieerd met een echte
      `docker compose --profile publiek up -d`: Caddy start en blijft stabiel draaien (self-signed
      "localhost"-certificaat zonder een echt `PUBLIC_DOMEIN`), `https://localhost` proxied correct
      naar de webapp, inloggen via Caddy geeft een `secure`-cookie terwijl rechtstreeks inloggen op
      `http://localhost:8080` tegelijkertijd een niet-secure cookie blijft geven (beide toegangswegen
      werken naast elkaar), een vervalste `X-Forwarded-For` via Caddy heeft geen effect op de
      rate-limiters (alleen Caddy's eigen, correcte hop wordt vertrouwd), de MQTT-websocket-upgrade
      komt door Caddy heen tot aan de ticket-check in `server.js`, en de volledige regressietest
      (alle tabbladen) slaagt met Caddy actief. De eerdere "derde reviewronde"/productie-
      gereedheidsconclusie ging uit van de (onterechte) lokaal-netwerk-only-scope — zie
      [specs/productie-gereedheid-analyse-toegang-van-buitenaf.md]
      (specs/productie-gereedheid-analyse-toegang-van-buitenaf.md) voor die (deels achterhaalde)
      analyse; met Caddy nu hersteld én opnieuw getest geldt de kernconclusie ("geen resterende
      code-blokkers") weer, inclusief de publieke-bereikbaarheid-laag.
      **Eerste ticketronde** (6 augustus 2026) vond een **kritieke bug**: de login-laag was met een
      hoofdletter in het pad te omzeilen (`/API/...` matchte de route wél maar de auth-gate niet,
      Express routeert standaard case-insensitive) — zonder in te loggen was hiermee o.a. een
      account aan te maken en de hele Beheer-laag te benaderen. Direct en geïsoleerd gefixt en
      hertest (hoofdletter-gegate-check op alle varianten, `case sensitive routing` als tweede,
      onafhankelijke laag). Zes verdere punten meegenomen in dezelfde ronde: `SESSION_SECRET`
      genereert nu zichzelf bij een ontbrekende `.env`-waarde i.p.v. een hardcoded fallback; het
      MQTT-ticket is nu eenmalig/kortlevend (30s) en `mqtt.js` vraagt een vers ticket per
      (her)verbinding — tijdens het testen bleek daarbovenop een **tweede, diepere bug**: mqtt.js'
      `reconnectPeriod:0` bleek in de praktijk niet te voorkomen dat de onderliggende
      websocket-stream zelf op transportniveau bleef doorproberen met een allang verlopen ticket,
      zonder ooit een client-event te vuren — opgelost met een eigen watchdog-timer die de client
      hoe dan ook na 10s hard afsluit en zelf opnieuw begint; `/mqtt` zelf zit ook achter de
      auth-gate; simpele rate-limiters op `/api/login` (20/15 min) en `/api/hq-status` (30/min) +
      een generieke foutmelding i.p.v. de ruwe Influx-fout. Kleinere punten: stored-XSS-escape in
      `accounts.js`/`hq-locaties.js`, `accounts.json`/`locaties.json` nu ook in de
      back-up-/restore-flow, verouderde `mosquitto.conf`-comment bijgewerkt. Zie
      [specs/vervolgticket-toegang-van-buitenaf.md](specs/vervolgticket-toegang-van-buitenaf.md).
      **Tweede ticketronde** (6 augustus 2026, "is dit klaar voor productie?") bevestigde de
      hoofdletterbug-fix grondig (tientallen padvarianten getest) en vond vier nieuwe blokkers, alle
      vier direct gefixt en empirisch hertest: (1) `INTERNAL_API_TOKEN` accepteerde de letterlijke
      `.env.example`-placeholderwaarde als geldig servicegeheim — een niet-overschreven placeholder
      telt nu als "niet ingesteld" (zelfde voor `SESSION_SECRET`, uit voorzorg, al niet expliciet
      gemeld); (2) de MQTT-reconnect-fix uit ronde 1 werkte niet ná een geslaagde verbinding —
      `mqtt.js` zette een "afgehandeld"-vlag permanent op `true` zodra 'm ooit gelukt was, waardoor
      een latere verbindingsdrop (broker-herstart, netwerkstoring) nooit meer tot een nieuwe poging
      leidde en de statusstip stil "verbonden"/groen bleef tonen met bevroren data — vlag wordt nu
      per verbindingspoging teruggezet, geverifieerd met een echte mosquitto-herstart tijdens een
      actieve verbinding (stip viel binnen 4s terug naar "niet verbonden" en herstelde zichzelf 3s
      later, zonder page-reload); (3) de sessiecookie's `secure`-vlag hing af van een globale
      `PUBLIC_DOMEIN`-schakelaar i.p.v. het daadwerkelijke protocol van de binnenkomende request —
      nu gebaseerd op `req.secure` (via `req.sessionOptions`, cookie-session's per-request
      cookie-optiehaak), geverifieerd dat zowel een gewone HTTP-request (geen `secure`-vlag, geen
      loginloop) als een gesimuleerde `X-Forwarded-Proto: https`-request (wél `secure`-vlag) correct
      werken; (4) Grafana's ntfy-webhook (`/api/notificaties/grafana-webhook`) kreeg sinds de
      login-laag 401 — een eerder afgerond item (het ntfy-notificatiekanaal) stond daardoor
      stilzwijgend stil. Grafana authenticeert die aanroep nu met `INTERNAL_API_TOKEN` via
      `Authorization: Bearer` (contact-point-provisioning uitgebreid met
      `authorization_scheme`/`authorization_credentials`), geverifieerd met een echt bericht dat op
      een test-ntfy.sh-topic aankwam. Niet-blokkerende hardeningspunten uit hetzelfde ticket ook
      meegenomen: `NODE_ENV=production` + een generieke laatste error-handler (geen stacktraces
      meer), `/mqtt/`-varianten met trailing slash/extra pad-segment vallen nu ook onder de
      auth-gate, en de README-firewall-paragraaf is bijgewerkt naar de huidige poortsituatie. Zie
      [specs/vervolgticket-toegang-van-buitenaf-ronde2.md]
      (specs/vervolgticket-toegang-van-buitenaf-ronde2.md).
      **TLS/reverse-proxy**: optionele `caddy`-service (alleen gestart met
      `docker compose --profile publiek up -d`, lokaal ontwikkelen blijft gewoon op
      `http://localhost:8080`) voor als deze locatie-instance ook over het publieke internet
      bereikbaar moet zijn — automatisch Let's Encrypt-certificaat via een ingesteld
      `PUBLIC_DOMEIN`, websocket-upgrades (inclusief `/mqtt`) werken vanzelf zonder aparte config.
      `trust proxy` staat aan (`app.set('trust proxy', 1)`) — Caddy is de enige vertrouwde hop ervoor
      en zet `X-Forwarded-Proto`/`-For` zelf correct, waardoor zowel de secure-cookie-vlag
      (`req.secure`) als de IP-rate-limiters kloppen voor beide toegangswegen tegelijk (rechtstreeks
      op :8080 en via Caddy op :443).
      **Login + accounts**: `cookie-session` (signed cookie — alleen ondertekend, niet versleuteld;
      de payload is enkel een account-id, geen geheim, dus leesbare base64 is geen lek — geen
      server-side sessieopslag), wachtwoorden gehashed met `bcryptjs`. Eerste-opstart maakt automatisch één
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
      geen browser-sessie heeft) authenticeert zichzelf met een gedeeld `INTERNAL_API_TOKEN` —
      hetzelfde token wordt sinds ronde 2 ook door Grafana's ntfy-webhook gebruikt.
      **HQ-Locaties-pagina**: nieuwe subtab onder Rapportages — een handmatige locatielijst
      (naam + URL) met live statuskaarten (kasten-aantal, aantal amber/rood, "Beheer openen"-link
      naar de volledige app van die locatie). Elke locatie-instance krijgt een nieuw, publiek
      (ongeauthenticeerd, geeft alleen tellingen terug) `/api/hq-status`-endpoint; de HQ-instance
      haalt dat server-naar-server op per bekende locatie, met een timeout per locatie zodat één
      onbereikbare locatie de rest niet blokkeert (toont dan een grijze "offline"-kaart). Werkt
      zolang de HQ-instance en de locatie-instances op hetzelfde netwerk/VPN zitten.
      **Derde reviewronde / Caddy-herstel (6 augustus 2026, "is dit klaar voor productie?")**:
      de eerdere versie van deze conclusie ging uit van de (onterecht) verwijderde Caddy-laag
      ("lokaal-netwerk-only" scope) — met Caddy hersteld (zie hierboven) is die scope niet meer van
      toepassing, en is opnieuw end-to-end getest onder de juiste (Caddy-inclusief) scope: Caddy
      start en blijft stabiel draaien, TLS-config is valide, secure-cookies werken correct via zowel
      Caddy als het rechtstreekse LAN-pad, rate-limiters blijven correct (niet omzeilbaar via een
      vervalste header), MQTT-websocket-upgrades komen door Caddy heen, en de volledige regressietest
      slaagt. Geen resterende code-blokkers. De destijds gevonden deploy-aandachtspunten blijven
      gelden (geen codewerk, wel niet vergeten bij het opzetten): `INTERNAL_API_TOKEN` invullen in
      `.env`; na opstarten eenmalig Beheer → Alert-notificaties → "Wijzigingen doorvoeren" klikken
      (dat is het moment waarop Grafana's ntfy-contact-point het `Authorization: Bearer`-token
      krijgt); bouwen met `docker compose build`/`up --build`, niet alleen `up -d`. Zie
      event_dashboard.md voor de volledige featurebeschrijving.
- [x] **LAN-IP-detectie verplaatsen naar de container.** Afgerond — gebouwd conform
      [specs/lan-ip-detectie-verplaatsen-plan.md](specs/lan-ip-detectie-verplaatsen-plan.md), Mike's
      oorspronkelijke verzoek dat aanvankelijk verkeerd begrepen werd als de Caddy-verwijdering
      hierboven (zie de correctie daar): de losse `start.sh`/`start.ps1`-wrapperscripts (detecteerden
      op de host het LAN-IP en riepen dan pas `docker compose` aan) zijn verwijderd — `docker
      compose ...` rechtstreeks aanroepen is nu genoeg. De LAN-IP-detectie zelf blijft bestaan maar
      verhuist naar een nieuwe, eenmalige `lan-ip-detector`-service in `docker-compose.yml`
      (`network_mode: host`, ziet zo de echte host-netwerkinterfaces) die het gedetecteerde adres
      naar een gedeeld volume-bestand schrijft; `webapp` mount dat volume read-only en wacht erop via
      `depends_on: condition: service_completed_successfully` vóórdat 'ie zelf opstart. Bewust
      alléén deze kleine wegwerp-service in host-netwerkmodus — `webapp` zelf blijft op het gewone
      Docker-bridge-netwerk, dus alle bestaande service-naam-DNS (`influxdb:8086`, `mosquitto:1883`,
      enz.) is ongewijzigd blijven werken. `webapp/server.js` leest voortaan het gedeelde bestand
      i.p.v. de vervallen `HOST_LAN_IP`-env-var. Geverifieerd: opstartvolgorde klopt (detector
      draait en sluit af vóórdat webapp start), het bestand komt read-only aan bij de webapp, de
      juiste waarde verschijnt in de opstartlogs, de volledige regressietest slaagt, en de combinatie
      met `--profile publiek` (Caddy) geeft geen opstartconflict. De QR-code-deeplinks zijn
      hierdoor niet geraakt — die gebruiken `location.origin` uit de browser zelf, nooit de
      server-side LAN-IP-waarde. Kanttekening: end-to-end getest op deze (Windows/Docker Desktop/
      WSL2-)ontwikkelmachine, waar het gedetecteerde adres de interne WSL-VM-IP is, niet het echte
      LAN-adres van de Windows-host — de daadwerkelijke juistheid van het gedetecteerde adres is dus
      pas op de échte Linux-productiemachine te bevestigen (de mechaniek zelf — detecteren, wegschrijven,
      uitlezen, tonen — is wel volledig geverifieerd).
- [x] **Kritieke regressie: fysieke Shelly's konden niet meer met de broker verbinden.** Afgerond —
      gevonden tijdens het uitwerken van
      [specs/shelly-auto-configuratie-plan.md](specs/shelly-auto-configuratie-plan.md) (7 augustus
      2026), los van die feature. Sinds commit `721172c` ("Toegang van buitenaf") had
      `docker-compose.yml`'s `mosquitto`-service geen `ports:`-mapping meer — bedoeld om de browser
      niet meer rechtstreeks met mosquitto te laten verbinden (die gaat terecht via de webapp's
      `/mqtt`-proxy), maar een **fysieke Shelly is geen browser**: die praat rechtstreeks TCP/MQTT
      naar `<host>:1883` en kan onmogelijk via een sessie-gegate websocketproxy. Met 1883 dicht was
      er sinds die commit domweg geen enkele fysieke Shelly meer bereikbaar — niet opgemerkt door de
      drie latere code-review-rondes op "Toegang van buitenaf" (die waren gericht op auth/security
      van de webapp zelf, niet op de fysieke-apparaten-kant). Gefixt: `1883:1883` weer gepubliceerd
      (bewust **niet** 9001/websockets, die blijft terecht dicht — dat is nu de webapp-proxy).
      `allow_anonymous true` blijft ongewijzigd, zelfde vertrouwensmodel als poort 8080. README's
      firewall-paragrafen (§1, §15) behandelen 1883 nu hetzelfde als 8080: lokaal-netwerk-only, nooit
      naar het publieke internet routeren. Geverifieerd met een echte `mosquitto_pub`/`mosquitto_sub`
      vanaf een los, extern proces (niet vanuit de container) naar `<host>:1883` — publiceren en
      ontvangen werkt weer. Volledige regressietest slaagt.
- [x] **MQTT-prefix zichtbaar+kopieerbaar + twee kleine UI-bugfixes.** Afgerond — gebouwd conform
      [specs/mqtt-configuratie-plan.md](specs/mqtt-configuratie-plan.md) en
      [specs/vervolgticket-ui-schaal-en-qr-sticker.md](specs/vervolgticket-ui-schaal-en-qr-sticker.md)
      (beide 7 augustus 2026, Mike). Het handmatig *bewerkbaar* maken van het MQTT-prefix is bewust
      geschrapt (zie de correctie in het eerste document) — met Shelly-auto-configuratie in het
      vooruitzicht (hieronder) is een losse handmatige-override-route overbodig, dit item dekt
      alleen zichtbaar+kopieerbaar maken.
      **MQTT-prefix**: een 📋-knop naast het Shelly-IP-veld bij elke kast/generator/lid kopieert de
      server-berekende `mqtt_topic_prefix` naar het klembord (`navigator.clipboard`, stil falen als
      geblokkeerd — de waarde staat toch al zichtbaar in het veld ernaast, zelfde patroon als de
      account-wachtwoord-kopieerknop). Blijft alleen-lezen. README §3 herschreven met de
      authenticatie-/SSL-toggle-uitleg die eerder ontbrak (getoetst aan Shelly's officiële
      Gen2+-API-documentatie) en verwijst nu naar de kopieerknop als makkelijkste weg.
      **Kasten-tabel-overflow**: root cause gevonden — `.ksectie{overflow:hidden}` (voor de
      afgeronde hoeken van de sectie) kapte zonder scroll-wrapper ook alle tabelinhoud breder dan de
      sectie hard af, zonder scrollbalk; met de huidige kolommen (ruim 1150px aan expliciete
      min-widths) paste dat niet meer op een kleiner scherm, dus juist de latere kolommen (Generator,
      Gevoed vanaf, Acties) werden afgekapt. Gefixt met een eigen `overflow-x:auto`-wrapper om de
      tabel specifiek, `.ksectie` zelf hoeft niet te veranderen. Geverifieerd op een 1280px-breed
      venster: scrollWidth (1190px) > wrapper clientWidth (938px), en na scrollen is de laatste
      kolomkop (Acties) weer volledig binnen beeld.
      **Vervolgronde (7 augustus 2026)**: Mike meldde met screenshot dat de tabel op zijn scherm
      nog steeds hard afgekapt werd, zonder scrollbalk — de wrapper-fix hierboven klopte op
      zichzelf, maar miste een laag hoger. Gebouwd conform
      [specs/vervolgticket-ui-schaal-ronde2.md](specs/vervolgticket-ui-schaal-ronde2.md):
      `.beheer` is een flex-item in een rij-layout (`.body`) zonder `min-width:0` — een flex-item
      krijgt standaard `min-width:auto`, dus mag nooit smaller worden dan de intrinsieke breedte
      van zijn inhoud. Met de brede kasten-tabel als inhoud werd `.beheer` zelf breder dan de
      viewport geduwd, waardoor de `overflow-x:auto`-wrapper om de tabel niets had om tegen te
      scrollen (die meet t.o.v. `.beheer`'s al te brede breedte, niet t.o.v. de viewport) — zelfde
      onderliggende mechanisme als de bestaande `.body`/`.grafbody`-`min-height:0`-toepassingen,
      hier alleen gemist voor de horizontale variant. Eén regel gefixt: `min-width:0` (+ expliciete
      `overflow-x:auto`) op `.beheer` zelf. Geverifieerd op een écht verkleind browservenster
      (1280px, geen devtools-emulatie): `.beheer` groeit niet meer mee met de tabel
      (scrollWidth = clientWidth = viewportWidth = 1280), de tabel-wrapper scrollt weer correct
      (1211px inhoud binnen een 938px wrapper), en de laatste kolomkop (Acties) valt na scrollen
      volledig binnen de viewport. Accounts-tabel en generatorentabel blijven ongewijzigd zonder
      onnodige scroll op normale breedte. Volledige regressietest slaagt.
      **Losse QR-sticker**: de bestaande "Printen"-knop in de QR-overlay hergebruikte de 4-koloms-
      bulk-sheet-layout voor maar 1 item (bijna leeg vel, klein stickertje in de hoek). Nieuwe
      `printEnkeleSticker()`-functie: één groot (350px), gecentreerd QR-blok met naam/afkorting
      eronder, geen grid — bruikbaar om direct uit te knippen of op een labelvel te plakken.
      "Alle QR-codes printen" (bulk) blijft ongewijzigd de 4-koloms-sheet. Volledige regressietest
      slaagt voor alle drie punten. Zie event_dashboard.md, Topologiebeheer (Beheer-tabblad).
- [x] **Shelly's automatisch configureren vanuit Beheer.** Afgerond — gebouwd conform
      [specs/onderzoek-shelly-auto-configuratie.md](specs/onderzoek-shelly-auto-configuratie.md)
      (onderzoek, geaccordeerd) en
      [specs/shelly-auto-configuratie-plan.md](specs/shelly-auto-configuratie-plan.md) (7 augustus
      2026, Mike). Nieuwe server-side module `webapp/shelly-rpc.js`: alle aanroepen via
      `POST http://<shelly-ip>/rpc` (Node's ingebouwde fetch, 5s timeout per aanroep) tegen de
      Shelly Gen2+ lokale RPC-API — `MQTT.SetConfig` (broker + topic-prefix) → `Shelly.Reboot` →
      pollen op `MQTT.GetStatus` (elke 2s, max 20s, timeout ≠ harde fout) → optioneel het
      snelheidsscript (`shelly/em-fast-publish.js`) via `Script.List`/`Create`/`Stop`(als al
      lopend)/`PutCode` (chunks van 1024 bytes, zelfde patroon als Shelly's eigen upload-tooling)/
      `SetConfig`/`Start`. Nieuw `POST /api/shelly/configureren`-endpoint (`doelType:'kast'|
      'generator'|'lid'`) — bewust **geen** `shelly_ip`/`mqtt_topic_prefix` in de request-body, de
      server zoekt die zelf op via `readTopo()` (voorkomt een SSRF-hefboom: nooit een door de
      client aangeleverd IP-adres direct aanroepen). Broker-host komt uit de bestaande
      `bepaalHostLanIp()` (lan-ip-detector-bestand); ontbreekt die, dan een duidelijke 400 i.p.v.
      een zinloze configuratie versturen. Bulk is bewust client-side (de browser roept het endpoint
      na elkaar aan, max. 2 tegelijk) — geen apart bulk-endpoint/SSE-infrastructuur.
      **UI**: een ⚙️-knop (+ "ook script"-vinkje, standaard aan) naast elke rij met een ingevuld
      Shelly-IP (kast/generator/lid), met een klein toastje met een client-side benaderde
      voortgangstekst (géén echte server-streaming, zie het plan) en het uiteindelijke resultaat
      (MQTT-/scriptstatus apart). "Alle Shelly's configureren" boven de generatorentabel opent een
      overlay met een rij per apparaat en een live-bijwerkend statusicoontje.
      **Kritieke, losstaande bevinding tijdens het uitwerken**: mosquitto-poort 1883 bleek al sinds
      een eerdere commit niet meer gepubliceerd — apart, met voorrang gefixt (zie het item
      hierboven in deze roadmap).
      **Getest** met een gemockte lokale RPC-server (geen fysieke Shelly nodig): volledige
      happy-path-flow (exacte RPC-volgorde geverifieerd via een call-log, chunked script-upload
      reconstrueert het bestand byte-perfect), idempotentie (tweede aanroep op een al-geconfigureerd
      apparaat gebruikt `Script.Stop` + hetzelfde script-id, geen dubbel script), timeout-
      foutafhandeling (onbereikbaar IP, 5s), ontbrekend-shelly-ip/ongeldig-doelType/onbekend-id
      (400/404), en het ontbrekend-LAN-IP-scenario (400). UI end-to-end getest met **strikt
      op naam/id gescopede selectors** (nooit een blinde eerste-match-selector) — een eerdere
      testrun raakte per ongeluk een echt, fysiek apparaat van Mike (verkeerd broker-adres gezet
      door de bekende WSL2/Docker-Desktop-lan-ip-detector-beperking) en is ter plekke hersteld en
      geverifieerd (opnieuw verbonden, live meetdata bevestigd op de broker); nadien is elke
      testinteractie herbouwd om alleen op een uniek-geïdentificeerde, tijdelijke testrij te kunnen
      klikken. Volledige regressietest slaagt. Zie event_dashboard.md, Topologiebeheer
      (Beheer-tabblad).
- [x] **Bestaande generators samenvoegen tot een groep ("Power Plant").** Afgerond — gebouwd
      conform
      [specs/generator-groep-powerplant-plan.md](specs/generator-groep-powerplant-plan.md). Nieuw
      `POST /api/generators/groeperen`-endpoint: neemt ≥2 bestaande, niet-al-groep generator-ids +
      een naam (en optioneel vermogen_kva/groep_soort), maakt daar één nieuwe `type:'groep'`-
      generator van (de geselecteerde generators worden leden, hun kVA's opgeteld als default), en
      verhuist elke kast die eronder hing mee naar de nieuwe groep (`kast.generator` + herberekende
      `mqtt_topic_prefix`, hergebruikt hetzelfde patroon als `PUT /api/kasten/:id`). Alle validatie
      (onbekend id, dubbel id, al-een-groep, <2 selectie) gebeurt vóórdat er iets aan de data
      verandert, en alles wordt in één `writeTopo()`-call weggeschreven — een mislukte aanvraag
      (bijv. een ongeldig id ertussen) wijzigt daardoor niets, geen half-gemigreerde toestand.
      UI in Beheer boven de generatorentabel: "Generators groeperen"-knop zet een selectiemodus aan
      (checkbox per rij, groepen zelf tonen een niet-klikbare "—" i.p.v. een checkbox — geen
      geneste groepen), een actiebalk verschijnt zodra ≥2 aangevinkt zijn, en een bevestigingsdialoog
      (hergebruikt de bestaande `.qroverlay`-stijl) toont een verplichte waarschuwing over hoeveel
      kasten van MQTT-topic wisselen vóórdat er bevestigd kan worden. Getest tegen de live stack met
      losse, tijdelijke test-generators/-kasten (nooit tegen Mike's echte topologie): een
      2-generator-samenvoeging met elk een eigen kast eronder — beide kasten hangen ná het
      samenvoegen onder de nieuwe groep met bijgewerkt `mqtt_topic_prefix`, de oude generator-ids
      bestaan niet meer, kVA-optelling klopt (100+200=300), zowel het te-korte-selectie- als het
      onbekend-id-foutscenario wijzigen niets; en de volledige UI-flow (generators aanmaken →
      selecteren → dialoog → bevestigen → nieuwe groep verschijnt met "2 leden ▾") zonder
      console-errors. Volledige regressietest slaagt. Ongroeperen (terug uitsplitsen) en geneste
      groepen zijn bewust niet meegenomen, net als in de spec. Zie event_dashboard.md,
      Topologiebeheer (Beheer-tabblad).
- [x] **Eerste admin-login: standaard admin:admin + verplichte wachtwoordwijziging.** Afgerond —
      gebouwd conform
      [specs/eerste-admin-standaardwachtwoord-plan.md](specs/eerste-admin-standaardwachtwoord-plan.md).
      Het bootstrap-admin-account (bij een lege `accounts.json`) gebruikt voortaan een vast
      `admin`/`admin` i.p.v. een willekeurig gegenereerd wachtwoord dat eenmalig in de container-log
      verscheen — makkelijker te onthouden/documenteren, aanvaardbaar omdat de verplichte wijziging
      na de eerste login **server-side** afgedwongen wordt (nieuwe check in de bestaande auth-gate,
      niet alleen een overslaanbaar UI-schermpje): elke `/api/*`-aanroep behalve
      `/api/logout`/`/api/session`/`/api/wachtwoord-wijzigen` geeft 403
      `wachtwoord_wijzigen_vereist` totdat het account zelf een nieuw wachtwoord gezet heeft via het
      nieuwe `POST /api/wachtwoord-wijzigen`-endpoint (minstens 8 tekens, niet `admin`). Nieuwe
      `#wachtwoordWijzigenOverlay` in de frontend (zelfde stijl als het bestaande loginscherm,
      hergebruikt), getoond zowel direct na een `admin/admin`-login als bij een latere page-reload
      terwijl de wijziging nog niet gebeurd is (`/api/session` geeft dezelfde vlag terug). Getest
      tegen een volledig losse, verse container (nooit tegen Mike's echte data): bootstrap-log toont
      `admin / admin`, elke andere route geeft 403 vóór de wijziging, het wijzig-formulier weigert
      een te kort wachtwoord en ongelijke velden, na het wijzigen werkt het oude `admin`/`admin` niet
      meer en het nieuwe wachtwoord wel, en een page-reload tijdens de verplichte stap toont opnieuw
      het wijzigscherm (niet de app, niet een leeg scherm). Bevestigd dat een bestaande installatie
      (met al een `accounts.json`, zoals de huidige live-instance) hier niets van merkt —
      `moet_wachtwoord_wijzigen` ontbreekt op bestaande accounts, telt dus als `false`. Nieuwe
      accounts/resets via Beheer → Accounts blijven ongewijzigd een willekeurig wachtwoord geven.
      Zie event_dashboard.md, Login & toegangsbeheer.
- [x] **Bugreport: dropdown/kastnamen op Beheer-pagina.** Afgerond — gebouwd conform
      [specs/vervolgticket-beheer-dropdown-namen.md](specs/vervolgticket-beheer-dropdown-namen.md).
      Twee gemelde punten, gereproduceerd tegen de live stack (met een losse, tijdelijke
      test-generator/-kast, nooit tegen de echte topologiedata): (1) "generator-dropdown werkt niet"
      bleek **geen bug** — het "soort koppeling"-veld is met opzet `disabled` tenzij het type al op
      "Groep" staat (de type-dropdown zelf functioneerde gewoon correct, inclusief de save-roundtrip
      en het verschijnen van de leden-knop na omzetten). Kleine UX-verbetering toegevoegd: een
      tooltip op het disabled-veld die uitlegt waarom. (2) "kastnamen niet zichtbaar" was wél een
      echte bug: de naamkolom in de kasten-tabel gebruikt een flex-wrapper
      (`naamInput.style.flex='1'` = `flex-basis:0%`) zonder expliciete `min-width` op de `<td>` —
      anders dan de overige kolommen, die dat wel hebben. Browsers berekenen de intrinsieke
      (auto-table-layout-)breedte van een flex-child met `flex-basis:0` als vrijwel nul, waardoor de
      naamkolom instortte tot een paar pixels breed zodra de overige, wél expliciet gebreedte
      kolommen samen al bijna de volledige tabelbreedte opeisten — geverifieerd: 14,77px vóór de fix,
      144px erna (`min-width:180px` op de cel, zelfde patroon als de andere kolommen). Alleen de
      kasten-tabel had dit (de generatorentabel gebruikt een simpele `<input>` zonder flex-wrapper,
      dus was nooit geraakt). Regressietest slaagt.
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
