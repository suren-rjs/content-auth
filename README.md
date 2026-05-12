# Content-Auth-Export (v1.1.0)

A professional-grade, comprehensive Node.js CLI tool for auditing website content. It performs an exhaustive search for text strings across all layers of a site: visible UI text, hidden accessibility attributes, SEO metadata, and text embedded within all images (including SVGs and CSS backgrounds).

## Key Features

- **Comprehensive DOM Auditing**: Automatically extracts and searches text from:
  - Visible page content.
  - Hidden accessibility attributes: `alt`, `title`, `aria-label`, and `placeholder`.
  - SEO & Social Metadata: `<title>`, `<meta name="description">`, Open Graph (`og:`), and Twitter tags.
  - Form UI: Button values and input placeholders.
- **Deep Image Audit (Always-On OCR)**: No flags required. The tool automatically reads text inside:
  - Standard `<img>` tags and modern `<picture>`/`<source>` elements.
  - **Vector Graphics (SVGs)**: Automatically rasterized and processed.
  - **CSS Background Images**: Discovered via computed styles using Puppeteer.
- **Advanced OCR Engine**: Powered by **Tesseract.js** with **Sharp** pre-processing:
  - **Multi-Pass Analysis**: Each image is processed through 5 different filters (Grayscale, High-Contrast, Threshold, Inverted) to maximize detection of stylized or artistic fonts.
  - **Fuzzy Matching**: Uses a 75% word-match heuristic to handle minor OCR misreads while maintaining high precision.
- **Dynamic Content Support**: Uses **Puppeteer** to handle JavaScript-rendered sites (SPAs) and waits for `networkidle2` to ensure all data-driven content is loaded.
- **UI Interaction**: Optional support to click buttons or expand sections (e.g., accordions) to reveal hidden content before auditing.
- **Granular Reporting**: Exports a detailed Excel file (.xlsx) mapping every match to its exact source (e.g., "Page HTML / Attributes" or the specific Image URL).

## Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. (Optional) Link the command globally:
   ```bash
   npm link
   ```

## Usage

```bash
node bin/index.js --url https://example.com --content "Search Text" --output audit-results.xlsx
```

### Options
- `-u, --url <url>`: **(Required)** The base URL to start crawling from.
- `-c, --content <content>`: **(Required)** The text content to search for.
- `-o, --output <path>`: Output Excel file path (default: `results.xlsx`).
- `-t, --threads <number>`: Number of concurrent requests (default: `5`).
- `-i, --interact <selector>`: CSS selector to click before auditing (e.g., `".expand-btn"`).

## Examples

### Audit a site for brand consistency (Text + Images + Meta)
```bash
node bin/index.js -u https://yoursite.com -c "Brand Name"
```

### Audit interactive UI and hidden content
```bash
node bin/index.js -u https://yoursite.com -c "Confidential" -i "button.accordion-header"
```

## Architecture

The project follows a SOLID modular structure for high maintainability:
- `src/interfaces.js`: Abstractions for core services.
- `src/services/HtmlSearcher.js`: Logic for comprehensive DOM auditing (Attributes, Meta, Text).
- `src/services/OcrService.js`: Advanced multi-pass image-to-text conversion.
- `src/services/WebCrawler.js`: Headless browser-based crawler with CSS background extraction.
- `src/services/CrawlAndSearchService.js`: Orchestrator for the unified search workflow.

## License
ISC
