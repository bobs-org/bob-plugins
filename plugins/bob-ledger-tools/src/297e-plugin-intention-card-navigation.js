// Intention card navigation: in-place parent/sibling travel, missing-note
// states, yesterday entry points, the intentions YAML excursion, and the
// [n==r / ==[r compositions. Browse navigation never discards an active
// stage: stage keys stay text, and only explicit cancel/save leaves it. All
// requests, Undo, pending drafts, and async completions stay pinned to the
// modal's current target; superseded replies after close or target change are
// ignored.
function intentionCardNavKeyAction(event, context = {}) {
  const stage = context.stage || null;
  if (stage) return null;
  const key = event && event.key;
  if (key !== "[" && key !== "]" && key !== "=" && key !== "y" && key !== "Y") return null;
  if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) return null;
  if (context.inInput === true) return null;
  if (key === "[") return "navigate-prev";
  if (key === "]") return "navigate-next";
  if (key === "=") return "navigate-parent";
  if (key === "y") return "yaml-excursion";
  return null;
}

function intentionCardParentSubject(subject) {
  if (!subject || typeof subject !== "object") return null;
  return subject.parent || null;
}

function intentionCardSiblingSubject(subject, delta) {
  if (!subject || typeof subject !== "object" || !Number.isInteger(delta)) return null;
  if (delta < 0) return subject.previous || null;
  if (delta > 0) return subject.next || null;
  return null;
}

function intentionCardShortDayLabel(dateText) {
  try {
    const label = typeof intentionCardDayLabel === "function"
      ? intentionCardDayLabel(String(dateText || ""), true)
      : "";
    if (label) return label.replace(/, \d{4}$/, "");
  } catch (_) {}
  return String(dateText || "");
}

// Missing-note copy: dailies name the day, periods point at ensure. Never
// create a note implicitly from navigation.
function intentionCardMissingMessage(subject) {
  if (!subject || typeof subject !== "object") return "That note is missing.";
  if (subject.kind === "day") {
    return `no note for ${intentionCardShortDayLabel(subject.start || subject.id)} yet`;
  }
  return "This period note does not exist yet — run `bob periods ensure` to create it.";
}

function intentionCardMissingHint(subject) {
  if (!subject || typeof subject !== "object") return "";
  if (subject.kind === "day") return "Daily notes are created by the daily-notes flow, never by navigation.";
  return "Run `bob periods ensure -d <date>` for its first day, then reopen.";
}

// Yesterday via local calendar arithmetic: shift the local date, never
// milliseconds or UTC string parsing.
function intentionCardYesterdayDate(now = new Date()) {
  const base = now instanceof Date && Number.isFinite(now.getTime()) ? new Date(now.getTime()) : new Date();
  base.setDate(base.getDate() - 1);
  return base;
}

function intentionCardYesterdayDailyPath(app, now) {
  try {
    if (typeof todayDailyPath !== "function") return "";
    const options = typeof getDailyNotesOptions === "function" ? getDailyNotesOptions(app) || {} : {};
    return todayDailyPath(intentionCardYesterdayDate(now), options);
  } catch (_) {
    return "";
  }
}

function intentionCardYesterdayId(today) {
  try {
    if (typeof intentionCardShiftDate === "function") return intentionCardShiftDate(String(today || ""), -1);
  } catch (_) {}
  return "";
}

// Owned-field line focus for the YAML excursion: first line whose key
// matches the selected field, else the frontmatter open.
function intentionCardYamlLineForField(source, fieldKey) {
  const text = String(source || "");
  const lines = text.split(/\r\n|\r|\n/);
  const want = (() => {
    if (!fieldKey) return "";
    if (fieldKey === "reflection") return "reflection";
    if (fieldKey === "summary") return "summary";
    if (fieldKey === "add" || String(fieldKey).startsWith("intention:")) return "intentions";
    return String(fieldKey).split(":")[0] || "";
  })();
  if (!want) return 1;
  for (let index = 0; index < lines.length; index += 1) {
    if (new RegExp(`^\\s*${want}\\s*:`).test(lines[index])) return index + 1;
  }
  return 1;
}

class BobLedgerToolsIntentionCardNavigationMixin {
  setupIntentionCardNavigation() {
    if (this.intentionCardNavigationActive) return;
    this.intentionCardNavigationActive = true;
    try {
      this.addCommand({
        id: "edit-intentions",
        name: "Edit intentions",
        callback: () => { void this.intentionCardEditActive(); },
      });
    } catch (_) {}
    try {
      this.addCommand({
        id: "reflect-on-yesterday",
        name: "Reflect on yesterday",
        callback: () => { void this.intentionCardReflectYesterday(); },
      });
    } catch (_) {}
  }

  teardownIntentionCardNavigation() {
    this.intentionCardNavigationActive = false;
  }

  intentionCardNavigationToday() {
    try {
      if (typeof this.intentionCardEditorToday === "function") return this.intentionCardEditorToday();
      if (typeof this.intentionCardToday === "function") return this.intentionCardToday();
    } catch (_) {}
    try {
      if (typeof dayStripLocalToday === "function") return dayStripLocalToday(new Date());
    } catch (_) {}
    return "";
  }

  intentionCardVaultHas(path) {
    try {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getAbstractFileByPath !== "function") return null;
      return Boolean(vault.getAbstractFileByPath(path));
    } catch (_) {
      return null;
    }
  }

  async intentionCardEditActive(options = {}) {
    try {
      const filePath = typeof this.intentionCardEditorActivePath === "function"
        ? this.intentionCardEditorActivePath(options.filePath || "")
        : "";
      return this.openIntentionCard({ ...options, filePath });
    } catch (_) {
      return { ok: false, reason: "open-failed" };
    }
  }

  // Reflect on yesterday: pin yesterday's daily note via local daily
  // path/date logic and open its Reflection. Missing notes show the same
  // disabled state as in-modal missing days.
  async intentionCardReflectYesterday(options = {}) {
    const yesterdayPath = intentionCardYesterdayDailyPath(this.app, options.now);
    if (!yesterdayPath) {
      try { new Notice("Could not resolve yesterday's daily note."); } catch (_) {}
      return { ok: false, reason: "missing-path" };
    }
    return this.openIntentionCard({
      ...options,
      filePath: yesterdayPath,
      field: "reflection",
      initialStage: options.stage === null ? "" : (options.initialStage || "reflection"),
      returnSelection: options.returnSelection || "",
    });
  }

  // [n==r composition helper: previous-note navigation already moved the
  // active note; the registry opens its card; direct reflection opening
  // selects the reflection row (closed notes land there anyway).
  async intentionCardOpenPreviousReflection(options = {}) {
    try {
      const filePath = typeof this.intentionCardEditorActivePath === "function"
        ? this.intentionCardEditorActivePath(options.filePath || "")
        : "";
      return this.openIntentionCard({ ...options, filePath, field: "reflection" });
    } catch (_) {
      return { ok: false, reason: "open-failed" };
    }
  }

  intentionCardMarkdownLeaf(path) {
    const target = typeof intentionCardPath === "function" ? intentionCardPath(path) : String(path || "");
    try {
      const leaves = this.app?.workspace?.getLeavesOfType?.("markdown") || [];
      const found = leaves.find((leaf) => {
        try {
          const p = leaf?.view?.file?.path || "";
          return (typeof intentionCardPath === "function" ? intentionCardPath(p) : String(p)) === target;
        } catch (_) { return false; }
      });
      return found || this.app?.workspace?.getMostRecentLeaf?.() || this.app?.workspace?.activeLeaf || null;
    } catch (_) {
      return null;
    }
  }

  async intentionCardReadSource(path) {
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(path) || null;
      if (!file || typeof this.app?.vault?.read !== "function") return "";
      return await this.app.vault.read(file);
    } catch (_) {
      return "";
    }
  }

  async intentionCardJumpSource(path, line) {
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(path) || { path };
      const leaf = this.intentionCardMarkdownLeaf(path);
      const cursorLine = Number.isInteger(line) && line > 0 ? line - 1 : 0;
      if (leaf && typeof leaf.openFile === "function") {
        await leaf.openFile(file, { state: { mode: "source" } });
      } else if (leaf && typeof leaf.setViewState === "function") {
        const current = typeof leaf.getViewState === "function" ? leaf.getViewState() : { type: "markdown", state: {} };
        await leaf.setViewState({
          ...(current || {}),
          type: "markdown",
          state: { ...((current && current.state) || {}), mode: "source", file: path },
        });
      } else if (this.app?.workspace?.openLinkText) {
        await this.app.workspace.openLinkText(String(path || "").replace(/\.md$/i, ""), path, false);
      }
      const editor = leaf?.view?.editor;
      if (editor && typeof editor.setCursor === "function") {
        editor.setCursor({ line: cursorLine, ch: 0 });
        if (typeof editor.scrollIntoView === "function") {
          editor.scrollIntoView({ from: { line: cursorLine, ch: 0 }, to: { line: cursorLine, ch: 0 } }, true);
        }
      }
      return { ok: true, line: cursorLine + 1 };
    } catch (_) {
      return { ok: false, reason: "source-jump-failed" };
    }
  }

  // `y` in browse mode: close the card, open Source on the selected
  // field's line, and record the excursion with saved selection and prior
  // view. Daily and period paths share this path.
  async intentionCardStartYamlExcursion(options = {}) {
    const modal = this.intentionCardEditorModal || options.modal || null;
    const subjectPath = typeof intentionCardPath === "function"
      ? intentionCardPath(options.subjectPath || modal?.subjectPath || "")
      : String(options.subjectPath || modal?.subjectPath || "");
    if (!subjectPath) return { ok: false, reason: "missing-path" };
    const field = String(options.field || modal?.selectedKey || "");
    const leaf = this.intentionCardMarkdownLeaf(subjectPath);
    if (!leaf) return this.intentionCardJumpSource(subjectPath, 1);
    let viewState = null;
    try { viewState = typeof leaf.getViewState === "function" ? leaf.getViewState() : null; } catch (_) {}
    let source = "";
    try { source = await this.intentionCardReadSource(subjectPath); } catch (_) { source = ""; }
    const line = intentionCardYamlLineForField(source, field);
    let record = null;
    try {
      record = typeof this.albumYamlExcursionBegin === "function"
        ? this.albumYamlExcursionBegin(leaf, {
          kind: "intentions",
          albumPath: subjectPath,
          viewState,
          selectedKey: field,
          selectedField: field,
          reopenCard: true,
          selection: { field },
        })
        : null;
    } catch (_) { record = null; }
    try { modal?.close?.(); } catch (_) {}
    if (!record) return this.intentionCardJumpSource(subjectPath, line);
    return this.intentionCardJumpSource(subjectPath, line);
  }

  async intentionCardYamlDoneAttempt(leaf, record) {
    const ownPath = (() => {
      try {
        return typeof albumYamlExcursionOwnPath === "function"
          ? albumYamlExcursionOwnPath(record)
          : record.albumPath;
      } catch (_) { return record && record.albumPath; }
    })();
    if (typeof this.albumYamlExcursionStillCurrent === "function"
      && !this.albumYamlExcursionStillCurrent(leaf, record)) {
      return { ok: false, reason: "stale-excursion" };
    }
    let save = { ok: true };
    try {
      save = typeof this.albumYamlSaveExcursionEditors === "function"
        ? await this.albumYamlSaveExcursionEditors([ownPath])
        : { ok: true };
    } catch (error) {
      save = { ok: false, code: "save-failed", message: String((error && error.message) || error) };
    }
    if (typeof this.albumYamlExcursionStillCurrent === "function"
      && !this.albumYamlExcursionStillCurrent(leaf, record)) {
      return { ok: false, reason: "stale-excursion" };
    }
    if (!save || save.ok !== true) {
      try { new Notice(save?.message || "Saving the intentions pane failed — fix it before Done."); } catch (_) {}
      return { ok: false, reason: save?.code || "save-failed" };
    }
    // Validate with a fresh periods empty-op preview: only a current
    // fingerprint plus a decodable report returns to the card. Errors stay
    // visible in Source with recovery available.
    let subject = null;
    try {
      subject = typeof intentionCardSubjectForPath === "function"
        ? intentionCardSubjectForPath(ownPath, this.intentionCardNavigationToday())
        : null;
    } catch (_) { subject = null; }
    if (!subject) {
      try { new Notice("That note is not a daily or period note — fix it before Done."); } catch (_) {}
      return { ok: false, reason: "non-intention-note" };
    }
    let result = null;
    try {
      const envelope = typeof intentionUpdateEnvelopeText === "function"
        ? intentionUpdateEnvelopeText("", [])
        : JSON.stringify({ schema_version: 1, ops: [] });
      result = typeof this.apiIntentionUpdatePreview === "function"
        ? await this.apiIntentionUpdatePreview(subject.id, envelope)
        : { ok: false, code: "unavailable", message: "The intention service is unavailable." };
    } catch (error) {
      result = { ok: false, code: "failed", message: error && error.message ? String(error.message) : "The intention read failed." };
    }
    if (typeof this.albumYamlExcursionStillCurrent === "function"
      && !this.albumYamlExcursionStillCurrent(leaf, record)) {
      return { ok: false, reason: "stale-excursion" };
    }
    if (!result || result.ok !== true || !result.report || result.report.ok !== true) {
      const code = result && (result.code || (result.report && result.report.error && result.report.error.code)) || "failed";
      const message = (result && result.report && result.report.error && result.report.error.message)
        || (result && result.message)
        || "The intentions are invalid — fix them before Done.";
      const hint = (result && result.report && result.report.error && result.report.error.hint) || "";
      try { new Notice([message, hint].filter(Boolean).join(" ")); } catch (_) {}
      return { ok: false, reason: code };
    }
    let restoreError = null;
    try {
      record.restoring = true;
      if (record.viewState && typeof leaf.setViewState === "function") await leaf.setViewState(record.viewState);
      else if (record.viewState?.state && typeof leaf.openFile === "function") {
        const file = this.app?.vault?.getAbstractFileByPath?.(ownPath) || { path: ownPath };
        await leaf.openFile(file, { state: { ...record.viewState.state, file: ownPath } });
      }
    } catch (error) { restoreError = error; }
    record.restoring = false;
    if (typeof this.albumYamlExcursionForLeaf === "function"
      && this.albumYamlExcursionForLeaf(leaf) !== record && !restoreError) {
      return { ok: false, reason: "stale-excursion" };
    }
    if (restoreError) return { ok: false, reason: "restore-failed", message: String(restoreError.message || restoreError) };
    try {
      if (typeof this.albumYamlExcursionClear === "function") this.albumYamlExcursionClear(leaf);
    } catch (_) {}
    const reopened = await this.openIntentionCard({
      filePath: ownPath,
      field: record.selectedField || record.selectedKey || "",
    });
    return { ok: true, reopened: Boolean(reopened && reopened.modal) };
  }
}

// Modal travel: same modal, new subject. Async work stays pinned to the
// target it started for; superseded replies are ignored.
if (typeof IntentionCardModal !== "undefined" && IntentionCardModal && !IntentionCardModal.prototype.intentionNavigateTo) {
  IntentionCardModal.prototype.intentionNavigateTo = async function (subject) {
    if (!subject || !subject.path || this.closed) return null;
    if (this.stage) return null;
    if (subject.path === this.subjectPath) return null;
    const plugin = this.intentionPlugin;
    const targetPath = typeof intentionCardPath === "function" ? intentionCardPath(subject.path) : String(subject.path);
    const navSeq = this.intentionReadSeq();
    try { this.session?.close?.(); } catch (_) {}
    this.session = null;
    this.subject = subject.id;
    this.subjectPath = targetPath;
    this.subjectState = subject.state === "closed" ? "closed" : "open";
    this.stage = null;
    this.stageDraft = "";
    this.stageNote = "";
    this.stagePreview = null;
    this.retainedOps = null;
    this.retainedSelection = "";
    this.fields = { intentions: [], summary: "", summaryState: "", summaryDrafted: "", reflection: "" };
    const exists = (() => {
      try {
        const vault = plugin?.app?.vault;
        if (!vault || typeof vault.getAbstractFileByPath !== "function") return null;
        return Boolean(vault.getAbstractFileByPath(targetPath));
      } catch (_) { return null; }
    })();
    if (exists === false) {
      this.malformed = false;
      this.missing = true;
      this.writable = false;
      this.fingerprint = "";
      this.latestReport = null;
      this.statusKind = "missing";
      this.refusalMessage = intentionCardMissingMessage(subject);
      this.refusalHint = intentionCardMissingHint(subject);
      const targets = this.intentionTargets();
      this.selectedKey = intentionCardEditorOpeningSelection(targets, this.subjectState, "");
      this.paintIntentionCard();
      return { ok: true, missing: true };
    }
    this.missing = false;
    let read = { ok: false, reason: "unavailable", fields: null };
    try {
      read = plugin && typeof plugin.intentionCardEditorReadFields === "function"
        ? plugin.intentionCardEditorReadFields(targetPath)
        : read;
    } catch (_) {}
    if (!this.intentionLive(navSeq)) return null;
    this.malformed = !read.ok;
    this.writable = read.ok;
    if (!read.ok) {
      this.fingerprint = "";
      this.latestReport = null;
      this.statusKind = "refusal";
      this.refusalMessage = "The intention fields on this note are malformed.";
      this.refusalHint = "Open the note in Source mode to repair the frontmatter, then reopen.";
      const targets = this.intentionTargets();
      this.selectedKey = intentionCardEditorOpeningSelection(targets, this.subjectState, "");
      this.paintIntentionCard();
      return { ok: true, malformed: true };
    }
    this.fields = {
      intentions: read.fields.intentions,
      summary: read.fields.summary,
      summaryState: read.fields.summaryState,
      summaryDrafted: read.fields.summaryDrafted,
      reflection: read.fields.reflection,
    };
    this.statusKind = "reading";
    const targets = this.intentionTargets();
    this.selectedKey = intentionCardEditorOpeningSelection(targets, this.subjectState, "");
    this.paintIntentionCard();
    let result = null;
    try {
      const envelope = typeof intentionUpdateEnvelopeText === "function"
        ? intentionUpdateEnvelopeText("", [])
        : JSON.stringify({ schema_version: 1, ops: [] });
      result = plugin && typeof plugin.apiIntentionUpdatePreview === "function"
        ? await plugin.apiIntentionUpdatePreview(subject.id, envelope)
        : { ok: false, code: "unavailable" };
    } catch (error) {
      result = { ok: false, code: "failed", message: error && error.message ? String(error.message) : "read failed" };
    }
    if (!this.intentionLive(navSeq)) return null;
    if (this.subjectPath !== targetPath) return null;
    try {
      const session = this.ensureIntentionSession();
      this.sessionState = session.getState();
    } catch (_) {}
    this.intentionConsumePreview(result);
    return result;
  };

  IntentionCardModal.prototype.intentionNavigateSibling = function (delta) {
    if (this.stage || this.pendingApply || this.closed) return null;
    let subject = null;
    try {
      const today = this.intentionPlugin && typeof this.intentionPlugin.intentionCardNavigationToday === "function"
        ? this.intentionPlugin.intentionCardNavigationToday()
        : (typeof this.intentionPlugin.intentionCardEditorToday === "function"
          ? this.intentionPlugin.intentionCardEditorToday()
          : "");
      subject = typeof intentionCardSubjectForPath === "function"
        ? intentionCardSubjectForPath(this.subjectPath, today)
        : null;
    } catch (_) { subject = null; }
    const target = intentionCardSiblingSubject(subject, delta);
    if (!target || !target.path) return null;
    if (target.kind === "all") return null;
    void this.intentionNavigateTo(target);
    return target;
  };

  IntentionCardModal.prototype.intentionNavigateParent = function () {
    if (this.stage || this.pendingApply || this.closed) return null;
    let subject = null;
    try {
      const today = this.intentionPlugin && typeof this.intentionPlugin.intentionCardNavigationToday === "function"
        ? this.intentionPlugin.intentionCardNavigationToday()
        : (typeof this.intentionPlugin.intentionCardEditorToday === "function"
          ? this.intentionPlugin.intentionCardEditorToday()
          : "");
      subject = typeof intentionCardSubjectForPath === "function"
        ? intentionCardSubjectForPath(this.subjectPath, today)
        : null;
    } catch (_) { subject = null; }
    const target = intentionCardParentSubject(subject);
    if (!target || !target.path) return null;
    void this.intentionNavigateTo(target);
    return target;
  };

  const intentionCardEditorOnKeyDown = IntentionCardModal.prototype.intentionOnKeyDown;
  IntentionCardModal.prototype.intentionOnKeyDown = function (event) {
    if (!event || event.isComposing || event.keyCode === 229) return;
    if (event.defaultPrevented || event.__schemaEscapeHandled) return;
    if (!this.pendingApply && !this.stage) {
      try {
        const navAction = typeof intentionCardNavKeyAction === "function"
          ? intentionCardNavKeyAction(event, { stage: null, inInput: this.intentionInInput(event) })
          : null;
        if (navAction === "navigate-prev") {
          event.preventDefault?.();
          this.intentionNavigateSibling(-1);
          return;
        }
        if (navAction === "navigate-next") {
          event.preventDefault?.();
          this.intentionNavigateSibling(1);
          return;
        }
        if (navAction === "navigate-parent") {
          event.preventDefault?.();
          this.intentionNavigateParent();
          return;
        }
        if (navAction === "yaml-excursion") {
          event.preventDefault?.();
          try { void this.intentionPlugin?.intentionCardStartYamlExcursion?.({ modal: this }); } catch (_) {}
          return;
        }
      } catch (_) {}
    }
    return intentionCardEditorOnKeyDown.call(this, event);
  };

  const intentionCardEditorHandleAction = IntentionCardModal.prototype.intentionHandleAction;
  IntentionCardModal.prototype.intentionHandleAction = function (action, payload) {
    if (action === "navigate-prev") { this.intentionNavigateSibling(-1); return null; }
    if (action === "navigate-next") { this.intentionNavigateSibling(1); return null; }
    if (action === "navigate-parent") { this.intentionNavigateParent(); return null; }
    if (action === "yaml-excursion") {
      try { void this.intentionPlugin?.intentionCardStartYamlExcursion?.({ modal: this }); } catch (_) {}
      return null;
    }
    return intentionCardEditorHandleAction.call(this, action, payload);
  };
}
