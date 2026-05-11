export class CrawlAndSearchService {
  constructor(crawler, searcher, exporter) {
    this.crawler = crawler;
    this.searcher = searcher;
    this.exporter = exporter;
    this.matches = [];
  }

  /**
   * Orchestrates the crawl, search, and export process.
   * @param {string} baseUrl - Starting URL.
   * @param {string} searchText - Content to search for.
   * @param {string} outputPath - Excel file path.
   */
  async execute(baseUrl, searchText, outputPath) {
    console.log(`Starting search for "${searchText}" on ${baseUrl}...`);
    
    await this.crawler.crawl(baseUrl, async (url, html) => {
      if (this.searcher.matches(html, searchText)) {
        
        console.log(`[MATCH FOUND] ${url}`);
        this.matches.push(url);
      }
    });

    if (this.matches.length > 0) {
      await this.exporter.export(this.matches, outputPath);
    } else {
      console.log('No matches found.');
    }
  }
}
