// Intention card editor entry points: the `intentions` registry kind, the
// `==` open path for every canonical subject (including empty or malformed
// ones), and the per-path optimistic overlay store. A malformed field opens
// the modal with a refusal and YAML recovery; it never paints a display card.
const INTENTION_CARD_EDITOR_OVERLAY_TTL_MS = 8000;

class BobLedgerToolsIntentionCardEditorMixin {
  intentionCardOverlayStore() {
    if (!(this.intentionCardOverlays instanceof Map)) this.intentionCardOverlays = new Map();
    return this.intentionCardOverlays;
  }

  intentionCardOverlayTimers() {
    if (!(this.intentionCardOverlayTimersMap instanceof Map)) this.intentionCardOverlayTimersMap = new Map();
    return this.intentionCardOverlayTimersMap;
  }

  setupIntentionCardEditor() {
    this.intentionCardEditorModal = null;
    this.intentionCardOverlays = new Map();
    this.intentionCardOverlayTimersMap = new Map();
    try { this.ensurePropertyCardBuiltins?.(); } catch (_) {}
    try {
      if (typeof this.registerPropertyCard === "function") {
        this.registerPropertyCard({
          kind: "intentions",
          match: ({ path } = {}) => this.intentionCardEditorMatch({ path }),
          open: ({ path } = {}) => { void this.openIntentionCard({ filePath: path }); },
        });
      }
    } catch (_) {}
  }

  teardownIntentionCardEditor() {
    try { this.intentionCardEditorModal?.close?.(); } catch (_) {}
    this.intentionCardEditorModal = null;
    try {
      if (typeof this.unregisterPropertyCard === "function") this.unregisterPropertyCard("intentions");
    } catch (_) {}
    for (const timer of this.intentionCardOverlayTimersMap?.values?.() || []) {
      try {
        if (this.albumClearTimeout) this.albumClearTimeout(timer);
        else clearTimeout(timer);
      } catch (_) {}
    }
    this.intentionCardOverlayTimersMap?.clear?.();
    if (this.intentionCardOverlays instanceof Map) this.intentionCardOverlays.clear();
  }

  intentionCardEditorToday() {
    try {
      if (typeof this.intentionCardToday === "function") return this.intentionCardToday();
    } catch (_) {}
    try {
      if (typeof dayStripLocalToday === "function") return dayStripLocalToday(new Date());
    } catch (_) {}
    return "";
  }

  intentionCardEditorMatch({ path } = {}) {
    try {
      const filePath = typeof intentionCardPath === "function" ? intentionCardPath(path || "") : String(path || "");
      if (!filePath) return false;
      if (typeof intentionCardSubjectForPath !== "function") return false;
      return intentionCardSubjectForPath(filePath, this.intentionCardEditorToday()) !== null;
    } catch (_) {
      return false;
    }
  }

  intentionCardEditorActivePath(overridePath = "") {
    if (overridePath) {
      return typeof intentionCardPath === "function" ? intentionCardPath(overridePath) : String(overridePath);
    }
    try {
      const view = typeof this.getActiveMarkdownView === "function"
        ? this.getActiveMarkdownView()
        : this.app?.workspace?.getActiveViewOfType?.(MarkdownView);
      if (view && view.file && view.file.path) {
        return typeof intentionCardPath === "function" ? intentionCardPath(view.file.path) : String(view.file.path);
      }
    } catch (_) {}
    try {
      const file = this.app?.workspace?.activeLeaf?.view?.file;
      if (file && file.path) {
        return typeof intentionCardPath === "function" ? intentionCardPath(file.path) : String(file.path);
      }
    } catch (_) {}
    return "";
  }

  intentionCardEditorReadFields(path) {
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(path);
      const cache = file ? this.app?.metadataCache?.getFileCache?.(file) : null;
      const frontmatter = cache && cache.frontmatter && typeof cache.frontmatter === "object" ? cache.frontmatter : {};
      if (typeof intentionCardReadFields !== "function") return { ok: false, reason: "unavailable" };
      const fields = intentionCardReadFields(frontmatter);
      if (!fields.ok) return { ok: false, reason: fields.reason || fields.key || "invalid", fields: null };
      return { ok: true, fields };
    } catch (_) {
      return { ok: false, reason: "unavailable", fields: null };
    }
  }

  // One path-pinned open method with initial-stage and return-selection for
  // the navigation phase. Never invents a global keystroke queue here.
  async openIntentionCard(options = {}) {
    if (this.intentionCardEditorModal) {
      try { this.intentionCardEditorModal.close(); } catch (_) {}
      this.intentionCardEditorModal = null;
    }
    const desktop = (() => {
      try {
        if (typeof this.intentionCardDesktop === "function") return this.intentionCardDesktop();
      } catch (_) {}
      try {
        if (typeof propertyCardDesktop === "function") return propertyCardDesktop();
      } catch (_) {}
      return true;
    })();
    if (desktop !== true) {
      try { new Notice("Intention editing needs desktop Obsidian."); } catch (_) {}
      return { ok: false, reason: "mobile" };
    }
    const filePath = this.intentionCardEditorActivePath(options.filePath || "");
    if (!filePath) {
      try { new Notice("Open a daily or period note to edit its intentions."); } catch (_) {}
      return { ok: false, reason: "missing-path" };
    }
    let subject = null;
    try {
      subject = typeof intentionCardSubjectForPath === "function"
        ? intentionCardSubjectForPath(filePath, this.intentionCardEditorToday())
        : null;
    } catch (_) { subject = null; }
    if (!subject) {
      try { new Notice("Open a daily or period note to edit its intentions."); } catch (_) {}
      return { ok: false, reason: "non-intention-note" };
    }
    let vaultHas = null;
    try {
      vaultHas = typeof this.intentionCardVaultHas === "function"
        ? this.intentionCardVaultHas(filePath)
        : (this.app?.vault && typeof this.app.vault.getAbstractFileByPath === "function"
          ? Boolean(this.app.vault.getAbstractFileByPath(filePath))
          : null);
    } catch (_) { vaultHas = null; }
    const read = vaultHas === false ? { ok: false, reason: "missing-note", fields: null } : this.intentionCardEditorReadFields(filePath);
    const modal = new IntentionCardModal(this.app, {
      plugin: this,
      subject: subject.id,
      subjectPath: subject.path,
      state: subject.state === "closed" ? "closed" : "open",
      fields: read.ok ? {
        intentions: read.fields.intentions,
        summary: read.fields.summary,
        summaryState: read.fields.summaryState,
        summaryDrafted: read.fields.summaryDrafted,
        reflection: read.fields.reflection,
      } : null,
      malformed: !read.ok && read.reason !== "missing-note",
      missing: read.reason === "missing-note",
      fingerprint: "",
      report: null,
      field: options.field || "",
      stage: options.stage || null,
      initialStage: options.initialStage || "",
      returnSelection: options.returnSelection || "",
    });
    if (read.reason === "missing-note") {
      modal.missing = true;
      modal.writable = false;
      try {
        modal.refusalMessage = typeof intentionCardMissingMessage === "function"
          ? intentionCardMissingMessage(subject)
          : "That note is missing.";
        modal.refusalHint = typeof intentionCardMissingHint === "function"
          ? intentionCardMissingHint(subject)
          : "";
        modal.statusKind = "missing";
      } catch (_) {}
    }
    this.intentionCardEditorModal = modal;
    try { modal.open(); } catch (_) {}
    return { ok: true, modal, readOnly: modal.writable !== true };
  }

  intentionCardPushOverlay(path, overlay, options = {}) {
    const key = typeof intentionCardPath === "function" ? intentionCardPath(path || "") : String(path || "");
    if (!key) return null;
    const timers = this.intentionCardOverlayTimers();
    const old = timers.get(key);
    if (old !== undefined && old !== null) {
      try {
        if (this.albumClearTimeout) this.albumClearTimeout(old);
        else clearTimeout(old);
      } catch (_) {}
    }
    timers.delete(key);
    if (overlay) this.intentionCardOverlayStore().set(key, overlay);
    else this.intentionCardOverlayStore().delete(key);
    try { this.intentionCardHost?.().scheduleRefresh?.(); } catch (_) {}
    if (!overlay) return null;
    const ttl = Number.isFinite(options.ttlMs) && options.ttlMs >= 0
      ? options.ttlMs
      : INTENTION_CARD_EDITOR_OVERLAY_TTL_MS;
    if (ttl === 0) return overlay;
    const token = overlay;
    const timer = (typeof this.albumSetTimeout === "function" ? this.albumSetTimeout : setTimeout)((() => {
      try { timers.delete(key); } catch (_) {}
      try {
        if (this.intentionCardOverlayStore().get(key) === token) this.intentionCardOverlayStore().delete(key);
      } catch (_) {}
      try { this.intentionCardHost?.().scheduleRefresh?.(); } catch (_) {}
    }), ttl);
    if (timer !== undefined && timer !== null) timers.set(key, timer);
    return overlay;
  }

  intentionCardClearOverlay(path) {
    return this.intentionCardPushOverlay(path, null);
  }

  // An overlay settles when the vault reports matching metadata (the write
  // landed) or conflicting metadata (a later write superseded it); the TTL
  // bounds every other case. No optimistic success before apply succeeds.
  intentionCardSettleOverlay(path, frontmatter) {
    const key = typeof intentionCardPath === "function" ? intentionCardPath(path || "") : String(path || "");
    const overlay = key ? this.intentionCardOverlayStore().get(key) : null;
    if (!overlay || !overlay.fields || typeof overlay.fields !== "object") return false;
    const fm = frontmatter && typeof frontmatter === "object" ? frontmatter : {};
    const same = (name) => {
      if (!Object.prototype.hasOwnProperty.call(overlay.fields, name)) return true;
      const want = overlay.fields[name] === undefined ? null : overlay.fields[name];
      const have = Object.prototype.hasOwnProperty.call(fm, name) ? fm[name] : null;
      return JSON.stringify(want === undefined ? null : want) === JSON.stringify(have === undefined ? null : have);
    };
    if (same("intentions") && same("summary") && same("reflection")) {
      this.intentionCardClearOverlay(key);
      return true;
    }
    this.intentionCardClearOverlay(key);
    return false;
  }
}
