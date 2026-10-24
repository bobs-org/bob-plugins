// Read-only relation-label journal mirror and api.relationLabels v1.
// bob-cli owns all writes; this mixin only reads through Obsidian's vault
// adapter and delegates desktop hide/unhide requests back to bob.
class BobLedgerToolsRelationLabelsMixin {
  initializeRelationLabels() {
    this.relationLabelsJournalFold = relationLabelFoldEvents([]);
    this.relationLabelsJournalWarnings = [];
    this.relationLabelsListeners = new Set();
    this.relationLabelsJournalTimer = null;
    this.relationLabelsJournalReadToken = 0;
    const plugin = this;
    this.relationLabelsApiValue = Object.freeze({
      version: RELATION_LABELS_SCHEMA_VERSION,
      rows: (query, options) => plugin.relationLabelsRows(query, options),
      hiddenCount: () => plugin.relationLabelsHiddenCount(),
      onChange: (listener) => plugin.onRelationLabelsChange(listener),
      hide: (label, options) => plugin.apiRelationLabelsHide(label, options),
      unhide: (label, options) => plugin.apiRelationLabelsUnhide(label, options),
      rename: (from, to, options) => plugin.apiRelationLabelsRename(from, to, options),
    });
  }

  relationLabelsApi() {
    return this.relationLabelsApiValue;
  }

  relationLabelsPrefs() {
    const folded = this.relationLabelsJournalFold;
    return folded && folded.byKey && typeof folded.byKey === "object"
      ? folded.byKey
      : {};
  }

  relationLabelsRows(query, options = {}) {
    try {
      const edges = this.relationIndexState && Array.isArray(this.relationIndexState.edges)
        ? this.relationIndexState.edges
        : [];
      return relationLabelApiRows(
        edges,
        this.relationLabelsPrefs(),
        query,
        options,
      );
    } catch (_error) {
      return [];
    }
  }

  relationLabelsHiddenCount() {
    try {
      return this.relationLabelsRows("", { hidden: "include" })
        .filter((row) => row.hidden === true).length;
    } catch (_error) {
      return 0;
    }
  }

  onRelationLabelsChange(listener) {
    try {
      if (typeof listener !== "function") return () => {};
      this.relationLabelsListeners.add(listener);
      return () => {
        try {
          this.relationLabelsListeners.delete(listener);
        } catch (_error) {
          // Unsubscribe is best-effort.
        }
      };
    } catch (_error) {
      return () => {};
    }
  }

  relationLabelsNotifyChanged(reason) {
    try {
      const snapshot = this.relationLabelsRows("", { hidden: "include" });
      for (const listener of [...this.relationLabelsListeners]) {
        try {
          listener(snapshot, reason);
        } catch (_error) {
          // One listener cannot interrupt the other subscribers.
        }
      }
    } catch (_error) {
      // Notifications are best-effort.
    }
  }

  setupRelationLabelsJournal() {
    try {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.on !== "function") return;
      const changed = (file, oldPath) => {
        const paths = [file && file.path, oldPath].filter((path) => typeof path === "string");
        if (paths.some((path) =>
          path.startsWith(`${RELATION_LABELS_JOURNAL_DIR}/`) && path.endsWith(".jsonl"),
        )) {
          this.scheduleRelationLabelsJournalRefresh("vault");
        }
      };
      for (const event of ["create", "modify", "delete"]) {
        this.registerEvent(vault.on(event, (file) => changed(file)));
      }
      this.registerEvent(vault.on("rename", (file, oldPath) => changed(file, oldPath)));
      void this.refreshRelationLabelsJournal("startup");
    } catch (_error) {
      // The API remains readable with an empty preference fold.
    }
  }

  scheduleRelationLabelsJournalRefresh(reason) {
    try {
      if (this.relationLabelsJournalTimer !== null) return;
      const schedule =
        typeof window !== "undefined" && typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      this.relationLabelsJournalTimer = schedule(() => {
        this.relationLabelsJournalTimer = null;
        void this.refreshRelationLabelsJournal(reason || "vault");
      }, RELATION_LABELS_JOURNAL_REFRESH_MS);
    } catch (_error) {
      // Scheduling is best-effort.
    }
  }

  async refreshRelationLabelsJournal(reason) {
    void reason;
    const token = ++this.relationLabelsJournalReadToken;
    try {
      const adapter = this.app && this.app.vault && this.app.vault.adapter;
      if (!adapter || typeof adapter.list !== "function" || typeof adapter.read !== "function") {
        return this.relationLabelsPrefs();
      }
      let listed;
      try {
        listed = await adapter.list(RELATION_LABELS_JOURNAL_DIR);
      } catch (_error) {
        return this.relationLabelsPrefs();
      }
      const names = listed && Array.isArray(listed.files) ? listed.files.slice() : [];
      names.sort(relationLabelCodepointCompare);
      const events = [];
      const warnings = [];
      let malformed = 0;
      for (const name of names) {
        if (typeof name !== "string" || !name.endsWith(".jsonl")) continue;
        const base = name.split("/").pop();
        let text;
        try {
          text = await adapter.read(`${RELATION_LABELS_JOURNAL_DIR}/${base}`);
        } catch (_error) {
          continue;
        }
        String(text || "").split("\n").forEach((line, index) => {
          if (!line.trim()) return;
          const event = relationLabelParseJournalLine(line, base, index + 1);
          if (event) events.push(event);
          else {
            malformed += 1;
            if (warnings.length < 8) {
              warnings.push(`skipping malformed relation journal line ${base}:${index + 1}`);
            }
          }
        });
      }
      if (token !== this.relationLabelsJournalReadToken) return this.relationLabelsPrefs();
      if (malformed > 8) warnings.push(`skipped ${malformed} malformed relation journal lines`);
      this.relationLabelsJournalFold = relationLabelFoldEvents(events);
      this.relationLabelsJournalWarnings = warnings;
      this.relationLabelsNotifyChanged("journal");
      return this.relationLabelsPrefs();
    } catch (_error) {
      return this.relationLabelsPrefs();
    }
  }

  relationLabelsIsDesktop() {
    try {
      return typeof Platform !== "undefined" && Platform && Platform.isDesktopApp === true;
    } catch (_error) {
      return false;
    }
  }

  relationLabelsWriteSpawn(args, via) {
    if (!this.relationLabelsIsDesktop()) {
      return Promise.resolve({
        ok: false,
        code: "desktop_only",
        message: "Relation-label writes need the desktop app.",
        detail: "",
      });
    }
    return bobSpawnJson(
      [...args, "--via", via || RELATION_LABELS_VIA, "-f", "json"],
      relationLabelsDecodeWrite,
      {
        commandLabel: "bob relations",
        resolveBobPath: () =>
          typeof this.apiStatsBobPath === "function"
            ? this.apiStatsBobPath()
            : { path: "bob", source: "path" },
        getVaultPath: () => this.statsVaultBasePath(),
        timeout: BOB_SPAWN_TIMEOUT_MS,
        maxBuffer: BOB_SPAWN_MAX_BUFFER,
        firstLine: statsFirstLine,
      },
    );
  }

  async apiRelationLabelsWriteAftermath(result) {
    if (result && result.ok) {
      try {
        await this.refreshRelationLabelsJournal("write");
      } catch (_error) {
        // The bob write succeeded; the read refresh cannot roll it back.
      }
      this.relationLabelsNotifyChanged("write");
    }
    return result;
  }

  async apiRelationLabelsHide(label, options = {}) {
    const name = String(label || "").trim();
    if (!name) return { ok: false, code: "invalid_label", message: "Name a relation label to hide." };
    const opts = options && typeof options === "object" ? options : {};
    const args = ["relations", "hide", name];
    if (opts.allowUnused === true) args.push("--allow-unused");
    try {
      return this.apiRelationLabelsWriteAftermath(
        await this.relationLabelsWriteSpawn(args, opts.via),
      );
    } catch (_error) {
      return { ok: false, code: "failed", message: "bob relations hide failed." };
    }
  }

  async apiRelationLabelsUnhide(label, options = {}) {
    const name = String(label || "").trim();
    if (!name) return { ok: false, code: "invalid_label", message: "Name a relation label to unhide." };
    const opts = options && typeof options === "object" ? options : {};
    try {
      return this.apiRelationLabelsWriteAftermath(
        await this.relationLabelsWriteSpawn(["relations", "unhide", name], opts.via),
      );
    } catch (_error) {
      return { ok: false, code: "failed", message: "bob relations unhide failed." };
    }
  }

  // Rename relation labels through bob's previewed vault rewrite. Dry runs
  // return their report without refreshing the journal; writes refresh the
  // read-only mirror after bob has committed.
  async apiRelationLabelsRename(from, to, options = {}) {
    try {
      const source = String(from || "").trim();
      const target = String(to || "").trim();
      if (!source || !target) {
        return { ok: false, code: "invalid_label", message: "Rename needs two relation labels." };
      }
      const opts = options && typeof options === "object" ? options : {};
      const args = ["relations", "rename", source, target];
      if (opts.dryRun === true) args.push("--dry-run");
      if (opts.merge === true) args.push("--merge");
      const result = await this.relationLabelsWriteSpawn(args, opts.via);
      return opts.dryRun === true
        ? result
        : this.apiRelationLabelsWriteAftermath(result);
    } catch (_error) {
      return { ok: false, code: "failed", message: "bob relations rename failed." };
    }
  }

  teardownRelationLabelsJournal() {
    if (this.relationLabelsJournalTimer !== null && typeof clearTimeout === "function") {
      clearTimeout(this.relationLabelsJournalTimer);
    }
    this.relationLabelsJournalTimer = null;
    this.relationLabelsJournalReadToken += 1;
    if (this.relationLabelsListeners) this.relationLabelsListeners.clear();
  }
}

const RELATION_LABELS_JOURNAL_REFRESH_MS = 3000;
