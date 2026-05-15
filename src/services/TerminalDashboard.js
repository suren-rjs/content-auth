import readline from 'readline';

export class TerminalDashboard {
  constructor() {
    this.totalUrls = 0;
    this.completedUrls = 0;
    this.currentUrl = '';
    this.currentStatus = 'Initializing...';
    this.counts = {
      meta: 0,
      text: 0,
      ocr: 0
    };
    this.startTime = Date.now();
  }

  init(totalUrls) {
    this.totalUrls = totalUrls;
    this.render();
  }

  updateProgress(completed, total) {
    if (completed !== undefined) this.completedUrls = completed;
    if (total !== undefined) this.totalUrls = total;
    this.render();
  }

  updateUrl(url) {
    this.currentUrl = url;
    this.render();
  }

  updateStatus(status) {
    this.currentStatus = status;
    this.render();
  }

  incrementCount(type, amount = 1) {
    if (this.counts[type] !== undefined) {
      this.counts[type] += amount;
      this.render();
    }
  }

  render() {
    const width = 30;
    const progress = this.totalUrls > 0 ? this.completedUrls / this.totalUrls : 0;
    const filled = Math.round(width * progress);
    const empty = width - filled;
    const progressBar = `[${'#'.repeat(filled)}${'-'.repeat(empty)}]`;
    const percent = Math.round(progress * 100);

    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    
    // Clear previous lines
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);

    console.log(`\x1b[1m\x1b[36mWebsite Content Auditor\x1b[0m (v1.2.0)`);
    console.log(`Progress: ${progressBar} ${percent}% (${this.completedUrls}/${this.totalUrls} URLs)`);
    console.log(`Current : \x1b[33m${this.truncate(this.currentUrl, 60)}\x1b[0m`);
    console.log(`Status  : \x1b[32m${this.currentStatus}\x1b[0m`);
    console.log(`Matches : \x1b[35m${this.counts.meta} Meta\x1b[0m, \x1b[35m${this.counts.text} Text\x1b[0m, \x1b[35m${this.counts.ocr} OCR\x1b[0m`);
    console.log(`Time    : ${elapsed}s elapsed`);
    console.log('------------------------------------------------------------');
  }

  truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len - 3) + '...' : str;
  }

  finalize(outputPath) {
    this.render();
    console.log(`\n\x1b[1m\x1b[32m✔ Audit Complete!\x1b[0m`);
    console.log(`Report saved to: \x1b[4m${outputPath}\x1b[0m\n`);
  }
}
