import { createWorker, createScheduler } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

export class OcrService {
  constructor(concurrency = 5) {
    this.concurrency = concurrency;
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

  levenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
        }
      }
    }
    return matrix[b.length][a.length];
  }

  isFuzzyMatch(text, term) {
    if (!text || !term) return false;
    
    const t = text.toLowerCase().replace(/[^a-z0-9]/g, '');
    const s = term.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Direct substring match on cleaned text
    if (t.includes(s)) return true;
    
    // If term is very short, don't do fuzzy matching to avoid false positives
    if (s.length < 3) return false;

    if (s.length > 4) {
      const words = text.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z0-9]/g, ''));
      for (const word of words) {
        if (word.length < 3) continue;
        if (word.includes(s) || s.includes(word)) return true;

        const dist = this.levenshtein(word, s);
        
        let limit = 0.3; // Stricter limit
        if (word[0] === s[0]) limit = 0.4;
        
        const maxDist = Math.floor(s.length * limit);
        if (dist <= maxDist) {
          // Special cases to avoid common mismatches
          if (s === 'hardware' && word === 'software') continue;
          if (s === 'software' && word === 'hardware') continue;
          return true;
        }
      }
    }
    return false;
  }

  async preprocessImage(imageBuffer, type = 'default') {
    try {
      const metadata = await sharp(imageBuffer).metadata();
      let pipeline = sharp(imageBuffer).flatten({ background: '#ffffff' }); 
      
      // Increased resolution for better detail
      const targetWidth = Math.max(1600, (metadata.width || 0) * 4);
      pipeline = pipeline.resize({ width: Math.round(targetWidth), kernel: sharp.kernel.lanczos3 });

      switch (type) {
        case 'red':
          pipeline = pipeline.extractChannel('red').normalize().sharpen();
          break;
        case 'contrast':
          pipeline = pipeline.grayscale().linear(3, -0.7).sharpen();
          break;
        case 't200':
          pipeline = pipeline.grayscale().threshold(200).sharpen();
          break;
        case 't150':
          pipeline = pipeline.grayscale().threshold(150).sharpen();
          break;
        case 't100':
          pipeline = pipeline.grayscale().threshold(100).sharpen();
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

      const metadata = await sharp(imageBuffer).metadata();
      const targetWidth = Math.max(1600, (metadata.width || 0) * 4);
      
      const upscaledBase = await sharp(imageBuffer)
        .flatten({ background: '#ffffff' })
        .resize({ width: Math.round(targetWidth), kernel: sharp.kernel.lanczos3 })
        .toBuffer();

      // Parallelize preprocessing to save time
      const [bufT200, bufT150, bufT100, bufRed, bufInv, bufContrast, bufGray] = await Promise.all([
        this.preprocessImage(imageBuffer, 't200'),
        this.preprocessImage(imageBuffer, 't150'),
        this.preprocessImage(imageBuffer, 't100'),
        this.preprocessImage(imageBuffer, 'red'),
        this.preprocessImage(imageBuffer, 'inv'),
        this.preprocessImage(imageBuffer, 'contrast'),
        this.preprocessImage(imageBuffer, 'gray')
      ]);

      const passes = [
        { name: 'std', buf: upscaledBase, psm: '3' },
        { name: 'sparse', buf: upscaledBase, psm: '11' },
        { name: 't200', buf: bufT200, psm: '11' },
        { name: 't150', buf: bufT150, psm: '11' },
        { name: 't100', buf: bufT100, psm: '11' },
        { name: 'red', buf: bufRed, psm: '11' },
        { name: 'inv', buf: bufInv, psm: '11' },
        { name: 'contrast', buf: bufContrast, psm: '11' },
        { name: 'gray', buf: bufGray, psm: '11' }
      ];

      const normalizedSearch = searchText.replace(/\s+/g, ' ').trim().toLowerCase();
      
      // Run ALL OCR passes in parallel using the scheduler pool
      const results = await Promise.all(passes.map(async (pass) => {
        try {
          const res = await this.scheduler.addJob('recognize', pass.buf, {
            tessedit_pageseg_mode: pass.psm
          });
          return { ...res, name: pass.name };
        } catch (e) {
          return null;
        }
      }));

      let allText = '';
      for (const res of results) {
        if (!res || !res.data || !res.data.text) continue;
        const text = res.data.text;
        const confidence = res.data.confidence;
        
        const normalizedText = text.replace(/\s+/g, ' ').trim().toLowerCase();
        allText += ' ' + normalizedText;

        if (this.isFuzzyMatch(normalizedText, normalizedSearch)) {
          // If we found a match with reasonable confidence, return true
          if (confidence > 15) return true; 
        }
      }

      // Final check on aggregated text across all passes
      if (this.isFuzzyMatch(allText, normalizedSearch)) return true;

      return false;
    } catch (error) {
      return false;
    }
  }
}
