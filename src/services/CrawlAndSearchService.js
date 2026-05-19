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
    this.tempDir = path.resolve(process.cwd(), '.audit_temp');
    
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
        this.results = data.results || [];
        if (this.dashboard) {
          this.dashboard.updateStatus(`Resumed from checkpoint: ${this.urlsProcessed.size} URLs`);
        }
      }
    } catch (e) {}
  }

  saveCheckpoint() {
    if (this.isFinalizing) return;
    try {
      const serialisable = {
        completedUrls: [...this.urlsProcessed],
        results: this.results
      };
      fs.writeFileSync(this.checkpointFile, JSON.stringify(serialisable), 'utf8');
    } catch (e) {}
  }

  async execute(urls, searchText, outputPath, options = {}) {
    const { screenshots = true, signal } = options;
    const urlList = Array.isArray(urls) ? urls : [urls];
    
    // Clear output file before starting
    if (fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
      } catch (e) {}
    }

    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    if (this.dashboard) {
      this.dashboard.init(urlList.length, searchText);
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
        const setStatus = (status) => {
          if (this.dashboard) this.dashboard.updateWorker(pageUrl, status);
        };

        setStatus('Scanning DOM...');

        // 1. Meta Tags / Page Title
        const metaHits = await this.searcher.scanMeta(page, searchText);
        if (metaHits.length) {
          this.results.push(...metaHits.map(h => ({ ...h, pageUrl, screenshot: null })));
          if (this.dashboard) this.dashboard.incrementCount('meta', metaHits.length);
        }

        if (signal?.aborted) return;

        // 2. Attributes
        const attrHits = await this.searcher.scanAttributes(page, searchText);
        if (attrHits.length) {
          this.results.push(...attrHits.map(h => ({ ...h, pageUrl, screenshot: null })));
          if (this.dashboard) this.dashboard.incrementCount('attr', attrHits.length);
        }

        if (signal?.aborted) return;

        // 3. Visible Text / SVG
        const textHits = await this.searcher.scanVisibleText(page, searchText);
        if (textHits.length) {
          for (const hit of textHits) {
            if (signal?.aborted) break;
            
            let screenshotPath = null;
            if (screenshots && hit.auditId) {
              setStatus(`Screenshot: ${hit.auditId}`);
              const buf = await this.crawler.captureScreenshot(page, hit.auditId);
              if (buf) {
                screenshotPath = path.join(this.tempDir, `shot_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
                fs.writeFileSync(screenshotPath, buf);
              }
            }
            this.results.push({ ...hit, pageUrl, screenshot: screenshotPath });
            if (this.dashboard) this.dashboard.incrementCount('text');
          }
        }

        if (signal?.aborted) return;

        // 4. OCR & Visual Audit
        if (this.ocrService && page) {
          const visualCandidates = await page.evaluate(() => {
            const candidates = [];
            let counter = 0;

            const addCandidate = (el, type, src) => {
              const id = `vis_${++counter}`;
              el.setAttribute('data-audit-id', id);
              candidates.push({ id, type, src });
            };

            document.querySelectorAll('img').forEach(el => {
              addCandidate(el, '<img>', el.src || 'src-unknown');
            });

            document.querySelectorAll('*').forEach(el => {
              if (el.tagName === 'IMG') return;
              const style = window.getComputedStyle(el);
              const bg = style.backgroundImage;
              if (bg && bg !== 'none' && bg.startsWith('url(')) {
                const src = bg.match(/url\(["']?([^"']+)["']?\)/)?.[1] || 'css-url';
                addCandidate(el, 'BG Image', src);
              }
            });

            document.querySelectorAll('svg').forEach(el => {
              addCandidate(el, '<svg>', 'inline-svg');
            });

            return candidates;
          });

          if (visualCandidates.length > 0) {
            for (let i = 0; i < visualCandidates.length; i++) {
              if (signal?.aborted) break;
              
              const { id, type, src } = visualCandidates[i];
              setStatus(`OCR ${i + 1}/${visualCandidates.length}`);

              try {
                const el = await page.$(`[data-audit-id="${id}"]`);
                if (!el) continue;

                const box = await el.boundingBox().catch(() => null);
                // Sanity check: Skip invisible or giant elements that would crash OCR
                if (!box || box.width < 5 || box.height < 5) continue;
                if (box.width > 2500 || box.height > 2500) continue; 

                const imgBuf = await el.screenshot({ timeout: 5000 }).catch(() => null);
                if (!imgBuf) continue;

                const found = await this.ocrService.searchInBuffer(imgBuf, searchText).catch(() => false);
                if (found) {
                  let screenshotPath = null;
                  if (screenshots) {
                    setStatus(`Visual Match Screenshot`);
                    const buf = await this.crawler.captureScreenshot(page, id);
                    if (buf) {
                      screenshotPath = path.join(this.tempDir, `shot_ocr_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
                      fs.writeFileSync(screenshotPath, buf);
                    }
                  }

                  this.results.push({
                    pageUrl,
                    type: `OCR (${type})`,
                    tag: type,
                    content: `[OCR] ${src}`,
                    screenshot: screenshotPath
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
          this.dashboard.updateWorker(pageUrl, null);
        }
        this.saveCheckpoint();
      }, { 
        ...options, 
        signal,
        onStatus: (url, status) => {
          if (this.dashboard) this.dashboard.updateWorker(url, status);
        }
      });

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
      
      // Cleanup temp screenshots
      if (fs.existsSync(this.tempDir)) {
        const files = fs.readdirSync(this.tempDir);
        for (const file of files) {
          fs.unlinkSync(path.join(this.tempDir, file));
        }
        fs.rmdirSync(this.tempDir);
      }
    } catch (err) {}

    if (this.dashboard) {
      this.dashboard.finalize(outputPath);
    }
  }
}
