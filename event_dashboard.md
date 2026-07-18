# Event Stroomdashboard — projectdocument

> Voor installatie- en gebruiksinstructies (stack starten, Shelly's koppelen, Grafana-queries):
> zie [README.md](README.md). Dit document beschrijft wat het project ís, welke features er zijn,
> en wat er nog op de roadmap staat. Houd dit bij als de featurelijst of roadmap wijzigt.

## Omschrijving

Zelf-gehost dashboard om de stroomvoorziening tijdens een evenement (festival, kermis, ...) in
de gaten te houden: hoeveel stroom trekt elke verdeelkast, hoe dicht zit die bij de zekering, en
hoe verhoudt dat zich tot de generator waar 'ie op hangt. Elke verdeelkast heeft een Shelly Pro
3EM-meter die live metingen over MQTT publiceert; die data wordt opgeslagen in InfluxDB en
gevisualiseerd in Grafana. Een losse webapp is er specifiek voor het **beheren van de
stroomtopologie** (welke generator, welke kasten, hoe hangen ze aan elkaar) en het **live
volgen** van de status op een plattegrond — dingen waar Grafana zelf niet geschikt voor is,
omdat het geen begrip heeft van de fysieke opstelling of de parent/child-stroomketen.

Architectuur (zie `docker-compose.yml`):
- **mosquitto** — MQTT-broker waar de Shelly's (of de simulator) naar publiceren
- **telegraf** — leest MQTT-berichten en schrijft ze weg naar InfluxDB
- **influxdb** — tijdreeksdatabase voor de meetdata
- **grafana** — dashboards/grafieken/alerting bovenop InfluxDB
- **webapp** — topologiebeheer, plattegrond-kalibratie, live-status, testtools (dit repo)
- **simulator** — publiceert fake meetdata voor alle kasten, voor testen zonder Shelly-hardware

De hele stack is generiek en evenement-onafhankelijk: er zit geen vaste branding in, en via een
eigen logo-upload en een `EVENT_EDITION`-variabele in `.env` is 'm elk jaar/editie opnieuw in te
zetten zonder code aan te passen.

## Features

**Topologiebeheer (Beheer-tabblad)**
- Generators aanmaken/bewerken/verwijderen (naam, kVA)
- Kasten aanmaken/bewerken/verwijderen (naam, afkorting, ampèrage, gekoppelde generator)
- Kasten aan elkaar koppelen via "Gevoed vanaf" om de stroomketen (parent/child) vast te leggen,
  met bescherming tegen cyclussen; verwijderen van een tussenliggende kast koppelt de keten
  automatisch door
- Automatisch gegenereerde `mqtt_topic_prefix` per kast, direct bruikbaar in de Shelly-config
- Evenementlogo uploaden, zichtbaar in de header
- Export/import van de volledige topologie als JSON (back-up, of hergebruik voor een nieuwe editie)

**Plattegrond & kalibratie (Kalibreren-tabblad)**
- Plattegrond (afbeelding) uploaden
- Generators en kasten als pins op de plattegrond plaatsen en verslepen
- Lijnen tussen kasten en hun voedingsbron, afgeleid uit de parent/child-koppeling

**Live-monitoring (Live-tabblad)**
- Rechtstreekse MQTT-verbinding vanuit de browser (via websockets) naar de broker
- Status per kast (groen/amber/rood) op basis van actuele stroom t.o.v. de ingestelde rating
- Live meetwaarden (stroom per fase, spanning, vermogen) in het detailpaneel

**Testdata-tabblad** *(tijdelijk, zie roadmap)*
- Eén klik een voorbeeldtopologie laden (2 generators, 6 kasten) om de app te demonstreren
- Meetdata in InfluxDB wissen zonder de topologie aan te raken, voor een schone start na een korte test

**Simulator**
- Publiceert realistische, langzaam variërende meetdata voor alle kasten in de huidige topologie,
  met incidentele belastingspieken — geen Shelly-hardware nodig om te testen

**Grafana-dashboards**
- InfluxDB-datasource en start-dashboard worden automatisch geprovisioned bij het opstarten
- Panelen per kast (totale stroom, stroom per fase) herhalen automatisch via een `$kast`-variabele
- `$editie`-variabele om meerdere jaren/edities te vergelijken (data blijft in dezelfde bucket)
- Alerting-condities (90%-drempel van `rating_a`) zijn per paneel handmatig toe te voegen

## Roadmap

- [ ] **Simulator + Testdata-tabblad achter een profile-flag na de testfase.** Beide staan nu
      standaard aan zodat testen makkelijk is. Zodra een editie de testfase uit is: zet
      `profiles: ["test"]` weer op de simulator-service in `docker-compose.yml`, en verberg
      (of laat 404 geven) het Testdata-tabblad — knoppen "Laad testtopologie"
      (`POST /api/topology/test-data`), "Start/stop simulator" (`POST /api/simulator/start`
      en `/stop`) en "Wis meetdata" (`POST /api/metingen/reset`) — tenzij dezelfde `test`-profile
      actief is (`docker compose --profile test up -d`). Zo kan niemand tijdens een echt
      evenement per ongeluk de topologie overschrijven, de simulator aanzetten of meetdata wissen.
- [ ] **Notificatiekanaal voor alerting naar telefoon.** Alert-condities in Grafana kunnen al
      aangemaakt worden; er moet nog gekozen worden welk kanaal het bericht ontvangt (opties:
      Telegram, Pushover, ntfy.sh, e-mail).
- [ ] **Overzichtsdashboard met generator-totalen.** Eén pagina met de generator-totalen
      bovenaan (grote getallen/gauges), daaronder per generator een rij met de direct-gevoede
      kasten, en voor kasten die zelf weer vertakken (bijv. een terreinverdeler) een klikbare
      drill-down naar een sub-dashboard — via Grafana dashboard-links of variabelen.
