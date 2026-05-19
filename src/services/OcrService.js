import { createWorker, createScheduler } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// Disable sharp's internal cache to prevent memory bloat
sharp.cache(false);

export class OcrService {
  constructor(concurrency = 5) {
    this.concurrency = Math.max(1, Math.min(concurrency, 4)); // Cap OCR workers
    this.scheduler = null;
    this.isInitializing = false;
    this.cachePath = path.resolve(process.cwd(), '.tesseract-cache');
    this.dashboard = null;
  }

  setDashboard(dashboard) {
    this.dashboard = dashboard;
  }

  async init() {
    if (this.scheduler) return;
    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise(r => setTimeout(r, 100));
      }
      return;
    }

    this.isInitializing = true;
    try {
      if (!fs.existsSync(this.cachePath)) {
        fs.mkdirSync(this.cachePath, { recursive: true });
      }

      this.scheduler = createScheduler();
      
      const workers = [];
      for (let i = 0; i < this.concurrency; i++) {
        workers.push((async () => {
          const worker = await createWorker('eng', 1, {
            cachePath: this.cachePath,
            logger: () => {} 
          });
          await worker.setParameters({
            tessjs_create_hocr: '0',
            tessjs_create_tsv: '0',
          });
          this.scheduler.addWorker(worker);
        })());
      }
      
      await Promise.all(workers);
    } catch (error) {
      this.scheduler = null;
    } finally {
      this.isInitializing = false;
    }
  }

  async terminate() {
    if (this.scheduler) {
      try {
        await this.scheduler.terminate();
      } catch (e) {}
      this.scheduler = null;
    }
  }

  isExactMatch(text, term) {
    if (!text || !term) return false;
    const normalizedText = text.replace(/\s+/g, ' ').trim();
    const normalizedTerm = term.replace(/\s+/g, ' ').trim();
    const escapedTerm = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const startBoundary = /^\w/.test(normalizedTerm) ? '\\b' : '';
    const endBoundary = /\w$/.test(normalizedTerm) ? '\\b' : '';
    const regex = new RegExp(`${startBoundary}${escapedTerm}${endBoundary}`, 'i');
    return regex.test(normalizedText);
  }

  async preprocessImage(imageBuffer, type = 'default') {
    try {
      const metadata = await sharp(imageBuffer).metadata();
      let pipeline = sharp(imageBuffer).flatten({ background: '#ffffff' }); 
      
      // More conservative scaling to prevent memory issues (pixdata_malloc fail)
      // Limit max width to 2500px and multiplier to 2x or 3x
      const targetWidth = Math.min(2500, Math.max(1000, (metadata.width || 0) * 3));
      pipeline = pipeline.resize({ width: Math.round(targetWidth), kernel: sharp.kernel.lanczos3 });

      switch (type) {
        case 'red':
          pipeline = pipeline.extractChannel('red').normalize().sharpen();
          break;
        case 'contrast':
          pipeline = pipeline.grayscale().modulate({ brightness: 1.2, contrast: 2.5 }).normalize().sharpen();
          break;
        case 'threshold_adaptive':
          pipeline = pipeline.grayscale().normalize().linear(2, -0.5).sharpen();
          break;
        case 't150':
          pipeline = pipeline.grayscale().threshold(150).sharpen();
          break;
        case 'inv':
          pipeline = pipeline.grayscale().negate().normalize().sharpen();
          break;
        case 'gray':
          pipeline = pipeline.grayscale().normalize().sharpen();
          break;
        default:
          pipeline = pipeline.grayscale().sharpen();
      }

      return await pipeline.toBuffer();
    } catch (error) {
      return imageBuffer;
    }
  }

  async searchInBuffer(imageBuffer, searchText) {
    try {
      await this.init();
      if (!this.scheduler) return false;

      const normalizedSearch = searchText.replace(/\s+/g, ' ').trim().toLowerCase();
      
      // Reduced number of passes to prioritize memory and speed
      const passConfigs = [
        { name: 'std', type: 'default', psm: '3' },
        { name: 'gray', type: 'gray', psm: '11' },
        { name: 'contrast', type: 'contrast', psm: '11' },
        { name: 'adaptive', type: 'threshold_adaptive', psm: '11' },
        { name: 't150', type: 't150', psm: '11' }
      ];

      let allText = '';
      
      for (const config of passConfigs) {
        try {
          const processedBuf = await this.preprocessImage(imageBuffer, config.type);
          const res = await this.scheduler.addJob('recognize', processedBuf, {
            tessedit_pageseg_mode: config.psm
          });

          if (res && res.data && res.data.text) {
            const text = res.data.text;
            const confidence = res.data.confidence;
            const normalizedText = text.replace(/\s+/g, ' ').trim().toLowerCase();
            allText += ' ' + normalizedText;

            if (this.isExactMatch(normalizedText, normalizedSearch)) {
              if (confidence > 5) return true;
            }
          }
        } catch (e) {
          // Skip failed pass
        }
      }

      if (this.isExactMatch(allText, normalizedSearch)) return true;

      return false;
    } catch (error) {
      return false;
    }
  }
}
