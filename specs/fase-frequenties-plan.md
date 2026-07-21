`🚧 DEV-V2 🚧`

# Fasefrequenties tonen — korte spec

Vervolg op bevinding 1 in [shelly-data-audit.md](shelly-data-audit.md). Mike kiest dit als enige
item om nu op te pakken; de rest van de audit-bevindingen gaat naar v3 (zie
[event_dashboard.md](../event_dashboard.md) Roadmap v3).

Klein genoeg voor een korte spec i.p.v. een mockup: het voegt één rij toe aan een bestaande tabel,
in exact hetzelfde patroon als de rijen ernaast — geen nieuw visueel element om te valideren.

## Wat

`a_freq`/`b_freq`/`c_freq` (Hz, per fase) worden al door elke Shelly gepubliceerd in `status/em:0`
en komen al ongewijzigd door Telegraf heen (scalaire velden, geen parser-aanpassing nodig — zie de
audit). Puur een presentatielaag-toevoeging, geen nieuwe databron.

## Waar (design)

- **`kastpopup.js`**: nieuwe tabelrij "Frequentie" onder de bestaande rijen (Stroom/Spanning/Act.
  vermogen/Schijnb. vermogen/cos φ), zelfde `fmtVeld()`-patroon, eenheid "Hz", 1 decimaal
  (frequentie-afwijkingen zijn doorgaans klein, bijv. 49,8 Hz i.p.v. 50,0 Hz — 1 decimaal is genoeg
  resolutie, 2 zou schijnnauwkeurigheid suggereren).
- **`render-detail.js` (`metingenHtml()`)**: toegevoegd aan de bestaande per-fase metric-regel
  ("Fase A" · stroom · spanning) i.p.v. een aparte regel — dus "Fase A: X A · Y V · Z Hz" op één
  regel, consistent met hoe stroom en spanning daar nu ook al samen op één regel staan.
- Geen wijziging aan groen/amber/rood-statuslogica, geen nieuwe kleurcode — puur een extra
  getalswaarde naast wat er al staat.

## Wat het niet is (bewust buiten scope, tenzij je anders wilt)

- Geen alert-drempel/statuskleur op frequentie-afwijking — dat zou een aparte designbeslissing zijn
  (eigen conventie naast groen/amber/rood), niet iets wat impliciet meekomt met "gewoon tonen".
- Geen Grafana-paneel — kan er los bij als gewenst, maar niet gevraagd; laat ik achterwege tenzij je
  't alsnog wilt.

## Vervolg

Klaar voor Claude Code — geen technisch fundament-vraagstuk hier (scalaire velden, komen al door,
zuiver een frontend-weergavewijziging in twee bestaande bestanden).

## Status

Afgerond en geverifieerd (2026-07-21). `kastpopup.js` heeft een "Frequentie"-rij gekregen (1
decimaal, Hz) en `render-detail.js` toont 'm op de bestaande per-fase regel
("Fase A: X A · Y V · Z Hz"), exact zoals hierboven beschreven. De simulator (`simulator/index.js`)
publiceert nu ook `a_freq`/`b_freq`/`c_freq` (rond 49,9–50,1 Hz), zodat het ook in testmodus
zichtbaar en verifieerbaar is — dat stond niet expliciet in de spec maar was nodig om de aside-
detail en de kastpopup-tabel in de browser te kunnen controleren. Geverifieerd met Playwright op de
Live-tab (aside-detail + kastpopup-databallon), geen console-fouten anders dan een niet-gerelateerd
ontbrekend favicon.ico.
