#!/usr/bin/env node

import { Command } from 'commander';
import { WebCrawler } from '../src/services/WebCrawler.js';
import { HtmlSearcher } from '../src/services/HtmlSearcher.js';
import { ExcelExporter } from '../src/services/ExcelExporter.js';
import { OcrService } from '../src/services/OcrService.js';
import { CrawlAndSearchService } from '../src/services/CrawlAndSearchService.js';

const program = new Command();

program
  .name('content-auth')
  .description('Crawl a website and search for content, exporting matching URLs to Excel')
  .version('1.0.0')
  .requiredOption('-u, --url <url>', 'Base URL to start crawling from')
  .requiredOption('-c, --content <content>', 'Text content to search for')
  .option('-o, --output <path>', 'Output Excel file path', 'results.xlsx')
  .option('-t, --threads <number>', 'Number of concurrent requests', '5')
  .option('-i, --interact <selector>', 'CSS selector to click before searching (e.g. ".expand-btn")')
  .option('--ocr', 'Enable OCR to search for text within images (slower)', false)
  .action(async (options) => {
    try {
      const { url, content, output, threads, interact, ocr } = options;
      
      const crawler = new WebCrawler(parseInt(threads));
      const searcher = new HtmlSearcher();
      const exporter = new ExcelExporter();
      const ocrService = ocr ? new OcrService() : null;
      
      const service = new CrawlAndSearchService(crawler, searcher, exporter, ocrService);
      
      await service.execute(url, content, output, {
        interactionSelector: interact,
        useOcr: ocr
      });
    } catch (error) {
      console.error('An error occurred:', error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
