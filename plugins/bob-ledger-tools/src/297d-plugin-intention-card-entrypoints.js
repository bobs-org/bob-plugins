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
    try {
      const modal = this.intentionCardEditorModal;
      if (modal) modal.intentionForceClose = true;
      modal?.close?.();
    } catch (_) {}
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
      // A new open never supersedes an in-flight write in the current card.
      if (this.intentionCardEditorModal.pendingApply && !this.intentionCardEditorModal.closed) {
        try { new Notice("Wait for the intention save to finish."); } catch (_) {}
        return { ok: false, reason: "busy" };
      }
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

  intentionCardOverlayFor(path) {
    const key = typeof intentionCardPath === "function" ? intentionCardPath(path || "") : String(path || "");
    if (!key || !(this.intentionCardOverlays instanceof Map)) return null;
    return this.intentionCardOverlays.get(key) || null;
  }

  // Owned fields as metadataCache describes them right now, comparable with
  // overlay snapshots; null when the note or a field is unreadable.
  intentionCardOverlayMetadataFields(path) {
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(path);
      const cache = file ? this.app?.metadataCache?.getFileCache?.(file) : null;
      const frontmatter = cache && cache.frontmatter && typeof cache.frontmatter === "object" ? cache.frontmatter : {};
      return file ? intentionOverlayComparable(frontmatter) : null;
    } catch (_) {
      return null;
    }
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
    const previous = this.intentionCardOverlayStore().get(key) || null;
    if (overlay) {
      // Metadata can lag more than one write: any earlier snapshot still on
      // its way (the prior overlay, its priors, the metadata seen now) keeps
      // this overlay pending instead of reading as a conflicting update.
      const priors = [];
      const add = (fields) => {
        if (fields && !priors.some((known) => intentionOverlaySame(known, fields))) priors.push(fields);
      };
      for (const prior of Array.isArray(overlay.priors) ? overlay.priors : []) add(prior);
      if (previous) {
        add(intentionOverlayComparable(previous.fields));
        for (const prior of Array.isArray(previous.priors) ? previous.priors : []) add(prior);
      }
      add(this.intentionCardOverlayMetadataFields(key));
      overlay.priors = priors.slice(0, INTENTION_CARD_EDITOR_OVERLAY_PRIORS);
      this.intentionCardOverlayStore().set(key, overlay);
    } else {
      this.intentionCardOverlayStore().delete(key);
    }
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

  // Metadata settles an overlay three ways: matching owned fields mean the
  // write landed ("settled"); fields that still describe an earlier snapshot
  // keep it ("pending"); anything else is a later conflicting owned-field
  // update ("discarded"). The TTL bounds the pending case. No optimistic
  // success before apply succeeds: only applied writes push overlays.
  intentionCardSettleOverlay(path, frontmatter) {
    const key = typeof intentionCardPath === "function" ? intentionCardPath(path || "") : String(path || "");
    const overlay = key ? this.intentionCardOverlayStore().get(key) : null;
    if (!overlay || !overlay.fields || typeof overlay.fields !== "object") return "none";
    const have = intentionOverlayComparable(frontmatter && typeof frontmatter === "object" ? frontmatter : {});
    const want = intentionOverlayComparable(intentionCardOverlayExpected(have, overlay.fields));
    if (intentionOverlaySame(have, want)) {
      this.intentionCardClearOverlay(key);
      return "settled";
    }
    const priors = Array.isArray(overlay.priors) ? overlay.priors : [];
    if (have && priors.some((prior) => intentionOverlaySame(have, prior))) return "pending";
    this.intentionCardClearOverlay(key);
    return "discarded";
  }
}

const INTENTION_CARD_EDITOR_OVERLAY_PRIORS = 8;

// Overlay fields over the current comparable snapshot: fields the report did
// not carry keep their current value.
function intentionCardOverlayExpected(current, fields) {
  const base = current && typeof current === "object" ? { ...current } : {};
  for (const name of ["intentions", "summary", "reflection"]) {
    if (fields && Object.prototype.hasOwnProperty.call(fields, name)) base[name] = fields[name];
  }
  return base;
}

function intentionCardOverlayText(value) {
  return typeof value === "string" && value.trim() ? value : "";
}

// Display frontmatter with an applied overlay's owned fields laid over the
// note's own frontmatter. A changed summary never keeps the old stamps: the
// old digest does not belong to the new text. Unowned keys stay as they are.
function intentionCardOverlayFrontmatter(frontmatter, overlay) {
  const base = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter) ? { ...frontmatter } : {};
  const fields = overlay && overlay.fields && typeof overlay.fields === "object" ? overlay.fields : null;
  if (!fields) return base;
  const has = (name) => Object.prototype.hasOwnProperty.call(fields, name);
  if (has("intentions")) {
    const list = Array.isArray(fields.intentions) ? fields.intentions.map(String) : [];
    if (list.length) base.intentions = list;
    else delete base.intentions;
  }
  if (has("reflection")) {
    const reflection = intentionCardOverlayText(fields.reflection);
    if (reflection) base.reflection = reflection;
    else delete base.reflection;
  }
  if (has("summary")) {
    const summary = intentionCardOverlayText(fields.summary);
    const sameText = typeof base.summary === "string" && base.summary.trim() === summary.trim();
    if (!summary) {
      delete base.summary;
      delete base.summary_digest;
      delete base.summary_drafted;
    } else {
      base.summary = summary;
      if (!sameText || overlay.summaryState !== "agent") {
        delete base.summary_digest;
        delete base.summary_drafted;
      }
      if (overlay.summaryState === "agent" && overlay.summaryDrafted) base.summary_drafted = overlay.summaryDrafted;
    }
  }
  return base;
}

// The writer's reported summary provenance wins over the digest recomputed
// from overlay frontmatter (an Undo can restore agent text the old metadata
// never held). A date comes only from the applied op or matching metadata.
function intentionCardOverlayModel(model, overlay, frontmatter) {
  if (!model || !overlay || !model.summary) return model;
  if (overlay.summaryState === "agent") {
    const drafted = overlay.summaryDrafted
      || (frontmatter && typeof intentionCardDateStamp === "function" ? intentionCardDateStamp(frontmatter.summary_drafted) || "" : "");
    return { ...model, summaryState: "agent", summaryDrafted: drafted };
  }
  if (overlay.summaryState === "edited") return { ...model, summaryState: "edited", summaryDrafted: "" };
  return model;
}
