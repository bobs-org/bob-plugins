// --- Daily Stats cache and fetch queue (fetch-service) --------------------
// Per-key in-flight promises behind a FIFO queue plus freshness-gated
// cache entries. The data mixin (`236-plugin-stats-data.js`) owns the spawn
// boundary and `apiStatsFetch`; this mixin owns the cache map, the change
// generation, the listener set, the synchronous peek, and the single-flight
// pump. Installed right after the data mixin.
class BobLedgerToolsStatsCacheMixin {
  statsCacheStore() {
    if (!(this.statsCache instanceof Map)) {
      this.statsCache = new Map();
    }
    return this.statsCache;
  }

  statsCacheGet(key) {
    const store = this.statsCacheStore();
    const entry = store.get(key);
    if (!entry) {
      return null;
    }
    // LRU touch: reinsert so the oldest entry evicts first.
    store.delete(key);
    store.set(key, entry);
    return entry;
  }

  statsCacheSet(key, report, gen) {
    const store = this.statsCacheStore();
    if (store.has(key)) {
      store.delete(key);
    }
    let generation = gen;
    if (typeof generation !== "number") {
      try {
        generation = this.statsChangeGenValue();
      } catch (error) {
        generation = 0;
      }
    }
    let fetchedAt = null;
    try {
      fetchedAt = Date.now();
    } catch (error) {
      fetchedAt = 0;
    }
    store.set(key, { report, fetchedAt, gen: generation });
    while (store.size > STATS_CACHE_SIZE) {
      const oldest = store.keys().next();
      if (oldest.done) {
        break;
      }
      store.delete(oldest.value);
    }
  }

  statsChangeGenValue() {
    try {
      const gen = Number(this.statsChangeGen);
      if (Number.isFinite(gen) && gen >= 0) {
        return Math.floor(gen);
      }
    } catch (error) {
      // Fall through to 0 below.
    }
    return 0;
  }

  statsBumpChangeGen() {
    try {
      const next = this.statsChangeGenValue() + 1;
      this.statsChangeGen = next;
      return next;
    } catch (error) {
      this.statsChangeGen = 1;
      return 1;
    }
  }

  statsCacheListenersStore() {
    if (!(this.statsCacheListeners instanceof Set)) {
      this.statsCacheListeners = new Set();
    }
    return this.statsCacheListeners;
  }

  // Subscribe to successful cache stores; called with the key. Returns an
  // unsubscribe function. Never throws.
  statsOnCacheUpdate(listener) {
    try {
      if (typeof listener !== "function") {
        return () => {};
      }
      const store = this.statsCacheListenersStore();
      store.add(listener);
      return () => {
        try {
          store.delete(listener);
        } catch (error) {
          // Unsubscribe is best-effort.
        }
      };
    } catch (error) {
      return () => {};
    }
  }

  statsNotifyCacheUpdate(key) {
    try {
      const listeners = this.statsCacheListenersStore();
      for (const listener of Array.from(listeners)) {
        try {
          listener(key);
        } catch (error) {
          // One bad listener never breaks the others.
        }
      }
    } catch (error) {
      // Notification is best-effort.
    }
  }

  // Synchronous read for first-frame paints: null on miss. Never throws.
  statsPeek(options = {}) {
    try {
      const opts = options && typeof options === "object" ? options : {};
      const { key } = statsRequestFor(opts);
      const store = this.statsCacheStore();
      const entry = store.get(key);
      if (!entry) {
        return null;
      }
      // LRU touch so a peeked default entry stays hot.
      try {
        store.delete(key);
        store.set(key, entry);
      } catch (error) {
        // Touch is best-effort.
      }
      let now = null;
      try {
        now = Date.now();
      } catch (error) {
        now = entry.fetchedAt;
      }
      return {
        report: entry.report,
        fetchedAt: entry.fetchedAt,
        gen: entry.gen,
        dirty: statsCacheEntryIsDirty(entry, now, this.statsChangeGenValue()),
      };
    } catch (error) {
      return null;
    }
  }

  statsPendingQueueStore() {
    if (!Array.isArray(this.statsPendingQueue)) {
      this.statsPendingQueue = [];
    }
    return this.statsPendingQueue;
  }

  statsPendingByKeyStore() {
    if (!(this.statsPendingByKey instanceof Map)) {
      this.statsPendingByKey = new Map();
    }
    return this.statsPendingByKey;
  }

  // Queue one spawn behind the single running flight. Distinct keys stay
  // distinct so no waiter is lost; the oldest pending key is dropped with
  // an explicit cancellation once the queue is full. Never throws.
  statsEnqueueFetch(entry) {
    try {
      const queue = this.statsPendingQueueStore();
      const byKey = this.statsPendingByKeyStore();
      const existing = byKey.get(entry.key);
      if (existing) {
        for (const waiter of entry.waiters) {
          existing.waiters.push(waiter);
        }
        return existing;
      }
      while (queue.length >= STATS_MAX_PENDING_KEYS) {
        const dropped = queue.shift();
        try {
          byKey.delete(dropped.key);
        } catch (error) {
          // Map cleanup is best-effort.
        }
        const cancelled = statsCancelledResult();
        for (const waiter of dropped.waiters.splice(0)) {
          try {
            waiter(cancelled);
          } catch (error) {
            // Waiter delivery is best-effort.
          }
        }
      }
      queue.push(entry);
      byKey.set(entry.key, entry);
      try {
        this.statsPumpQueue();
      } catch (error) {
        // Pumping is best-effort; waiters settle on unload.
      }
      return entry;
    } catch (error) {
      const cancelled = statsCancelledResult();
      for (const waiter of (entry && entry.waiters ? entry.waiters.splice(0) : [])) {
        try {
          waiter(cancelled);
        } catch (inner) {
          // Waiter delivery is best-effort.
        }
      }
      return entry;
    }
  }

  // Ensure a dirty cache entry refreshes in the background without
  // duplicating a flight or queued entry for the same key. Never throws.
  statsEnsureQueued(key, args, opts) {
    try {
      if (this.statsFlight && this.statsFlight.key === key) {
        return;
      }
      if (this.statsPendingByKeyStore().has(key)) {
        return;
      }
      this.statsEnqueueFetch({ key, args, opts: { ...opts }, waiters: [], hadCached: true });
    } catch (error) {
      // Background refresh is best-effort.
    }
  }

  // Run the oldest queued key when no spawn is in flight. Concurrency
  // stays at 1. The stored entry keeps the start generation so a change
  // that lands mid-flight leaves it dirty for one follow-up. Never throws.
  statsPumpQueue() {
    try {
      if (this.statsFlight) {
        return;
      }
      const queue = this.statsPendingQueueStore();
      const byKey = this.statsPendingByKeyStore();
      if (queue.length === 0) {
        return;
      }
      const entry = queue.shift();
      try {
        byKey.delete(entry.key);
      } catch (error) {
        // Map cleanup is best-effort.
      }
      const startGen = this.statsChangeGenValue();
      const flight = { key: entry.key, promise: null, waiters: entry.waiters };
      this.statsFlight = flight;
      this.statsPendingFetch = null;
      try {
        this.statsSpawnCount = (Number(this.statsSpawnCount) || 0) + 1;
      } catch (error) {
        this.statsSpawnCount = 1;
      }
      try {
        this.statsLastSpawnAt = Date.now();
      } catch (error) {
        // Timestamp is best-effort.
      }
      const outcomeFor = (result) => {
        if (result && result.ok) {
          return { report: result.report, stale: false, error: null };
        }
        if (entry.hadCached) {
          let staleEntry = null;
          try {
            staleEntry = this.statsCacheGet(entry.key);
          } catch (error) {
            staleEntry = null;
          }
          return {
            report: staleEntry ? staleEntry.report : null,
            stale: true,
            error: result,
          };
        }
        return { report: null, stale: false, error: result };
      };
      const run = async () => {
        let result = null;
        try {
          result = await this.statsSpawnFetch(entry.args, entry.opts);
        } catch (error) {
          result = {
            ok: false,
            code: "failed",
            message: error && error.message ? String(error.message) : "bob stats failed.",
            detail: "",
          };
        }
        if (result && result.ok) {
          try {
            this.statsCacheSet(entry.key, result.report, startGen);
          } catch (error) {
            // Cache store is best-effort.
          }
          try {
            this.statsNotifyCacheUpdate(entry.key);
          } catch (error) {
            // Notification is best-effort.
          }
        }
        // Clear the flight and start the next queued key BEFORE settling
        // waiters: waiter continuations run as microtasks after this
        // returns, and they must never observe this finished flight as
        // still running (a stale flight would swallow their refresh).
        try {
          if (this.statsFlight === flight) {
            this.statsFlight = null;
          }
        } catch (error) {
          // Flight cleanup is best-effort.
        }
        try {
          this.statsPumpQueue();
        } catch (error) {
          // Follow-up pumping is best-effort.
        }
        const outcome = outcomeFor(result);
        for (const waiter of flight.waiters.splice(0)) {
          try {
            waiter(outcome);
          } catch (error) {
            // Waiter delivery is best-effort.
          }
        }
        return outcome;
      };
      const promise = run().finally(() => {
        try {
          if (this.statsFlight === flight) {
            this.statsFlight = null;
          }
        } catch (error) {
          // Flight cleanup is best-effort.
        }
        try {
          this.statsPumpQueue();
        } catch (error) {
          // Follow-up pumping is best-effort.
        }
      });
      flight.promise = promise;
    } catch (error) {
      // Pumping is best-effort; waiters settle on unload.
    }
  }

  // Cancel every waiter with an explicit cancellation. Used on unload and
  // when the queue overflows. Never throws.
  statsCancelAllWaiters() {
    try {
      const cancelled = statsCancelledResult();
      const flight = this.statsFlight;
      this.statsFlight = null;
      if (flight && Array.isArray(flight.waiters)) {
        for (const waiter of flight.waiters.splice(0)) {
          try {
            waiter({ ...cancelled });
          } catch (error) {
            // Waiter delivery is best-effort.
          }
        }
      }
      let queue = null;
      try {
        queue = this.statsPendingQueueStore();
      } catch (error) {
        queue = [];
      }
      for (const entry of queue.splice(0)) {
        for (const waiter of (entry.waiters || []).splice(0)) {
          try {
            waiter({ ...cancelled });
          } catch (error) {
            // Waiter delivery is best-effort.
          }
        }
      }
      try {
        this.statsPendingByKeyStore().clear();
      } catch (error) {
        // Map cleanup is best-effort.
      }
      this.statsPendingFetch = null;
    } catch (error) {
      // Cancellation is best-effort.
    }
  }
}
