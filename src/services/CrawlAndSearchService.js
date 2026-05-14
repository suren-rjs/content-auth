export class CrawlAndSearchService {
  constructor(crawler, searcher, exporter, ocrService) {
    this.crawler = crawler;
    this.searcher = searcher;
    this.exporter = exporter;
    this.ocrService = ocrService;
    this.results = []; // Stores { pageUrl, source, count, screenshot? }
    this.isFinalizing = false;
  }

  /**
   * Orchestrates the crawl, search, and export process.
   * @param {string} baseUrl - Starting URL.
   * @param {string} searchText - Content to search for.
   * @param {string} outputPath - Excel file path.
   * @param {Object} options - Additional options like screenshots.
   */
  async execute(baseUrl, searchText, outputPath, options = {}) {
    const { screenshots = true, signal } = options;
    console.log(`Starting comprehensive search for "${searchText}" on ${baseUrl}...`);

    const onAbort = async () => {
      console.log('  [ABORT] Abort signal received. Cleaning up...');
      await this.finalize(outputPath);
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      await this.crawler.crawl(baseUrl, async (pageUrl, html, extra) => {
        if (signal?.aborted) return;
        
        const { page } = extra;

        // 1. Search in HTML text
        const htmlCount = this.searcher.countOccurrences(html, searchText);
        if (htmlCount > 0) {
          console.log(`[MATCH FOUND] ${pageUrl} (HTML/Attributes: ${htmlCount})`);
          
          let screenshotBuffer = null;
          if (screenshots && page) {
            console.log(`  Taking screenshot of match on ${pageUrl}...`);
            screenshotBuffer = await this.crawler.captureScreenshot(page, searchText);
          }

          const result = { 
            pageUrl, 
            source: 'Page HTML / Attributes', 
            count: htmlCount, 
            screenshot: screenshotBuffer
          };
          this.results.push(result);
          await this.exporter.update(result, outputPath);
        }

        if (signal?.aborted) return;

        // 2. Search in images
        if (this.ocrService) {
          const standardImageUrls = this.ocrService.extractImageUrls(html, pageUrl);
          const backgroundImages = extra?.backgroundImages || [];
          const absoluteBackgroundUrls = backgroundImages.map(src => {
            try { return new URL(src, pageUrl).toString(); } catch(e) { return null; }
          }).filter(Boolean);

          const allImageUrls = [...new Set([...standardImageUrls, ...absoluteBackgroundUrls])];

          if (allImageUrls.length > 0) {
            console.log(`Scanning ${allImageUrls.length} image sources on ${pageUrl}...`);
            for (const imageUrl of allImageUrls) {
              if (signal?.aborted) break;
              const count = await this.ocrService.searchInImage(imageUrl, searchText);
              if (count > 0) {
                console.log(`  [OCR MATCH] ${imageUrl} (Count: ${count})`);
                
                let screenshotBuffer = null;
                if (screenshots && page) {
                  console.log(`  Taking screenshot of image match on ${pageUrl}...`);
                  screenshotBuffer = await this.crawler.captureScreenshot(page, searchText);
                }

                const result = { 
                  pageUrl, 
                  source: imageUrl, 
                  count,
                  screenshot: screenshotBuffer
                };
                this.results.push(result);
                await this.exporter.update(result, outputPath);
              }
            }
          }
        }
      }, { ...options, signal });

    } catch (error) {
      if (!signal?.aborted) {
        throw error;
      }
    } finally {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      await this.finalize(outputPath);
    }
  }

  /**
   * Finalizes the process by cleaning up services.
   * @param {string} outputPath - Excel file path.
   */
  async finalize(outputPath) {
    if (this.isFinalizing) return;
    this.isFinalizing = true;

    if (this.results.length === 0) {
      console.log('No matches found.');
    } else {
      console.log(`Scan complete. ${this.results.length} total matches saved to ${outputPath}.`);
    }

    console.log('Cleaning up resources...');
    try {
      if (this.ocrService) {
        await this.ocrService.terminate();
      }
      if (this.crawler) {
        await this.crawler.close();
      }
    } catch (err) {
      console.error(`  [ERROR] Cleanup failed: ${err.message}`);
    }
  }
}
