`🚧 DEV-V2 🚧`

# PDF-rapport formatting-review (roadmap-item 7)

Apart deelproject bij [rebuild-plan-v2.md](../rebuild-plan-v2.md) §6/§8 fase 5 — vóór de
logo-implementatie gebouwd wordt, zoals de roadmap expliciet vereist. Mockup:
`pdf-rapport-mockup.html` (open in browser; drie paginamockups op A4-liggend-formaat, 842×595pt,
zelfde afmeting als `webapp/server.js` nu al gebruikt voor de placeholder-pagina).

## Huidige situatie (`webapp/server.js`, `voerRapportGeneratieUit`)

Het PDF-rapport is nu **kaal**: geen coverpagina, geen logo, geen voettekst, geen paginanummering.
Het bestand is simpelweg een aaneenschakeling van losse Grafana-paneel-PDF's
(generatorTotalen/kastPerFase/sankey, elk via `/render/d-solo`), plus — als "Overschrijdingen &
alarmen" is aangevinkt — één kale pagina met een grijze regel Helvetica-tekst
(`voegPlaceholderPaginaToe`). Er is dus geen bestaand format om het logo "in te passen"; er moet
een format bij komen.

## Voorstel (drie mockups)

1. **Coverpagina (nieuw)** — logo, eventnaam, titel, editie/periode/gegenereerd-op, en een simpele
   inhoudsopgave die precies toont welke onderdelen zijn aangevinkt (en welke bewust zijn
   overgeslagen, zoals "alarmen" hierboven) — dat maakt in één oogopslag duidelijk wat wel/niet in
   dit specifieke rapport zit, iets wat nu nergens zichtbaar is.
2. **Voettekst op elke paneelpagina** — de bestaande Grafana-paneelpagina's blijven zelf
   ongewijzigd (dat is Grafana's eigen render, geen webapp-styling); er komt alleen een dunne
   voettekststrook overheen (pdf-lib `drawImage`/`drawText` na `copyPages`) met een klein
   logo-merkje, eventnaam/editie en paginanummer.
3. **Alarmen-placeholder herstyled** — dezelfde voettekst, plus een nette kop en een duidelijk
   vlak met icoon i.p.v. de huidige kale grijze tekstregel.

## Aandachtspunt: licht i.p.v. donker thema voor het rapport

De webapp zelf is bewust donker (regie-omgeving, wisselend licht in een tent). Een PDF-rapport is
een ander soort artefact — bedoeld om na afloop uit te printen of te delen met stakeholders die de
webapp nooit gezien hebben. Voorstel: het rapport licht/print-vriendelijk houden (wit/lichtgrijs
met het bestaande accent-teal als merkkleur voor logo/kop), in plaats van het donkere thema
1-op-1 door te trekken — dat scheelt inkt bij printen en oogt professioneler in een gedeeld
document. Dit is een bewuste afwijking van het donkere thema uit §5, niet een vergissing.

## Openstaande vraag aan Mike

Akkoord met de lichte/print-vriendelijke stijl voor het rapport (i.p.v. het donkere thema van de
webapp doortrekken)? En akkoord met de drie mockups (cover, voettekst, alarmen-pagina) als basis
voor Code om de logo-implementatie op te bouwen?
