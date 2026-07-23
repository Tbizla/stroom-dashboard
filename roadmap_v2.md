# Event Stroom-Dashboard — roadmap v2 (afgerond)

> Voor omschrijving en featurelijst: zie [event_dashboard.md](event_dashboard.md). Voor de
> actieve roadmap: zie [roadmap_v3.md](roadmap_v3.md). Overzicht van alle roadmap-bestanden:
> [roadmap.md](roadmap.md).

## Roadmap v2 (afgerond, uitgebracht als [v2.0.0](https://github.com/Tbizla/stroom-dashboard/releases/tag/v2.0.0))

> Werkafspraak voor deze en alle latere roadmap-golven (spec/plan eerst, dan pas bouwen): zie
> "Overige afspraken" in [CLAUDE.md](CLAUDE.md) — dat is de canonieke plek, niet hier of in
> roadmap_v3.md herhalen.

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
