import * as cheerio from 'cheerio';
import { ISearcher } from '../interfaces.js';

export class HtmlSearcher extends ISearcher {
  /**
   * Scans meta tags and the page title for the search term.
   */
  async scanMeta(page, term) {
    return page.evaluate((lc) => {
      const hits = [];
      const seenEl = new Set();

      const escapedTerm = lc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      const startBoundary = /^\w/.test(lc) ? '\\b' : '';
      const endBoundary = /\w$/.test(lc) ? '\\b' : '';
      const regex = new RegExp(`${startBoundary}${escapedTerm}${endBoundary}`, 'i');

      // 1. Page Title
      if (document.title && regex.test(document.title)) {
        hits.push({
          type: 'Page Title',
          tag: '<title>',
          content: document.title.trim(),
          screenshot: null
        });
      }

      // 2. Meta Tags
      document.querySelectorAll('meta').forEach(el => {
        const elKey = el.outerHTML;
        if (seenEl.has(elKey)) return;

        const matchedAttrs = [];
        for (const attr of ['name', 'property', 'content', 'http-equiv', 'charset']) {
          const val = (el.getAttribute(attr) || '').trim();
          if (regex.test(val)) matchedAttrs.push(`${attr}="${val}"`);
        }
        if (matchedAttrs.length === 0) return;

        seenEl.add(elKey);
        hits.push({
          type: 'Meta Tag',
          tag: '<meta>',
          content: el.outerHTML.slice(0, 400),
          screenshot: null
        });
      });
      return hits;
    }, term.toLowerCase());
  }

  /**
   * Scans attributes like alt, src, href, title, data-*, value, etc.
   */
  async scanAttributes(page, term) {
    return page.evaluate((lc) => {
      const hits = [];
      const seen = new Set();

      const escapedTerm = lc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      const startBoundary = /^\w/.test(lc) ? '\\b' : '';
      const endBoundary = /\w$/.test(lc) ? '\\b' : '';
      const regex = new RegExp(`${startBoundary}${escapedTerm}${endBoundary}`, 'i');

      const push = (attr, val, tag) => {
        // Truncate very long base64 or data strings to keep report clean
        const displayVal = val.length > 300 ? val.substring(0, 297) + '...' : val;
        const key = `${attr}|${displayVal}|${tag}`;
        if (seen.has(key)) return;
        seen.add(key);
        hits.push({
          type: `Attr: ${attr}`,
          tag: `<${tag}>`,
          content: `[${attr.toUpperCase()}] ${displayVal}`,
          screenshot: null
        });
      };

      // Standard attributes
      const ATTRIBUTES = ['alt', 'src', 'href', 'aria-label', 'title', 'placeholder', 'value', 'id', 'name'];
      
      document.querySelectorAll('*').forEach(el => {
        const tagName = el.tagName.toLowerCase();
        if (['script', 'style', 'link'].includes(tagName)) return;

        // Check defined whitelist
        for (const attr of ATTRIBUTES) {
          const v = (el.getAttribute(attr) || '').trim();
          if (regex.test(v)) push(attr, v, tagName);
        }

        // Check all data-* attributes
        for (const attr of el.getAttributeNames()) {
          if (attr.startsWith('data-')) {
            const v = (el.getAttribute(attr) || '').trim();
            if (regex.test(v)) push(attr, v, tagName);
          }
        }
      });

      return hits;
    }, term.toLowerCase());
  }

  /**
   * Scans visible and hidden text and SVG content using a leaf-match strategy.
   */
  async scanVisibleText(page, term) {
    return page.evaluate((lc) => {
      const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'IFRAME']);
      document.querySelectorAll('[data-audit-id]').forEach(e => e.removeAttribute('data-audit-id'));

      const escapedTerm = lc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      const startBoundary = /^\w/.test(lc) ? '\\b' : '';
      const endBoundary = /\w$/.test(lc) ? '\\b' : '';
      const regex = new RegExp(`${startBoundary}${escapedTerm}${endBoundary}`, 'i');
      const globalRegex = new RegExp(`${startBoundary}${escapedTerm}${endBoundary}`, 'gi');

      let counter = 0;
      const results = [];

      // Helper for SVG text extraction
      const getSvgText = (node) => {
        if (node.tagName === 'SVG' || node.ownerSVGElement) {
          // Inside SVG, we look for text, title, desc
          const tags = ['text', 'title', 'desc', 'tspan'];
          let combined = '';
          node.querySelectorAll('*').forEach(child => {
            if (tags.includes(child.tagName.toLowerCase())) {
              combined += ' ' + child.textContent;
            }
          });
          return combined.trim();
        }
        return '';
      };

      const walker = document.createTreeWalker(
        document.body, NodeFilter.SHOW_ELEMENT,
        { 
          acceptNode: n => {
            if (SKIP.has(n.tagName)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      while (walker.nextNode()) {
        const node = walker.currentNode;
        const tagName = node.tagName;
        const isSvg = tagName === 'SVG';
        const isNoscript = tagName === 'NOSCRIPT';
        
        let rawText = '';
        if (isSvg) {
          rawText = getSvgText(node);
        } else {
          // Use textContent to find hidden text, but skip script/style content via TreeWalker filter
          rawText = node.textContent || '';
        }

        const text = rawText.trim();
        // Normalize text by collapsing all whitespace for robust matching
        const normalizedText = text.replace(/\s+/g, ' ');

        if (!normalizedText || !regex.test(normalizedText)) continue;

        // Leaf match: none of the children contain the term
        // For SVG and NOSCRIPT, we treat the root as the leaf for highlighting purposes
        if (!isSvg && !isNoscript) {
          const childOwns = [...node.children].some(c => {
            if (SKIP.has(c.tagName)) return false;
            try { 
              const cText = (c.textContent || '').trim().replace(/\s+/g, ' ');
              return regex.test(cText);
            }
            catch { return false; }
          });
          if (childOwns) continue;
        }

        const id = `audit_${++counter}`;
        node.setAttribute('data-audit-id', id);

        // Count occurrences within this leaf
        const matches = normalizedText.match(globalRegex);
        const occurrences = matches ? matches.length : 1;

        const baseText = normalizedText;
        let type = 'Text Content';
        if (isSvg) type = 'SVG Content';
        if (isNoscript) type = 'Noscript Content';
        
        for (let i = 0; i < occurrences; i++) {
          results.push({
            type: type,
            tag: `<${tagName.toLowerCase()}>`,
            content: occurrences > 1 ? `${baseText} [instance ${i + 1} of ${occurrences}]` : baseText,
            auditId: id,
            isMultiple: occurrences > 1
          });
        }
      }

      return results;
    }, term.toLowerCase());
  }

  /**
   * Legacy method - maintained for interface compatibility.
   */
  countOccurrences(html, searchText) {
    const $ = cheerio.load(html);
    const text = $('body').text().replace(/\s+/g, ' ');
    const escapedSearch = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const startBoundary = /^\w/.test(searchText) ? '\\b' : '';
    const endBoundary = /\w$/.test(searchText) ? '\\b' : '';
    const regex = new RegExp(`${startBoundary}${escapedSearch}${endBoundary}`, 'gi');
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  }
}
