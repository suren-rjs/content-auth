import readline from 'readline';

export class TerminalDashboard {
  constructor() {
    this.totalUrls = 0;
    this.completedUrls = 0;
    this.activeWorkers = new Map(); // url -> status
    this.counts = {
      meta: 0,
      attr: 0,
      text: 0,
      ocr: 0
    };
    this.startTime = Date.now();
    this.searchTerm = '';
  }

  init(totalUrls, searchTerm = '') {
    this.totalUrls = totalUrls;
    this.searchTerm = searchTerm;
    this.render();
  }

  updateProgress(completed, total) {
    if (completed !== undefined) this.completedUrls = completed;
    if (total !== undefined) this.totalUrls = total;
    this.render();
  }

  updateWorker(url, status) {
    if (!url) return;
    if (status === null) {
      this.activeWorkers.delete(url);
    } else {
      this.activeWorkers.set(url, status);
    }
    this.render();
  }

  updateStatus(status) {
    // Global status if needed, but we prefer worker-specific status now
    this.globalStatus = status;
    this.render();
  }

  incrementCount(type, amount = 1) {
    if (this.counts[type] !== undefined) {
      this.counts[type] += amount;
      this.render();
    }
  }

  formatDuration(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);

    return parts.join(' ');
  }

  render() {
    const width = 30;
    const progress = this.totalUrls > 0 ? this.completedUrls / this.totalUrls : 0;
    const filled = Math.min(width, Math.max(0, Math.round(width * progress)));
    const empty = width - filled;
    const progressBar = `[${'#'.repeat(filled)}${'-'.repeat(empty)}]`;
    const percent = Math.round(progress * 100);

    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    
    // Clear previous lines
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);

    console.log(`\x1b[1m\x1b[36mWebsite Content Auditor\x1b[0m (v1.3.0)`);
    console.log(`Search  : \x1b[1m"${this.searchTerm}"\x1b[0m`);
    console.log(`Progress: ${progressBar} ${percent}% (${this.completedUrls}/${this.totalUrls} URLs)`);
    
    // Show active workers
    console.log(`\x1b[1mActive Tasks:\x1b[0m`);
    const activeEntries = [...this.activeWorkers.entries()].slice(-5); // Show last 5
    if (activeEntries.length === 0) {
      console.log(`  (Waiting for tasks...)`);
    } else {
      for (const [url, status] of activeEntries) {
        console.log(`  - \x1b[33m${this.truncate(url, 40)}\x1b[0m: \x1b[32m${status}\x1b[0m`);
      }
    }
    
    // Fill empty lines if less than 5 workers to keep UI stable
    for (let i = activeEntries.length; i < 5; i++) {
      console.log('');
    }

    console.log(`Matches : \x1b[35m${this.counts.meta} Meta\x1b[0m, \x1b[35m${this.counts.attr} Attr\x1b[0m, \x1b[35m${this.counts.text} Text\x1b[0m, \x1b[35m${this.counts.ocr} OCR\x1b[0m`);
    console.log(`Time    : ${this.formatDuration(elapsed)} elapsed`);
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
