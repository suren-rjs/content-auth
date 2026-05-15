#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs';
import { WebCrawler } from '../src/services/WebCrawler.js';
import { HtmlSearcher } from '../src/services/HtmlSearcher.js';
import { ExcelExporter } from '../src/services/ExcelExporter.js';
import { OcrService } from '../src/services/OcrService.js';
import { CrawlAndSearchService } from '../src/services/CrawlAndSearchService.js';
import { TerminalDashboard } from '../src/services/TerminalDashboard.js';

const program = new Command();

program
  .name('content-audit')
  .description('Comprehensive website content audit: Search visible text, hidden attributes, and images')
  .version('1.2.0')
  .option('-u, --url <url>', 'Single URL to audit')
  .option('-f, --file <path>', 'Text file containing list of URLs to audit (one per line)')
  .requiredOption('-c, --content <content>', 'Text content to search for')
  .option('-o, --output <path>', 'Output Excel file path', 'results.xlsx')
  .option('-t, --threads <number>', 'Number of concurrent requests', '5')
  .option('-i, --interact <selector>', 'CSS selector to click before searching (e.g. ".expand-btn")')
  .action(async (options) => {
    let { url, file, content, output, threads, interact } = options;
    
    let urls = [];
    if (url) {
      urls.push(url);
    }
    
    if (file) {
      try {
        const fileContent = fs.readFileSync(file, 'utf8');
        const fileUrls = fileContent.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        urls.push(...fileUrls);
      } catch (err) {
        console.error(`Error reading URL file: ${err.message}`);
        process.exit(1);
      }
    }

    if (urls.length === 0) {
      console.error('Error: Please provide either a URL (-u) or a file with URLs (-f).');
      process.exit(1);
    }

    urls = [...new Set(urls)];

    const dashboard = new TerminalDashboard();
    const crawler = new WebCrawler(parseInt(threads));
    const searcher = new HtmlSearcher();
    const exporter = new ExcelExporter();
    const ocrService = new OcrService();
    
    const service = new CrawlAndSearchService(crawler, searcher, exporter, ocrService, dashboard);
    const controller = new AbortController();

    process.on('SIGINT', () => {
      controller.abort();
    });

    try {
      await service.execute(urls, content, output, {
        interactionSelector: interact,
        screenshots: true,
        signal: controller.signal,
        noFollow: true 
      });
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('An error occurred:', error.message);
        process.exit(1);
      }
    }
  });

program.parse(process.argv);
