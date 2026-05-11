import ExcelJS from 'exceljs';
import { IExporter } from '../interfaces.js';

export class ExcelExporter extends IExporter {
  /**
   * Exports data to an Excel file.
   * @param {string[]} urls - List of matching URLs.
   * @param {string} outputPath - Path to the output file.
   */
  async export(urls, outputPath) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Matching URLs');

    worksheet.columns = [
      { header: 'URL', key: 'url', width: 100 }
    ];

    urls.forEach(url => {
      worksheet.addRow({ url });
    });

    // Style the header
    worksheet.getRow(1).font = { bold: true };

    await workbook.xlsx.writeFile(outputPath);
    console.log(`Results exported to ${outputPath}`);
  }
}
