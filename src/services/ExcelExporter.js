import ExcelJS from 'exceljs';
import { IExporter } from '../interfaces.js';

export class ExcelExporter extends IExporter {
  /**
   * Exports data to an Excel file.
   * @param {Array<{url: string, count: number}>} data - List of results.
   * @param {string} outputPath - Path to the output file.
   */
  async export(data, outputPath) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Search Results');

    worksheet.columns = [
      { header: 'URL', key: 'url', width: 80 },
      { header: 'Count', key: 'count', width: 15 }
    ];

    data.forEach(item => {
      worksheet.addRow(item);
    });

    // Style the header
    worksheet.getRow(1).font = { bold: true };
    
    // Center the count column
    worksheet.getColumn('count').alignment = { horizontal: 'center' };

    await workbook.xlsx.writeFile(outputPath);
    console.log(`Results exported to ${outputPath}`);
  }
}
