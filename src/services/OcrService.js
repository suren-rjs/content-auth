import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

export class OcrService {
  constructor() {
    this.worker = null;
    this.isInitializing = false;
    this.cachePath = path.resolve(process.cwd(), '.tesseract-cache');
    this.dashboard = null;
  }

  setDashboard(dashboard) {
    this.dashboard = dashboard;
  }

  async init() {
    if (this.worker) return;
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

      this.worker = await createWorker('eng', 1, {
        cachePath: this.cachePath,
        logger: () => {} 
      });

      await this.worker.setParameters({
        tessjs_create_hocr: '0',
        tessjs_create_tsv: '0',
      });
    } catch (error) {
      this.worker = null;
    } finally {
      this.isInitializing = false;
    }
  }

  async terminate() {
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch (e) {}
      this.worker = null;
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
    const t = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
    const s = term.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    
    if (t.includes(s)) return true;

    if (s.length > 4) {
      const joinedT = t.replace(/\s+/g, '');
      if (joinedT.includes(s)) return true;

      const words = t.split(/\s+/);
      for (const word of words) {
        if (word.length < 3) continue;
        const dist = this.levenshtein(word, s);
        
        let limit = 0.35;
        if (word[0] === s[0]) limit = 0.45;
        if (word.endsWith('ware') || word.includes('ware')) limit = 0.55;
        
        const maxDist = Math.floor(s.length * limit);
        if (dist <= maxDist) {
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
      
      const targetWidth = Math.max(1200, (metadata.width || 0) * 3);
      pipeline = pipeline.resize({ width: Math.round(targetWidth), kernel: sharp.kernel.lanczos3 });

      switch (type) {
        case 'red':
          pipeline = pipeline.extractChannel('red').normalize().sharpen();
          break;
        case 'contrast':
          pipeline = pipeline.grayscale().linear(3, -0.7).sharpen();
          break;
        case 't200':
          pipeline = pipeline.grayscale().threshold(200);
          break;
        case 't150':
          pipeline = pipeline.grayscale().threshold(150);
          break;
        case 't100':
          pipeline = pipeline.grayscale().threshold(100);
          break;
        case 't80':
          pipeline = pipeline.grayscale().threshold(80);
          break;
        case 'inv':
          pipeline = pipeline.grayscale().negate().normalize();
          break;
        case 'gray':
          pipeline = pipeline.grayscale().normalize().sharpen();
          break;
        default:
          pipeline = pipeline.grayscale();
      }

      return await pipeline.toBuffer();
    } catch (error) {
      return imageBuffer;
    }
  }

  async searchInBuffer(imageBuffer, searchText) {
    try {
      await this.init();
      if (!this.worker) return false;

      const metadata = await sharp(imageBuffer).metadata();
      const targetWidth = Math.max(1200, (metadata.width || 0) * 3);
      
      const upscaledBase = await sharp(imageBuffer)
        .flatten({ background: '#ffffff' })
        .resize({ width: Math.round(targetWidth), kernel: sharp.kernel.lanczos3 })
        .toBuffer();

      const passes = [
        { name: 'flat', buf: upscaledBase, psm: '11' },
        { name: 't200', buf: await this.preprocessImage(imageBuffer, 't200'), psm: '11' },
        { name: 't150', buf: await this.preprocessImage(imageBuffer, 't150'), psm: '11' },
        { name: 't100', buf: await this.preprocessImage(imageBuffer, 't100'), psm: '11' },
        { name: 't80', buf: await this.preprocessImage(imageBuffer, 't80'), psm: '11' },
        { name: 'red', buf: await this.preprocessImage(imageBuffer, 'red'), psm: '11' },
        { name: 'inv', buf: await this.preprocessImage(imageBuffer, 'inv'), psm: '11' },
        { name: 'contrast', buf: await this.preprocessImage(imageBuffer, 'contrast'), psm: '11' },
        { name: 'gray', buf: await this.preprocessImage(imageBuffer, 'gray'), psm: '11' },
        { name: 'auto', buf: upscaledBase, psm: '3' }
      ];

      const normalizedSearch = searchText.replace(/\s+/g, ' ').trim().toLowerCase();
      let allText = '';

      for (const pass of passes) {
        if (this.dashboard) {
          const currentStatus = this.dashboard.currentStatus;
          this.dashboard.updateStatus(`${currentStatus} (${pass.name})`);
        }

        await this.worker.setParameters({ tessedit_pageseg_mode: pass.psm });
        const { data: { text, confidence } } = await this.worker.recognize(pass.buf);
        if (!text) continue;

        const normalizedText = text.replace(/\s+/g, ' ').trim().toLowerCase();
        allText += ' ' + normalizedText;

        if (this.isFuzzyMatch(normalizedText, normalizedSearch)) {
          if (confidence > 3) return true; 
        }
      }

      if (this.isFuzzyMatch(allText, normalizedSearch)) return true;

      return false;
    } catch (error) {
      return false;
    }
  }
}
