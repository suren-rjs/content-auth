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
  .description('Comprehensive website content audit: Search visible text, hidden attributes, and images')
  .version('1.3.0')
  .requiredOption('-u, --url <url>', 'Base URL to start crawling from')
  .requiredOption('-c, --content <content>', 'Text content to search for')
  .option('-o, --output <path>', 'Output Excel file path', 'results.xlsx')
  .option('-t, --threads <number>', 'Number of concurrent requests', '5')
  .option('-i, --interact <selector>', 'CSS selector to click before searching (e.g. ".expand-btn")')
  .action(async (options) => {
    try {
      const { url, content, output, threads, interact } = options;
      
      const crawler = new WebCrawler(parseInt(threads));
      const searcher = new HtmlSearcher();
      const exporter = new ExcelExporter();
      const ocrService = new OcrService(); // Always on
      
      const service = new CrawlAndSearchService(crawler, searcher, exporter, ocrService);
      
      await service.execute(url, content, output, {
        interactionSelector: interact,
        screenshots: true
      });
    } catch (error) {
      console.error('An error occurred:', error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
