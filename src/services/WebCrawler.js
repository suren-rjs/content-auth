import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import pLimit from 'p-limit';
import { ICrawler } from '../interfaces.js';

// Apply stealth plugin to bypass bot detection
puppeteer.use(StealthPlugin());

export class WebCrawler extends ICrawler {
  constructor(concurrency = 5) {
    super();
    this.limit = pLimit(concurrency);
    this.visited = new Set();
    this.browser = null;
  }

  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: "new",
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--window-size=1920,1080'
        ]
      });
    }
  }

  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {}
      this.browser = null;
    }
  }

  /**
   * Normalizes a URL to prevent duplicate crawling of functionally identical pages.
   * Strips trailing slashes and common index filenames (index.html, index.php, etc.).
   * @param {string} urlString - The URL to normalize.
   * @returns {string} - The normalized URL.
   */
  normalizeUrl(urlString) {
    try {
      const url = new URL(urlString);
      url.hash = ''; // Hashes never change the page content for a search
      
      let pathname = url.pathname;
      
      // 1. Consistency: remove trailing slash (except for root '/')
      if (pathname.length > 1 && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      
      // 2. Remove common default document names
      const indexFiles = ['/index.html', '/index.htm', '/index.php', '/index.asp', '/default.aspx', '/home'];
      const lowerPath = pathname.toLowerCase();
      
      for (const file of indexFiles) {
        if (lowerPath.endsWith(file)) {
          pathname = pathname.slice(0, -file.length);
          break;
        }
      }
      
      // Ensure we don't end up with an empty string for the pathname
      url.pathname = pathname || '/';
      
      return url.toString().replace(/\/$/, '') || url.origin + '/';
    } catch (e) {
      return urlString;
    }
  }

  /**
   * Extracts background images using Puppeteer.
   */
  async extractBackgroundImages(page) {
    return await page.evaluate(() => {
      const urls = [];
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const bg = window.getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none' && bg.startsWith('url(')) {
          const url = bg.match(/url\(["']?([^"']+)["']?\)/)?.[1];
          if (url) urls.push(url);
        }
      }
      return [...new Set(urls)];
    });
  }

  /**
   * Highlights text on the page and takes a screenshot.
   * @param {Object} page - Puppeteer page object.
   * @param {string} searchText - Text to highlight.
   * @returns {Promise<Buffer>} - Screenshot buffer.
   */
  async captureScreenshot(page, searchText) {
    try {
      await page.evaluate((text) => {
        // Simple search and highlight logic
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let node;
        const matches = [];
        while (node = walker.nextNode()) {
          if (node.textContent.toLowerCase().includes(text.toLowerCase())) {
            matches.push(node.parentElement);
          }
        }

        matches.forEach(el => {
          el.style.outline = '5px solid red';
          el.style.backgroundColor = 'yellow';
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }, searchText);

      // Wait a bit for scroll and rendering
      await new Promise(r => setTimeout(r, 500));

      return await page.screenshot({ fullPage: false });
    } catch (error) {
      console.error(`Failed to capture screenshot: ${error.message}`);
      return null;
    }
  }

  async crawl(baseUrl, onPageFound, options = {}) {
    await this.init();
    const origin = new URL(baseUrl).origin;
    const tasks = [];
    const { signal } = options;

    const crawlPage = async (rawUrl) => {
      if (signal?.aborted) return;
      
      const url = this.normalizeUrl(rawUrl);
      if (this.visited.has(url)) return;
      this.visited.add(url);

      let page;
      try {
        page = await this.browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        const response = await page.goto(url, { 
          waitUntil: 'networkidle2', 
          timeout: 60000 
        });

        if (signal?.aborted) return;

        const status = response ? response.status() : 'unknown';
        console.log(`Crawling: ${url} [Status: ${status}]`);

        if (status === 403) {
          console.warn(`[WARN] Access denied (403) for ${url}. The site may be blocking the crawler.`);
        }

        // --- Interaction Logic ---
        if (options.interactionSelector) {
          console.log(`  Performing interaction: clicking "${options.interactionSelector}" on ${url}...`);
          try {
            await page.waitForSelector(options.interactionSelector, { timeout: 10000 });
            await page.click(options.interactionSelector);
            
            // Wait for potential content change or animation
            await new Promise(r => setTimeout(r, 2000));
            // Optional: wait for network to settle if new content was fetched
            await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
          } catch (e) {
            console.warn(`  [WARN] Interaction failed on ${url}: ${e.message}`);
          }
        }

        if (signal?.aborted) return;

        // Get rendered HTML AFTER interaction
        const html = await page.content();
        
        // Extract background images via computed style
        const backgroundImages = await this.extractBackgroundImages(page);
        
        // Notify observer with both HTML, page object (for screenshots), and extra image URLs
        await onPageFound(url, html, { backgroundImages, page });

        if (signal?.aborted) return;

        const links = await page.evaluate((origin) => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(href => {
              try {
                const u = new URL(href);
                return u.origin === origin;
              } catch (e) {
                return false;
              }
            });
        }, origin);

        for (const link of links) {
          const normalizedLink = this.normalizeUrl(link);
          if (!this.visited.has(normalizedLink) && !signal?.aborted) {
            tasks.push(this.limit(() => crawlPage(normalizedLink)));
          }
        }
      } catch (error) {
        if (!signal?.aborted) {
          console.error(`Failed to crawl ${url}: ${error.message}`);
        }
      } finally {
        if (page) {
          try {
            await page.close();
          } catch (e) {}
        }
      }
    };

    tasks.push(this.limit(() => crawlPage(baseUrl)));

    let i = 0;
    while (i < tasks.length) {
      if (signal?.aborted) break;
      await tasks[i];
      i++;
    }

    // Don't close browser here if aborted, let finalize handle it
    if (!signal?.aborted) {
      await this.close();
    }
  }
}
