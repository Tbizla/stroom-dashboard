`🚧 DEV-V2 🚧`

# i18n proof-of-concept — bevindingen (Beheer-tab)

Bij [rebuild-plan-v2.md](../rebuild-plan-v2.md) §6/§8 fase 2. Mockup: `i18n-beheer-poc.html`
(open in browser, klik NL/EN rechtsboven in de header).

Interactieve proof-of-concept met een echte taalkeuze-toggle (geen twee losse screenshots) op de
Beheer-tab, inclusief het "Rapport exporteren"-blok dat al conform §4 naar de hub-ingang is
verplaatst (dus niet meer in deze mockup).

## Bevindingen

- **"Kasten" → "Distribution boxes"**: gaat van 6 naar 19 tekens. Als sectiekop (`<h2>`) geen
  probleem, maar als filter-chip ("Kasten" → "Distribution boxes") wordt de chip merkbaar breder —
  bij drie/vier chips naast elkaar (Alles/Kasten/Batterijen/Bypass actief) gaat dat een regel meer
  kosten op smallere vensters. Zie gemarkeerde (stippellijn) elementen in de mockup.
- **"Rating (A)" en "Afk."/"Abbr."** blijven vergelijkbaar van lengte in beide talen — geen
  aanpassing nodig aan tabelkolombreedtes.
- **"Verdeelkast" → "Main distribution board"**: grootste uitschieter (11 → 24 tekens). Dit is
  precies het domeinterm-vraagstuk uit §2: een letterlijke vertaling ("distribution box") zou
  botsen met de algemene "kast"-vertaling. Voorstel: in tabelcellen een kortere EN-variant
  ("Main board") en de volledige term alleen in het detailpaneel/tooltip.
- **Sectiekoppen (bijv. "Generator zuid")** zijn namen, geen UI-tekst — worden niet vertaald,
  geen probleem.
- **Conclusie**: geen van de gevonden lengteverschillen breekt het huidige layout, maar filter-
  chips en tabelcellen met korte vaste breedte (`width:70px`/`80px` inline styles, zoals nu in
  `webapp/public/index.html`) hebben een iets flexibelere min-breedte nodig i.p.v. de huidige
  vaste pixelbreedtes. Dit is een concrete technische aanpassing om aan Code mee te geven bij de
  daadwerkelijke i18n-implementatie, geen doorslaggevend risico voor de aanpak zelf.

## Vervolg

Fase 2 uit §8 is hiermee afgerond. Volgende fase (§8.3): fasekleuren-mockup (bruin/zwart/grijs).
