# Market expansion research standard

The provider map is a living market census, not a one-result-per-city directory.

## Definition of done for one market

A community is not considered researched until all of these passes are complete:

1. Search the industrial corridors and nearby towns visually, not only the city name.
2. Search every service family: drilling, completions, production, supply, fluids/environmental, construction, logistics, automation/measurement, and safety.
3. Run a separate gasfield pass for compression, gathering systems, pipeline integrity, gas processing and dehydration, measurement, methane/leak detection, emissions compliance, gas-well dewatering, and midstream facility construction.
4. Use both vocabularies explicitly: `oilfield`, `oil well`, `gasfield`, `natural gas`, `gas well`, `CBM`, `coalbed methane`, `upstream`, and `midstream`, combined with the town, county, basin, and nearby industrial corridors.
5. Check company contact/location pages, state oil-and-gas operator and contractor records, current business registrations, and reputable map/business listings. Open the business in Maps rather than relying only on the search-results label.
6. Follow each confirmed provider's neighbors and related-company results for additional candidates.
7. Record the exact facility address, coordinates, phone, website, source URL, service evidence, and verification date.
8. Keep map-only discoveries labeled `Discovery`; promote them to `Verified` only after independent source confirmation.
9. Record closed, moved, acquired, or duplicate providers rather than silently dropping them.

## Contact and map-profile enrichment

Every provider with a placeholder address, phone, website, or city-centroid marker must receive a public-profile enrichment pass. Capture the displayed business name, full street address, phone, website, business category, Plus Code when available, profile/source URL, and access date. Use the street address for the map-search link.

If ordinary geocoding fails but a Plus Code is public, decode the Plus Code relative to the named locality and store those coordinates with `Plus Code geocode` precision. Preserve the original city-centroid coordinates in the audit columns.

A reputable public business profile can move a record from an unsourced lead to `Map-profile enriched`; it does not by itself prove every claimed service or current operating status. Confirm service scope and active status against the company's website, an association/regulator source, or direct contact before marking it `Verified`.

Use licensed Places/search APIs for automated collection and follow the source's terms. User-supplied screenshots and public profile details may be entered with explicit evidence and access dates; never infer missing contact data.

## Coverage rule

Finding one provider never closes a market. Research continues until two consecutive discovery passes produce no new relevant companies and all service-family gaps are either populated or explicitly documented as unavailable locally.

## Automation

Run `npm run research-queue` to regenerate `reports/market-research-queue.json`. It ranks thin markets and shows missing service families. Run `npm run audit` for source, website, duplicate, and coordinate checks.

Automated discovery should use a licensed places/search data source. Search results are candidate evidence, not permission to mark a company verified or delete an existing record.

## Nationwide discovery

Run `npm run discover:nationwide:dry` to inspect the market and query manifest without making API calls. Live discovery requires `GOOGLE_PLACES_API_KEY` and runs with `npm run discover:nationwide`. Results are checkpointed in `research/nationwide-discovery-candidates.json` and remain outside the live provider layer until reviewed.

The weekly GitHub workflow processes 12 unfinished markets per batch. Every market receives 14 oilfield, gasfield, upstream, midstream, environmental, supply, logistics, safety, technology, and learned local-provider-pattern searches within roughly 65 km. Existing names are excluded and Places IDs are deduplicated across overlapping market searches.

The discovery vocabulary also learns from recurring local-company naming patterns observed in corridor sweeps: `well service`, `field services`, `mobile testing`, `hydro testing`, `pump and supply`, `tool supply`, `inspection`, `pipe yard`, `hot shot`, `compressor`, `engine service`, `roustabout`, and `project services`. These are searched as service patterns, not exact national company names, to surface independent local providers.

For corporate families, research the parent company, operating subsidiaries, service pages, contact pages, and rig/fleet maps separately. A subsidiary service page may prove current capability while the parent contact page supplies the actual U.S. offices and field bases, as with Western Energy Services Corp. and Stoneham Drilling.

Association buyers' guides are a separate discovery channel. Preserve the association, guide category, listing URL, listed address, and scan date. A guide listing is stronger than an unsourced map lead but still requires confirmation against the provider's current website, direct contact, or another authoritative source before promotion to `Verified`.
