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

      // 1. Page Title
      if (document.title && document.title.toLowerCase().includes(lc)) {
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
          if (val.toLowerCase().includes(lc)) matchedAttrs.push(`${attr}="${val}"`);
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
        if (['script', 'style', 'noscript', 'link'].includes(tagName)) return;

        // Check defined whitelist
        for (const attr of ATTRIBUTES) {
          const v = (el.getAttribute(attr) || '').trim();
          if (v.toLowerCase().includes(lc)) push(attr, v, tagName);
        }

        // Check all data-* attributes
        for (const attr of el.getAttributeNames()) {
          if (attr.startsWith('data-')) {
            const v = (el.getAttribute(attr) || '').trim();
            if (v.toLowerCase().includes(lc)) push(attr, v, tagName);
          }
        }
      });

      return hits;
    }, term.toLowerCase());
  }

  /**
   * Scans visible text and SVG content using a leaf-match strategy.
   */
  async scanVisibleText(page, term) {
    return page.evaluate((lc) => {
      const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'META', 'LINK', 'IFRAME']);
      document.querySelectorAll('[data-audit-id]').forEach(e => e.removeAttribute('data-audit-id'));

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
        const isSvg = node.tagName === 'SVG';
        
        let text = '';
        if (isSvg) {
          text = getSvgText(node);
        } else {
          try { text = node.innerText.trim(); } catch { continue; }
        }

        if (!text || !text.toLowerCase().includes(lc)) continue;

        // Leaf match: none of the children contain the term
        // For SVG, we treat the root <svg> as the leaf for highlighting purposes
        if (!isSvg) {
          const childOwns = [...node.children].some(c => {
            if (SKIP.has(c.tagName)) return false;
            try { return (c.innerText || '').toLowerCase().includes(lc); }
            catch { return false; }
          });
          if (childOwns) continue;
        }

        const id = `audit_${++counter}`;
        node.setAttribute('data-audit-id', id);

        // Count occurrences within this leaf
        let occurrences = 0;
        let pos = text.toLowerCase().indexOf(lc);
        while (pos !== -1) {
          occurrences++;
          pos = text.toLowerCase().indexOf(lc, pos + lc.length);
        }
        if (occurrences === 0) occurrences = 1;

        const baseText = text.replace(/\s+/g, ' ');
        const type = isSvg ? 'SVG Content' : 'Visible Text';
        
        for (let i = 0; i < occurrences; i++) {
          results.push({
            type: type,
            tag: `<${node.tagName.toLowerCase()}>`,
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
    const text = $('body').text().toLowerCase();
    const normalizedSearch = searchText.toLowerCase();
    const escapedSearch = normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedSearch, 'g');
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  }
}
