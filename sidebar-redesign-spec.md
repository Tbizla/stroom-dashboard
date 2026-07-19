# Designvoorstel: sidebar (lijst generators & kasten)

> Status: voorstel vanuit Cowork (UI/UX), ter implementatie door Claude Code. Geen directe edit
> in `webapp/public/index.html` gedaan — zie CLAUDE.md-afspraak over losse mockup/spec.

## Probleem

De aside-lijst (`#list` in `Kalibreren`- en `Live`-modus) toont nu alle generators en al hun
kasten altijd volledig uitgeklapt, plat onder elkaar. Bij een topologie met veel generators en/of
diepe parent/child-ketens (zie de uitgebreide testtopologie: 5 generators, 80 kasten, tot 10
niveaus diep) is dit onoverzichtelijk — je moet lang scrollen en er is geen overzicht van waar een
probleem zit zonder alles langs te lopen.

## Doel

1. Generatorgroepen inklapbaar maken, met een statussamenvatting die ook ingeklapt zichtbaar
   blijft.
2. Kasten met eigen onderliggende kasten (parent/child-keten) ook inklapbaar maken, met een
   "N onderliggend"-indicator.
3. Zoeken en snel filteren op status (amber/rood), werkend over alle groepen heen — ook binnen
   ingeklapte groepen.
4. Inklap-status onthouden tussen sessies/tabwissels.

## Scope

Alleen de aside-lijst (`#list`, met de bestaande `genrow`/`row`-structuur) in de `Kalibreren`- en
`Live`-weergave. Geen wijziging aan de Beheer-tabellen, het Schema-tabblad (heeft al een
boomdiagram met eigen zoom/pan) of de plattegrond/pin-logica zelf.

## Gedrag in detail

### 1. Generator-header wordt een toggle

`.genrow` (nu alleen sticky label) krijgt:
- Een chevron-icoon vóór de naam (▾ open / ▸ dicht), klikbaar over de hele rij.
- Rechts, naast de bestaande kVA-waarde, drie kleine statusbadges: aantal groen / aantal amber /
  aantal rood binnen die generator (recursief over de hele keten eronder, dus ook diep geneste
  kasten tellen mee). Badge met 0 mag weggelaten worden i.p.v. "0" tonen.
- Bij klikken op de chevron/rij: toggle alleen de directe kasten-rijen van díe generator
  (`display:none`/`block`), geen re-render van de hele lijst nodig.

### 2. Kasten met kinderen worden ook een toggle

Een kast die zelf weer kasten voedt (staat als `parent` in een andere kast) krijgt dezelfde
chevron-behandeling als de generator-header:
- Chevron + naam + status-dot, plus rechts `"N onderliggend"` (klein, `--text3`) i.p.v. de
  kinderen meteen te tonen.
- Kinderen worden met extra `padding-left` (staffeling per niveau, bijv. +14px per niveau diep)
  getoond zodra opengeklapt — dit kan meerdere niveaus diep rekursief doorwerken.
- Kasten zónder kinderen blijven een gewone rij zoals nu.

### 3. Default open/dicht state

- Bij een topologie met weinig generators (bijv. ≤2, zoals de eenvoudige testtopologie): alles
  standaard open, huidig gedrag blijft voor kleine sets intact.
- Bij meer generators: generatoren zonder amber/rood-kasten staan standaard dicht; generatoren
  mét amber/rood staan standaard open. Drempel voor "veel" mag een simpele constante zijn (bijv.
  >3 generators) — geen ingewikkelde heuristiek nodig.
- Genest-kasten-niveaus (punt 2) staan altijd standaard dicht, ongeacht status van de generator
  zelf — dat voorkomt dat één rode kast diep in een keten de hele boom openklapt.

### 4. Onthouden van open/dicht per sessie

Gebruik hetzelfde patroon als de bestaande zoom-opslag (`ZOOM_STORAGE_KEY` /
`stroomdash_zoom_v1` in `localStorage`, zie `webapp/public/index.html`): een nieuwe key,
bijv. `stroomdash_sidebar_v1`, met een object `{ [generatorId]: bool, [kastId]: bool }` voor
open/dicht. Alleen expliciete gebruikersacties overschrijven deze state; een topologiewijziging
(nieuwe kast toegevoegd) mag de bestaande state laten staan en alleen voor nieuwe id's de
default (punt 3) toepassen.

### 5. Zoekbalk

Nieuw tekstveld bovenaan de aside, boven `.listhead` of erin verwerkt:
- Placeholder: `Zoek op naam of afkorting...`
- Filtert live (op elke toets, geen submit-knop) op zowel kast-/generatornaam als de afkorting
  (`afk`-veld uit Beheer).
- Bij een match die zich in een ingeklapte groep/kast bevindt: die groep/kast klapt automatisch
  open zolang de zoekterm actief is (niet de onthouden state overschrijven — herstel bij het
  legen van het zoekveld naar wat `localStorage` zegt).
- Niet-matchende rijen: verbergen, niet grijs maken (behoud van overzicht is het doel).

### 6. Statusfilter-chips

Twee knoppen naast/onder de zoekbalk, met dezelfde chip-stijl als bestaande `.calbar button`
maar rond (`border-radius:12px`, kleiner lettertype):
- **Alles** (default, actief)
- **Amber+** — toont alleen kasten met status amber of rood (en hun voedende generators/
  parent-kasten, anders zijn ze niet bereikbaar in de boom)
- **Alleen rood** — toont alleen kasten met status rood (idem, met voedingspad zichtbaar)

Filter en zoekbalk zijn AND-gecombineerd (een zoekterm binnen het amber+-filter zoekt alleen
binnen die subset).

### 7. "Alles inklappen" / "Alles uitklappen"

Eén knop rechts van de filter-chips die toggle tussen "Alles inklappen" en "Alles uitklappen"
(tekst wisselt naar de tegenovergestelde actie, zoals bij de bestaande zoom-knoppen). Werkt op
zowel generator- als kast-niveau in één keer, en overschrijft daarmee de onthouden
per-item-state in `localStorage`.

## Technische randvoorwaarden (uit CLAUDE.md, ter herinnering voor implementatie)

- Alles blijft binnen het bestaande `webapp/public/index.html` (één bestand, geen framework/
  build-stap) — geen nieuwe library's, gewoon vanilla JS/DOM zoals de rest van het bestand.
- Statuskleuren groen/amber/rood blijven de vaste betekenis (stroom t.o.v. `rating_a`) — de
  badges in punt 1 zijn puur een telling van bestaande status, geen nieuwe kleurcodering.
  Taal/labels in het Nederlands, consistent met de rest van de UI (kast, generator, groep,
  batterij, plattegrond).
- Dit raakt niet de percentage-based plaatsing of de fit-to-screen-logica van de kaart/schema —
  puur de aside-lijst.

## Niet in scope / open vragen voor Claude Code

- Of de statustelling (punt 1) live moet meebewegen met binnenkomende MQTT-data in `Live`-modus,
  of alleen bij openen/wisselen van tabblad herberekend wordt — functioneel het nettst is live
  meebewegen, maar dat is een implementatiekeuze i.v.m. performance bij 80+ kasten.
- Exacte iconen voor de chevron (huidige mockup gebruikt een simpel ▾/▸ teken; een SVG-icoon mag
  ook, zolang het geen externe library toevoegt).
