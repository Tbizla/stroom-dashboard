`🚧 DEV-V2 🚧`

# Hub-dashboard: iframe-embed vs. herbouwen — vergelijking

Bij [rebuild-plan-v2.md](../rebuild-plan-v2.md) §3.3 / §11.3. Mockups: `hub-optie-a-iframe-embed.html`,
`hub-optie-b-herbouwd.html` (open direct in een browser).

Beide mockups tonen dezelfde IA uit het rebuild-plan: geen vijfde grote mode-tab, maar een
"Rapportages & tools"-ingang in de header met een subnav (Overzicht / PDF-rapport / Back-up).

## Optie A — iframe-embed

Grafana-panelen rechtstreeks ingebed (`<iframe src=".../d-solo/...&theme=dark&kiosk">`).

**Voordelen**
- Altijd in sync met Grafana — geen dubbele queries/logica te onderhouden
- Weinig bouwwerk: bestaande dashboards/panelen hergebruiken
- Volledige Grafana-functionaliteit gratis mee (tijdrange-picker, inspecteren, export)

**Nadelen**
- Grafana's eigen paneel-chrome (⋮-menu, kleuren, font) wijkt zichtbaar af van de webapp-stijl —
  in de mockup goed te zien aan het blauw/oranje Grafana-kleurpalet naast de groen/amber/rood-
  conventie van de rest van de app
- Vereist dat Grafana publiek/anoniem bereikbaar is vanaf hetzelfde netwerk als de webapp (of een
  aparte auth-doorgeefconstructie) — een extra technisch/beveiligingsvraagstuk
  op zich
- Kiosk-mode verbergt niet alles; sommige Grafana-chrome (tijdrange, legenda-styling) blijft

## Optie B — herbouwen als native component

Zelfde databron (InfluxDB/`topology_edges`), maar zelf getekend met de bestaande CSS-variabelen en
componentstijl (kaartjes, statuskleuren, mono-cijfers) — zie mockup: metric-cards, een staafdiagram
per kast, een compacte Sankey-achtige boomweergave die de stijl van de Schema-tab hergebruikt.

**Voordelen**
- Volledig visueel en interactief consistent met de rest van de app
- Geen afhankelijkheid van Grafana's bereikbaarheid vanuit de browser van de gebruiker
- Herbruikbare bouwstenen (bijv. Schema-tab-stijl) — minder nieuw dan het lijkt

**Nadelen**
- Elke Grafana-functie die je wilt tonen, moet je zelf bouwen en onderhouden (geen 1-op-1
  pariteit vanzelf) — tijdrange-keuze, drill-down, export moeten apart
- Twee plekken met vergelijkbare visualisatielogica (Grafana-dashboard blijft ook gewoon bestaan
  voor wie dat wil gebruiken) — een vorm van duplicatie, bewust geaccepteerd voor consistentie

## Voorlopige inschatting (geen besluit — dat ligt bij Code)

Optie B past beter bij hoe de rest van de webapp is opgebouwd (eigen visuele taal, geen externe
afhankelijkheden in de browser) en bij de bestaande filosofie van "geen framework, geen build-stap,
alles zelf getekend". Optie A is sneller te bouwen maar introduceert een tweede, zichtbaar ander
visueel systeem binnen dezelfde pagina, en een auth/bereikbaarheids-vraagstuk. Dit is een
designafweging, geen technisch besluit — de bouwinspanning en het onderhoudsrisico moet Claude Code
hiernaast leggen voordat er een keuze gemaakt wordt.
