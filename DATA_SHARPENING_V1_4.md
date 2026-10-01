# SCHTMap data sharpening v1.4

Date: 2026-10-01

This pass targets fields that now visibly power the public product rather than doing a generic enrichment scrape.

## Enriched companies
Comtech Space Components and Antennas, HawkRobo, Ryvid, Hop Aero, Creabot, Makani Science, Soaring Aerospace, VinMotion, and Therabot.

## Coverage after pass
- Companies: 100
- Mapped location records: 107
- Capability links: 449
- Named / normalized product records: 112
- Public events: 39
- Sources: 311
- Companies with manufacturing/process detail: 53
- Companies with leadership detail: 67
- Companies with ownership detail: 74
- Companies with employee detail: 78
- Companies with public capital records: 21
- Government/public-sector signals: 14
- Hiring signals: 24
- Companies with 2+ sources: 89
- Exact street addresses: 85

## Important integrity decisions
- VinMotion: current sources support a Cypress-area U.S. R&D presence but did not support the prior exact street address, so street precision was removed and the location is marked for re-verification.
- Therabot: retained because it is part of the historical map seed, but current OC presence remains unverified and is marked low-confidence / re-verification.
- Ryvid: founding year remains unknown in the canonical record because current public sources conflict between 2020 and 2021.

## Next batch
Prioritize remaining thin public dossiers: Lanic Aerospace, Halo Industries, Lantronix, TOMI Engineering, Xcelerium, eControls, Evergreen Biotech, Ibis Industries, SQUID3 Space, West Coast Solutions, plus deeper event history for companies already well-covered.
