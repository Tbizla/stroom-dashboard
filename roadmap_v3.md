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
- [x] **Sub-tabbladen voor de Beheer-pagina.** Afgerond — gebouwd conform
      [specs/beheer-subtabs-plan.md](specs/beheer-subtabs-plan.md) (7 augustus 2026, Mike): het
      Beheer-tabblad was één lange, doorlopend scrollende pagina met acht secties achter elkaar —
      opgedeeld in vier sub-tabs, 1-op-1 hergebruik van het bestaande Rapportages-subnav-patroon
      (`.subnav`-CSS, `toonRapportSubnav()`-klik-logica gekopieerd naar een nieuwe
      `toonBeheerSubnav()`). **Topologie** (standaard actief — Generators + Kasten + "Alles
      wissen"), **Instellingen** (Evenementlogo, Systeeminstellingen, Alert-notificaties —
      eenmalig-per-evenement-dingen), **Accounts** (eigen tab i.p.v. tussen Instellingen en
      Generators in), **Back-up** (de drie bestaande onderdelen blijven bij elkaar, `#backupPanel`
      hergebruikt als sub-tab-paneel-id). Dit is een pure DOM-herindeling, geen rebuild: alle
      bestaande element-id's (`genTable`, `kastSections`, `accountsTable`, `logoFile`,
      `notifTelegramBotToken`, `resetAllBtn`, enz.) bleven exact hetzelfde, dus al het bestaande
      JavaScript in `render-beheer.js`/`instellingen.js`/`notificaties.js`/`accounts.js`/
      `(automatische-)backup.js` werkt ongewijzigd — `display:none` op een voorouder-element breekt
      geen `getElementById`. Sub-tab-keuze wordt onthouden zolang je in de app blijft (`state.
      beheerSubnav`, zelfde in-memory-patroon als `state.rapportSubnav`), ook bij wisselen naar een
      ander hoofdtabblad en terug. **Bug tijdens het bouwen, direct gevonden en gefixt**: de eerste
      versie zette het nieuwe buiten-wrapper-element `#beheerPanel` standaard op `display:none`
      (het Rapportages-patroon-klakkeloos-gekopieerd), maar Beheer ís — anders dan Rapportages — de
      standaard-actieve modus bij het laden van de pagina; zonder een expliciete klik op de
      Beheer-knop bleef de hele pagina dan leeg. Gefixt door de buiten-wrapper terug op
      `display:flex` te zetten (de vier sub-panelen zelf regelen onderling wie zichtbaar is).
      Getest: Topologie is de default sub-tab bij het laden (generatorentabel meteen gevuld), elke
      sub-tab bevat exact de juiste velden/knoppen, generator aanmaken werkt vanuit de
      Topologie-sub-tab, en wisselen naar een ander hoofdtabblad (Live) en terug naar Beheer toont
      weer de laatst-actieve sub-tab (Back-up). Volledige regressietest slaagt. Zie
      event_dashboard.md, Topologiebeheer (Beheer-tabblad).
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
- [x] **Rolverdeling/rechten.** Afgerond — gebouwd conform
      [specs/rolverdeling-plan.md](specs/rolverdeling-plan.md) (geaccordeerd 3 augustus 2026, spec
      bijgewerkt 8 augustus 2026 voor het Grafieken-tabblad en de Beheer-subtabs-herindeling die
      er in de tussentijd bijkwamen). Bouwde voort op de accounts-/login-fundering uit "Toegang van
      buitenaf" hierboven. **Twee rollen, geen fijnmaziger systeem**: Editor (huidig gedrag,
      ongewijzigd) en Viewer (alleen kijken). Elk account krijgt een `rol`-veld
      (`'editor'|'viewer'`), verplicht bij het aanmaken (rol-dropdown in het aanmaakformulier),
      inline te wijzigen per bestaand account via een nieuwe `PUT /api/accounts/:id`-route +
      rol-dropdown in de Accounts-tabel. Bestaande accounts van vóór dit veld (geen schrijf-
      migratie, een `bepaalRol()`-fallback bij elke lezing — zelfde stijl als andere
      default-toepassingen elders in dit bestand) tellen als `editor`, zodat niemands rechten
      ongevraagd inkrimpen bij de upgrade — geverifieerd met de twee bestaande accounts uit eerdere
      ticketrondes (beiden zonder `rol`-veld in `accounts.json`), die na deze upgrade correct als
      Editor tonen. Het bootstrap-admin-account krijgt altijd `rol:'editor'`.
      **Server-side afgedwongen** (niet alleen de tabbladen client-side verstopt — een viewer-
      sessie kan een editor-only-route dus ook niet via een rechtstreekse API-aanroep buiten de UI
      om bereiken): een nieuwe `isEditorOnlyRoute()`-check in de bestaande auth-gate, als derde
      voorwaarde ná de sessie-/`moet_wachtwoord_wijzigen`-checks. Gate per "eigenaar-tabblad"
      (Beheer's vier sub-tabs, Kalibreren, Testdata), niet per HTTP-methode — bewust geen
      granulaire matrix, met twee met-opzet-geëxpliciteerde uitzonderingen (`GET /api/map`/
      `GET /api/logo` blijven viewer-toegankelijk, alleen de POST-upload-varianten zijn editor-
      only, want de plattegrond/het logo worden ook getoond in viewer-toegankelijke tabbladen resp.
      de header voor iedereen). **Frontend**: de mode-switch toont voor een viewer alleen Schema/
      Live/Rapportages/Grafieken (Beheer/Kalibreren/Testdata volledig verborgen i.p.v. grijs-met-
      uitleg); een viewer landt bij het inloggen automatisch op Schema i.p.v. de statische
      Beheer-default (ná `loadTopology()`, zodat `renderSchema()` niet op nog-lege data draait).
      Geverifieerd: server-side gate blokkeert een viewer-sessie op alle editor-only-routes (403,
      curl getest tegen `/api/kasten`, `/api/accounts`, `/api/instellingen`, `/api/topology/positie`,
      `/api/backup/genereer`, `/api/shelly/configureren`) terwijl viewer-toegankelijke routes
      (`/api/topology`, `/api/map`/`/api/logo` GET, `/api/mqtt-ticket`, Rapportages-/Grafieken-
      endpoints) gewoon 200 blijven geven; UI-flow bevestigt de juiste mode-switch-zichtbaarheid en
      de automatische Schema-landing voor een viewer-sessie, zonder console-errors; editor-sessies
      blijven volledig ongewijzigd. Volledige regressietest slaagt. Zie event_dashboard.md,
      Login & toegangsbeheer.
- [x] **Vervolgticket op commit 0dcb15f (Rolverdeling — gat bij Locaties-beheren).** Afgerond —
      [specs/vervolgticket-rolverdeling-locaties-gap.md](specs/vervolgticket-rolverdeling-locaties-gap.md).
      Code-review van de Rolverdeling-commit hierboven signaleerde één gemiste route:
      `POST`/`DELETE /api/locaties` (HQ-locatie toevoegen/verwijderen) stond niet in
      `EDITOR_ONLY_PREFIXEN`, terwijl de bijbehorende UI (Rapportages → Locaties → "Locaties
      beheren") in een tabblad zit dat voor viewers wél open blijft — een viewer-sessie kon dus via
      de gewone UI (en sowieso via een rechtstreekse API-aanroep) HQ-locaties toevoegen/verwijderen.
      Gefixt met hetzelfde patroon als de bestaande `/api/map`/`/api/logo`-uitzondering: `/api/locaties`
      toegevoegd aan `EDITOR_ONLY_PREFIXEN` mét een expliciete GET-uitzondering in
      `isEditorOnlyRoute()` (lezen blijft voor iedereen, alleen schrijven wordt editor-only).
      Frontend: het aanmaakformulier en de verwijderknoppen in `hq-locaties.js` verbergen zich nu
      voor `state.rol==='viewer'` (puur cosmetisch bovenop de echte server-side gate, zelfde aanpak
      als `verbergEditorOnlyTabsVoorViewer()`). Geverifieerd met een los aangemaakt tijdelijk editor-
      en viewer-testaccount (nooit tegen de echte admin/bestaande accounts getest, achteraf weer
      verwijderd): viewer-sessie krijgt 200 op `GET /api/locaties` en `GET /api/hq-locaties-status`,
      403 op zowel `POST` als `DELETE /api/locaties` (curl én een rechtstreekse `fetch()` vanuit de
      browsersessie zelf); Playwright bevestigt dat `#locatieAddForm` en alle
      `[data-verwijder]`-knoppen niet in de DOM-zichtbaarheid staan voor een viewer, terwijl een
      editor-sessie ze ongewijzigd blijft zien. Overige routes nagelopen tegen de volledige
      routelijst — verder geen gaten gevonden.
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
- [x] **Grafieken-tabblad: "Alle fasen tegelijk" bij het lijndiagram.** Afgerond — gebouwd conform
      [specs/grafieken-alle-fasen-plan.md](specs/grafieken-alle-fasen-plan.md). Mikes verzoek: fase-
      onbalans van één kast/generator spotten (bijv. één fase structureel zwaarder belast) zonder
      drie keer achter elkaar van fase te moeten wisselen. Nieuwe 5e fase-chip **"Alle fasen"**, per
      afgestemde scope-keuze alleen voor **één geselecteerd item tegelijk** (N items zou N×3 lijnen
      geven — onleesbaar en niet het doel): zodra actief gedraagt de checklist zich tijdelijk als
      een enkele-keuze-lijst (nieuw vinkje zet het vorige automatisch uit, stonden er al meerdere
      aan dan blijft alleen het eerste over), terugschakelen naar A/B/C/Totaal maakt 'm gewoon weer
      multi-select zonder de selectie te wissen. Alleen zichtbaar/bruikbaar bij het Lijndiagram
      (zelfde type-afhankelijke beschikbaarheid als de bestaande "Alle edities"-optie, met dezelfde
      val-terug-naar-Totaal zodra je wegschakelt van Lijn). **Backend**: nieuwe
      `grafiekenCsvNaarSeriesPerVeld()` naast de bestaande combinerende `grafiekenCsvNaarSeries()` —
      geeft de drie rauwe per-fase-velden als 3 aparte series terug i.p.v. te middelen/sommeren;
      `/api/grafieken/tijdreeks` dwingt server-side af dat er bij fase "alle" precies 1 id gequeried
      wordt (400 anders, niet alleen de checklist client-side beperkt, zelfde principe als de
      rolverdeling-rechten). **Frontend**: vaste kleur (de eerste 3 PALET-kleuren, dus visueel niets
      nieuws) + "Fase A/B/C"-label per lijn i.p.v. de normale kast/generator-kleur-en-naam-opzoeking.
      **Live-modus zit ook in scope** (tussentijds toegevoegd op Mikes verzoek): de al aanwezige
      client-side rolling buffer (per kast de rauwe MQTT-data, geen wijziging nodig) levert 3 series
      op via 3x `liveVeldWaarde()`-aanroepen (fase a/b/c) op dezelfde buffer van het ene
      geselecteerde item — dezelfde responsvorm als de historische tak, dus `tekenChart()` heeft
      maar één fase="alle"-branch nodig voor beide. Geverifieerd met Playwright tegen de ingebouwde
      testtopologie + simulator: 2 items selecteren en dan Alle fasen activeren laat er terecht nog
      maar 1 over; een chart met 3 herkenbare Fase A/B/C-lijnen zowel historisch als live (na eerst
      de MQTT-verbinding via Live-modus geactiveerd te hebben — de buffer vult zich pas dan);
      wegschakelen naar Staaf terwijl Alle fasen actief was valt terug op Totaal en verbergt de
      chip; direct een `fase=alle`-query met 2+ ids via de API geeft 400, met een ongeldige fase-
      waarde ook. Zie event_dashboard.md, Grafieken-tabblad.
- [x] **Favicon.** Afgerond — gebouwd conform [specs/favicon-plan.md](specs/favicon-plan.md):
      `webapp/public/favicon.svg`, letterlijk hetzelfde ⚡-teken als het generator-icoon in de
      zijbalk (`typeIcon()`), op een afgeronde vierkante `--panel`-achtergrond. Eén schaalbare SVG,
      geen aparte 16/32/180px-PNG-varianten. `<link rel="icon">` toegevoegd aan `index.html`'s
      `<head>`. Geverifieerd: `favicon.svg` wordt met `200 image/svg+xml` geserveerd.
- [x] **Grafieken-tabblad: "Alle fasen" ook bij Staaf en Taart.** Afgerond — gebouwd conform
      [specs/grafieken-alle-fasen-staaf-taart-plan.md](specs/grafieken-alle-fasen-staaf-taart-plan.md),
      vervolg op de hierboven al gebouwde Lijn-variant. Scope-keuze met Mike afgestemd: alleen Staaf
      en Taart (Heatmap/Sankey hebben geen natuurlijke "3 fasen tegelijk"-vorm, blijven ongewijzigd).
      **Staaf**: gegroepeerde balken per fase (3 per item), meerdere items blijven toegestaan —
      i.t.t. Lijn is dat hier juist het punt (fasebalans per kast/generator náást elkaar
      vergelijken). Vaste fasekleur + nieuwe legenda i.p.v. de groen/amber/rood-statuskleuring,
      sortering op de som van de (tot 3) fasewaarden, ontbrekende fase toont gewoon minder balken
      (geen kunstmatige 0). **Taart**: omgeschakeld naar "aandeel van fase A/B/C binnen één item"
      (i.p.v. aandeel per item) — hier wél dezelfde enkele-keuze-checklist-beperking als Lijn.
      **Backend** (`/api/grafieken/aggregaat`): fase-validatie uitgebreid met `'alle'`, bewust
      **geen** 1-id-afdwinging (i.t.t. `/api/grafieken/tijdreeks` — Staaf gebruikt hier legitiem
      meerdere ids, de Taart-beperking is puur een frontend-renderkeuze op dezelfde ruwe data, de
      server kent het onderscheid Staaf/Taart niet). Nieuwe
      `grafiekenAggregaatCsvNaarWaardenPerVeld()` naast de bestaande middelende variant; het
      periode-totaal-pad (energie) doet bij `fase==='alle'` per id 3 losse
      `berekenEnergieKwh()`-aanroepen (a/b/c) i.p.v. 1; statuswaarde-verrijking wordt overgeslagen
      (niet zinvol bij al-rauwe single-fase-waarden). **Frontend**: `ververFaseBeschikbaarheid()`
      uitgebreid naar Lijn/Staaf/Taart; checklist-enkele-keuze-conditie aangescherpt tot "niet bij
      Staaf" (zowel in de checkbox-handler als de fase-chip-klik-handler); nieuwe branches in
      `tekenStaafChart()`/`tekenTaartChart()`. **Live-modus** (niet expliciet in de spec benoemd,
      maar wel nodig zodra "Alle fasen" bij Staaf/Taart ook tijdens Live bereikbaar wordt — anders
      een crash/stille misrender bij die combinatie): `verversLiveWeergave()`'s taart/staaf-takken
      kregen een eigen `fase==='alle'`-pad, `liveStaafWaarde()` accepteert nu een optionele
      expliciete faseletter zodat 'ie per fase herhaald kan worden. Code-review tijdens het bouwen
      vond en fixte nog een gat: een type-wissel zelf (bijv. Staaf-met-3-items → Taart terwijl Alle
      fasen al actief stond) liep niet door de enkele-keuze-afdwinging heen — nu ook gecheckt in
      `ververFaseBeschikbaarheid()` zelf, bij elke `ververAlleAfgeleideUiState()`-aanroep.
      Geverifieerd met Playwright tegen de ingebouwde testtopologie + simulator: Staaf+3
      items+Alle-fasen blijft multi-select (historisch én live, met een 2e/3e balkengroep correct
      gesorteerd op som); wisselen naar Taart trimt terug naar 1 item; wisselen naar Heatmap laat
      de chip verdwijnen en fase terugvallen op Totaal; `/api/grafieken/aggregaat` met `fase=alle`
      en 2+ ids geeft gewoon 200 (bevestigd geen 1-id-afdwinging). Zie event_dashboard.md,
      Grafieken-tabblad.
- [x] **Vervolgticket: Lijndiagram dunnere lijnen.** Afgerond — gebouwd conform
      [specs/vervolgticket-lijndiagram-lijndikte.md](specs/vervolgticket-lijndiagram-lijndikte.md),
      Mikes keuze (Optie B) op een eerder voorgelegde mockup. `borderWidth: 2` → `1` in
      `tekenChart()` (het lijndiagram, gedeeld door de normale meerdere-items-weergave en de "Alle
      fasen"-weergave); `tension: 0.15` ongewijzigd. Geverifieerd dat `tekenStaafChart()`s
      balkrand en de taart-slice-rand (elders `borderWidth: 2`, ongerelateerd) niet meeveranderd
      zijn. Visueel gecontroleerd in beide lijndiagram-weergaven.
- [x] **UI schaalt niet mee op verschillende schermformaten — volledige vloeiende schaling.**
      Afgerond — gebouwd conform [specs/ui-vloeiende-schaling-plan.md](specs/ui-vloeiende-schaling-plan.md).
      Mikes bugmelding: geen enkele `@media`-breakpoint in `style.css`, alle maten vaste px-waarden
      — klein scherm raakte eerder afgekapt/wrappend, groot beamer-scherm bleef een mini-UI in een
      zee van lege ruimte. Gekozen aanpak (met Mike afgestemd): volledige vloeiende schaling i.p.v.
      een paar gerichte breakpoint-patches, gefaseerd gebouwd.
      **Mechanisme**: `html{font-size:clamp(14px, 10px + 0.36vw, 19px)}` — bij een "normale"
      desktopbreedte (~1440-1920px) resulteert dat in ~15-17px (vrijwel identiek aan de oude
      impliciete 16px-default), aan de uiterste breedtes klemt de clamp vast op 14px resp. 19px.
      **Fase 1+2 (CSS, `webapp/public/css/style.css`)**: alle font-sizes/padding/margin/gaps/
      expliciete knop-en-inputafmetingen/border-radius omgezet van `px` naar `rem` (16px-basis) —
      in de praktijk in één samenhangende bewerking gedaan i.p.v. als twee losse stappen, aangezien
      Fase 1 en 2 mechanisch identiek zijn (alleen welke sectie eerst) en er geen technische reden
      was om ze apart te bouwen/verifiëren. Om het risico op handmatige rekenfouten over ~250
      px-waarden te vermijden is de conversie via een klein, weggooibaar Node-scriptje gedaan
      (regex-gebaseerd, met een lookbehind i.p.v. een consumerende capture-group voor de
      declaratie-grens — een eerdere versie met een consumerende group at per ongeluk de `;`-
      scheiding tussen twee opeenvolgende target-properties op, waardoor bijv. `width:16px;height:16px`
      alleen de eerste van de twee omzette; met terugwerkende kracht bevestigd doordat het
      brace-aantal, de volledige set class-selectors en het aantal `var(--...)`-referenties vóór en
      ná de conversie exact gelijk bleven). Randdiktes, box-shadow-offsets en positionerings-
      nudges (`top`/`left`/`right`/`bottom`, `transform`-offsets) blijven bewust `px`.
      **Kritieke uitzondering, niet aangeraakt**: `.blankcanvas` (4800×3000px) en de hele
      percentage-gebaseerde pin-plaatsingscluster (`.pin`, `.pinlabel`, `.edgeline`, `.knik`,
      `.pin-anomaly`, `@keyframes pulse`) — dat is een vaste logische coördinatenruimte met een
      eigen, al werkende content-aware fit-to-screen-`transform:scale()`; een root-schaalfactor zou
      dat dubbel gaan beïnvloeden. De UI-chrome erboven (zoomknoppen, zijbalk, kastpopup) schaalt
      wel gewoon mee.
      **Fase 3 (JS, `webapp/public/js/grafieken.js`)**: Chart.js (Lijn/Staaf/Taart) en de eigen
      Heatmap/Sankey-SVG lezen geen CSS-`rem` — nieuwe `schaalFactor()`-helper leest de effectieve
      root-font-size via `getComputedStyle()` uit (relatief t.o.v. de 16px-basis) en vermenigvuldigt
      daarmee de tot dan toe hardcoded JS-px-constanten: Chart.js' `ticks`/`legend`/`tooltip`-
      `font.size`, en bij Heatmap/Sankey `NAAMKOL`/`CELW`/`CELH`/`KOPH` resp.
      `RECT_W`/`MARGE_X`/`TOP`/`BOTTOM`/`GAP_Y`/de kolombreedte-cap plus de node-labeltekst.
      Geverifieerd met Playwright op drie referentiebreedtes (1280px smal-laptop, 1920px normale
      desktop, 3200px beamer, telkens een echt aangepaste viewport, geen devtools-responsive-mode):
      `html`'s effectieve font-size klopt met de clamp-berekening op alle drie (14.6px/16.9px/19px);
      Beheer/Kalibreren/Live (incl. een geopende kastpopup) en alle vijf grafiektypes tonen
      proportioneel grotere/kleinere chrome zonder afgekapte tekst of gebroken layout; de pins/het
      canvas blijven op elke breedte exact hun vaste pixelgrootte houden en de bestaande fit-to-
      screen-zoomlogica past zich (ongewijzigd, zoals bedoeld) vanzelf aan de nieuwe containergrootte
      aan. Zie event_dashboard.md, sectie "Vloeiende UI-schaling".
- [x] **Shelly/verdeelkast vervangen tijdens een project.** Afgerond — gebouwd conform
      [specs/shelly-vervanging-plan.md](specs/shelly-vervanging-plan.md). Mike: soms gaat een Shelly
      of een verdeelkast tijdens een evenement stuk, hij wilde één duidelijke actie i.p.v. de twee
      losse stappen (IP-veld overtypen, dan apart de ⚙️-configureerknop zoeken) én bijhouden wát
      vervangen is. De databasis stond hier al goed voor: de logische kast/generator blijft
      ongewijzigd (naam/positie/rating/koppelingen), alleen `shelly_ip` wijzigt —
      `mqtt_topic_prefix` is gebaseerd op de kast-id, niet het fysieke apparaat, dus historische
      Grafieken-/Rapportages-data blijft ononderbroken.
      **Backend**: nieuwe gedeelde `nieuweVervangingenArray(vorigShellyIp, nieuwShellyIp,
      bestaandeVervangingen)`-helper in `server.js`, aangeroepen vanuit `PUT /api/kasten/:id`,
      `PUT /api/generators/:id` (eigen shelly_ip) én de `leden`-array-route van diezelfde
      generator-endpoint (leden-scope uit het plan meegenomen, niet als losse ronde uitgesteld) — een
      wijziging telt als vervanging zodra er al een ander, niet-leeg IP stond, puur op de
      waarde-vergelijking (niet gekoppeld aan welke knop de aanroep deed, dus ook een rechtstreekse
      bewerking van het inline IP-veld wordt gelogd). Voor leden bouwt `normaliseerLeden()` bij elke
      PUT verse lid-objecten, dus de oude leden-array (op `id`) opgezocht om zowel de
      shelly_ip-vergelijking als een eventueel bestaand `vervangingen`-array mee te dragen naar het
      nieuwe object.
      **Frontend** (`render-beheer.js`): nieuwe 🔁-knop naast de bestaande ⚙️-configureerknop op
      kast-, generator- en groepslid-rijen, opent een inline toggle-formuliertje (nieuw IP +
      snelheidsscript-vinkje) binnen dezelfde actiekolom-cel — geen modal. Bevestigen doet de PUT en
      start meteen dezelfde `startShellyConfiguratie()` die de bestaande ⚙️-knop ook gebruikt (zelfde
      voortgangstoast). Welke rij het formulier open heeft staan zit in een module-level
      `vervangFormOpen`-Set (sleutel `"kast:<id>"`/`"generator:<id>"`/`"lid:<genId>|<lidIndex>"`),
      nodig omdat `renderBeheer()` de hele tabel bij elke wijziging herbouwt (zelfde patroon als de
      bestaande `groepeerGeselecteerd`/`expandedGroepen`-state) — twee parallelle implementaties
      (DOM-gebouwd voor de kast-rij, string-gebouwd + gedelegeerde events voor generator/lid, zelfde
      bestaande patroon-verschil als `maakShellyConfigureerControl()` t.o.v. de
      `data-shelly-cfg-type`-rijen). Nieuw 🔁-indicatortje bij de Shelly-IP-kolom, alleen zichtbaar
      als `vervangingen.length>0`, met de volledige geschiedenis (nieuwste eerst) in een
      title-tooltip.
      **Bug gevonden tijdens het testen**: de DOM-gebouwde formulier-inputs (kast-rij) misten hun
      CSS-klasse (`ipInput.className` nooit gezet, in tegenstelling tot de string-gebouwde variant)
      — onopgemerkt gebleven totdat een Playwright-test er specifiek op selecteerde; hersteld.
      Geverifieerd end-to-end voor alle drie rij-typen (kast/generator/groepslid): eerste keer een IP
      invullen logt niets, een echte vervanging wél (met de juiste oude/nieuwe IP-waarden), een
      tweede vervanging op dezelfde rij geeft twee entries i.p.v. een overschreven entry, en de
      indicator-tooltip toont de geschiedenis in de juiste (nieuwste-eerst) volgorde.
- [x] **Vervolgticket: UI-schaling werkte nog niet op écht brede/4K-schermen.** Afgerond — Mikes
      terugmelding op de eerdere "volledige vloeiende schaling"-fix hierboven: op zijn 16" 4K-laptop
      bleef nog veel ruimte onbenut, op zijn 32" 4K-scherm "helemaal erg". Concrete cijfers
      opgevraagd i.p.v. blind opnieuw te gokken: `window.innerWidth` was 1536px (laptop, met
      Windows-schaling) resp. 3840px (32"-scherm, zonder OS-schaling) — beide écht reproduceerbaar,
      geen incident.
      **Oorzaak 1**: de root-`clamp()` had een plafond van 19px, ruim vóór 3840px al bereikt (bij
      ~2500px) — daarna groeide er niets meer mee, wat op het grote scherm aanvoelde als een harde
      stop. Plafond opgehoogd naar 24px, coëfficiënt ongewijzigd (dus 1440-1920px blijft "vrijwel
      identiek aan nu").
      **Oorzaak 2, groter dan gedacht**: `.beheercol` (Topologie-/Instellingen-/Accounts-/
      Back-up-inhoud) had weliswaar een vaste max-width, maar die was op smallere inhoud vaak niet
      eens de daadwerkelijke beperking — de vier `.beheer`-subpanelen zijn zelf `display:flex`
      (rij-richting, `toonBeheerSubnav()` in `modes.js`), en `.beheercol` had daarbinnen nooit een
      `flex-grow` gekregen. Een flex-item zonder groei sizet op zijn eigen content (shrink-to-fit),
      dus alléén de max-width loslaten (eerste poging) veranderde zichtbaar niets — pas
      `.beheercol{flex:1;min-width:0}` (zelfde min-width:0-patroon als `.beheer` zelf al gebruikte)
      liet 'm ook echt de beschikbare rijbreedte opvullen.
      Geverifieerd met Playwright op precies Mikes gerapporteerde breedtes (1536px/3840px, geen
      afgeronde referentiewaarden): `html`'s font-size klopt met de nieuwe clamp-berekening
      (15.53px/23.82px), en de kasten-/generatorentabel vult nu zichtbaar de volledige breedte i.p.v.
      een smalle kolom naast een lege rand — gecontroleerd met een tijdelijke test-generator/-kast
      (de echte topologie was op het moment van testen leeg). Overige tabbladen (Instellingen,
      Kalibreren) steekproefsgewijs gecontroleerd op geen regressie. Zie event_dashboard.md, sectie
      "Vloeiende UI-schaling".
- [x] **Vervolgticket: "+ nieuwe rij"-formulieren onder tabellen lijnden niet meer uit met de
      kolomkoppen.** Afgerond — regressie die de `.beheercol{flex:1}`-fix hierboven zelf blootlegde,
      gemeld met screenshot ("de input boxen staan niet meer onder de benamingen"). Grondoorzaak:
      de "+ Generator"/"+ Account aanmaken"/"+ Locatie"-formulieren waren losse `<div class="addform">`
      onder de `<table class="btable">`, geen echte tabelrij — hun `<input>`-breedtes hingen dus nooit
      samen met de kolombreedtes die de browser voor de tabel zelf berekent. Dat de invoervelden
      toch onder de koppen léken te staan was puur toeval: klopte alleen zolang de tabel toevallig
      ongeveer even smal rendere als de van-nature-smalle addform-inputs — brak zichtbaar zodra de
      tabel na de vorige fix daadwerkelijk breed ging renderen. Opgelost door deze drie formulieren
      om te bouwen tot een echte laatste `<tr>` ín de tabel zelf (zelfde patroon als de al langer
      bestaande "+"-rij van de leden-subtabel, die dit nooit als probleem had) — lijnt daardoor per
      definitie uit, ongeacht schermbreedte. Bijkomende fix onderweg: de nieuwe Generatoren-rij
      kreeg aanvankelijk één `<td>` te weinig (8 i.p.v. 9 kolommen), waardoor alles een kolom
      opschoof — verholpen door de ontbrekende lege LEDEN-kolom toe te voegen. Statische
      `<div class="addform">`-blokken + hun losse `onclick`-registratie bij module-load vervangen
      door in de tabel-HTML meegebouwde velden met een herbruikbare handler-functie die na elke
      render opnieuw aan de (opnieuw aangemaakte) knop gekoppeld wordt. Geverifieerd met Playwright
      op 3840px én 1440px: kolomkop- en invoerveld-posities liggen nu op enkele pixels na (padding)
      exact onder elkaar bij alle drie tabellen, en de volledige aanmaak-/verwijder-flow werkt nog
      end-to-end (tijdelijke `TMP-`-generator/-locatie/-account aangemaakt, geverifieerd, weer
      verwijderd).

## Ideeën van Claude (ongefilterd, nog niet besproken/geprioriteerd met Mike)

> Deze sectie is momenteel leeg — alle eerder voorgestelde ideeën zijn inmiddels met Mike
> geprioriteerd (zie de items hierboven en in [roadmap_v4.md](roadmap_v4.md)).
