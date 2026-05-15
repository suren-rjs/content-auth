# Content-Auth-Export (v1.3.0)

A professional-grade, comprehensive Node.js CLI tool for auditing website content. It performs an exhaustive search for text strings across all layers of a site: visible UI text, hidden accessibility attributes, SEO metadata, and text embedded within all images (including SVGs and CSS backgrounds).

## Key Features

- **Bulk Load Support**: Audit multiple URLs provided via command line or loaded from a text file.
- **Leaf-Match Strategy**: Advanced DOM scanning that identifies the deepest elements containing the search term, preventing redundant ancestor matches.
- **Visual Proof (Red-Border Screenshots)**: 
  - Automatically highlights matched elements with a precise **3px red border overlay**.
  - Captures high-resolution, viewport-accurate screenshots.
  - Supports multiple instances of the same word on a single page, each with its own screenshot.
- **Professional Reporting**: Generates an enhanced `.xlsx` report with:
  - **Summary Sheet**: Dashboard overview of all URLs, match counts, and status.
  - **Per-URL Sheets**: Dedicated tabs for each URL with detailed evidence and embedded screenshots.
  - **Rich Metadata**: Captures URL, Match Type, HTML Tag, and Matched Content.
- **Deep Image Audit (OCR)**: 
  - Automatic detection of text in images, SVGs, and CSS backgrounds.
  - **Multi-Worker Pool**: Uses a worker pool to process images in parallel across concurrent pages, eliminating processing bottlenecks.
  - **Confidence Filtering**: Implements confidence thresholds to eliminate false positives.
  - **Multi-Pass Pre-processing**: Uses Sharp to maximize OCR accuracy across various image styles.
- **Real-time Parallel Dashboard**:
  - Monitors multiple concurrent workers simultaneously.
  - Live status updates for each worker (e.g., "OCR", "Scanning DOM", "Scrolling").
  - Tracks progress, matches, and elapsed time in a unified view.
- **Crash Resilience**: Progress is auto-saved to `audit_checkpoint.json`. Long-running audits can be resumed seamlessly if interrupted.
- **Performance & Stealth**: 
  - Uses Playwright/Puppeteer with a stealth plugin to bypass bot detection.
  - Configurable concurrency for fast batch processing.
  - Resource interception to block unnecessary assets (fonts, media) for faster loads.

## Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Link the command globally:
   ```bash
   npm link
   ```
   Now you can use the `content-audit` command from anywhere.

## Usage

### Audit a single URL
```bash
content-audit -u https://example.com -c "Search Text"
```

### Audit multiple URLs from a file
```bash
content-audit -f urls.txt -c "Search Text" -o report.xlsx
```

### Options
- `-u, --url <url>`: Single URL to audit.
- `-f, --file <path>`: Text file containing list of URLs to audit (one per line).
- `-c, --content <content>`: **(Required)** The text content to search for.
- `-o, --output <path>`: Output Excel file path (default: `results.xlsx`).
- `-t, --threads <number>`: Number of concurrent browser instances (default: `5`).
- `-i, --interact <selector>`: CSS selector to click (e.g., cookie banner, "Read More") before searching.

## Examples

### Bulk audit from a text file
```bash
# Create a urls.txt
# https://site1.com
# https://site2.com/page

content-audit -f urls.txt -c "Confidential" -o audit-report.xlsx
```

### Handling Interactive Pages
```bash
content-audit -u https://yoursite.com -c "Success" -i ".expand-button"
```

### Using with node directly
If you haven't linked the package, you can still run:
```bash
node bin/index.js -u https://example.com -c "Search Text"
```

## Architecture

The project follows a SOLID modular structure for high maintainability:
- `src/interfaces.js`: Service contracts and type definitions.
- `src/services/HtmlSearcher.js`: Leaf-match DOM auditing (Attributes, Meta, Visible Text).
- `src/services/OcrService.js`: Multi-pass OCR analysis with confidence filtering.
- `src/services/WebCrawler.js`: Headless browser-based auditor with stealth support and visual capture.
- `src/services/ExcelExporter.js`: Multi-sheet, styled Excel report generator.
- `src/services/CrawlAndSearchService.js`: Orchestrator with checkpointing and bulk URL support.

## License
ISC
