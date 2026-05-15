/**
 * Interface for the crawler service.
 */
export class ICrawler {
  async crawl(baseUrl, onPageFound, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Captures a screenshot of the current page, highlighting a specific element by ID.
   * @param {Object} page - The crawler's page object.
   * @param {string} auditId - The element's data-audit-id.
   * @returns {Promise<Buffer|null>} - The screenshot buffer or null.
   */
  async captureScreenshot(page, auditId) {
    throw new Error('Method not implemented');
  }
}

/**
 * Interface for the content searcher service.
 */
export class ISearcher {
  async scanMeta(page, term) {
    throw new Error('Method not implemented');
  }

  async scanAttributes(page, term) {
    throw new Error('Method not implemented');
  }

  async scanVisibleText(page, term) {
    throw new Error('Method not implemented');
  }

  countOccurrences(content, searchText) {
    throw new Error('Method not implemented');
  }
}

/**
 * Interface for the exporter service.
 */
export class IExporter {
  async export(data, outputPath, options = {}) {
    throw new Error('Method not implemented');
  }

  async update(item, outputPath) {
    throw new Error('Method not implemented');
  }
}
