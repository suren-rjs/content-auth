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

  /**
   * Initializes the browser instance.
   */
  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
  }

  /**
   * Closes the browser instance.
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async crawl(baseUrl, onPageFound) {
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
        
        // Set a reasonable timeout and wait for network to be idle
        // This ensures API calls made by the page have a chance to finish
        await page.goto(url, { 
          waitUntil: 'networkidle2', 
          timeout: 60000 
        });

        // Get the fully rendered HTML
        const html = await page.content();
        await onPageFound(url, html);

        // Extract links from the rendered DOM
        const links = await page.evaluate((origin) => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(href => {
              try {
                const u = new URL(href);
                u.hash = ''; // Remove fragments
                return u.origin === origin;
              } catch (e) {
                return false;
              }
            });
        }, origin);

        // Schedule new links
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

    // Start with the base URL
    tasks.push(this.limit(() => crawlPage(baseUrl)));

    // Wait for all tasks to complete
    let i = 0;
    while (i < tasks.length) {
      await tasks[i];
      i++;
    }

    await this.close();
  }
}
