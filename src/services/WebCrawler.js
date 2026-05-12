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

  async interact(page, selector) {
    if (!selector) return;
    
    try {
      console.log(`Interacting with elements matching: ${selector}`);
      const elements = await page.$$(selector);
      for (const element of elements) {
        try {
          await element.click();
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {}
      }
      await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
    } catch (error) {
      console.error(`Interaction failed: ${error.message}`);
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

  async crawl(baseUrl, onPageFound, options = {}) {
    const { interactionSelector } = options;
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

        if (interactionSelector) {
          await this.interact(page, interactionSelector);
        }

        // Get rendered HTML
        const html = await page.content();
        
        // Extract background images via computed style
        const backgroundImages = await this.extractBackgroundImages(page);
        
        // Notify observer with both HTML and extra image URLs
        await onPageFound(url, html, { backgroundImages });

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
