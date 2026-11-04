# MRFP Segregated Extractor Canada — Browser v1

**Independent browser-only application for consolidated Canadian segregated-fund financial reports.** The source MRFP v6-5 distribution is not changed or overwritten. The v1 release contains the first supported issuer: **CI Investments Inc., CI Guaranteed Investment Funds**, for the supplied December 31, 2025 and June 30, 2026 templates.

## Launch and requirements

1. Extract `MRFP_Segregated_Extractor_Canada_HTML_v1_Production.zip` without changing its folder structure.
2. Open `MRFP_Segregated_Extractor_Canada_HTML_v1/index.html` in a current desktop Chrome, Edge or Firefox browser. The delivered PDF.js assets are local. No Node.js, internet connection, API, database server or account is required at runtime.
3. Choose or drag PDF reports into the queue (up to 5 at once), then click **Extract selected PDFs**. A consolidated report stays **one PDF** with fund groups and individual class rows.
4. Use **Fund selector** → **All funds** or choose an individual fund. Click a group heading to expand/collapse, use name search, and page through groups if needed. **⌕ Search** opens the original Financial Highlights source page and highlights its original MER/PTR cells; **Edit** makes a manual correction without altering original PDF source evidence.
5. Optional: **Mark document as verified** after checking it. **Re-scan** compares proposed new values before replacement. History, document restoration, reports, export, storage management and backups are available in the top navigation.
6. Choose **Excel (.xlsx)** or **CSV**; export selected fund, current PDF, recent listed PDFs or all saved documents.

**Offline operation:** Native text PDFs work entirely offline. An additional optional OCR engine is *not bundled*, so scanned/image-only PDFs are not reliably supported offline in this release. The optional local Tesseract loader expects `vendor/tesseract/tesseract.min.js` and its corresponding offline worker/core/traineddata assets, configured for local access. The supplied two CI PDFs are native-text PDFs and do not need OCR. The application never downloads remote OCR scripts.

## What the CI pilot extracts

- **184-page annual PDF, December 31, 2025:** 19 separately segmented funds, 38 Class A/B rows.
- **182-page semi-annual PDF, June 30, 2026:** 19 funds, 38 Class A/B rows.
- Each row has issuer, fund name, class, date, **MER after taxes**, PTR and TER only if explicitly reported. In the provided CI Financial Highlights tables, TER is not printed as a distinct figure and is therefore `null` (displayed `—`). Printed PTR dashes remain `null` with source evidence to the printed dash; a printed numeric zero remains `0`.
- Tables are interpreted per fund, class and latest relevant year. No historical period substitutes are made when the current period shows a dash.

### First verified reference example

| Report | Fund | Class | MER after taxes | TER | PTR |
|---|---|---|---:|---|---:|
| Annual 2025 | CI International Guaranteed Investment Fund | Class A | 5.06 | null | 8.44 |
| Annual 2025 | CI International Guaranteed Investment Fund | Class B | 3.90 | null | 8.44 |
| Semi-annual 2026 | CI International Guaranteed Investment Fund | Class A | 5.06 | null | null |
| Semi-annual 2026 | CI International Guaranteed Investment Fund | Class B | 3.90 | null | null |

The first CI pilot previously underwent independent value checks across 76 class records. Test fixtures and reference PDFs are deliberately **not** packaged in this production-only ZIP; this package does not itself supply a regression-test runner.

## Directory roles

| Location | Responsibility |
|---|---|
| `index.html`, `css/style.css`, `Assets/` | Original v6-5 visual system adapted for multi-fund grouped results |
| `js/pdf-reader.js` | Local PDF.js native-text item + geometry reader, optional local OCR hook |
| `js/core/document-indexer.js` | Per-document one-pass index of page text, heading and geometry |
| `js/core/fund-segmenter.js` | Generic page-boundary segmentation using adapter-supplied headings |
| `js/core/extraction-engine.js` | FMC selection, validation and extraction workflow |
| `js/core/evidence-engine.js` | Source-cell provenance records; no value-based global guesses |
| `js/core/fmc-registry.js` | Register distinct adapter modules |
| `js/core/shared-utils.js` | Generic normalization, identity and numeric/null rules |
| `js/fmc/ci.js` | CI issuer identity, fund headers, Financial Highlights column geometry and parsing |
| `js/fmc/ADAPTER_TEMPLATE.txt` | Starting template for other issuers |
| `js/engine.js` | **Generated** browser bundle of core + registered FMC adapters |
| `js/evidence-locator.js` | **Generated** viewer evidence-contract bundle |
| `js/evidence-viewer.js` | Local PDF renderer with lazy pages and yellow/orange source overlays |
| `js/app.js` | Group UI, queue, editing, re-scan, export, navigation and reports |
| `js/storage.js` | Independent local IndexedDB namespace, PDF copies, history and reset |
| `js/excel-export.js` | Browser-only ZIP-based Excel and CSV exporters |
| `vendor/pdfjs/` | Bundled PDF.js and worker (no CDN requirement) |
| `dev-tools/` | Build script and adapter manifest (development only) |

## Add a future FMC/insurer — no shared-core changes expected

1. Copy `js/fmc/ADAPTER_TEMPLATE.txt` to `js/fmc/<issuer>.js`, then implement `detect(index)` and `extract(index)` for the new insurer. Register actual document header evidence rather than matching filenames.
2. Supply one or more appropriately scoped financial-table extractors in that issuer's file, with a **unique row ID per fund/class/period**, and actual page + cell boxes for metrics. Never borrow historical values for missing current fields; never treat an underlying holding as a separately reported fund.
3. Add `{"key":"<issuer>","file":"js/fmc/<issuer>.js"}` to `dev-tools/fmc-manifest.json`.
4. Run `node dev-tools/build.cjs` to regenerate `js/engine.js` and `js/evidence-locator.js`.
5. Independently verify the new FMC against source PDFs and rerun regression tests in a **separate development/test workspace**. The production ZIP intentionally excludes `tests/`, test-only PDF.js Node builds, fixtures and test reports. Do not claim the new FMC or old FMCs are regression-tested unless those tests were actually run.


## Important limits

- This **first version is not a claim of production accuracy for 200 different issuers**; its modular structure makes future additions straightforward, but each new insurer requires real PDFs, an independent adapter and regression fixtures.
- Only the two supplied CI 2025/2026 templates have been run against exhaustive expected values. Issuer layouts may vary over time; unsupported documents fail closed rather than invent data.
- Automated PDF source position tests have been performed using PDF.js and independently prepared PyMuPDF fixtures; full real-PDF browser rendering and all zoom/scroll/overlay actions could not be end-to-end validated in the restricted test-browser environment. User testing in a real browser remains important.
- IndexedDB capacity is browser-dependent; large saved PDFs may exceed quota, in which case results can still be saved without the PDF copy, and source preview requires re-upload. A results backup exports no PDF binary data.
- Tesseract OCR runtime is not bundled; native-text extraction is the supported v1 path.

The original development release documents validation and its limits; those test documents are intentionally excluded from this production distribution.

## Production distribution and Windows CMD skeleton

- `CMD_SKELETON_ARCHITECTURE.txt` contains paste-ready Windows Command Prompt instructions. Its **first line is `cd /d D:\`**. Edit that line if your target drive/path differs, and paste the commands into **Command Prompt**, not PowerShell.
- The commands create the full folder structure and empty placeholders without overwriting existing files. After running them, copy the actual source-file contents into the corresponding placeholders. **Empty placeholders are not a functional application.**
- `Assets/Icons/*.png` / `*.jpg` are binary images and must be copied as actual files. `vendor/pdfjs/*.js` must also contain the complete bundled PDF.js JavaScript; an empty placeholder does not provide PDF rendering. The ZIP already includes these real dependencies and icons.
- This release preserves the source adapter and `dev-tools/build.cjs` for future FMC work, but contains **no tests**. You may use Node.js to rebuild generated bundles after changing an FMC. Node.js is not required to use the delivered browser application.
