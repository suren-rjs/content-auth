import ExcelJS from 'exceljs';
import { IExporter } from '../interfaces.js';

export class ExcelExporter extends IExporter {
  /**
   * Exports data to an Excel file with optional embedded screenshots.
   * @param {Array<{pageUrl: string, source: string, count: number, screenshot?: Buffer}>} data - List of results.
   * @param {string} outputPath - Path to the output file.
   */
  async export(data, outputPath) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Search Results');

    const hasScreenshots = data.some(item => item.screenshot);

    worksheet.columns = [
      { header: 'Page URL', key: 'pageUrl', width: 40 },
      { header: 'Source', key: 'source', width: 60 },
      { header: 'Count', key: 'count', width: 10 },
      ...(hasScreenshots ? [{ header: 'Screenshot', key: 'screenshot', width: 40 }] : [])
    ];

    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const rowNumber = i + 2; // +1 for 1-based index, +1 for header
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

        row.height = 160; // Make row tall enough for the image
      }
    }

    // Style the header
    worksheet.getRow(1).font = { bold: true };
    
    // Center alignment
    worksheet.getColumn('count').alignment = { horizontal: 'center' };
    if (hasScreenshots) {
      worksheet.getColumn('screenshot').alignment = { vertical: 'middle', horizontal: 'center' };
    }

    await workbook.xlsx.writeFile(outputPath);
    console.log(`Results exported to ${outputPath}`);
  }
}
