// Property update service mixin. Show and dry-run are read-only; apply
// saves every pane showing the target note, then writes through bob props.
// History and overlays are per normalized path, survive reopen, and clear
// on unload. Rename migrates state; delete releases it.
class BobLedgerToolsPropertyUpdateMixin {
  propertyHistoryStore() {
    if (!this.propertyHistory) {
      this.propertyHistory = createPropertyHistory({ limit: PROPERTY_HISTORY_LIMIT });
    }
    return this.propertyHistory;
  }

  propertyOverlayStore() {
    if (!this.propertyOverlays) {
      this.propertyOverlays = createPropertyOverlayStore({
        ttlMs: PROPERTY_OVERLAY_TTL_MS,
        setTimeout: (callback, delay) => this.albumSetTimeout
          ? this.albumSetTimeout(callback, delay)
          : setTimeout(callback, delay),
        clearTimeout: (timer) => this.albumClearTimeout
          ? this.albumClearTimeout(timer)
          : clearTimeout(timer),
        now: () => {
          try {
            if (this.albumTimers && typeof this.albumTimers.now === "number") return this.albumTimers.now;
          } catch (_) {}
          return Date.now();
        },
      });
    }
    return this.propertyOverlays;
  }

  setupPropertyUpdate() {
    this.propertyUpdateActive = true;
    this.propertyCapability = null;
    this.propertyVaultGeneration = this.propertyVaultGeneration || 0;
    this.propertyUpdateFlight = null;
    this.propertyUpdateBusy = false;
    this.propertySessions = new Map();
    this.propertyHistory = createPropertyHistory({ limit: PROPERTY_HISTORY_LIMIT });
    this.propertyOverlays = createPropertyOverlayStore({
      ttlMs: PROPERTY_OVERLAY_TTL_MS,
      setTimeout: (callback, delay) => this.albumSetTimeout
        ? this.albumSetTimeout(callback, delay)
        : setTimeout(callback, delay),
      clearTimeout: (timer) => this.albumClearTimeout
        ? this.albumClearTimeout(timer)
        : clearTimeout(timer),
      now: () => {
        try {
          if (this.albumTimers && typeof this.albumTimers.now === "number") return this.albumTimers.now;
        } catch (_) {}
        return Date.now();
      },
    });
    this.propertyOverlayUnsub = this.propertyOverlays.subscribe((path, overlay) => {
      try { this.propertyPublishOverlay(path, overlay); } catch (_) {}
    });
    try {
      const vault = this.app?.vault;
      if (vault && typeof vault.on === "function" && typeof this.registerEvent === "function") {
        this.registerEvent(vault.on("rename", (file, oldPath) => this.propertyHandleRename(file, oldPath)));
        this.registerEvent(vault.on("delete", (file) => this.propertyHandleDelete(file)));
        this.registerEvent(vault.on("modify", (file) => this.propertyHandleModify(file)));
      }
    } catch (_) {}
    try {
      const metadata = this.app?.metadataCache;
      if (metadata && typeof metadata.on === "function" && typeof this.registerEvent === "function") {
        this.registerEvent(metadata.on("changed", (file, data) => {
          const path = propertyNotePath(file && file.path);
          if (!path) return;
          const frontmatter = data && data.frontmatter
            ? data.frontmatter
            : this.propertyCacheFrontmatter(path);
          this.propertyOverlayStore().observeCache(path, frontmatter);
        }));
      }
    } catch (_) {}
  }

  teardownPropertyUpdate() {
    this.propertyUpdateActive = false;
    this.propertyUpdateBusy = false;
    this.propertyUpdateFlight = null;
    try {
      if (this.propertySessions instanceof Map) {
        for (const session of this.propertySessions.values()) {
          try { session.close(); } catch (_) {}
        }
        this.propertySessions.clear();
      }
    } catch (_) {}
    try { this.propertyOverlayUnsub?.(); } catch (_) {}
    this.propertyOverlayUnsub = null;
    try { this.propertyHistory?.clear(); } catch (_) {}
    try { this.propertyOverlays?.clear(); } catch (_) {}
    this.propertyHistory = null;
    this.propertyOverlays = null;
    this.propertyCapability = null;
  }

  propertyBumpGeneration() {
    this.propertyVaultGeneration = (this.propertyVaultGeneration || 0) + 1;
    if (this.propertySessions instanceof Map) {
      for (const session of this.propertySessions.values()) {
        try { session.noteGenerationChanged(); } catch (_) {}
      }
    }
    return this.propertyVaultGeneration;
  }

  propertyHandleRename(file, oldPath) {
    const from = propertyNotePath(oldPath);
    const to = propertyNotePath(file && file.path);
    if (!from) return;
    this.propertyBumpGeneration();
    this.propertyHistoryStore().migrate(from, to);
    this.propertyOverlayStore().migrate(from, to);
    if (this.propertySessions instanceof Map) {
      const session = this.propertySessions.get(from);
      if (session) {
        this.propertySessions.delete(from);
        try { session.close(); } catch (_) {}
      }
    }
  }

  propertyHandleDelete(file) {
    const path = propertyNotePath(file && file.path);
    if (!path) return;
    this.propertyBumpGeneration();
    this.propertyHistoryStore().release(path);
    this.propertyOverlayStore().release(path);
    if (this.propertySessions instanceof Map) {
      const session = this.propertySessions.get(path);
      if (session) {
        this.propertySessions.delete(path);
        try { session.close(); } catch (_) {}
      }
    }
  }

  propertyHandleModify(file) {
    const path = propertyNotePath(file && file.path);
    if (!path) return;
    this.propertyBumpGeneration();
    try {
      const source = this.propertySourceInventory(path);
      if (source) this.propertyOverlayStore().observeSource(path, source);
    } catch (_) {}
  }

  propertyCacheFrontmatter(path) {
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(path);
      const cache = file ? this.app?.metadataCache?.getFileCache?.(file) : null;
      return cache && cache.frontmatter && typeof cache.frontmatter === "object" ? cache.frontmatter : null;
    } catch (_) {
      return null;
    }
  }

  propertySourceInventory(path) {
    const frontmatter = this.propertyCacheFrontmatter(path);
    if (!frontmatter) return null;
    return Object.keys(frontmatter).map((key) => ({ key, value: frontmatter[key] }));
  }

  propertyPublishOverlay(path, overlay) {
    // Later editor-shell, card, and drawer surfaces subscribe through
    // propertyOverlayStore().subscribe; this hook stays a no-op publisher
    // so confirmed writes can land before those surfaces exist.
    void path;
    void overlay;
  }

  propertySpawnJson(args, decode, options = {}) {
    const opts = propertyJsonObject(options) ? options : {};
    return bobSpawnJson(args, decode, {
      ...opts,
      resolveBobPath: () =>
        typeof this.apiStatsBobPath === "function"
          ? this.apiStatsBobPath()
          : { path: "bob", source: "path" },
      getVaultPath: () =>
        typeof this.statsVaultBasePath === "function" ? this.statsVaultBasePath() : null,
      timeout: PROPERTY_UPDATE_TIMEOUT_MS,
      maxBuffer: PROPERTY_UPDATE_MAX_BUFFER,
      firstLine: typeof statsFirstLine === "function" ? statsFirstLine : undefined,
    });
  }

  apiPropertyShow(notePath, options = {}) {
    if (this.propertyUpdateActive === false) {
      return Promise.resolve({ ok: false, code: "unloaded", message: "Property editing has unloaded." });
    }
    const path = propertyNotePath(notePath);
    if (!path) {
      return Promise.resolve({ ok: false, code: "missing-path", message: "A Markdown note path is required." });
    }
    return this.propertySpawnJson(
      propertyShowArgs(path),
      propertyDecodeShowReport,
      { ...options, commandLabel: "bob props show" },
    ).then((outcome) => {
      if (outcome && outcome.code === "needs-bob") this.propertyCapability = false;
      else if (outcome && outcome.ok === true && outcome.report) {
        this.propertyCapability = propertyHasCapability(outcome.report);
      }
      return outcome;
    });
  }

  apiPropertyUpdateCapable(report) {
    if (report !== undefined) return propertyHasCapability(report);
    return this.propertyCapability === true;
  }

  apiPropertyUpdatePreview(notePath, envelopeText, options = {}) {
    if (this.propertyUpdateActive === false) {
      return Promise.resolve({ ok: false, code: "unloaded", message: "Property editing has unloaded." });
    }
    if (this.propertyCapability === false) {
      return Promise.resolve({
        ok: false,
        code: "needs-bob",
        message: "Update bob to edit properties here — y opens YAML.",
      });
    }
    const path = propertyNotePath(notePath);
    return this.propertySpawnJson(
      propertyUpdateArgs(path, { dryRun: true }),
      propertyDecodeUpdateReport,
      {
        ...options,
        stdin: typeof envelopeText === "string" ? envelopeText : "",
        commandLabel: "bob props update -d",
      },
    );
  }

  apiPropertyUpdateApply(notePath, envelopeText, options = {}) {
    const opts = propertyJsonObject(options) ? options : {};
    if (this.propertyUpdateActive === false) {
      return Promise.resolve({ ok: false, code: "unloaded", message: "Property editing has unloaded." });
    }
    if (this.propertyCapability === false) {
      return Promise.resolve({
        ok: false,
        code: "needs-bob",
        message: "Update bob to edit properties here — y opens YAML.",
      });
    }
    if (this.propertyUpdateFlight) {
      return Promise.resolve({
        ok: false,
        code: "apply-busy",
        message: "Another property apply is already running.",
        hint: "Wait for it to settle, then preview again.",
      });
    }
    const path = propertyNotePath(notePath);
    const applyPromise = (async () => {
      this.propertyUpdateBusy = true;
      let outcome;
      try {
        try {
          outcome = await this.propertySpawnJson(
            propertyUpdateArgs(path, { dryRun: false }),
            propertyDecodeUpdateReport,
            {
              ...opts,
              stdin: typeof envelopeText === "string" ? envelopeText : "",
              commandLabel: "bob props update",
            },
          );
        } catch (error) {
          outcome = {
            ok: false,
            code: "failed",
            message: error && error.message ? String(error.message) : "bob props update failed.",
          };
        }
        const wrote = Boolean(
          outcome && outcome.ok && outcome.report && outcome.report.ok === true &&
          outcome.report.dry_run === false && guardedUpdateReportChanged(outcome.report),
        );
        const unknown = Boolean(outcome && !outcome.ok && (outcome.code === "timeout" || outcome.code === "failed"));
        return { ...outcome, wrote, unknown };
      } finally {
        this.propertyUpdateBusy = false;
        if (this.propertyUpdateFlight === applyPromise) this.propertyUpdateFlight = null;
      }
    })();
    this.propertyUpdateFlight = applyPromise;
    return applyPromise;
  }

  openPropertyUpdateSession(options = {}) {
    const path = propertyNotePath(options.path || options.ownPath || "");
    if (!path) return null;
    if (this.propertySessions instanceof Map) {
      const existing = this.propertySessions.get(path);
      if (existing && options.reuse === true) return existing;
      if (existing) {
        try { existing.close(); } catch (_) {}
        this.propertySessions.delete(path);
      }
    }
    const deps = propertyUpdateServiceDeps(this, {
      path,
      timers: options.timers,
      onChange: options.onChange,
      saveEditors: options.saveEditors,
      history: this.propertyHistoryStore(),
      overlays: this.propertyOverlayStore(),
    });
    const session = createPropertyUpdateSession({
      path,
      expect: options.expect,
      properties: options.properties,
      undo: options.undo,
      lockRetryMs: options.lockRetryMs,
      lockWaitBudgetMs: options.lockWaitBudgetMs,
    }, deps);
    if (this.propertySessions instanceof Map) this.propertySessions.set(path, session);
    return session;
  }

  propertyOverlayFor(path) {
    return this.propertyOverlayStore().get(path);
  }

  propertyHistoryFor(path) {
    return this.propertyHistoryStore().snapshot(path);
  }
}
