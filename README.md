# Content-Auth-Export

A Node.js CLI tool to crawl a website and search for specific content, exporting matching URLs to an Excel file.

## Features
- Crawls a starting URL and all sub-URLs within the same domain.
- Uses **Puppeteer** to handle JavaScript-rendered content and dynamic data (SPAs).
- Performs case-insensitive content matching.
- Ignores HTML tags during search (e.g., `<b>T</b>itle` matches `Title`).
- Exports results to an Excel file (.xlsx).
- Supports concurrent requests for faster crawling.
- Follows SOLID principles and clean code structure.

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

## Development

The project follows a modular structure:
- `src/interfaces.js`: Abstractions for core services.
- `src/services/`: Concrete implementations of Crawler, Searcher, Exporter, and the Orchestrator.
- `bin/index.js`: CLI entry point using `commander`.

## License
ISC
