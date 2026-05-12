import { createWorker } from 'tesseract.js';
import * as cheerio from 'cheerio';
import sharp from 'sharp';
import axios from 'axios';

export class OcrService {
  constructor() {
    this.worker = null;
    this.isInitializing = false;
  }

  /**
   * Initializes the Tesseract worker.
   */
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
      console.log('Initializing OCR engine...');
      this.worker = await createWorker('eng', 1, {
        errorHandler: (err) => console.error('OCR Worker Error:', err)
      });
      
      // Removed strict whitelist to allow the engine to be more flexible with stylized shapes
      await this.worker.setParameters({
        tessjs_create_hocr: '0',
        tessjs_create_tsv: '0',
      });
    } catch (error) {
      console.error('Failed to initialize OCR worker:', error.message);
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

  /**
   * Pre-processes an image with multiple techniques to maximize readability.
   */
  async preprocessImage(imageBuffer, type = 'default') {
    try {
      let pipeline = sharp(imageBuffer).grayscale();
      
      if (type === 'high-contrast') {
        pipeline = pipeline.linear(2, -0.5); // Increase contrast significantly
      } else if (type === 'threshold') {
        pipeline = pipeline.threshold(180); // Higher threshold for lighter text
      } else if (type === 'inverted') {
        pipeline = pipeline.negate(); // Invert colors if text is light on dark
      }
      
      return await pipeline.normalize().sharpen().toBuffer();
    } catch (error) {
      return imageBuffer;
    }
  }

  async downloadImage(url) {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data, 'binary');
  }

  extractImageUrls(html, baseUrl) {
    const $ = cheerio.load(html);
    const urls = [];
    $('img[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (!src) return;

      try {
        const absoluteUrl = new URL(src, baseUrl);
        const pathname = absoluteUrl.pathname.toLowerCase();
        
        const isOcrCompatible = /\.(png|jpe?g|webp|bmp)$/i.test(pathname);
        const isNotIcon = !/(favicon|pixel|tracker|spacer)/i.test(pathname);
        
        if (isOcrCompatible && isNotIcon) {
          urls.push(absoluteUrl.toString());
        }
      } catch (e) {}
    });
    return [...new Set(urls)];
  }

  /**
   * Searches for text within an image using multi-pass pre-processing.
   */
  async searchInImage(imageUrl, searchText) {
    try {
      await this.init();
      if (!this.worker) return 0;

      const originalBuffer = await this.downloadImage(imageUrl);

      // Multi-pass approach: try different filters to see which one works
      const passes = [
        originalBuffer,
        await this.preprocessImage(originalBuffer, 'default'),
        await this.preprocessImage(originalBuffer, 'high-contrast'),
        await this.preprocessImage(originalBuffer, 'threshold'),
        await this.preprocessImage(originalBuffer, 'inverted')
      ];

      const normalizedSearch = searchText.replace(/\s+/g, ' ').trim().toLowerCase();
      
      for (const buffer of passes) {
        const { data: { text } } = await this.worker.recognize(buffer);
        if (!text) continue;
        
        const normalizedText = text.replace(/\s+/g, ' ').trim().toLowerCase();
        
        // 1. Direct match
        if (normalizedText.includes(normalizedSearch)) return 1;

        // 2. Fuzzy match (more aggressive for stylized text)
        const searchWords = normalizedSearch.split(' ');
        if (searchWords.length >= 2) {
          let matchCount = 0;
          for (const word of searchWords) {
            // Check for partial word matches (at least 70% of word length)
            if (word.length >= 3) {
              const regex = new RegExp(word.substring(0, Math.floor(word.length * 0.7)), 'i');
              if (regex.test(normalizedText)) matchCount++;
            }
          }
          if (matchCount / searchWords.length >= 0.5) return 1;
        }
      }

      return 0;
    } catch (error) {
      console.error(`OCR skipped for ${imageUrl}: ${error.message}`);
      if (error.message && (error.message.includes('Unknown format') || error.message.includes('pixReadStream'))) {
        await this.terminate();
      }
      return 0;
    }
  }
}
