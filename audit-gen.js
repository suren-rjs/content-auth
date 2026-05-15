'use strict';

/**
 * Content Audit Scraper — Multi-URL Edition
 * ─────────────────────────────────────────
 * • Accepts 1 000+ URLs without breaking
 * • Processes URLs in configurable concurrency batches
 * • Auto-saves a JSON checkpoint after every URL so no data is lost on crash
 * • Each URL gets its own sheet (named after its path slug)
 * • A "Summary" sheet lists every URL with match counts and status
 * • Scans: meta tags · alt attributes · src attributes · visible text · OCR
 * • Screenshots stored as in-memory Buffers (no temp files needed)
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const Tesseract = require('tesseract.js');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

chromium.use(StealthPlugin());

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG — tweak these to match your environment
// ═══════════════════════════════════════════════════════════════════════════════
const CONFIG = {
    CONCURRENCY: 3,                    // parallel browser pages (keep ≤5 for stability)
    PAGE_TIMEOUT: 60_000,               // ms to wait for page load
    SCROLL_SETTLE_MS: 300,                  // ms after scrollIntoView before screenshot
    OUTPUT_FILE: 'Search_Results.xlsx',
    CHECKPOINT_FILE: 'audit_checkpoint.json', // resume-able progress file
    IMG_W: 520,                  // screenshot column width in Excel (px)
    IMG_H: 270,                  // screenshot row height in Excel (px)
    ROW_H: 200,                  // Excel row height (pt) when image present
};

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

const sleep = ms => new Promise(r => setTimeout(r, ms));
const normalise = t => t.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Turn a URL into a safe Excel sheet name (≤31 chars, no special chars).
 * Uses the pathname + search so sheets stay unique across the same domain.
 * e.g. https://xy.com/page01?q=1  →  page01_q=1   (truncated to 31)
 */
function urlToSheetName(rawUrl, index) {
    try {
        const u = new URL(rawUrl);
        const slug = (u.pathname + u.search)
            .replace(/^\//, '')          // strip leading slash
            .replace(/[\\\/\*\?\:\[\]]/g, '_') // Excel forbidden chars
            .replace(/\s+/g, '_')
            .slice(0, 28)               // leave room for dedup suffix
            || u.hostname.slice(0, 28);
        return slug || `Sheet_${index + 1}`;
    } catch {
        return `Sheet_${index + 1}`;
    }
}

/** Make sheet names unique within the workbook. */
function deduplicateSheetName(name, usedNames) {
    let candidate = name.slice(0, 31);
    let counter = 2;
    while (usedNames.has(candidate)) {
        const suffix = `_${counter++}`;
        candidate = name.slice(0, 31 - suffix.length) + suffix;
    }
    usedNames.add(candidate);
    return candidate;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKPOINT  (crash-safe progress)
// ═══════════════════════════════════════════════════════════════════════════════

function loadCheckpoint() {
    try {
        if (fs.existsSync(CONFIG.CHECKPOINT_FILE)) {
            const raw = fs.readFileSync(CONFIG.CHECKPOINT_FILE, 'utf8');
            return JSON.parse(raw); // { completedUrls: Set-as-array, results: [...] }
        }
    } catch { /* corrupt checkpoint — start fresh */ }
    return { completedUrls: [], results: [] };
}

function saveCheckpoint(completedUrls, results) {
    // Screenshots are Buffers — convert to base64 for JSON serialisation
    const serialisable = results.map(r => ({
        ...r,
        screenshot: Buffer.isBuffer(r.screenshot)
            ? r.screenshot.toString('base64')
            : r.screenshot, // null / string passthrough
    }));
    fs.writeFileSync(
        CONFIG.CHECKPOINT_FILE,
        JSON.stringify({ completedUrls: [...completedUrls], results: serialisable }, null, 0),
        'utf8'
    );
}

function rehydrateCheckpoint(raw) {
    // Convert base64 strings back to Buffers
    return raw.results.map(r => ({
        ...r,
        screenshot: typeof r.screenshot === 'string' && r.screenshot.length > 100
            ? Buffer.from(r.screenshot, 'base64')
            : r.screenshot,
    }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// BROWSER HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function clearOverlays(page) {
    await page.evaluate(() =>
        document.querySelectorAll('.__audit_ov__').forEach(e => e.remove())
    ).catch(() => { });
}

/**
 * Highlight one element and take a full-viewport screenshot.
 * Uses Playwright's boundingBox() AFTER scrollIntoViewIfNeeded() so coords
 * are always viewport-accurate. Injects the border as a position:fixed overlay
 * keyed to the live bounding box — works even with sticky headers / transforms.
 */
async function takeHighlightedShot(page, elHandle) {
    try {
        await clearOverlays(page);
        await elHandle.scrollIntoViewIfNeeded();
        await sleep(CONFIG.SCROLL_SETTLE_MS);          // let scroll + repaint settle

        // boundingBox() is Playwright-native and runs after scroll — always accurate
        const box = await elHandle.boundingBox();
        if (!box || box.width === 0 || box.height === 0) return null;

        // Paint border using absolute page coords converted to fixed viewport coords
        // via the same getBoundingClientRect that Playwright uses internally
        await elHandle.evaluate((node) => {
            // Remove any leftover overlays first
            document.querySelectorAll('.__audit_ov__').forEach(e => e.remove());
            const r = node.getBoundingClientRect();
            const ov = document.createElement('div');
            ov.className = '__audit_ov__';
            ov.style.position = 'fixed';
            ov.style.top = r.top + 'px';
            ov.style.left = r.left + 'px';
            ov.style.width = r.width + 'px';
            ov.style.height = r.height + 'px';
            ov.style.outline = '3px solid #FF0000';
            ov.style.outlineOffset = '-1px';
            ov.style.pointerEvents = 'none';
            ov.style.zIndex = '2147483647';
            ov.style.boxSizing = 'border-box';
            document.body.appendChild(ov);
        });

        const buf = await page.screenshot({ fullPage: false });
        await clearOverlays(page);
        return buf;
    } catch {
        await clearOverlays(page).catch(() => { });
        return null;
    }
}

/**
 * Take one highlighted screenshot per audit-id in the ids array.
 * Returns array of Buffers aligned to ids[].
 */
async function screenshotByIds(page, ids) {
    const buffers = [];
    for (const id of ids) {
        try {
            const el = await page.$(`[data-audit-id="${id}"]`);
            if (!el) { buffers.push(null); continue; }
            const buf = await takeHighlightedShot(page, el);
            buffers.push(buf);
        } catch {
            await clearOverlays(page).catch(() => { });
            buffers.push(null);
        }
    }
    return buffers;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOM SCANNING  (all evaluate() calls run inside the browser)
// ═══════════════════════════════════════════════════════════════════════════════

/** Phase 1 — <meta> attributes
 *  FIX: dedup by element (outerHTML) not by individual attr|val.
 *  A single <meta name="description" content="Heartland ..."> was previously
 *  emitted separately for every matching attribute; now it's emitted once
 *  with matchedAttr showing which attribute(s) triggered it.
 *  Also searches ALL meta attributes so content="..." is never skipped.
 */
async function scanMeta(page, term) {
    return page.evaluate((lc) => {
        const hits = [];
        const seenEl = new Set();   // dedup per element, not per attr

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
                attr: matchedAttrs.join(', '),
                val: matchedAttrs.join(', '),
                html: el.outerHTML.slice(0, 400),
            });
        });
        return hits;
    }, term.toLowerCase());
}

/** Phase 2 — alt & src attributes (no screenshot) */
async function scanAttributes(page, term) {
    return page.evaluate((lc) => {
        const hits = [];
        const seen = new Set();

        const push = (attr, val, tag) => {
            const key = `${attr}|${val}`;
            if (seen.has(key)) return;
            seen.add(key);
            hits.push({ attr, val, tag });
        };

        document.querySelectorAll('[alt]').forEach(el => {
            const v = (el.getAttribute('alt') || '').trim();
            if (v.toLowerCase().includes(lc)) push('alt', v, el.tagName.toLowerCase());
        });

        document.querySelectorAll('[src]:not(script):not(link)').forEach(el => {
            const v = (el.getAttribute('src') || '').trim();
            if (v.toLowerCase().includes(lc)) push('src', v, el.tagName.toLowerCase());
        });

        // href links — catches <a href="..."> and any element with href
        document.querySelectorAll('[href]').forEach(el => {
            const v = (el.getAttribute('href') || '').trim();
            if (v.toLowerCase().includes(lc)) push('href', v, el.tagName.toLowerCase());
        });

        // Also catch aria-label, title, placeholder — often missed
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
 * Phase 3 — Visible text (leaf elements only).
 *
 * Strategy: walk the full DOM tree. A node is a "leaf match" if:
 *   (a) its innerText contains the term, AND
 *   (b) NONE of its direct element children also contain the term.
 *
 * This prevents the div→div→p ancestor chain from producing 3 identical rows.
 * Additionally we collect the element's XPath so we can re-locate it later
 * for screenshotting without a second full-tree walk.
 */
// /**
//  * Phase 3 scan — stamps every matching leaf element with a unique
//  * data-audit-id attribute so Playwright can locate it precisely later.
//  * Returns results grouped by normalised text, each with an array of ids
//  * (one per instance on the page).
//  */
// async function scanVisibleText(page, term) {
//     return page.evaluate((lc) => {
//         const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'HEAD', 'META', 'LINK', 'IFRAME']);
//         // Remove any leftover stamps from a previous run on this page
//         document.querySelectorAll('[data-audit-id]').forEach(e => e.removeAttribute('data-audit-id'));

//         let counter = 0;
//         const byKey = new Map(); // normalised text → { text, tagName, ids[] }

//         const walker = document.createTreeWalker(
//             document.body, NodeFilter.SHOW_ELEMENT,
//             { acceptNode: n => SKIP.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT }
//         );

//         while (walker.nextNode()) {
//             const node = walker.currentNode;
//             let text = '';
//             try { text = node.innerText.trim(); } catch { continue; }
//             if (!text || !text.toLowerCase().includes(lc)) continue;

//             // Only keep the deepest element that owns the text (no ancestor wrappers)
//             const childOwns = [...node.children].some(c => {
//                 if (SKIP.has(c.tagName)) return false;
//                 try { return (c.innerText || '').toLowerCase().includes(lc); }
//                 catch { return false; }
//             });
//             if (childOwns) continue;

//             // Stamp a unique id directly on the element
//             const id = `audit_${++counter}`;
//             node.setAttribute('data-audit-id', id);

//             const key = text.replace(/\s+/g, ' ').toLowerCase();
//             if (byKey.has(key)) {
//                 byKey.get(key).ids.push(id);
//             } else {
//                 byKey.set(key, { text, tagName: node.tagName.toLowerCase(), ids: [id] });
//             }
//         }

//         return [...byKey.values()];
//     }, term.toLowerCase());
// }

/**
 * Phase 3 — Visible text (leaf elements only).
 * 
 * FIX: Counts multiple occurrences of the word inside a single paragraph 
 * and duplicates the data-audit-id in the tracking array so the engine 
 * yields multiple individual report rows and screenshots per word instance.
 */
async function scanVisibleText(page, term) {
    return page.evaluate((lc) => {
        const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'HEAD', 'META', 'LINK', 'IFRAME']);
        // Remove any leftover stamps from a previous run on this page
        document.querySelectorAll('[data-audit-id]').forEach(e => e.removeAttribute('data-audit-id'));

        let counter = 0;
        const byKey = new Map(); // normalised text → { text, tagName, ids[] }

        const walker = document.createTreeWalker(
            document.body, NodeFilter.SHOW_ELEMENT,
            { acceptNode: n => SKIP.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT }
        );

        while (walker.nextNode()) {
            const node = walker.currentNode;
            let text = '';
            try { text = node.innerText.trim(); } catch { continue; }
            if (!text || !text.toLowerCase().includes(lc)) continue;

            // Only keep the deepest element that owns the text (no ancestor wrappers)
            const childOwns = [...node.children].some(c => {
                if (SKIP.has(c.tagName)) return false;
                try { return (c.innerText || '').toLowerCase().includes(lc); }
                catch { return false; }
            });
            if (childOwns) continue;

            // Stamp a unique id directly on the element
            const id = `audit_${++counter}`;
            node.setAttribute('data-audit-id', id);

            // Count how many times the term appears in this specific block of text
            let occurrences = 0;
            let pos = text.toLowerCase().indexOf(lc);
            while (pos !== -1) {
                occurrences++;
                pos = text.toLowerCase().indexOf(lc, pos + lc.length);
            }
            // Fallback to 1 if something went wrong
            if (occurrences === 0) occurrences = 1;

            const key = text.replace(/\s+/g, ' ').toLowerCase();

            // Build an array containing the ID duplicated for each occurrence found
            const idInstances = Array(occurrences).fill(id);

            if (byKey.has(key)) {
                byKey.get(key).ids.push(...idInstances);
            } else {
                byKey.set(key, { text, tagName: node.tagName.toLowerCase(), ids: idInstances });
            }
        }

        return [...byKey.values()];
    }, term.toLowerCase());
}

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE-URL SCRAPER
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapePage(browser, targetUrl, searchTerm, ocrWorker) {
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 3,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    // Block heavy assets we don't need — speeds up load significantly
    await page.route('**/*', route => {
        const type = route.request().resourceType();
        if (['font', 'media', 'websocket'].includes(type)) return route.abort();
        return route.continue();
    });

    const seenContent = new Set();
    const results = [];

    function tryAdd(entry) {
        const key = normalise(entry.content);
        if (seenContent.has(key)) return false;
        seenContent.add(key);
        results.push(entry);
        return true;
    }

    try {
        console.log(`  📡 Loading: ${targetUrl}`);
        await page.goto(targetUrl, {
            waitUntil: 'domcontentloaded',    // faster than networkidle for large pages
            timeout: CONFIG.PAGE_TIMEOUT,
        });

        // Extra wait for JS-rendered content (SPAs etc.)
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => { });

        // ── Phase 1: META ───────────────────────────────────────────────────
        const metaHits = await scanMeta(page, searchTerm);
        for (const h of metaHits) {
            tryAdd({ url: targetUrl, type: 'Meta Tag', tag: '<meta>', content: h.html, screenshot: null });
        }
        if (metaHits.length) console.log(`    🔖 ${metaHits.length} meta hit(s)`);

        // ── Phase 2: ALT / SRC / ARIA ───────────────────────────────────────
        const attrHits = await scanAttributes(page, searchTerm);
        for (const h of attrHits) {
            const content = `[${h.attr.toUpperCase()}] ${h.val}`;
            tryAdd({ url: targetUrl, type: `Attr: ${h.attr}`, tag: `<${h.tag}>`, content, screenshot: null });
        }
        if (attrHits.length) console.log(`    🔖 ${attrHits.length} attribute hit(s)`);

        // ── Phase 3: VISIBLE TEXT (leaf) ────────────────────────────────────
        // scanVisibleText stamps each matching element with data-audit-id so
        // Playwright can locate them precisely with page.$() — no XPath parser.
        const leafMatches = await scanVisibleText(page, searchTerm);
        console.log(`    🔍 ${leafMatches.length} unique text match(es)`);

        for (const match of leafMatches) {
            if (seenContent.has(normalise(match.text))) continue;

            const instanceCount = match.ids.length;

            // Check visibility of the first instance
            const firstEl = await page.$(`[data-audit-id="${match.ids[0]}"]`);
            const visible = firstEl ? await firstEl.isVisible().catch(() => false) : false;

            if (!visible) {
                tryAdd({
                    url: targetUrl,
                    type: 'Hidden Text',
                    tag: `<${match.tagName}>`,
                    content: match.text,
                    screenshot: null,
                });
                continue;
            }

            if (instanceCount === 1) {
                // Single instance — one row, one screenshot
                const buf = await takeHighlightedShot(page, firstEl);
                tryAdd({
                    url: targetUrl,
                    type: 'Visible Text',
                    tag: `<${match.tagName}>`,
                    content: match.text,
                    screenshot: buf,
                });
            } else {
                // Multiple instances — one row per instance with individual screenshot
                seenContent.add(normalise(match.text));  // block tryAdd for base text
                const bufs = await screenshotByIds(page, match.ids);
                for (let i = 0; i < instanceCount; i++) {
                    results.push({
                        url: targetUrl,
                        type: 'Visible Text',
                        tag: `<${match.tagName}>`,
                        content: `${match.text} [instance ${i + 1} of ${instanceCount}]`,
                        screenshot: bufs[i] || null,
                    });
                }
                console.log(`      ↳ ${instanceCount} instances of: "${match.text.slice(0, 50)}"`);
            }
        }

        // ── Phase 4: OCR on <img> elements ─────────────────────────────────
        const imgs = await page.$$('img');
        let ocrCount = 0;
        for (const img of imgs) {
            if (!(await img.isVisible().catch(() => false))) continue;
            try {
                // Apply filters to the element for better OCR contrast
                await img.evaluate(el => {
                    el._auditStyle = el.style.filter;
                    el.style.filter = 'grayscale(100%) contrast(200%)';
                });

                // Take a high-res screenshot of the image element
                const imgBuf = await img.screenshot({ timeout: 5000 });

                // Restore original style
                await img.evaluate(el => {
                    el.style.filter = el._auditStyle || '';
                });

                const { data: { text, confidence } } = await ocrWorker.recognize(imgBuf);

                if (text && text.trim().length > 0) {
                    // console.log(`      [OCR Debug] Found: "${text.trim().replace(/\n/g, ' ').slice(0, 50)}" (Conf: ${confidence})`);
                }

                // Confidence filter — high-res binarised images usually yield much higher confidence
                if (confidence < 30) continue;
                if (!text || !text.toLowerCase().includes(searchTerm.toLowerCase())) continue;
                if (seenContent.has(normalise(text))) continue;

                const buf = await takeHighlightedShot(page, img);
                if (tryAdd({
                    url: targetUrl,
                    type: 'OCR (Image)',
                    tag: '<img>',
                    content: `[OCR] ${text.trim()}`,
                    screenshot: buf,
                })) ocrCount++;
            } catch (err) {
                // console.log(`      [OCR Error] ${err.message}`);
            }
        }
        if (ocrCount) console.log(`    🖼  ${ocrCount} OCR hit(s)`);

        console.log(`    ✅ Total: ${results.length} unique match(es) for ${targetUrl}`);
        return { url: targetUrl, status: 'ok', results };

    } catch (err) {
        console.error(`    ❌ Failed: ${targetUrl} — ${err.message}`);
        return { url: targetUrl, status: 'error', error: err.message, results };
    } finally {
        await clearOverlays(page).catch(() => { });
        await context.close().catch(() => { });
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONCURRENT BATCH RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run up to CONFIG.CONCURRENCY URLs in parallel.
 * Writes a checkpoint after EVERY completed URL so a crash loses at most
 * the in-flight batch (≤ CONCURRENCY URLs).
 */
async function runAllUrls(urls, searchTerm) {
    const cp = loadCheckpoint();
    const completedSet = new Set(cp.completedUrls);

    // Rehydrate buffered screenshots from base64
    const allResults = rehydrateCheckpoint(cp);

    const pending = urls.filter(u => !completedSet.has(u));
    console.log(`\n🚀 Starting audit`);
    console.log(`   Total URLs : ${urls.length}`);
    console.log(`   Already done: ${completedSet.size}`);
    console.log(`   Remaining  : ${pending.length}`);
    console.log(`   Concurrency: ${CONFIG.CONCURRENCY}\n`);

    const browser = await chromium.launch({ headless: true });

    // Initialise Tesseract worker pool / singleton
    const ocrWorker = await Tesseract.createWorker('eng');
    await ocrWorker.setParameters({
        tessedit_pageseg_mode: '11', // Sparse text
    });

    // Process in chunks of CONCURRENCY
    for (let i = 0; i < pending.length; i += CONFIG.CONCURRENCY) {
        const batch = pending.slice(i, i + CONFIG.CONCURRENCY);
        console.log(`\n── Batch ${Math.floor(i / CONFIG.CONCURRENCY) + 1} / ${Math.ceil(pending.length / CONFIG.CONCURRENCY)} ──`);

        const settled = await Promise.allSettled(
            batch.map(url => scrapePage(browser, url, searchTerm, ocrWorker))
        );

        for (const outcome of settled) {
            const data = outcome.status === 'fulfilled'
                ? outcome.value
                : { url: '?', status: 'error', error: outcome.reason?.message, results: [] };

            allResults.push(...data.results);
            completedSet.add(data.url);

            // Checkpoint after every URL — never lose more than one batch
            saveCheckpoint(completedSet, allResults);
        }
    }

    await ocrWorker.terminate();
    await browser.close();
    return allResults;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXCEL WRITER
// ═══════════════════════════════════════════════════════════════════════════════

function styleHeaderRow(worksheet) {
    const hdr = worksheet.getRow(4);
    hdr.values = ['URL', 'Match Type', 'HTML Tag', 'Matched Content', 'Screenshot'];
    hdr.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { bottom: { style: 'medium' } };
    });
    hdr.height = 22;
}

function applySheetColumns(worksheet) {
    worksheet.columns = [
        { width: 36 }, // URL
        { width: 18 }, // type
        { width: 12 }, // tag
        { width: 46 }, // content
        { width: 72 }, // screenshot
    ];
}

function writeTitleBlock(worksheet, titleText, matchCount) {
    worksheet.mergeCells('A1:E1');
    const t = worksheet.getCell('A1');
    t.value = titleText;
    t.font = { name: 'Arial Black', size: 14, color: { argb: 'FFFFFFFF' } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } };
    t.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 28;

    worksheet.mergeCells('A2:E2');
    const s = worksheet.getCell('A2');
    s.value = `Unique Matches: ${matchCount}`;
    s.font = { bold: true, size: 11 };
    s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE5E5' } };
    s.alignment = { horizontal: 'center' };
}

async function writeSheet(workbook, sheetName, pageUrl, rows) {
    const ws = workbook.addWorksheet(sheetName);
    applySheetColumns(ws);
    writeTitleBlock(ws, `SCAN: ${pageUrl}`, rows.length);
    styleHeaderRow(ws);

    let rowNum = 5;
    for (let i = 0; i < rows.length; i++) {
        const item = rows[i];
        const row = ws.addRow([item.url, item.type || '', item.tag || '', item.content, '']);
        row.alignment = { vertical: 'middle', wrapText: true };

        if (i % 2 !== 0) {
            [1, 2, 3, 4].forEach(c => {
                row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F6F6' } };
            });
        }

        const buf = item.screenshot;
        if (Buffer.isBuffer(buf) && buf.length > 0) {
            try {
                const imgId = workbook.addImage({ buffer: buf, extension: 'png' });
                ws.addImage(imgId, {
                    tl: { col: 4, row: rowNum - 1 },  // 0-based
                    ext: { width: CONFIG.IMG_W, height: CONFIG.IMG_H },
                    editAs: 'oneCell',
                });
                row.height = CONFIG.ROW_H;
            } catch {
                row.getCell(5).value = '(img error)';
            }
        } else {
            const cell = row.getCell(5);
            cell.value = item.screenshot === null ? 'N/A (attr)' : '(hidden)';
            cell.font = { italic: true, color: { argb: 'FF999999' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
        rowNum++;
    }
    return rows.length;
}

async function createReport(allResults, searchTerm, urls) {
    const workbook = new ExcelJS.Workbook();
    const usedNames = new Set();

    // ── Summary sheet (first sheet) ─────────────────────────────────────────
    const summary = workbook.addWorksheet('Summary');
    usedNames.add('Summary');
    summary.columns = [
        { width: 50 }, { width: 14 }, { width: 14 }, { width: 22 }
    ];

    summary.mergeCells('A1:D1');
    const st = summary.getCell('A1');
    st.value = `CONTENT AUDIT — Search Term: "${searchTerm.toUpperCase()}"`;
    st.font = { name: 'Arial Black', size: 14, color: { argb: 'FFFFFFFF' } };
    st.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } };
    st.alignment = { horizontal: 'center', vertical: 'middle' };
    summary.getRow(1).height = 28;

    summary.mergeCells('A2:D2');
    const ss = summary.getCell('A2');
    ss.value = `Total URLs scanned: ${urls.length}  |  Total matches: ${allResults.length}`;
    ss.font = { bold: true };
    ss.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE5E5' } };
    ss.alignment = { horizontal: 'center' };

    const sh = summary.getRow(4);
    sh.values = ['Page URL', 'Matches', 'Status', 'Sheet Name'];
    sh.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    sh.height = 20;

    // Group results by URL
    const byUrl = new Map();
    for (const r of allResults) {
        if (!byUrl.has(r.url)) byUrl.set(r.url, []);
        byUrl.get(r.url).push(r);
    }

    // ── Per-URL sheets ───────────────────────────────────────────────────────
    let summaryRow = 5;
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const rows = byUrl.get(url) || [];
        const sName = deduplicateSheetName(urlToSheetName(url, i), usedNames);
        const count = await writeSheet(workbook, sName, url, rows);

        // Summary row
        const sr = summary.addRow([url, count, count === 0 ? 'No matches' : 'OK', sName]);
        sr.alignment = { vertical: 'middle' };
        sr.getCell(2).alignment = { horizontal: 'center' };
        sr.getCell(3).alignment = { horizontal: 'center' };
        if (count === 0) {
            sr.getCell(3).font = { color: { argb: 'FF999999' } };
        } else {
            sr.getCell(3).font = { color: { argb: 'FF006600' }, bold: true };
        }
        if (summaryRow % 2 === 0) {
            [1, 2, 3, 4].forEach(c =>
                sr.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F6F6' } }
            );
        }
        summaryRow++;
    }

    const outFile = CONFIG.OUTPUT_FILE;
    await workbook.xlsx.writeFile(outFile);
    console.log(`\n📁 Report saved: ${outFile}`);

    // Clean up checkpoint now that we have the final report
    try { fs.unlinkSync(CONFIG.CHECKPOINT_FILE); } catch { }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

async function main(urls, searchTerm) {
    if (!Array.isArray(urls) || urls.length === 0) throw new Error('urls must be a non-empty array');
    if (!searchTerm) throw new Error('searchTerm is required');

    // Sanitise: remove blanks and duplicates, preserve order
    const cleanUrls = [...new Set(urls.map(u => u.trim()).filter(Boolean))];

    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║       CONTENT AUDIT SCRAPER              ║`);
    console.log(`║  Term: "${searchTerm}"`.padEnd(43) + '║');
    console.log(`╚══════════════════════════════════════════╝`);

    const allResults = await runAllUrls(cleanUrls, searchTerm);
    await createReport(allResults, searchTerm, cleanUrls);

    console.log('\n✅ Audit complete.');
}

// ─── Configure your URLs and search term here ─────────────────────────────────

const URLS = [
    'https://www.creativecommunications.rrd.com/testing/newsletter-test/2026/GP-test/GP/index.html',
    // 'https://www.globalpayments.com/en-us/our-company/brands/heartland-payment-systems',
    //     'https://www.globalpayments.com/en-us/insights/everything-you-need-to-know-about-visas-surcharging-rules',
    //     'https://www.globalpayments.com/en-us/insights/dev-portal',
    //     'https://www.globalpayments.com/en-us/insights/authors/amy-double-trent',
];

const SEARCH_TERM = 'Software';

main(URLS, SEARCH_TERM).catch(err => {
    console.error('\n💥 Fatal error:', err.message);
    process.exit(1);
});