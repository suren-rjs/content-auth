import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { IExporter } from '../interfaces.js';

export class ExcelExporter extends IExporter {
  constructor() {
    super();
    this.IMG_W = 520;
    this.IMG_H = 270;
    this.ROW_H = 200;
  }

  /**
   * Generates a safe sheet name from a URL.
   */
  urlToSheetName(rawUrl, index, usedNames) {
    try {
      const u = new URL(rawUrl);
      let slug = (u.pathname + u.search)
        .replace(/^\//, '')
        .replace(/[\\\/\*\?\:\[\]]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 28) || u.hostname.slice(0, 28);
      
      let candidate = slug.slice(0, 31);
      let counter = 2;
      while (usedNames.has(candidate)) {
        const suffix = `_${counter++}`;
        candidate = slug.slice(0, 31 - suffix.length) + suffix;
      }
      return candidate;
    } catch {
      return `Sheet_${index + 1}`;
    }
  }

  styleHeaderRow(worksheet, values) {
    const hdr = worksheet.getRow(4);
    hdr.values = values;
    hdr.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { bottom: { style: 'medium' } };
    });
    hdr.height = 22;
  }

  writeTitleBlock(worksheet, titleText, subtitle, matchCount) {
    worksheet.mergeCells('A1:E1');
    const t = worksheet.getCell('A1');
    t.value = titleText;
    t.font = { name: 'Arial Black', size: 14, color: { argb: 'FFFFFFFF' } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } };
    t.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 28;

    worksheet.mergeCells('A2:E2');
    const s = worksheet.getCell('A2');
    s.value = subtitle;
    s.font = { bold: true, size: 11 };
    s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE5E5' } };
    s.alignment = { horizontal: 'center' };
  }

  async export(allResults, outputPath, options = {}) {
    const { searchTerm = '', urls = [] } = options;
    const absolutePath = path.resolve(outputPath);
    const workbook = new ExcelJS.Workbook();
    const usedNames = new Set();

    // 1. Summary Sheet
    const summary = workbook.addWorksheet('Summary');
    usedNames.add('Summary');
    summary.columns = [
      { width: 50 }, { width: 14 }, { width: 14 }, { width: 22 }
    ];

    this.writeTitleBlock(summary, `CONTENT AUDIT — Search Term: "${searchTerm.toUpperCase()}"`, 
      `Total URLs scanned: ${urls.length}  |  Total matches: ${allResults.length}`, allResults.length);

    this.styleHeaderRow(summary, ['Page URL', 'Matches', 'Status', 'Sheet Name']);

    const byUrl = new Map();
    for (const r of allResults) {
      if (!byUrl.has(r.pageUrl)) byUrl.set(r.pageUrl, []);
      byUrl.get(r.pageUrl).push(r);
    }

    // 2. Per-URL Sheets
    let summaryRowIdx = 5;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const rows = byUrl.get(url) || [];
      const sName = this.urlToSheetName(url, i, usedNames);
      usedNames.add(sName);

      const ws = workbook.addWorksheet(sName);
      ws.columns = [
        { width: 36 }, { width: 18 }, { width: 12 }, { width: 46 }, { width: 72 }
      ];

      this.writeTitleBlock(ws, `SCAN: ${url}`, `Unique Matches: ${rows.length}`, rows.length);
      this.styleHeaderRow(ws, ['URL', 'Match Type', 'HTML Tag', 'Matched Content', 'Screenshot']);

      let rowNum = 5;
      for (let j = 0; j < rows.length; j++) {
        const item = rows[j];
        const row = ws.addRow([item.pageUrl, item.type || '', item.tag || '', item.content, '']);
        row.alignment = { vertical: 'middle', wrapText: true };

        if (j % 2 !== 0) {
          [1, 2, 3, 4].forEach(c => {
            row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F6F6' } };
          });
        }

        if (item.screenshot) {
          try {
            const imgId = workbook.addImage({ buffer: item.screenshot, extension: 'png' });
            ws.addImage(imgId, {
              tl: { col: 4, row: rowNum - 1 },
              ext: { width: this.IMG_W, height: this.IMG_H },
              editAs: 'oneCell',
            });
            row.height = this.ROW_H;
          } catch (e) {
            row.getCell(5).value = '(img error)';
          }
        } else {
          const cell = row.getCell(5);
          cell.value = item.screenshot === null ? 'N/A' : '(hidden)';
          cell.font = { italic: true, color: { argb: 'FF999999' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
        rowNum++;
      }

      // Add to summary
      const sr = summary.addRow([url, rows.length, rows.length === 0 ? 'No matches' : 'OK', sName]);
      sr.alignment = { vertical: 'middle' };
      sr.getCell(2).alignment = { horizontal: 'center' };
      sr.getCell(3).alignment = { horizontal: 'center' };
      if (rows.length === 0) {
        sr.getCell(3).font = { color: { argb: 'FF999999' } };
      } else {
        sr.getCell(3).font = { color: { argb: 'FF006600' }, bold: true };
      }
      if (summaryRowIdx % 2 === 0) {
        [1, 2, 3, 4].forEach(c =>
          sr.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F6F6' } }
        );
      }
      summaryRowIdx++;
    }

    await workbook.xlsx.writeFile(absolutePath);
    console.log(`\n📁 Report saved: ${outputPath}`);
  }

  /**
   * Backward compatibility for single update
   */
  async update(item, outputPath) {
    // This is less efficient now, we prefer bulk export at the end.
    // But we'll leave it as a no-op or simple implementation if needed.
  }
}
