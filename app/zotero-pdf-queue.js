// FIFO queue for privileged Zotero linked-PDF writes.
//
// The renderer can issue many independent Add requests at once. Keep only a
// bounded number of downloads/OneDrive confirmations active while retaining
// every later request in order. The key map also coalesces the same PDF while
// it is either queued or running.

const DEFAULT_ZOTERO_PDF_CONCURRENCY = 4;

class ZoteroPdfQueue {
  constructor(concurrency = DEFAULT_ZOTERO_PDF_CONCURRENCY) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new TypeError("Zotero PDF concurrency must be a positive integer");
    }
    this.concurrency = concurrency;
    this.active = 0;
    this.pending = [];
    this.inFlight = new Map();
  }

  enqueue(key, task) {
    if (typeof key !== "string") throw new TypeError("Zotero PDF queue key must be a string");
    if (typeof task !== "function") throw new TypeError("Zotero PDF queue task must be a function");

    const current = this.inFlight.get(key);
    if (current) return current;

    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const entry = { key, task, promise, resolve, reject };
    this.inFlight.set(key, promise);
    this.pending.push(entry);
    this._pump();
    return promise;
  }

  snapshot() {
    return {
      concurrency: this.concurrency,
      active: this.active,
      pending: this.pending.length,
      inFlight: this.inFlight.size,
    };
  }

  _release(entry) {
    this.active -= 1;
    if (this.inFlight.get(entry.key) === entry.promise) {
      this.inFlight.delete(entry.key);
    }
    this._pump();
  }

  _pump() {
    while (this.active < this.concurrency && this.pending.length) {
      const entry = this.pending.shift();
      this.active += 1;
      Promise.resolve()
        .then(entry.task)
        .then(
          (value) => {
            this._release(entry);
            entry.resolve(value);
          },
          (error) => {
            this._release(entry);
            entry.reject(error);
          }
        );
    }
  }
}

module.exports = { ZoteroPdfQueue, DEFAULT_ZOTERO_PDF_CONCURRENCY };
