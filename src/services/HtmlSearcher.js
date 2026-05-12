import * as cheerio from 'cheerio';
import { ISearcher } from '../interfaces.js';

export class HtmlSearcher extends ISearcher {
  /**
   * Counts occurrences of search text in HTML content, comprehensively including 
   * visible text, accessibility labels, SEO meta tags, and UI attributes.
   * @param {string} html - The raw HTML content.
   * @param {string} searchText - The text to search for.
   * @returns {number} - Number of occurrences found.
   */
  countOccurrences(html, searchText) {
    if (!html || !searchText) return 0;

    const $ = cheerio.load(html);
    
    // 1. Extract all hidden/semantic textual content
    let hiddenTexts = [];

    // Accessibility & UI Attributes
    const attributeSelectors = ['alt', 'title', 'aria-label', 'placeholder'];
    attributeSelectors.forEach(attr => {
      $(`[${attr}]`).each((_, el) => {
        const val = $(el).attr(attr);
        if (val) hiddenTexts.push(val);
      });
    });

    // Form Button Values
    $('input[type="button"], input[type="submit"], input[type="reset"]').each((_, el) => {
      const val = $(el).attr('value');
      if (val) hiddenTexts.push(val);
    });

    // SEO & Meta Tags
    $('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]').each((_, el) => {
      const content = $(el).attr('content');
      if (content) hiddenTexts.push(content);
    });

    // Page Title
    const pageTitle = $('title').text();
    if (pageTitle) hiddenTexts.push(pageTitle);

    // 2. Remove scripts and styles so their raw code isn't searched
    $('script, style, noscript').remove();

    // 3. Get the visible text content
    const visibleText = $('body').text() || $.text();
    
    // 4. Combine everything
    const combinedText = visibleText + ' ' + hiddenTexts.join(' ');

    // Normalize: strip excessive whitespace and lowercase
    const normalizedText = combinedText.replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizedSearch = searchText.replace(/\s+/g, ' ').trim().toLowerCase();

    // Escape regex special characters
    const escapedSearch = normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedSearch, 'g');
    
    const matches = normalizedText.match(regex);
    return matches ? matches.length : 0;
  }
}
