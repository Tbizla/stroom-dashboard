# Designvoorstel: kasten groeperen per stroombron in Beheer

> Status: voorstel vanuit Cowork (UI/UX), ter implementatie door Claude Code. Geen directe edit
> in `webapp/public/index.html` gedaan — zie CLAUDE.md-afspraak over losse mockup/spec.

## Probleem

De `Kasten`-tabel in de Beheer-tab (`#kastTable`) toont nu alle kasten van alle generators/groepen
plat onder elkaar, met alleen een "Gevoed vanaf"-kolom die de parent aangeeft. Bij veel
generators/kasten (zie de uitgebreide testtopologie: 5 generators, 80 kasten) is niet in één oogopslag
te zien welke kasten bij welke stroombron horen zonder de tabel regel voor regel na te lopen.

## Doel

Kasten visueel groeperen per stroombron (generator, of een groep als geheel) in plaats van één
platte tabel, met behoud van de bestaande parent/child-indentatie binnen een groep, plus een
zoekbalk en filters om snel te vinden/beperken wat je ziet.

## Scope

Alleen de `Kasten`-sectie van de Beheer-tab (`#kastTable` + het bijbehorende addform). Geen
wijziging aan de Generators-sectie, het toevoegformulier zelf (blijft bestaan, zie punt 6), of
enige andere tab.

## Gedrag in detail

### 1. Sectie per stroombron

Vervang de platte `#kastTable` door een lijst van secties, één per generator/groep (in dezelfde
volgorde als de Generators-tabel erboven). Elke sectie-header toont:
- Chevron-toggle (▾ open / ▸ dicht) voor de hele sectie.
- Naam van de generator/groep, met bij een groep het aantal leden erbij (zie bestaande
  `ledenrow`-notatie), bijv. "Centrum (groep — 4 aggregaten + batterij)".
- kVA-waarde (rechts, monospace, zoals nu in `genTable`).
- Aantal kasten in die sectie (recursief, dus inclusief geneste child-kasten).

Kasten die rechtstreeks op de generator/groep hangen (`parent === null`) staan direct in de
sectie-tabel; kasten die op een andere kast zijn aangesloten staan genest met indentatie en een
`↳`-prefix, exact zoals in het sidebar-voorstel (`sidebar-redesign-spec.md`) — beide voorstellen
mogen dezelfde inklap-/indentatiecomponent delen als dat handiger implementeert.

### 2. Inline "+ Kast op ..." per sectie

Onderaan elke sectie een knop `+ Kast op <naam stroombron>` die het bestaande addform-gedrag
(`#newKastNaam`, `#newKastAfk`, `#newKastRating`, etc.) triggert met `newKastGen`/`newKastParent`
al vooringevuld op die stroombron — scheelt scrollen naar het algemene formulier onderaan bij het
snel toevoegen van meerdere kasten aan dezelfde bron.

### 3. Zoekbalk

Tekstveld boven de secties, placeholder `Zoek op naam, afkorting of stroombron...`. Filtert live
op kastnaam, `afk`, én de naam van de stroombron waar de kast (uiteindelijk, ook via meerdere
niveaus) aan hangt. Niet-matchende kasten verbergen; een sectie zonder overgebleven matches wordt
volledig verborgen (niet leeg tonen).

### 4. Typefilters

Filterchips onder de zoekbalk, zelfde chip-stijl als het sidebar-voorstel
(`border-radius:12px`, actieve chip in `--accent`/`--accent-dim`):
- **Alles** (default)
- **Kasten** — alleen kasten van het gewone type
- **Batterijen** — alleen kasten van het type batterij (piekscheerder)
- **Bypass actief** — alleen kasten met de bypass-vlag aan

Filters zijn AND-gecombineerd met de zoekbalk. Wanneer een filter kasten uit een sectie wegfiltert
maar de sectie zelf nog kasten overhoudt, toon een regel `+ N kasten verborgen door filter "<naam
filter>"` onderaan die sectie — zodat duidelijk is dat er meer is dan getoond, in plaats van de
indruk te wekken dat de groep klein is.

Bewust géén status (groen/amber/rood) filter hier, in tegenstelling tot het sidebar-voorstel:
Beheer is topologiebeheer, geen live weergave, dus filteren op type/bypass past beter bij het
daadwerkelijke gebruiksdoel van dit tabblad.

### 5. Inklappen

Zelfde "Alles inklappen"/"Alles uitklappen"-knop als het sidebar-voorstel, rechts naast de
`Kasten`-kop. Onthouden van open/dicht-state mag dezelfde `localStorage`-key/aanpak hergebruiken
als in `sidebar-redesign-spec.md` (bijv. `stroomdash_sidebar_v1`), zodat de staat consistent is
tussen Beheer en de Kalibreren/Live-aside als je tussen tabs wisselt — of een eigen key als dat
implementatiematig schoner is; geen harde eis.

### 6. Algemeen toevoegformulier blijft bestaan

Het bestaande addform (`#newKastNaam`, `#newKastAfk`, `#newKastRating`, `#newKastGen`,
`#newKastParent`, `#addKastBtn`) onderaan de hele lijst blijft ongewijzigd beschikbaar voor het
vrij kiezen van een stroombron — punt 2 is een snelkoppeling, geen vervanging.

## Technische randvoorwaarden (uit CLAUDE.md, ter herinnering voor implementatie)

- Alles blijft binnen het bestaande `webapp/public/index.html` (één bestand, geen framework/
  build-stap), vanilla JS/DOM.
- Taal/labels in het Nederlands, consistent met de rest van de UI.
- Cyclusdetectie en auto-doorkoppelen bij verwijderen van een tussenliggende kast (bestaand
  gedrag in `server.js`) verandert niet — dit voorstel is puur presentatie/filtering aan de
  clientkant.

## Niet in scope / open vragen voor Claude Code

- Of "Bypass actief" als filter zinvol is zodra er nog geen batterij-kasten met bypass in de
  huidige topologie zitten (dan toont de chip gewoon 0 resultaten) — geen probleem, maar wel iets
  om in het oog te houden bij het testen met de eenvoudige testtopologie (die heeft geen
  batterij-/groepstype).
- Exacte gedeelde implementatie van de inklap-/indentatiecomponent met het sidebar-voorstel: kan
  als één herbruikbare JS-functie, hoeft niet per se — functioneel gedrag moet wel overeenkomen.
