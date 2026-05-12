import * as cheerio from 'cheerio';
import { ISearcher } from '../interfaces.js';

export class HtmlSearcher extends ISearcher {
  /**
   * Counts occurrences of search text in HTML content, ignoring tags and case.
   * @param {string} html - The raw HTML content.
   * @param {string} searchText - The text to search for.
   * @returns {number} - Number of occurrences found.
   */
  countOccurrences(html, searchText) {
    if (!html || !searchText) return 0;

    const $ = cheerio.load(html);
    
    // Remove scripts and styles to avoid matching code
    $('script, style').remove();

    // Get the visible text content
    const visibleText = $('body').text() || $.text();

    // Normalize text: strip tags, normalize whitespace, and lowercase
    const normalizedText = visibleText.replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizedSearch = searchText.replace(/\s+/g, ' ').trim().toLowerCase();

    // Escape regex special characters in search text
    const escapedSearch = normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedSearch, 'g');
    
    const matches = normalizedText.match(regex);
    return matches ? matches.length : 0;
  }
}
