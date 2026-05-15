import fs from 'fs';
import path from 'path';

export class CrawlAndSearchService {
  constructor(crawler, searcher, exporter, ocrService, dashboard) {
    this.crawler = crawler;
    this.searcher = searcher;
    this.exporter = exporter;
    this.ocrService = ocrService;
    this.dashboard = dashboard;
    this.results = []; 
    this.urlsProcessed = new Set();
    this.isFinalizing = false;
    this.checkpointFile = 'audit_checkpoint.json';
    
    if (this.ocrService && this.dashboard) {
      this.ocrService.setDashboard(this.dashboard);
    }
  }

  loadCheckpoint() {
    try {
      if (fs.existsSync(this.checkpointFile)) {
        const raw = fs.readFileSync(this.checkpointFile, 'utf8');
        const data = JSON.parse(raw);
        this.urlsProcessed = new Set(data.completedUrls || []);
        this.results = (data.results || []).map(r => ({
          ...r,
          screenshot: r.screenshot ? Buffer.from(r.screenshot, 'base64') : null
        }));
        if (this.dashboard) {
          this.dashboard.updateStatus(`Resumed from checkpoint: ${this.urlsProcessed.size} URLs`);
        }
      }
    } catch (e) {}
  }

  saveCheckpoint() {
    try {
      const serialisable = {
        completedUrls: [...this.urlsProcessed],
        results: this.results.map(r => ({
          ...r,
          screenshot: Buffer.isBuffer(r.screenshot) ? r.screenshot.toString('base64') : r.screenshot
        }))
      };
      fs.writeFileSync(this.checkpointFile, JSON.stringify(serialisable), 'utf8');
    } catch (e) {}
  }

  async execute(urls, searchText, outputPath, options = {}) {
    const { screenshots = true, signal } = options;
    const urlList = Array.isArray(urls) ? urls : [urls];
    
    if (this.dashboard) {
      this.dashboard.init(urlList.length);
    }

    this.loadCheckpoint();

    const onAbort = async () => {
      if (this.dashboard) this.dashboard.updateStatus('Aborting...');
      await this.finalize(outputPath, searchText);
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      await this.crawler.crawl(urlList, async (pageUrl, html, extra) => {
        if (signal?.aborted) return;
        if (this.urlsProcessed.has(pageUrl)) return;

        const { page } = extra;
        if (this.dashboard) {
          this.dashboard.updateUrl(pageUrl);
          this.dashboard.updateStatus('Scanning DOM...');
        }

        // 1. Meta Tags
        const metaHits = await this.searcher.scanMeta(page, searchText);
        if (metaHits.length) {
          this.results.push(...metaHits.map(h => ({ ...h, pageUrl })));
          if (this.dashboard) this.dashboard.incrementCount('meta', metaHits.length);
        }

        if (signal?.aborted) return;

        // 2. Attributes
        const attrHits = await this.searcher.scanAttributes(page, searchText);
        if (attrHits.length) {
          this.results.push(...attrHits.map(h => ({ ...h, pageUrl })));
          if (this.dashboard) this.dashboard.incrementCount('meta', attrHits.length); // Count attributes as meta for simplicity
        }

        if (signal?.aborted) return;

        // 3. Visible Text
        const textHits = await this.searcher.scanVisibleText(page, searchText);
        if (textHits.length) {
          for (const hit of textHits) {
            if (signal?.aborted) break;
            
            let screenshot = null;
            if (screenshots && hit.auditId) {
              screenshot = await this.crawler.captureScreenshot(page, hit.auditId);
            }
            this.results.push({ ...hit, pageUrl, screenshot });
            if (this.dashboard) this.dashboard.incrementCount('text');
          }
        }

        if (signal?.aborted) return;

        // 4. OCR
        if (this.ocrService && page) {
          const imgs = await page.$$('img');
          if (imgs.length > 0) {
            for (let i = 0; i < imgs.length; i++) {
              if (signal?.aborted) break;
              
              if (this.dashboard) {
                this.dashboard.updateStatus(`OCR Image ${i + 1}/${imgs.length}`);
              }

              const img = imgs[i];
              try {
                const box = await img.boundingBox().catch(() => null);
                if (!box || box.width < 10 || box.height < 10) continue;

                const imgBuf = await img.screenshot({ timeout: 5000 }).catch(() => null);
                if (!imgBuf) continue;

                const found = await this.ocrService.searchInBuffer(imgBuf, searchText);
                if (found) {
                  const src = await page.evaluate(el => el.getAttribute('src'), img).catch(() => 'unknown');
                  
                  let screenshot = null;
                  if (screenshots) {
                    const auditId = `ocr_${Math.random().toString(36).slice(2, 9)}`;
                    await page.evaluate((el, id) => el.setAttribute('data-audit-id', id), img, auditId);
                    screenshot = await this.crawler.captureScreenshot(page, auditId);
                  }

                  this.results.push({
                    pageUrl,
                    type: 'OCR (Image)',
                    tag: '<img>',
                    content: `[OCR] ${src}`,
                    screenshot
                  });
                  if (this.dashboard) this.dashboard.incrementCount('ocr');
                }
              } catch (e) {}
            }
          }
        }

        this.urlsProcessed.add(pageUrl);
        if (this.dashboard) {
          this.dashboard.updateProgress(this.urlsProcessed.size);
        }
        this.saveCheckpoint();
      }, { ...options, signal });

    } catch (error) {
      if (!signal?.aborted) throw error;
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
      await this.finalize(outputPath, searchText);
    }
  }

  async finalize(outputPath, searchText) {
    if (this.isFinalizing) return;
    this.isFinalizing = true;

    if (this.dashboard) this.dashboard.updateStatus('Saving report...');

    if (this.results.length > 0 || this.urlsProcessed.size > 0) {
      await this.exporter.export(this.results, outputPath, {
        searchTerm: searchText,
        urls: [...this.urlsProcessed]
      });
    }

    try {
      if (this.ocrService) await this.ocrService.terminate();
      if (this.crawler) await this.crawler.close();
      if (fs.existsSync(this.checkpointFile)) fs.unlinkSync(this.checkpointFile);
    } catch (err) {}

    if (this.dashboard) {
      this.dashboard.finalize(outputPath);
    }
  }
}
