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
  .version('1.1.0')
  .requiredOption('-u, --url <url>', 'Base URL to start crawling from')
  .requiredOption('-c, --content <content>', 'Text content to search for')
  .option('-o, --output <path>', 'Output Excel file path', 'results.xlsx')
  .option('-t, --threads <number>', 'Number of concurrent requests', '5')
  .option('-i, --interact <selector>', 'CSS selector to click before searching (e.g. ".expand-btn")')
  .action(async (options) => {
    const { url, content, output, threads, interact } = options;
    
    const crawler = new WebCrawler(parseInt(threads));
    const searcher = new HtmlSearcher();
    const exporter = new ExcelExporter();
    const ocrService = new OcrService();
    
    const service = new CrawlAndSearchService(crawler, searcher, exporter, ocrService);
    const controller = new AbortController();

    // Handle Ctrl+C (SIGINT) to abort gracefully
    process.on('SIGINT', () => {
      console.log('\n[INTERRUPT] Received Ctrl+C. Aborting and saving results...');
      controller.abort();
    });

    try {
      await service.execute(url, content, output, {
        interactionSelector: interact,
        screenshots: true,
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        // Handled in service.execute
      } else {
        console.error('An error occurred:', error.message);
        process.exit(1);
      }
    }
  });

program.parse(process.argv);
