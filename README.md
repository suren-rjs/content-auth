# Content-Auth-Export

A Node.js CLI tool to crawl a website and search for specific content, exporting matching URLs to an Excel file.

## Features
- Crawls a starting URL and all sub-URLs within the same domain.
- Uses **Puppeteer** to handle JavaScript-rendered content and dynamic data (SPAs).
- **OCR Support**: Analyze text within images (.png, .jpg, .webp) using **Tesseract.js**.
- **UI Interaction**: Click buttons or expand sections (e.g., accordions) before searching.
- Performs case-insensitive content matching.
- Ignores HTML tags during search (e.g., `<b>T</b>itle` matches `Title`).
- **Reports Occurrence Count**: Shows how many times the content appears on each page (combining text and images).
- Exports results to an Excel file (.xlsx).
- Supports concurrent requests for faster crawling.

## Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Link the CLI tool (optional):
   ```bash
   npm link
   ```

## Usage

Run the tool using `node bin/index.js` or `content-auth` (if linked):

```bash
node bin/index.js --url https://example.com --content "Search Text" --output results.xlsx
```

### Options
- `-u, --url <url>`: **(Required)** The base URL to start crawling from.
- `-c, --content <content>`: **(Required)** The text content to search for.
- `-o, --output <path>`: Output Excel file path (default: `results.xlsx`).
- `-t, --threads <number>`: Number of concurrent requests (default: `5`).
- `-i, --interact <selector>`: CSS selector to click before searching (e.g., `".expand-btn"`).
- `--ocr`: Enable OCR to search for text within images (Note: this makes crawling significantly slower).

## Examples

### Search for text within images
```bash
node bin/index.js -u https://yoursite.com -c "Logo Text" --ocr
```

### Search hidden content in accordions
```bash
node bin/index.js -u https://yoursite.com -c "Terms" -i "button.accordion"
```

## Development

The project follows a modular structure:
- `src/interfaces.js`: Abstractions for core services.
- `src/services/OcrService.js`: Handles image-to-text conversion.
- `src/services/WebCrawler.js`: Headless browser-based crawler.
- `src/services/HtmlSearcher.js`: Logic for text-based searching.

## License
ISC
