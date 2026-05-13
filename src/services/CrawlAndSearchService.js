export class CrawlAndSearchService {
  constructor(crawler, searcher, exporter, ocrService) {
    this.crawler = crawler;
    this.searcher = searcher;
    this.exporter = exporter;
    this.ocrService = ocrService;
    this.results = []; // Stores { pageUrl, source, count, screenshot? }
  }

  /**
   * Orchestrates the crawl, search, and export process.
   * @param {string} baseUrl - Starting URL.
   * @param {string} searchText - Content to search for.
   * @param {string} outputPath - Excel file path.
   * @param {Object} options - Additional options like screenshots.
   */
  async execute(baseUrl, searchText, outputPath, options = {}) {
    const { screenshots = true } = options;
    console.log(`Starting comprehensive search for "${searchText}" on ${baseUrl}...`);

    await this.crawler.crawl(baseUrl, async (pageUrl, html, extra) => {
      const { page } = extra;

      // 1. Search in HTML text (includes hidden attributes like alt, title, aria-label, etc.)
      const htmlCount = this.searcher.countOccurrences(html, searchText);
      if (htmlCount > 0) {
        console.log(`[MATCH FOUND] ${pageUrl} (HTML/Attributes: ${htmlCount})`);
        
        let screenshotBuffer = null;
        if (screenshots && page) {
          console.log(`  Taking screenshot of match on ${pageUrl}...`);
          screenshotBuffer = await this.crawler.captureScreenshot(page, searchText);
        }

        this.results.push({ 
          pageUrl, 
          source: 'Page HTML / Attributes', 
          count: htmlCount,
          screenshot: screenshotBuffer
        });
      }

      // 2. Search in all images (img tags, picture tags, and CSS backgrounds)
      if (this.ocrService) {
        // Extract standard image URLs from HTML
        const standardImageUrls = this.ocrService.extractImageUrls(html, pageUrl);
        
        // Combine with background images found via Puppeteer
        const backgroundImages = extra?.backgroundImages || [];
        const absoluteBackgroundUrls = backgroundImages.map(src => {
          try { return new URL(src, pageUrl).toString(); } catch(e) { return null; }
        }).filter(Boolean);

        const allImageUrls = [...new Set([...standardImageUrls, ...absoluteBackgroundUrls])];

        if (allImageUrls.length > 0) {
          console.log(`Scanning ${allImageUrls.length} image sources on ${pageUrl}...`);
          for (const imageUrl of allImageUrls) {
            const count = await this.ocrService.searchInImage(imageUrl, searchText);
            if (count > 0) {
              console.log(`  [OCR MATCH] ${imageUrl} (Count: ${count})`);
              
              // For images, the "screenshot" could be the original image or a screenshot of the element.
              // For simplicity and consistency with visible text matches, we'll try to find the element and screenshot it.
              let screenshotBuffer = null;
              if (screenshots && page) {
                console.log(`  Taking screenshot of image match on ${pageUrl}...`);
                // We pass the imageUrl to help locate the element if possible, 
                // but the generic highlightText will likely find text in the page if it's there.
                // If it's OCR, we'll just take a screenshot of the page where the text *should* be.
                screenshotBuffer = await this.crawler.captureScreenshot(page, searchText);
              }

              this.results.push({ 
                pageUrl, 
                source: imageUrl, 
                count,
                screenshot: screenshotBuffer
              });
            }
          }
        }
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
