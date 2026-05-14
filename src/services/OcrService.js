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
        pipeline = pipeline.linear(2, -0.5);
      } else if (type === 'threshold') {
        pipeline = pipeline.threshold(180);
      } else if (type === 'inverted') {
        pipeline = pipeline.negate();
      }
      
      return await pipeline.normalize().sharpen().toBuffer();
    } catch (error) {
      return imageBuffer;
    }
  }

  async downloadImage(url) {
    const response = await axios.get(url, { 
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    return Buffer.from(response.data, 'binary');
  }

  /**
   * Comprehensive extraction of image URLs from HTML, including picture tags.
   * Note: CSS backgrounds are handled by the WebCrawler via Puppeteer.
   */
  extractImageUrls(html, baseUrl) {
    const $ = cheerio.load(html);
    const urls = [];

    // Standard <img> tags
    $('img[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (src) urls.push(src);
    });

    // <picture> <source> tags
    $('picture source[srcset]').each((_, el) => {
      const srcset = $(el).attr('srcset');
      if (srcset) {
        // Grab the first URL in the srcset (usually the original/largest)
        const firstUrl = srcset.split(',')[0].trim().split(' ')[0];
        urls.push(firstUrl);
      }
    });

    const finalUrls = [];
    urls.forEach(src => {
      try {
        const absoluteUrl = new URL(src, baseUrl);
        const pathname = absoluteUrl.pathname.toLowerCase();
        
        const isOcrCompatible = /\.(png|jpe?g|webp|bmp|svg)$/i.test(pathname);
        const isNotIcon = !/(favicon|pixel|tracker|spacer)/i.test(pathname);
        
        if (isOcrCompatible && isNotIcon) {
          finalUrls.push(absoluteUrl.toString());
        }
      } catch (e) {}
    });

    return [...new Set(finalUrls)];
  }

  /**
   * Searches for text within an image using multi-pass pre-processing.
   */
  async searchInImage(imageUrl, searchText) {
    try {
      await this.init();
      if (!this.worker) return 0;

      const originalBuffer = await this.downloadImage(imageUrl);

      const passes = [
        originalBuffer,
        await this.preprocessImage(originalBuffer, 'default'),
        await this.preprocessImage(originalBuffer, 'high-contrast'),
        await this.preprocessImage(originalBuffer, 'threshold'),
        await this.preprocessImage(originalBuffer, 'inverted')
      ];

      const normalizedSearch = searchText.replace(/\s+/g, ' ').trim().toLowerCase();
      const searchWords = normalizedSearch.split(' ');
      
      for (const buffer of passes) {
        const { data: { text } } = await this.worker.recognize(buffer);
        if (!text) continue;
        
        const normalizedText = text.replace(/\s+/g, ' ').trim().toLowerCase();
        
        if (normalizedText.includes(normalizedSearch)) return 1;

        if (searchWords.length >= 2) {
          let matchCount = 0;
          for (const word of searchWords) {
            if (word.length <= 3) {
              const regex = new RegExp(`\\b${word}\\b`, 'i');
              if (regex.test(normalizedText)) matchCount++;
            } else {
              const prefixLen = Math.max(3, Math.floor(word.length * 0.75));
              const prefix = word.substring(0, prefixLen);
              if (normalizedText.includes(prefix)) matchCount++;
            }
          }
          if (matchCount / searchWords.length >= 0.75) return 1;
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
