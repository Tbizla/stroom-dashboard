# Event Stroomdashboard — installatie & gebruik

Praktische handleiding: stack opzetten, Shelly's koppelen, Grafana-queries en export/import.
Voor een projectoverzicht (omschrijving, features, roadmap) zie [event_dashboard.md](event_dashboard.md).

## 1. Generators en kasten invoeren

Alles begint leeg. Open de webapp (zie stap 3), je start automatisch in **Beheer**-modus:
- Maak eerst je generators aan (naam + kVA)
- Maak per generator de kasten aan (naam, ampèrage, eventueel een afkorting zoals "P1")
- Koppel elke kast aan de kast waar 'ie stroomtechnisch op doorgelust is via het dropdown-veld **"Gevoed vanaf"** (leeg = rechtstreeks op de generator). De app voorkomt dat je per ongeluk een lus/cyclus maakt.
- Kast verwijderen? Kasten die daarop waren doorgelust, worden automatisch doorgekoppeld naar wat erboven zat, zodat de keten intact blijft.

Elke kast krijgt automatisch een `mqtt_topic_prefix` (`fest/<generator_id>/<kast_id>`) — die vul je in de Shelly zelf in onder Settings > MQTT > Custom MQTT prefix.

## 2. Shelly's instellen (eenmalig, per kast)

Op elke Shelly Pro 3EM: Settings > MQTT
- Enable MQTT: aan
- Server: IP-adres van de machine bij NHQ, poort 1883
- Custom MQTT prefix: de waarde die de webapp voor die kast heeft gegenereerd (zichtbaar in de kasten-tabel in Beheer-modus, en in een export)

Na deze stap publiceert elke Shelly automatisch naar o.a.:
- `fest/<generator>/<kast>/status/em:0` — live spanning/stroom/vermogen per fase, elke paar seconden of bij verandering
- `fest/<generator>/<kast>/status/emdata:0` — cumulatieve energietelling (kWh)

## 3. Stack starten

```
cp .env.example .env
# vul .env in met eigen wachtwoorden/token
docker compose up -d --build
```

Dit start alles in één keer: Mosquitto, Telegraf, InfluxDB, Grafana (poort 3000) én het stroomdashboard zelf (poort 8080). Niets hoeft meer los gekopieerd of ingesteld te worden.

Open `http://<ip-van-de-nhq-machine>:8080` — dat werkt vanaf elk apparaat op hetzelfde lokale netwerk, dus je hele crew kan tegelijk meekijken. De eerste keer: gebruik de knop **"Plattegrond uploaden"** om de veldtekening in te laden, en plaats daarna de kasten via de kalibratiemodus. Upload optioneel ook een **evenementlogo** onderaan Beheer — dat verschijnt in de header. Posities, plattegrond en logo worden centraal op de server bewaard (in een Docker-volume), dus dat hoeft maar één keer per editie, door één persoon.

Grafana zelf: de InfluxDB data source wordt automatisch geprovisioned (`grafana/provisioning/datasources/influxdb.yml`, met de token uit `.env`) — je hoeft 'm niet meer handmatig toe te voegen. Er staat ook een start-dashboard klaar ("Stroomdashboard - overzicht", `grafana/dashboards/stroomdashboard.json`) met twee panelen (totale stroom en stroom per fase) die automatisch herhaald worden per kast via een `$kast`-variabele, plus een `$editie`-variabele. Dit dashboard bevat bewust geen generator-totalen of alarmdrempels — die vereisen kennis van de webapp-topologie (parent/child-keten, `rating_a`) die niet in InfluxDB zit; zie secties 5 en 6 hieronder om die zelf toe te voegen.

## 4. Voorbeeldquery — één kast (paneel per kast)

De onderstaande queries gebruiken voorbeeldnamen (`podium1`, `foodtrucks_zuid`, ...). Jouw eigen kast-id's zie je in de Beheer-modus van de webapp — dat zijn de namen die je zelf hebt ingevoerd, verwerkt tot een technische naam (bijv. "Podium 1" → `podium1`).

Totale stroom van bijvoorbeeld podium 1, laatste 15 minuten:

```flux
from(bucket: "stroomdata")
  |> range(start: -15m)
  |> filter(fn: (r) => r._measurement == "shelly_em")
  |> filter(fn: (r) => r.kast == "podium1")
  |> filter(fn: (r) => r._field == "total_current")
```

Voor stroom per fase (a/b/c) vervang je de laatste filter door `r._field == "a_current" or r._field == "b_current" or r._field == "c_current"` — zo krijg je drie lijnen in één paneel.

## 5. Voorbeeldquery — generator-totaal

Belangrijk: alleen de kasten met `parent: null` in de JSON optellen (die rechtstreeks op de generator zitten), downstream-kasten NIET meetellen — hun verbruik zit al in de bovenliggende meting.

Generator zuid (podium1 + foodtrucks_zuid + terreinverdeler):

```flux
from(bucket: "stroomdata")
  |> range(start: -5m)
  |> filter(fn: (r) => r._measurement == "shelly_em" and r._field == "total_current")
  |> filter(fn: (r) => r.kast == "podium1" or r.kast == "foodtrucks_zuid" or r.kast == "terreinverdeler")
  |> aggregateWindow(every: 10s, fn: last, createEmpty: false)
  |> group(columns: ["_time"])
  |> sum()
```

Generator noord (podium2 + bar2):

```flux
from(bucket: "stroomdata")
  |> range(start: -5m)
  |> filter(fn: (r) => r._measurement == "shelly_em" and r._field == "total_current")
  |> filter(fn: (r) => r.kast == "podium2" or r.kast == "bar2")
  |> aggregateWindow(every: 10s, fn: last, createEmpty: false)
  |> group(columns: ["_time"])
  |> sum()
```

Vermogen (kVA-schatting) werkt hetzelfde, maar met `r._field == "total_aprt_power"` in plaats van `total_current`.

## 6. Alarmdrempels per kast

Elke kast heeft in de webapp (Beheer-modus) een `rating_a`. Zet in Grafana per paneel een drempel op bijvoorbeeld 90% van die waarde, zodat je een waarschuwing krijgt vóórdat een kast echt overbelast raakt — bijvoorbeeld een 63A-kast op 56,7A, een 32A-kast op 28,8A. De ratings van al je eigen kasten zie je in één oogopslag terug in de kasten-tabel in Beheer-modus, of in de export (`/api/export`).

Voor de generatoren reken je de kVA om naar een ruwe stroomindicatie (kVA x 1000 / (3 x 230V) voor een driefasesysteem) en gebruik je diezelfde 90%-vuistregel, of je laat het gewoon bij een kVA-drempel op het totaalpaneel.

## 7. Testen met fake data

Er zit een simulator bij die realistisch ogende meetdata voor alle kasten publiceert, zonder dat er Shelly's aangesloten hoeven te zijn. Hij haalt de kastenlijst automatisch op bij de webapp, dus je hoeft niets handmatig te synchroniseren. Elke kast krijgt een langzaam wisselende belasting, en af en toe (standaard ~1% kans per tik) een kunstmatige piek — handig om de groen/amber/rood-status en later de alerts te testen.

Op het **Testdata**-tabblad in de webapp:
- **"Laad testtopologie"** zet in één klik een voorbeeldtopologie (2 generators, 6 kasten) neer, zodat de simulator meteen data heeft om te publiceren.
- **"Wis meetdata"** wist alle meetdata uit InfluxDB (de topologie blijft staan) — handig om na een korte test met een schone grafiek te beginnen.

**Let op: de simulator staat momenteel standaard aan.** Een gewone `docker compose up -d --build` start de simulator dus nu gewoon mee, zodat je meteen kunt testen zonder Shelly's. Zie de roadmap in [event_dashboard.md](event_dashboard.md) — dit gaat samen met het Testdata-tabblad weer achter een flag zodra de testfase klaar is, zodat er nooit per ongeluk mee getest wordt tijdens een echt evenement.

Los stoppen kan met:

```
docker compose stop simulator
```

## 8. Data exporteren

Twee soorten export, voor twee soorten data:

- **Topologie + posities** (welke kasten, ratings, kaart-coördinaten): knop "Exporteer data" bovenin de webapp (`/api/export`) — downloadt één JSON-bestand. Handig als back-up, of om over te zetten naar een nieuwe editie via "Importeer data".
- **Historische meetdata** (stroom/spanning/vermogen over tijd): dat hoort bij InfluxDB/Grafana. Open het paneel in Grafana, klik het menu (⋮) rechtsboven in het paneel > **Inspect > Data > Download CSV**. Voor grotere exports kun je ook rechtstreeks een Flux-query op InfluxDB loslaten en het resultaat als CSV wegschrijven.

## 9. Meerdere edities/jaren vergelijken

Elke keer dat je de stack opnieuw start, vul je in `.env` de `EVENT_EDITION` in (bijv. "2027"). Telegraf plakt dat als tag `editie` op elke meting, dus alle jaren blijven in dezelfde InfluxDB-bucket staan en kun je in Grafana filteren op editie, of meerdere edities naast elkaar in één grafiek zetten (bijv. via een `editie`-variabele bovenaan het dashboard).

## 10. Alarmering (Grafana Alerting)

Grafana kan per paneel een alert-regel krijgen die afgaat zodra `total_current` boven de 90%-drempel van `rating_a` komt (zie sectie 6 hierboven). De alert-regels kun je nu al aanmaken; het **notificatiekanaal** (waar het bericht naartoe gestuurd wordt) hoef je pas te koppelen als je een keuze hebt gemaakt.

Voorbeeld alert-conditie in Grafana (per kast-paneel):
- Query: `total_current` van de betreffende kast, laatste 1 minuut
- Conditie: `is above` [90% van rating_a]
- For: 30s (voorkomt vals alarm bij een korte piek)

Zodra je een kanaal kiest, voeg je die toe onder Alerting > Contact points, en koppel je 'm aan een notification policy. Ondersteunde opties: Telegram, Pushover, ntfy.sh, e-mail, Slack, webhook, en meer.
