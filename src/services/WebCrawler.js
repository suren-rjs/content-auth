import puppeteer from 'puppeteer';
import pLimit from 'p-limit';
import { ICrawler } from '../interfaces.js';

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
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
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

    const crawlPage = async (url) => {
      if (this.visited.has(url)) return;
      this.visited.add(url);

      let page;
      try {
        console.log(`Crawling: ${url}`);
        page = await this.browser.newPage();
        
        await page.goto(url, { 
          waitUntil: 'networkidle2', 
          timeout: 60000 
        });

        // Get rendered HTML
        const html = await page.content();
        
        // Extract background images via computed style
        const backgroundImages = await this.extractBackgroundImages(page);
        
        // Notify observer with both HTML, page object (for screenshots), and extra image URLs
        await onPageFound(url, html, { backgroundImages, page });

        const links = await page.evaluate((origin) => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(href => {
              try {
                const u = new URL(href);
                u.hash = '';
                return u.origin === origin;
              } catch (e) {
                return false;
              }
            });
        }, origin);

        for (const link of links) {
          const cleanUrl = new URL(link);
          cleanUrl.hash = '';
          const finalUrl = cleanUrl.toString();
          
          if (!this.visited.has(finalUrl)) {
            tasks.push(this.limit(() => crawlPage(finalUrl)));
          }
        }
      } catch (error) {
        console.error(`Failed to crawl ${url}: ${error.message}`);
      } finally {
        if (page) await page.close();
      }
    };

    tasks.push(this.limit(() => crawlPage(baseUrl)));

    let i = 0;
    while (i < tasks.length) {
      await tasks[i];
      i++;
    }

    await this.close();
  }
}
