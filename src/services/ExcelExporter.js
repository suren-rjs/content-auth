import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { IExporter } from '../interfaces.js';

export class ExcelExporter extends IExporter {
  /**
   * Updates or creates an Excel file with a single result.
   * @param {Object} item - The result item {pageUrl, source, count, screenshot?}.
   * @param {string} outputPath - Path to the output file.
   */
  async update(item, outputPath) {
    const absolutePath = path.resolve(outputPath);
    const workbook = new ExcelJS.Workbook();
    let worksheet;

    try {
      if (fs.existsSync(absolutePath)) {
        await workbook.xlsx.readFile(absolutePath);
        worksheet = workbook.getWorksheet('Search Results');
      }
      
      if (!worksheet) {
        worksheet = workbook.addWorksheet('Search Results');
        worksheet.columns = [
          { header: 'Page URL', key: 'pageUrl', width: 40 },
          { header: 'Source', key: 'source', width: 60 },
          { header: 'Count', key: 'count', width: 10 },
          { header: 'Screenshot', key: 'screenshot', width: 40 }
        ];
        worksheet.getRow(1).font = { bold: true };
        worksheet.getColumn('count').alignment = { horizontal: 'center' };
        worksheet.getColumn('screenshot').alignment = { vertical: 'middle', horizontal: 'center' };
      }

      const rowNumber = worksheet.rowCount + 1;
      const row = worksheet.addRow({
        pageUrl: item.pageUrl,
        source: item.source,
        count: item.count
      });

      if (item.screenshot) {
        const imageId = workbook.addImage({
          buffer: item.screenshot,
          extension: 'png',
        });

        worksheet.addImage(imageId, {
          tl: { col: 3, row: rowNumber - 1 },
          ext: { width: 300, height: 200 },
          editAs: 'oneCell'
        });

        row.height = 160;
      }

      await workbook.xlsx.writeFile(absolutePath);
    } catch (error) {
      console.error(`  [ERROR] Failed to update Excel file: ${error.message}`);
    }
  }

  /**
   * legacy support for bulk export if needed
   */
  async export(data, outputPath) {
    const absolutePath = path.resolve(outputPath);
    if (fs.existsSync(absolutePath)) {
      try { fs.unlinkSync(absolutePath); } catch(e) {}
    }
    for (const item of data) {
      await this.update(item, outputPath);
    }
  }
}
