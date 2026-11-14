// Ledger-owned bank-row index with editor overlays, immutable scoped
// snapshot, session anchor, and api.bankWalk v1. Disk is the cached vault
// read; the open editor beats disk for its note. One immutable snapshot
// per keypress and per paint; membership recomputed every gesture.
class BobLedgerToolsBankWalkMixin {
  setupBankWalk() {
    this.bankWalkActive = true;
    this.bankWalkReady = false;
    this.bankWalkGeneration = 0;
    this.bankWalkDisk = new Map();
    this.bankWalkReadTokens = new Map();
    this.bankWalkOverlays = new Map();
    this.bankWalkPathSeq = new Map();
    this.bankWalkReadScheduleSeq = new Map();
    this.bankWalkPendingReads = new Set();
    this.bankWalkScanCache = new Map();
    this.bankWalkOverlaySignature = null;
    this.bankWalkMemoKey = null;
    this.bankWalkMemoSnapshot = null;
    this.bankWalkListeners = new Set();
    this.bankWalkAnchorValue = null;
    this.bankWalkAnchorDay = null;
    this.bankWalkRevalidateTimer = null;
    this.bankWalkLocalDay = null;
    try {
      this.bankWalkLocalDay = bankLocalDate();
    } catch (error) {
      this.bankWalkLocalDay = null;
    }
    const vault = this.app && this.app.vault;
    if (vault && typeof vault.on === "function") {
      for (const event of ["create", "modify", "delete", "rename"]) {
        try {
          this.registerEvent(vault.on(event, (file, oldPath) => this.bankWalkHandleVaultEvent(event, file, oldPath)));
        } catch (error) {}
      }
    }
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.onLayoutReady === "function") {
        workspace.onLayoutReady(() => this.bankWalkStartInitialScan());
      } else {
        this.bankWalkStartInitialScan();
      }
    } catch (error) {
      try {
        this.bankWalkStartInitialScan();
      } catch (ignored) {}
    }
  }

  teardownBankWalk() {
    this.bankWalkActive = false;
    this.bankWalkReady = false;
    this.bankWalkGeneration = 0;
    if (this.bankWalkDisk instanceof Map) {
      this.bankWalkDisk.clear();
    }
    if (this.bankWalkReadTokens instanceof Map) {
      this.bankWalkReadTokens.clear();
    }
    if (this.bankWalkOverlays instanceof Map) {
      this.bankWalkOverlays.clear();
    }
    if (this.bankWalkPathSeq instanceof Map) {
      this.bankWalkPathSeq.clear();
    }
    if (this.bankWalkReadScheduleSeq instanceof Map) {
      this.bankWalkReadScheduleSeq.clear();
    }
    if (this.bankWalkPendingReads instanceof Set) {
      this.bankWalkPendingReads.clear();
    }
    if (this.bankWalkScanCache instanceof Map) {
      this.bankWalkScanCache.clear();
    }
    this.bankWalkOverlaySignature = null;
    this.bankWalkMemoKey = null;
    this.bankWalkMemoSnapshot = null;
    if (this.bankWalkListeners instanceof Set) {
      this.bankWalkListeners.clear();
    }
    this.bankWalkAnchorValue = null;
    this.bankWalkAnchorDay = null;
    if (this.bankWalkRevalidateTimer !== null && this.bankWalkRevalidateTimer !== undefined) {
      try {
        const timers = (this.bankTimerApi && typeof this.bankTimerApi === "function") ? this.bankTimerApi() : (typeof window !== "undefined" ? window : globalThis);
        if (timers && typeof timers.clearTimeout === "function") {
          timers.clearTimeout(this.bankWalkRevalidateTimer);
        } else {
          clearTimeout(this.bankWalkRevalidateTimer);
        }
      } catch (error) {}
    }
    this.bankWalkRevalidateTimer = null;
    this.bankWalkLocalDay = null;
  }

  bankWalkFireChange(info) {
    if (!(this.bankWalkListeners instanceof Set)) {
      return;
    }
    for (const listener of Array.from(this.bankWalkListeners)) {
      try {
        listener(info || { generation: this.bankWalkGeneration });
      } catch (error) {}
    }
  }

  onBankWalkChange(listener) {
    try {
      if (typeof listener !== "function") {
        return () => {};
      }
      if (!(this.bankWalkListeners instanceof Set)) {
        this.bankWalkListeners = new Set();
      }
      this.bankWalkListeners.add(listener);
      return () => {
        try {
          this.bankWalkListeners.delete(listener);
        } catch (error) {}
      };
    } catch (error) {
      return () => {};
    }
  }

  bankWalkOnChange(listener) {
    return this.onBankWalkChange(listener);
  }

  bankWalkIsMonthPath(path) {
    try {
      return bankMonthFromPath(path) !== null;
    } catch (error) {
      return false;
    }
  }

  bankWalkDropPath(path, reason) {
    try {
      const norm = bankNormalizePath(path);
      if (!norm) {
        return;
      }
      if (this.bankWalkDisk instanceof Map) {
        this.bankWalkDisk.delete(norm);
      }
      if (this.bankWalkOverlays instanceof Map) {
        this.bankWalkOverlays.delete(norm);
      }
      if (this.bankWalkScanCache instanceof Map) {
        this.bankWalkScanCache.delete(norm);
      }
      if (this.bankWalkPendingReads instanceof Set) {
        this.bankWalkPendingReads.delete(norm);
      }
      if (this.bankWalkPathSeq instanceof Map) {
        this.bankWalkPathSeq.delete(norm);
      }
      if (this.bankWalkReadScheduleSeq instanceof Map) {
        this.bankWalkReadScheduleSeq.delete(norm);
      }
      const tok = (this.bankWalkReadTokens instanceof Map ? this.bankWalkReadTokens.get(norm) : 0) || 0;
      if (this.bankWalkReadTokens instanceof Map) {
        this.bankWalkReadTokens.set(norm, tok + 1);
      }
      this.bankWalkGeneration = (this.bankWalkGeneration || 0) + 1;
      this.bankWalkMemoKey = null;
      this.bankWalkFireChange({ generation: this.bankWalkGeneration, reason: reason || "vault", path: norm });
    } catch (error) {}
  }

  bankWalkHandleVaultEvent(event, file, oldPath) {
    try {
      if (this.bankWalkActive === false) {
        return;
      }
      const current = file && typeof file.path === "string" ? file.path : (typeof file === "string" ? file : "");
      const previous = typeof oldPath === "string" ? oldPath : (oldPath && typeof oldPath.path === "string" ? oldPath.path : "");
      const curMonth = current ? this.bankWalkIsMonthPath(current) : false;
      const prevMonth = previous ? this.bankWalkIsMonthPath(previous) : false;
      if (!curMonth && !prevMonth) {
        return;
      }
      if (event === "delete") {
        const gone = curMonth ? current : (prevMonth ? previous : "");
        if (gone) {
          this.bankWalkDropPath(gone, "delete");
        }
        return;
      }
      if (event === "rename" && previous && prevMonth && previous !== current) {
        this.bankWalkDropPath(previous, "rename");
      }
      if (current && curMonth) {
        this.bankWalkScheduleFileRead(current);
      }
    } catch (error) {}
  }

  bankWalkClearTimer() {
    if (this.bankWalkRevalidateTimer === null || this.bankWalkRevalidateTimer === undefined) {
      return;
    }
    try {
      const timers = (this.bankTimerApi && typeof this.bankTimerApi === "function") ? this.bankTimerApi() : (typeof window !== "undefined" ? window : globalThis);
      if (timers && typeof timers.clearTimeout === "function") {
        timers.clearTimeout(this.bankWalkRevalidateTimer);
      } else {
        clearTimeout(this.bankWalkRevalidateTimer);
      }
    } catch (error) {}
    this.bankWalkRevalidateTimer = null;
  }

  bankWalkScheduleFileRead(fileOrPath) {
    try {
      if (this.bankWalkActive === false) {
        return;
      }
      const raw = typeof fileOrPath === "string" ? fileOrPath : (fileOrPath && fileOrPath.path);
      if (!raw || !this.bankWalkIsMonthPath(raw)) {
        return;
      }
      const path = bankNormalizePath(raw);
      if (!(this.bankWalkPendingReads instanceof Set)) {
        this.bankWalkPendingReads = new Set();
      }
      if (!(this.bankWalkReadScheduleSeq instanceof Map)) {
        this.bankWalkReadScheduleSeq = new Map();
      }
      this.bankWalkPendingReads.add(path);
      const overlay = this.bankWalkOverlays instanceof Map ? this.bankWalkOverlays.get(path) : null;
      const seq = overlay && Number.isInteger(overlay.seq)
        ? overlay.seq
        : ((this.bankWalkPathSeq instanceof Map ? this.bankWalkPathSeq.get(path) : 0) || 0);
      this.bankWalkReadScheduleSeq.set(path, seq);
      this.bankWalkClearTimer();
      const run = () => {
        this.bankWalkRevalidateTimer = null;
        const pending = this.bankWalkPendingReads instanceof Set
          ? Array.from(this.bankWalkPendingReads)
          : [];
        if (this.bankWalkPendingReads instanceof Set) {
          this.bankWalkPendingReads.clear();
        }
        for (const item of pending) {
          this.bankWalkReadSingleMonth(item);
        }
      };
      try {
        const timers = (this.bankTimerApi && typeof this.bankTimerApi === "function") ? this.bankTimerApi() : (typeof window !== "undefined" ? window : globalThis);
        if (timers && typeof timers.setTimeout === "function") {
          this.bankWalkRevalidateTimer = timers.setTimeout(run, 250);
        } else {
          this.bankWalkRevalidateTimer = setTimeout(run, 250);
        }
      } catch (error) {
        this.bankWalkRevalidateTimer = setTimeout(run, 250);
      }
    } catch (error) {}
  }

  bankWalkRetireOverlay(path, scheduledSeq) {
    try {
      const overlay = this.bankWalkOverlays instanceof Map ? this.bankWalkOverlays.get(path) : null;
      if (!overlay) {
        return;
      }
      const seq = Number.isInteger(overlay.seq) ? overlay.seq : 0;
      const scheduled = Number.isInteger(scheduledSeq) ? scheduledSeq : 0;
      if (seq <= scheduled) {
        this.bankWalkOverlays.delete(path);
      }
    } catch (error) {}
  }

  bankWalkReadSingleMonth(path) {
    try {
      if (this.bankWalkActive === false) {
        return;
      }
      const norm = bankNormalizePath(path);
      if (!(this.bankWalkReadTokens instanceof Map)) {
        this.bankWalkReadTokens = new Map();
      }
      const token = ((this.bankWalkReadTokens.get(norm) || 0) + 1);
      this.bankWalkReadTokens.set(norm, token);
      const scheduledSeq = this.bankWalkReadScheduleSeq instanceof Map
        ? (this.bankWalkReadScheduleSeq.get(norm) || 0)
        : 0;
      const vault = this.app && this.app.vault;
      const read = vault && (vault.cachedRead || vault.read);
      if (typeof read !== "function") {
        return;
      }
      let fileObj = null;
      try {
        if (vault && typeof vault.getAbstractFileByPath === "function") {
          fileObj = vault.getAbstractFileByPath(norm);
        }
      } catch (error) {
        fileObj = null;
      }
      const target = fileObj || { path: norm };
      Promise.resolve(read.call(vault, target)).then((content) => {
        if (this.bankWalkActive === false) {
          return;
        }
        if ((this.bankWalkReadTokens.get(norm) || 0) !== token) {
          return;
        }
        const text = typeof content === "string" ? content : "";
        if (!(this.bankWalkDisk instanceof Map)) {
          this.bankWalkDisk = new Map();
        }
        this.bankWalkDisk.set(norm, text);
        this.bankWalkRetireOverlay(norm, scheduledSeq);
        this.bankWalkGeneration = (this.bankWalkGeneration || 0) + 1;
        this.bankWalkMemoKey = null;
        this.bankWalkFireChange({ generation: this.bankWalkGeneration, reason: "vault", path: norm });
      }).catch(() => {});
    } catch (error) {}
  }

  bankWalkListMonthFiles() {
    const empty = { files: [], usedMarkdownWalk: false };
    try {
      const vault = this.app && this.app.vault;
      if (!vault) {
        return empty;
      }
      const hasFolderByPath = typeof vault.getFolderByPath === "function";
      const hasAbstract = typeof vault.getAbstractFileByPath === "function";
      if (hasFolderByPath || hasAbstract) {
        let folder = null;
        try {
          if (hasFolderByPath) {
            folder = vault.getFolderByPath("bank");
          }
        } catch (error) {
          folder = null;
        }
        if (!folder && hasAbstract) {
          try {
            folder = vault.getAbstractFileByPath("bank");
          } catch (error) {
            folder = null;
          }
        }
        if (!folder) {
          return { files: [], usedMarkdownWalk: false };
        }
        const children = folder && Array.isArray(folder.children) ? folder.children : [];
        return { files: children, usedMarkdownWalk: false };
      }
      if (typeof vault.getMarkdownFiles === "function") {
        try {
          return { files: vault.getMarkdownFiles() || [], usedMarkdownWalk: true };
        } catch (error) {
          return { files: [], usedMarkdownWalk: true };
        }
      }
      return empty;
    } catch (error) {
      return empty;
    }
  }

  bankWalkMarkReady(reason) {
    this.bankWalkReady = true;
    this.bankWalkGeneration = (this.bankWalkGeneration || 0) + 1;
    this.bankWalkMemoKey = null;
    this.bankWalkFireChange({ generation: this.bankWalkGeneration, reason: reason || "ready" });
  }

  bankWalkStartInitialScan() {
    try {
      if (this.bankWalkActive === false) {
        return;
      }
      const vault = this.app && this.app.vault;
      const listed = this.bankWalkListMonthFiles();
      let months = [];
      try {
        months = bankDiscoverMonthPaths(listed.files);
      } catch (error) {
        months = [];
      }
      if (!months.length) {
        this.bankWalkMarkReady("ready");
        return;
      }
      const read = vault && (vault.cachedRead || vault.read);
      if (typeof read !== "function") {
        this.bankWalkMarkReady("ready");
        return;
      }
      let pending = months.length;
      const finishOne = () => {
        pending -= 1;
        if (pending <= 0) {
          this.bankWalkMarkReady("ready");
        }
      };
      for (const entry of months) {
        const path = bankNormalizePath(entry.path);
        const token = ((this.bankWalkReadTokens instanceof Map ? this.bankWalkReadTokens.get(path) : 0) || 0) + 1;
        if (!(this.bankWalkReadTokens instanceof Map)) {
          this.bankWalkReadTokens = new Map();
        }
        this.bankWalkReadTokens.set(path, token);
        let fileObj = null;
        try {
          if (typeof vault.getAbstractFileByPath === "function") {
            fileObj = vault.getAbstractFileByPath(path);
          }
        } catch (error) {
          fileObj = null;
        }
        const target = fileObj || { path };
        Promise.resolve(read.call(vault, target)).then((content) => {
          if ((this.bankWalkReadTokens.get(path) || 0) !== token) {
            finishOne();
            return;
          }
          if (!(this.bankWalkDisk instanceof Map)) {
            this.bankWalkDisk = new Map();
          }
          this.bankWalkDisk.set(path, typeof content === "string" ? content : "");
          finishOne();
        }).catch(() => {
          finishOne();
        });
      }
    } catch (error) {
      try {
        this.bankWalkReady = true;
      } catch (ignored) {}
    }
  }

  bankWalkRememberOverlay(path, content) {
    if (!(this.bankWalkOverlays instanceof Map)) {
      this.bankWalkOverlays = new Map();
    }
    if (!(this.bankWalkPathSeq instanceof Map)) {
      this.bankWalkPathSeq = new Map();
    }
    const text = String(content);
    const existing = this.bankWalkOverlays.get(path);
    if (existing && existing.content === text) {
      return existing;
    }
    const seq = ((existing && Number.isInteger(existing.seq) ? existing.seq : (this.bankWalkPathSeq.get(path) || 0)) || 0) + 1;
    const record = { content: text, seq };
    this.bankWalkOverlays.set(path, record);
    this.bankWalkPathSeq.set(path, seq);
    return record;
  }

  bankWalkCollectOverlays() {
    if (!(this.bankWalkOverlays instanceof Map)) {
      this.bankWalkOverlays = new Map();
    }
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return this.bankWalkOverlays;
      }
      let leaves = [];
      try {
        leaves = workspace.getLeavesOfType("markdown") || [];
      } catch (error) {
        leaves = [];
      }
      for (const leaf of leaves) {
        try {
          const view = leaf && leaf.view;
          const file = view && view.file;
          const editor = view && view.editor;
          if (!file || typeof file.path !== "string") {
            continue;
          }
          if (!editor || typeof editor.getValue !== "function") {
            continue;
          }
          if (!this.bankWalkIsMonthPath(file.path)) {
            continue;
          }
          const path = bankNormalizePath(file.path);
          this.bankWalkRememberOverlay(path, editor.getValue());
        } catch (error) {}
      }
    } catch (error) {}
    return this.bankWalkOverlays;
  }

  bankWalkSnapshot() {
    try {
      if (this.bankWalkActive === false) {
        return Object.freeze({ available: false, reason: "unloaded" });
      }
      if (!this.bankWalkReady) {
        return Object.freeze({ available: false, reason: "indexing" });
      }
      const overlays = this.bankWalkCollectOverlays();
      const disk = this.bankWalkDisk instanceof Map ? this.bankWalkDisk : new Map();
      const overlayParts = Array.from(overlays.entries()).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const sig = `${this.bankWalkGeneration || 0}\u0000${overlayParts.map(([p, rec]) => `${p}\u0000${rec && rec.seq ? rec.seq : 0}`).join("\u0001")}`;
      if (this.bankWalkMemoKey === sig && this.bankWalkMemoSnapshot) {
        return this.bankWalkMemoSnapshot;
      }
      const merged = [];
      const seen = new Set();
      for (const [path, content] of disk.entries()) {
        const norm = bankNormalizePath(path);
        const overlay = overlays.get(norm);
        const text = overlay && typeof overlay.content === "string"
          ? overlay.content
          : (typeof content === "string" ? content : "");
        merged.push({ path: norm, content: text });
        seen.add(norm);
      }
      for (const [path, record] of overlays.entries()) {
        if (!seen.has(path)) {
          merged.push({ path, content: record && typeof record.content === "string" ? record.content : "" });
          seen.add(path);
        }
      }
      if (!(this.bankWalkScanCache instanceof Map)) {
        this.bankWalkScanCache = new Map();
      }
      let snapshot = null;
      try {
        snapshot = bankWalkBuildSnapshotFromContents(merged, this.bankWalkGeneration || 0, this.bankWalkScanCache);
      } catch (error) {
        return Object.freeze({ available: false, reason: "indexing" });
      }
      const prevSig = this.bankWalkOverlaySignature;
      const overlaySigOnly = overlayParts.map(([p, rec]) => `${p}\u0000${rec && rec.seq ? rec.seq : 0}`).join("\u0001");
      if (prevSig !== null && prevSig !== overlaySigOnly) {
        try {
          setTimeout(() => this.bankWalkFireChange({ generation: this.bankWalkGeneration || 0, reason: "overlay" }), 0);
        } catch (error) {}
      }
      this.bankWalkOverlaySignature = overlaySigOnly;
      this.bankWalkMemoKey = sig;
      this.bankWalkMemoSnapshot = snapshot;
      return snapshot;
    } catch (error) {
      try {
        return Object.freeze({ available: false, reason: "indexing" });
      } catch (ignored) {
        return { available: false, reason: "indexing" };
      }
    }
  }

  bankWalkAnchor() {
    try {
      const value = this.bankWalkAnchorValue;
      if (!value) {
        return null;
      }
      let today = "";
      try {
        today = bankLocalDate();
      } catch (error) {
        today = "";
      }
      if (this.bankWalkAnchorDay && today && this.bankWalkAnchorDay !== today) {
        return null;
      }
      return Object.freeze({ ...value });
    } catch (error) {
      return null;
    }
  }

  bankWalkSetAnchor(entry) {
    try {
      if (!entry || typeof entry !== "object") {
        this.bankWalkAnchorValue = null;
        this.bankWalkAnchorDay = null;
        return;
      }
      const path = typeof entry.path === "string" ? entry.path : "";
      const line = Number.isInteger(entry.line) ? entry.line : null;
      if (!path || line === null) {
        this.bankWalkAnchorValue = null;
        this.bankWalkAnchorDay = null;
        return;
      }
      let today = "";
      try {
        today = bankLocalDate();
      } catch (error) {
        today = "";
      }
      this.bankWalkAnchorDay = today || null;
      this.bankWalkAnchorValue = Object.freeze({
        key: typeof entry.key === "string" ? entry.key : `${path}|${entry.date || ""}|${entry.text || ""}|1`,
        path,
        line,
        date: typeof entry.date === "string" ? entry.date : null,
        text: typeof entry.text === "string" ? entry.text : "",
        day: today || null,
      });
    } catch (error) {}
  }

  bankWalkBusy() {
    try {
      const modal = this.bankCategoryModal;
      return Boolean(modal && !modal.closed);
    } catch (error) {
      return false;
    }
  }

  bankWalkHandOffOpenedRow(row, options = {}) {
    try {
      if (!row || typeof row.path !== "string" || !Number.isInteger(row.line) || row.line < 1) {
        return false;
      }
      let entry = null;
      try {
        const snapshot = typeof this.bankWalkSnapshot === "function"
          ? this.bankWalkSnapshot()
          : null;
        if (snapshot && snapshot.available === true && Array.isArray(snapshot.entries)) {
          entry = snapshot.entries.find((item) =>
            item && item.path === row.path && item.line === row.line) || null;
        }
      } catch (error) {
        entry = null;
      }
      this.bankWalkSetAnchor(entry || {
        path: row.path,
        line: row.line,
        date: typeof row.date === "string" ? row.date : null,
        text: typeof row.text === "string" ? row.text : "",
        key: typeof row.key === "string" ? row.key : undefined,
      });
      if (options.selectFamily === true) {
        const api = typeof this.dependencyNavApi === "function"
          ? this.dependencyNavApi()
          : null;
        const walkMode = api && api.walkMode;
        if (
          walkMode &&
          Number(walkMode.version) >= 4 &&
          typeof walkMode.select === "function"
        ) {
          walkMode.select("b");
        }
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  bankWalkApi() {
    const self = this;
    const guard = (fn, fallback) => (...args) => {
      try {
        return fn(...args);
      } catch (error) {
        return fallback;
      }
    };
    return Object.freeze({
      version: BANK_WALK_VERSION,
      snapshot: guard(() => self.bankWalkSnapshot(), Object.freeze({ available: false, reason: "indexing" })),
      plan: guard((snapshot, options) => bankWalkPlan(snapshot, options || {}), Object.freeze({ kind: "empty", scope: "waiting" })),
      locate: guard((snapshot, cursor) => bankWalkLocate(snapshot, cursor), null),
      resolve: guard((input) => bankWalkResolve(input || {}), { ok: false, reason: "invalid" }),
      anchor: guard(() => self.bankWalkAnchor(), null),
      setAnchor: (...args) => {
        try {
          self.bankWalkSetAnchor(args[0] || null);
        } catch (error) {}
      },
      busy: guard(() => self.bankWalkBusy(), false),
    });
  }
}
