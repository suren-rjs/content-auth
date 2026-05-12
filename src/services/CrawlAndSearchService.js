export class CrawlAndSearchService {
  constructor(crawler, searcher, exporter, ocrService = null) {
    this.crawler = crawler;
    this.searcher = searcher;
    this.exporter = exporter;
    this.ocrService = ocrService;
    this.results = [];
  }

  /**
   * Orchestrates the crawl, search, and export process.
   * @param {string} baseUrl - Starting URL.
   * @param {string} searchText - Content to search for.
   * @param {string} outputPath - Excel file path.
   * @param {Object} options - Additional options like interactionSelector and useOcr.
   */
  async execute(baseUrl, searchText, outputPath, options = {}) {
    console.log(`Starting search for "${searchText}" on ${baseUrl}...`);
    const { useOcr } = options;

    await this.crawler.crawl(baseUrl, async (url, html) => {
      // 1. Search in HTML text
      let totalCount = this.searcher.countOccurrences(html, searchText);

      // 2. Search in images if OCR is enabled
      if (useOcr && this.ocrService) {
        const imageUrls = this.ocrService.extractImageUrls(html, url);
        if (imageUrls.length > 0) {
          console.log(`Scanning ${imageUrls.length} images on ${url}...`);
          for (const imageUrl of imageUrls) {
            const count = await this.ocrService.searchInImage(imageUrl, searchText);
            if (count > 0) {
              console.log(`  [OCR MATCH] ${imageUrl} (Count: ${count})`);
              totalCount += count;
            }
          }
        }
      }

      if (totalCount > 0) {
        console.log(`[MATCH FOUND] ${url} (Total Count: ${totalCount})`);
        this.results.push({ url, count: totalCount });
      }
    }, options);

    if (this.results.length > 0) {
      await this.exporter.export(this.results, outputPath);
    } else {
      console.log('No matches found.');
    }

    if (this.ocrService) {
      await this.ocrService.terminate();
    }
  }
}
