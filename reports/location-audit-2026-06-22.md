# Provider location audit — 2026-06-22

## Corrected in V2.19

| Provider | Previous map location | Corrected map location | Coordinate precision | Evidence status |
| --- | --- | --- | --- | --- |
| The Dickerson Corporation | Pittsburgh, PA | Ripley, WV | City centroid (`38.818700, -81.710700`) | User-confirmed; exact street address and public source pending |
| Hower Well Services | Pittsburgh, PA | Flora, IL | City centroid (`38.668900, -88.485600`) | User-confirmed; exact street address and public source pending |
| Western Construction - EKY | Pikeville, KY | Prestonsburg, KY | City centroid (`37.665700, -82.771500`) | User-confirmed; exact street address and public source pending |
| Miller Supply of Kentucky, Inc. | Pikeville, KY | Ivel, KY | City centroid (`37.596200, -82.671300`) | User-confirmed city; company location source retained; exact street address pending |
| Geo. N. Mitchell Drilling Company | South-of-Carmi coordinate | Carmi, IL | City coordinate (`38.090900, -88.158600`) | Dataset city/source already said Carmi; coordinate inconsistency corrected |
| Les Wilson, Inc. | South-of-Carmi coordinate | Carmi, IL | City coordinate (`38.090900, -88.158600`) | Dataset address already said Carmi; street-level geocode pending |

The original V2.18 CSV is retained unchanged. The application now reads `DOG_Continental_US_Oilfield_Service_Provider_Map_V2_19_Location_Audit.csv`.

## Dataset-wide location risk

- 521 total provider/location rows
- 352 rows explicitly need a physical street address
- 52 rows are unverified user-provided leads
- 50 coordinate groups are shared by two or more providers
- The largest city-centroid stack contains 76 rows at Houston's center

Shared coordinates are not automatically errors: several providers can legitimately operate in the same city. They are strong indicators that a marker represents a city placeholder instead of an actual office, yard, or shop.

## Remaining Pittsburgh cluster

The erroneous five-provider Pittsburgh stack is now reduced to three records requiring separate review:

- Allegheny Control Products
- Hunt Geophysical
- West Penn Energy Services (a second, regional row exists in addition to the sourced Shelocta record)

No provider should be moved or deleted solely because it shares a coordinate. Confirm against the company's contact/location page, a state business registration, or direct contact first.

## Recommended verification order

1. The 52 unverified user leads.
2. Duplicate company records where one row has a sourced street address and another is a regional placeholder.
3. Large shared-coordinate stacks, beginning with Houston, Oklahoma City, Bakersfield, and Midland.
4. Remaining city-centroid records, prioritized by High business priority.

The weekly audit now emits the complete shared-coordinate review queue in `reports/provider-audit.json`.
