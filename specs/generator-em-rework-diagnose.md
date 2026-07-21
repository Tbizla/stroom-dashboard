`🚧 DEV-V2 🚧`

# Generator-EM rework — diagnose (nog géén spec)

Bij roadmap-item 1 in [event_dashboard.md](../event_dashboard.md). Het item zelf zegt nog niet
scherp te zijn wat er precies moet veranderen ("eerst verder gebruiken/bekijken voor de volgende
aanpassing") — dit is dus bewust nog geen mockup of implementatieplan, maar een doordenking van de
huidige code om concrete kandidaat-pijnpunten te benoemen, zodat we daarna gericht een spec kunnen
maken in plaats van in het wilde weg.

Ik heb de huidige generator/groep-monitoring nagelopen door de code heen (niet door de app zelf te
gebruiken — dat blijft aan jou). Drie dingen springen eruit die goed verklaren waarom het "nog niet
helemaal goed voelt":

## 1. Een "groep" wordt live behandeld als één plat ding, terwijl hij dat niet is

In Beheer modelleer je een groep expliciet als meerdere leden (bijv. Centrum: 4 aggregaten + een
batterijcontainer met bypass, elk met eigen naam/kVA/type) — dat zit al in
`render-detail.js` (toont de ledenlijst + koppelsoort parallel/backup/hybride). Maar zodra je naar
Live of de nieuwe Overzicht-kaart kijkt, valt die hele structuur terug op **één** rating_a en **één**
self-meter-uitlezing (`metingenHtml()` / `statusOf()` in `topology.js`, hergebruikt door
`render-detail.js`, de aside-lijst, de kaart-pin, én `overzicht.js`). Je ziet dus nergens welk
aggregaat het zwaarst belast is, of de batterij op dat moment aan het bufferen/bypassen is — precies
de informatie die het onderscheid tussen een los aggregaat en een groep in Beheer juist zo belangrijk
maakt, gaat live weer verloren.

## 2. Generator-pins krijgen niet dezelfde klik-interactie als kast-pins

In `render-pins.js` regel 39: `if(state.mode==='live' && !isGen(n))` — het openen van de rijke
kaart-databalloon (per-fase tabel, cos φ, cumulatieve energie) is expliciet uitgesloten voor
generatoren, ook als die generator wél een self-meter heeft (rating_a gezet, `liveData` gevuld). Een
generator met eigen meting gedraagt zich dus overal een beetje als een kast (statuskleur, aside-
detail) behalve op de plattegrond zelf, waar je 'm niet kunt aanklikken voor dezelfde live-diepgang.
Dat voelt inconsistent, zeker omdat de onderliggende data en renderlogica (`metingenHtml()`) al
volledig gedeeld zijn tussen kast en generator.

## 3. Eén statusstip op een generatorregel betekent twee verschillende dingen

`render-list.js` regel 121-137: een generatorregel in de zijbalk toont zowel een eigen statusstip
(gebaseerd op de generator's eigen self-meter t.o.v. zijn rating_a) als badges met de opgetelde
groen/amber/rood-status van alle eronder hangende kasten (`statusCounts()`) — twee totaal
verschillende signalen ("hoe doet de generator zelf het" vs. "hoe doen de kasten eronder het") naast
elkaar, zonder enig visueel onderscheid dat dat verduidelijkt. Dat kan op het eerste gezicht
overbodig of verwarrend ogen.

## Kleinere kanttekening → scopingsbesluit (bevestigd door Mike)

De oorspronkelijke kanttekening over `rating_a`'s dubbele rol bleek niet het echte punt. Het
werkelijke onderliggende vraagstuk: sommige generators zijn native uit te lezen (eigen telemetrie-
protocol), andere niet — daar hangt dan een Shelly+CT-klem aan, net als bij een kast. **Mike wil de
native-telemetrie-protocolintegratie expliciet pas bij v3 oppakken.** Voor deze v2-rework gaan we er
dus van uit dat elke uitgelezen generator/groep via een Shelly loopt, met dezelfde MQTT-vorm
(`status/em:0`) als een kast — precies zoals het nu al werkt. Geen aparte databron/acquisitiemethode
te ontwerpen in deze ronde; dat is bewust uitgesteld, geen aanname die nu gemaakt hoeft te worden.

## Punten 1, 2, 3: bevestigd door Mike

Alle drie herkend als reële pijnpunten. Twee dingen liggen nog open voordat dit een volwaardige spec
wordt:

## Nog openstaande vragen

- **Bij punt 1 (groep-onderverdeling):** is per-lid live status realistisch gegeven dat één
  Shelly/CT-klem doorgaans één punt in de keten uitleest? Ofwel: blijft dit voor nu een puur
  UI-vraagstuk (met de bestaande één-meting-per-groep-data, dus bijvoorbeeld alleen de leden-namen/
  kVA/soort duidelijker tonen náást die ene meting, zonder per-lid cijfers), of hangt hier ook een
  "meerdere Shelly's per groep, één per lid"-hardwarevraag aan die eerst beantwoord moet worden?
- **Bij punt 2 (klik-interactie generator-pin):** dit lijkt de goedkoopste losse verbetering — wil
  je die apart en eerder oppakken, los van de rest van deze rework, of in dezelfde slag meenemen?

Zodra deze twee beantwoord zijn, maak ik er een echte spec/mockup van — niet eerder, conform de
v2-roadmap-werkafspraak.
