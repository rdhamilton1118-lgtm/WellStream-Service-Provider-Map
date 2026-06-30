# WellStream Provider Atlas

The interactive application is built with React 19, Vite, and Leaflet. Start the local development site with `npm run host`, create a production bundle with `npm run build`, and preview that bundle with `npm run preview`.

A responsive, searchable map for the 521-location oil and gas service provider dataset supplied with this project.
V2.20 corridor-expansion layers for Gillette and Dickinson add newly discovered oilfield and gasfield candidates without misrepresenting map-only evidence as verified company data.

Company-sourced provider layers, such as Nine Energy Service's complete U.S. service matrix, contain branch-level addresses, phones, coordinates, service lines, and verification dates from official location pages. Multi-service facilities are consolidated into one marker while genuinely separate facilities in the same city remain distinct.
Parent/subsidiary references are also reconciled across official service and contact pages; Stoneham Drilling's Denver office and Williston field base are maintained as separate verified locations.

## Run locally

Browsers do not allow a local HTML file to fetch a neighboring CSV directly, so serve the folder:

```powershell
npm run dev
```

Open `http://localhost:4173`. Use the control beneath the zoom buttons to switch between the OpenStreetMap street view and Esri satellite imagery with road and place-label overlays. Both basemaps need an internet connection.

For the alternate local host on port 8080:

```powershell
npm run host
```

Then open `http://localhost:8080`.

## Weekly data maintenance

The included GitHub Actions workflow runs every Monday at 11:15 UTC. It checks provider websites, detects likely duplicate company/location rows, and commits `reports/provider-audit.json` when findings change. Run the same audit locally with:

```powershell
npm run audit
```

The audit deliberately does not auto-delete a provider after one failed request. Website blocks, timeouts, and temporary outages are common. Its report includes website failures, probable duplicates, records needing street addresses, unverified leads, and shared-coordinate clusters. Confirmed changes belong in the V2.20 base or a documented corridor-expansion layer. Adding brand-new providers automatically requires a defined discovery source or licensed search/data API.

Provider enrichment includes an explicit Maps/business-profile pass for street address, phone, website, category, and Plus Code. Map-derived contact information remains labeled separately from company-source verification.

Run `npm run enrich:providers:dry` to rebuild the existing-provider gap queue. With `GOOGLE_PLACES_API_KEY` configured, `npm run enrich:providers -- --limit=50` researches the next batch and stages address, phone, website, coordinates, business status, Plus Code, and Maps URL suggestions for review. The weekly Tuesday workflow repeats this pass without automatically overwriting the live master list.

Generate the market-by-market expansion queue with `npm run research-queue`. The governing process is documented in `research/RESEARCH_STANDARD.md`.

Generate the nationwide discovery plan with `npm run discover:nationwide:dry`. A live run requires a Google Places API key in `GOOGLE_PLACES_API_KEY`; candidates are staged for research review and are never promoted automatically. Use `npm run discover:nationwide -- --limit-markets=50` for controlled batches, then run `npm run discover:nationwide:review` to score likely oil/gas provider leads and hold noisy adjacent Google results. Run `npm run discover:nationwide:details -- --limit=200` to enrich the strongest review leads with Google Places Details such as phone, website, address, coordinates, business status, and Maps URL. Use `npm run discover:nationwide:promote` to create the conservative live Batch 1 layer after details enrichment; held leads remain in the promotion report for manual/company-source review.

Use `npm run discover:nationwide -- --theme=oilfield` for the focused Google Maps-style exact `oilfield` search demonstrated in Gillette. It runs independently across every market anchor and checkpoints each completed query into the nationwide candidate queue.

Refresh configured petroleum-association buyers' guides with `npm run discover:associations`. The source registry currently covers Montana, Kansas, North Dakota, Pennsylvania, and West Virginia, and writes deduplicated review candidates to `research/association-guide-candidates.json`.
The latest per-state totals and master-list match counts are written to `reports/association-guide-sweep-summary.json`.

## Image-directory ingestion

New directory scans placed in `assets` can be processed with `npm run assets:ocr`, then structured with `npm run assets:extract`. Run `npm run assets:enrich` to corroborate likely oil/gas provider locations against current Places data and `npm run assets:promote` to rebuild the reviewed live layer. OCR text, candidates, current-place matches, and promotion reports remain separate so every promoted address and contact field retains image-level provenance.

At regional map zooms, providers sharing the same or nearby locations are condensed into numbered area markers. Select a numbered marker to zoom into the individual provider constellation.
