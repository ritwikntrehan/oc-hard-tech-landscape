# SCHTMap capital, events and ecosystem layer v1

This layer expands SCHTMap from a company register into a small industrial-intelligence graph.

## New tables
- `data/capital_rounds.json` — sourced financing rounds, valuations and investors.
- `data/financial_snapshots.json` — dated revenue / valuation / transaction-value observations with basis.
- `data/events_ledger.json` — normalized public event stream.
- `data/ecosystem_entities.json` — investors, agencies, customers, partners and acquired businesses.
- `data/ecosystem_relationships.json` — company-to-entity edges with dates, amounts and evidence.
- `data/data_availability.json` — 100-company public-data availability matrix.

## Current starter depth
- Capital rounds: 16
- Financial snapshots: 5
- Event ledger rows: 46
- Ecosystem entities: 62
- Ecosystem relationships: 73

## Modeling rules
- Round amount, valuation and revenue are separate facts.
- Reported revenue for an acquired business is not silently treated as acquirer revenue.
- Rumored / in-discussion financings are excluded from the canonical capital ledger.
- Contract ceiling / potential award is labeled in context rather than assumed to equal recognized revenue.
- Investor/customer/government/supplier relationships are explicit edges rather than free-text company notes.
- Missing data remains missing.
- The `public_data_richness_pct` field measures how much public information SCHTMap currently has, not company quality.

## Next collection cycle
1. Backfill 2024–2026 events for the highest-activity 25 companies.
2. Expand investor relationships across every company with a public funding event.
3. Add contract/grant amount, agency and award ID where government records are public.
4. Add annual or LTM revenue only for public companies or private companies with direct/reputable reported figures.
5. Add employee snapshots over time where a dated source is available.
6. Build facility-expansion / capex events separately from financing events.
