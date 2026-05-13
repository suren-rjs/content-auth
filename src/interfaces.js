/**
 * Interface for the crawler service.
 * Responsible for navigating through pages and extracting raw content.
 */
export class ICrawler {
  /**
   * Crawls a website starting from a base URL.
   * @param {string} baseUrl - The URL to start crawling from.
   * @param {Function} onPageFound - Callback invoked for each page found.
   * @param {Object} options - Crawling options.
   */
  async crawl(baseUrl, onPageFound, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Captures a screenshot of the current page, highlighting specific text.
   * @param {Object} page - The crawler's page object.
   * @param {string} searchText - The text to highlight.
   * @returns {Promise<Buffer|null>} - The screenshot buffer or null.
   */
  async captureScreenshot(page, searchText) {
    throw new Error('Method not implemented');
  }
}

/**
 * Interface for the content searcher service.
 * Responsible for identifying matches within content.
 */
export class ISearcher {
  /**
   * Counts occurrences of text within content.
   * @param {string} content - The content to search.
   * @param {string} searchText - The text to look for.
   * @returns {number} - The count of matches.
   */
  countOccurrences(content, searchText) {
    throw new Error('Method not implemented');
  }
}

/**
 * Interface for the exporter service.
 * Responsible for persisting search results.
 */
export class IExporter {
  /**
   * Exports search results to a file.
   * @param {Array<{pageUrl: string, source: string, count: number, screenshot?: Buffer}>} data - Results list.
   * @param {string} outputPath - The file path to save results.
   */
  async export(data, outputPath) {
    throw new Error('Method not implemented');
  }
}
