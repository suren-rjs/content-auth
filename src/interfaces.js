/**
 * Interface for the crawler service
 */
export class ICrawler {
  async crawl(baseUrl, onPageFound) {
    throw new Error('Method not implemented');
  }
}

/**
 * Interface for the content searcher service
 */
export class ISearcher {
  matches(html, searchText) {
    throw new Error('Method not implemented');
  }
}

/**
 * Interface for the exporter service
 */
export class IExporter {
  async export(data, outputPath) {
    throw new Error('Method not implemented');
  }
}
