# Event Stroom-Dashboard — roadmap v2 (afgerond)

> Voor omschrijving en featurelijst: zie [event_dashboard.md](event_dashboard.md). Voor de
> actieve roadmap: zie [roadmap_v3.md](roadmap_v3.md). Overzicht van alle roadmap-bestanden:
> [roadmap.md](roadmap.md).

## Roadmap v2 (afgerond, uitgebracht als [v2.0.0](https://github.com/Tbizla/stroom-dashboard/releases/tag/v2.0.0))

> **Werkafspraak vanaf nu**: voor elk van onderstaande punten eerst een uitgebreide spec/plan
> uitwerken en afstemmen vóórdat er gebouwd wordt — geldt voor zowel de Cowork- als de Code-kant
> (zie ook de afspraak hierover in CLAUDE.md). Geen van de items hieronder is dus "zomaar" te
> starten, ook niet de kleine.

- [x] **MQTT-topic-prefix van `fest` naar `site`, plus InfluxDB-org `festival` → `site`.** Afgerond
      — zie README.md §14 voor de migratiestappen op een bestaande instance (InfluxDB-org hernoemen,
      topologie-data bijwerken, fysieke Shelly's herconfigureren). **Laatste openstaande punt voor
      v2 — v2-roadmap is hiermee compleet.**
- [x] **Audit: stuurt de Shelly alle data die 'm publiceren kan?** Afgerond. Conclusie: er mist
      data. Eén bevinding (fasefrequenties) wordt nu opgepakt, zie hieronder; de rest is
      doorgeschoven naar v3 (zie [roadmap_v3.md](roadmap_v3.md)).
- [x] **Fasefrequenties tonen (`a_freq`/`b_freq`/`c_freq`).** Afgerond — zie de
      Live-monitoring-feature in event_dashboard.md.
- [ ] *(meer volgt)*
