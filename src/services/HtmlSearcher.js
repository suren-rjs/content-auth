import * as cheerio from 'cheerio';
import { ISearcher } from '../interfaces.js';

export class HtmlSearcher extends ISearcher {
  /**
   * Matches search text against HTML content, ignoring tags and case.
   * @param {string} html - The raw HTML content.
   * @param {string} searchText - The text to search for.
   * @returns {boolean} - True if a match is found.
   */
  matches(html, searchText) {
    if (!html || !searchText) return false;

    const $ = cheerio.load(html);
    
    // Remove scripts and styles to avoid matching code
    $('script, style').remove();

    // Get the visible text content
    const visibleText = $('body').text() || $.text();

    // Normalize text: strip tags (already done by .text()), normalize whitespace, and case-insensitive match
    const normalizedText = visibleText.replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizedSearch = searchText.replace(/\s+/g, ' ').trim().toLowerCase();

    return normalizedText.includes(normalizedSearch);
  }
}
