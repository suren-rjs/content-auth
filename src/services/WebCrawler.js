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
          '--window-size=1920,1080',
          '--ignore-certificate-errors'
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
   * Normalizes a URL.
   */
  normalizeUrl(urlString) {
    try {
      const url = new URL(urlString);
      url.hash = ''; 
      
      let pathname = url.pathname;
      if (pathname.length > 1 && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      
      const indexFiles = ['/index.html', '/index.htm', '/index.php', '/index.asp', '/default.aspx', '/home'];
      const lowerPath = pathname.toLowerCase();
      
      for (const file of indexFiles) {
        if (lowerPath.endsWith(file)) {
          pathname = pathname.slice(0, -file.length);
          break;
        }
      }
      
      url.pathname = pathname || '/';
      return url.toString().replace(/\/$/, '') || url.origin + '/';
    } catch (e) {
      return urlString;
    }
  }

  /**
   * Clears audit overlays from the page.
   */
  async clearOverlays(page) {
    await page.evaluate(() => {
      document.querySelectorAll('.__audit_ov__').forEach(e => e.remove());
    }).catch(() => {});
  }

  /**
   * Highlights an element and takes a screenshot.
   */
  async captureScreenshot(page, auditId) {
    try {
      await this.clearOverlays(page);
      const el = await page.$(`[data-audit-id="${auditId}"]`);
      if (!el) return null;

      await el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
      await new Promise(r => setTimeout(r, 300)); 

      const box = await el.boundingBox();
      if (!box || box.width === 0 || box.height === 0) return null;

      await page.evaluate((id) => {
        const node = document.querySelector(`[data-audit-id="${id}"]`);
        if (!node) return;
        const r = node.getBoundingClientRect();
        const ov = document.createElement('div');
        ov.className = '__audit_ov__';
        ov.style.position = 'fixed';
        ov.style.top = r.top + 'px';
        ov.style.left = r.left + 'px';
        ov.style.width = r.width + 'px';
        ov.style.height = r.height + 'px';
        ov.style.outline = '3px solid #FF0000';
        ov.style.outlineOffset = '-1px';
        ov.style.pointerEvents = 'none';
        ov.style.zIndex = '2147483647';
        ov.style.boxSizing = 'border-box';
        document.body.appendChild(ov);
      }, auditId);

      const buf = await page.screenshot({ fullPage: false });
      await this.clearOverlays(page);
      return buf;
    } catch (error) {
      await this.clearOverlays(page).catch(() => {});
      return null;
    }
  }

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
   * Scrolls the page to the bottom to trigger lazy loading.
   */
  async scrollToBottom(page) {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        let distance = 100;
        let timer = setInterval(() => {
          let scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    // Wait a bit for images to load after scroll
    await new Promise(r => setTimeout(r, 2000));
  }

  /**
   * Processes a list of URLs and optionally follows links.
   */
  async crawl(baseUrlOrList, onPageFound, options = {}) {
    await this.init();
    const urls = Array.isArray(baseUrlOrList) ? baseUrlOrList : [baseUrlOrList];
    const { signal, noFollow = false } = options;
    const tasks = [];

    const processPage = async (rawUrl, baseOrigin) => {
      if (signal?.aborted) return;
      
      const url = this.normalizeUrl(rawUrl);
      if (this.visited.has(url)) return;
      this.visited.add(url);

      let page;
      try {
        page = await this.browser.newPage();
        if (options.onStatus) options.onStatus(url, 'Initializing...');
        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 3 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const type = req.resourceType();
          if (['font', 'media', 'websocket'].includes(type)) return req.abort();
          return req.continue();
        });

        const response = await page.goto(url, { 
          waitUntil: 'domcontentloaded', 
          timeout: 60000 
        });

        if (options.onStatus) options.onStatus(url, 'Waiting for network...');
        await page.waitForNetworkIdle({ timeout: 15000 }).catch(() => {});
        
        // Trigger lazy loading
        if (options.onStatus) options.onStatus(url, 'Scrolling...');
        await this.scrollToBottom(page);

        if (signal?.aborted) return;

        if (options.interactionSelector) {
          try {
            if (options.onStatus) options.onStatus(url, 'Interacting...');
            await page.waitForSelector(options.interactionSelector, { timeout: 10000 });
            await page.click(options.interactionSelector);
            await new Promise(r => setTimeout(r, 2000));
            await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
          } catch (e) {}
        }

        if (signal?.aborted) return;

        const html = await page.content();
        const backgroundImages = await this.extractBackgroundImages(page);
        
        if (options.onStatus) options.onStatus(url, 'Processing...');
        await onPageFound(url, html, { backgroundImages, page });
        if (options.onStatus) options.onStatus(url, 'Cleaning up...');

        if (signal?.aborted || noFollow) return;

        // If following links, extract them from the current page
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
        }, baseOrigin);

        for (const link of links) {
          const normalizedLink = this.normalizeUrl(link);
          if (!this.visited.has(normalizedLink) && !signal?.aborted) {
            tasks.push(this.limit(() => processPage(normalizedLink, baseOrigin)));
          }
        }
      } catch (error) {
        // Silently fail for dashboard consistency, or could log to a file
      } finally {
        if (page) {
          try {
            await page.close();
          } catch (e) {}
        }
      }
    };

    // Add initial URLs to the task list
    const startTasks = urls.map(startUrl => {
      try {
        const origin = new URL(startUrl).origin;
        return this.limit(() => processPage(startUrl, origin));
      } catch (e) {
        return Promise.resolve();
      }
    });

    // Wait for all initial and discovered tasks to complete
    await Promise.all(startTasks);

    // If there were many discovered tasks, they might still be running in the background 
    // but p-limit handles the queue. To be safe and ensure everything is finished:
    while (tasks.length > 0) {
      await Promise.all(tasks);
      // If processPage added more tasks during the previous await, we loop again
      // Clear tasks that are already started/finished
      tasks.length = 0; 
    }

    if (!signal?.aborted) {
      await this.close();
    }
  }
}
