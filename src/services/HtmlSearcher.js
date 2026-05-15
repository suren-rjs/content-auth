import * as cheerio from 'cheerio';
import { ISearcher } from '../interfaces.js';

export class HtmlSearcher extends ISearcher {
  /**
   * Scans meta tags for the search term.
   */
  async scanMeta(page, term) {
    return page.evaluate((lc) => {
      const hits = [];
      const seenEl = new Set();

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
   * Scans attributes like alt, src, href, etc.
   */
  async scanAttributes(page, term) {
    return page.evaluate((lc) => {
      const hits = [];
      const seen = new Set();

      const push = (attr, val, tag) => {
        const key = `${attr}|${val}|${tag}`;
        if (seen.has(key)) return;
        seen.add(key);
        hits.push({
          type: `Attr: ${attr}`,
          tag: `<${tag}>`,
          content: `[${attr.toUpperCase()}] ${val}`,
          screenshot: null
        });
      };

      document.querySelectorAll('[alt]').forEach(el => {
        const v = (el.getAttribute('alt') || '').trim();
        if (v.toLowerCase().includes(lc)) push('alt', v, el.tagName.toLowerCase());
      });

      document.querySelectorAll('[src]:not(script):not(link)').forEach(el => {
        const v = (el.getAttribute('src') || '').trim();
        if (v.toLowerCase().includes(lc)) push('src', v, el.tagName.toLowerCase());
      });

      document.querySelectorAll('[href]').forEach(el => {
        const v = (el.getAttribute('href') || '').trim();
        if (v.toLowerCase().includes(lc)) push('href', v, el.tagName.toLowerCase());
      });

      for (const attr of ['aria-label', 'title', 'placeholder']) {
        document.querySelectorAll(`[${attr}]`).forEach(el => {
          const v = (el.getAttribute(attr) || '').trim();
          if (v.toLowerCase().includes(lc)) push(attr, v, el.tagName.toLowerCase());
        });
      }

      return hits;
    }, term.toLowerCase());
  }

  /**
   * Scans visible text using a leaf-match strategy and stamps elements with data-audit-id.
   */
  async scanVisibleText(page, term) {
    return page.evaluate((lc) => {
      const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'HEAD', 'META', 'LINK', 'IFRAME']);
      document.querySelectorAll('[data-audit-id]').forEach(e => e.removeAttribute('data-audit-id'));

      let counter = 0;
      const results = [];

      const walker = document.createTreeWalker(
        document.body, NodeFilter.SHOW_ELEMENT,
        { acceptNode: n => SKIP.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT }
      );

      while (walker.nextNode()) {
        const node = walker.currentNode;
        let text = '';
        try { text = node.innerText.trim(); } catch { continue; }
        if (!text || !text.toLowerCase().includes(lc)) continue;

        // Leaf match: none of the children contain the term
        const childOwns = [...node.children].some(c => {
          if (SKIP.has(c.tagName)) return false;
          try { return (c.innerText || '').toLowerCase().includes(lc); }
          catch { return false; }
        });
        if (childOwns) continue;

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
        for (let i = 0; i < occurrences; i++) {
          results.push({
            type: 'Visible Text',
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
