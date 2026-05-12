/**
 * Interface for the crawler service
 */
export class ICrawler {
  async crawl(baseUrl, onPageFound, options = {}) {
    throw new Error('Method not implemented');
  }
}

/**
 * Interface for the content searcher service
 */
export class ISearcher {
  countOccurrences(html, searchText) {
    throw new Error('Method not implemented');
  }
}

/**
 * Interface for the exporter service
 */
export class IExporter {
  /**
   * Exports data to an output path.
   * @param {Array<{pageUrl: string, source: string, count: number}>} data 
   * @param {string} outputPath 
   */
  async export(data, outputPath) {
    throw new Error('Method not implemented');
  }
}
