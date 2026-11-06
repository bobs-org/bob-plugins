function imageZoomNormalizeOrigin(value) {
  if (!value || typeof value !== "object") return null;
  if (value.ok === true) return imageZoomNormalizeOrigin(value.origin);
  if (Object.prototype.hasOwnProperty.call(value, "origin")) {
    return imageZoomNormalizeOrigin(value.origin);
  }
  return typeof value.display === "string" || typeof value.source === "string"
    ? value
    : null;
}

function imageZoomOriginSuffix(origin) {
  if (!origin) return "";
  if (origin.state === "changed") return "changed since import";
  if (origin.state === "missing") return "no longer on disk";
  if (origin.state === "elsewhere") return `on ${origin.host || "another host"}`;
  if (origin.state === "external") return "Gmail thread";
  return "";
}

function imageZoomMiddleTruncate(value, limit = 120) {
  const text = String(value || "");
  if (text.length <= limit) return text;
  const room = Math.max(2, limit - 1);
  const left = Math.ceil(room / 2);
  const right = Math.floor(room / 2);
  return `${text.slice(0, left)}…${right ? text.slice(-right) : ""}`;
}

ImageZoomModal.prototype.resolveImageZoomOrigin = function resolveImageZoomOrigin() {
  const input = this.imageZoomContext.origin;
  const isPromise = input && typeof input.then === "function";
  this.imageZoomOriginResolved = !isPromise;
  this.imageZoomOriginError = null;
  const normalizeResult = (result) => {
    if (result && typeof result === "object" && result.ok === false) {
      this.imageZoomOriginError = result.message || result.code || "bob lookup failed";
      return null;
    }
    if (
      result && typeof result === "object" && result.ok === true &&
      !Object.prototype.hasOwnProperty.call(result, "origin")
    ) {
      this.imageZoomOriginError = "unexpected response from bob";
      return null;
    }
    return imageZoomNormalizeOrigin(result);
  };
  if (!isPromise) {
    this.imageZoomOrigin = normalizeResult(input);
    this.renderImageZoomOrigin();
    this.renderImageZoomFooter();
    return Promise.resolve(this.imageZoomOrigin);
  }
  this.imageZoomOriginPromise = Promise.resolve(input)
    .then((result) => normalizeResult(result))
    .catch((error) => {
      this.imageZoomOriginError = error && error.message ? error.message : "bob lookup failed";
      return null;
    })
    .then((origin) => {
      if (!this.imageZoomClosed) {
        this.imageZoomOrigin = origin;
        this.imageZoomOriginResolved = true;
        this.renderImageZoomOrigin();
        this.renderImageZoomFooter();
      }
      return origin;
    });
  return this.imageZoomOriginPromise;
};

ImageZoomModal.prototype.renderImageZoomOrigin = function renderImageZoomOrigin() {
  const el = this.imageZoomOriginEl;
  const origin = this.imageZoomOrigin;
  if (!el) return;
  const display = origin && (origin.display || origin.source);
  if (!display) {
    el.empty();
    el.setText("");
    el.classList.toggle("is-visible", false);
    el.removeAttribute("title");
    return;
  }
  const suffix = imageZoomOriginSuffix(origin);
  el.empty();
  el.createSpan({
    cls: "bob-image-zoom-origin-path",
    text: `↳ ${imageZoomMiddleTruncate(display, 112)}`,
  });
  if (suffix) {
    el.createSpan({ cls: "bob-image-zoom-origin-state", text: `· ${suffix}` });
  }
  el.setAttribute("title", `${display}${suffix ? ` · ${suffix}` : ""}`);
  el.classList.toggle("is-visible", true);
};

ImageZoomModal.prototype.renderImageZoomFooter = function renderImageZoomFooter() {
  const footer = this.imageZoomFooterEl;
  if (!footer) return;
  footer.empty();
  const addChip = (key, label) => {
    const item = footer.createSpan({ cls: "bob-image-zoom-chip" });
    item.createEl("kbd", { text: key });
    item.createSpan({ cls: "bob-image-zoom-chip-label", text: label });
  };
  const addDivider = () => footer.createSpan({ cls: "bob-image-zoom-divider", text: "·" });
  addChip("Esc", "close");
  addChip("+ / −", "zoom");
  addChip("0", "fit");
  addChip("1", "1:1");
  addChip("hjkl", "pan");
  if (!this.imageZoomOriginResolved) return;
  const context = this.imageZoomContext || {};
  const isVault = context.kind === "vault";
  const isUrl = context.kind === "url";
  const canCopy = Boolean((isVault && context.absolutePath) || (isUrl && context.url));
  const recorded = Boolean(this.imageZoomOrigin && (this.imageZoomOrigin.display || this.imageZoomOrigin.source));
  const canRestore = Boolean(context.restore && this.imageZoomOrigin && this.imageZoomOrigin.state === "present");
  if (canCopy || canRestore) addDivider();
  if (canCopy) {
    const label = this.imageZoomOrigin && this.imageZoomOrigin.state === "external"
      ? "copy Gmail link"
      : recorded ? "copy original path" : isUrl ? "copy URL" : "copy file path";
    addChip("y", label);
  }
  if (canRestore) addChip("r", "restore path");
};

ImageZoomModal.prototype.showImageZoomToast = function showImageZoomToast(message, options = {}) {
  if (this.imageZoomClosed) return;
  const el = this.imageZoomToastEl;
  if (!el || !message) return;
  this.clearImageZoomToast();
  const fullMessage = String(message);
  const isError = options.error === true || fullMessage.startsWith("!");
  const label = fullMessage.replace(/^[✓!]\s*/, "");
  el.empty();
  const mark = el.createSpan({ cls: "bob-image-zoom-toast-mark", text: isError ? "!" : "✓" });
  const text = el.createSpan({
    cls: "bob-image-zoom-toast-text",
    text: imageZoomMiddleTruncate(label, 112),
  });
  mark.setAttribute("aria-hidden", "true");
  text.setAttribute("title", label);
  el.classList.toggle("is-error", isError);
  el.classList.toggle("is-fading", false);
  el.classList.toggle("is-visible", true);
  el.setAttribute("title", label);
  const duration = Number.isFinite(Number(options.duration)) ? Number(options.duration) : 1800;
  const fade = this.imageZoomSetTimeout(() => {
    if (this.imageZoomClosed) return;
    el.classList.toggle("is-fading", true);
    const remove = this.imageZoomSetTimeout(() => {
      el.classList.toggle("is-visible", false);
      el.classList.toggle("is-fading", false);
      el.empty();
    }, 160);
    this.imageZoomToastTimers.push(remove);
  }, duration);
  this.imageZoomToastTimers.push(fade);
};

ImageZoomModal.prototype.clearImageZoomToast = function clearImageZoomToast() {
  for (const timer of this.imageZoomToastTimers || []) {
    try {
      this.imageZoomClearTimeout(timer);
    } catch (_error) {
      // Timer cleanup is best-effort.
    }
  }
  this.imageZoomToastTimers = [];
};

ImageZoomModal.prototype.showImageZoomImportedToast = function showImageZoomImportedToast() {
  const context = this.imageZoomContext || {};
  const imported = context.imported || (context.justImported && typeof context.justImported === "object"
    ? context.justImported
    : null);
  if (!context.justImported && !imported) return;
  const saved = String((imported && imported.saved) || context.vaultPath || "");
  if (!saved) return;
  this.showImageZoomToast(
    `${imported && imported.reused ? "Linked existing" : "Imported to"} ${saved} · r to undo`,
    { duration: 2600 },
  );
};

ImageZoomModal.prototype.awaitImageZoomOrigin = async function awaitImageZoomOrigin() {
  if (this.imageZoomOriginPromise) return this.imageZoomOriginPromise;
  if (!this.imageZoomOriginResolved) await this.resolveImageZoomOrigin();
  return this.imageZoomOrigin;
};

ImageZoomModal.prototype.copyImageZoomSource = async function copyImageZoomSource() {
  if (this.imageZoomClosed) return false;
  const origin = await this.awaitImageZoomOrigin();
  if (this.imageZoomClosed) return false;
  const context = this.imageZoomContext || {};
  const text = origin
    ? String(origin.display || origin.source || "")
    : context.kind === "url"
      ? String(context.url || "")
      : String(context.absolutePath || "");
  if (!text) {
    this.showImageZoomToast("! Couldn't copy", { error: true });
    return false;
  }
  try {
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (!clipboard || typeof clipboard.writeText !== "function") throw new Error("Clipboard unavailable");
    await clipboard.writeText(text);
    if (this.imageZoomClosed) return false;
    this.showImageZoomToast(`✓ Copied ${text}`);
    return true;
  } catch (_error) {
    if (this.imageZoomClosed) return false;
    this.showImageZoomToast("! Couldn't copy", { error: true });
    return false;
  }
};

ImageZoomModal.prototype.restoreImageZoomSource = async function restoreImageZoomSource() {
  if (this.imageZoomClosed) return false;
  const context = this.imageZoomContext || {};
  const restore = context.restore;
  const origin = await this.awaitImageZoomOrigin();
  if (this.imageZoomClosed) return false;
  if (context.kind === "url") {
    this.showImageZoomToast("! Web images have no original path", { error: true });
    return false;
  }
  if (!origin) {
    if (this.imageZoomOriginError) {
      this.showImageZoomToast(`! Couldn't look up the original · ${this.imageZoomOriginError}`, { error: true });
      return false;
    }
    this.showImageZoomToast("! No original path recorded", { error: true });
    return false;
  }
  if (origin.state === "missing") {
    this.showImageZoomToast("! Original is no longer on disk", { error: true });
    return false;
  }
  if (origin.state === "changed") {
    this.showImageZoomToast("! Original changed since import · y still copies it", { error: true });
    return false;
  }
  if (origin.state === "elsewhere") {
    this.showImageZoomToast(`! Original lives on ${origin.host || "another host"}`, { error: true });
    return false;
  }
  if (origin.state === "external") {
    this.showImageZoomToast("! Gmail attachment has no local source path", { error: true });
    return false;
  }
  const display = String(origin.display || origin.source || "");
  if (origin.state !== "present" || !display || !restore) {
    this.showImageZoomToast("! No original path recorded", { error: true });
    return false;
  }
  const workspace = this.app && this.app.workspace;
  const activeView = workspace && typeof workspace.getActiveViewOfType === "function"
    ? workspace.getActiveViewOfType(MarkdownView)
    : null;
  const editor = restore.editor;
  if (
    activeView !== restore.view ||
    !restore.view ||
    !restore.view.file ||
    restore.view.file.path !== restore.filePath ||
    !editor ||
    typeof editor.getLine !== "function" ||
    editor.getLine(restore.line) !== restore.lineText
  ) {
    this.showImageZoomToast("! Line changed · nothing restored", { error: true });
    return false;
  }
  const from = { line: restore.line, ch: restore.start };
  const to = { line: restore.line, ch: restore.end };
  const cursor = { line: restore.line, ch: restore.start };
  try {
    if (typeof editor.transaction === "function") {
      editor.transaction({
        changes: [{ from, to, text: display }],
        selection: { from: cursor, to: cursor },
      });
    } else if (typeof editor.replaceRange === "function") {
      editor.replaceRange(display, from, to);
      if (typeof editor.setCursor === "function") editor.setCursor(cursor);
    } else {
      this.showImageZoomToast("! Could not restore path", { error: true });
      return false;
    }
  } catch (_error) {
    this.showImageZoomToast("! Could not restore path", { error: true });
    return false;
  }
  restore.restoreCursor = cursor;
  this.close();
  try {
    new Notice(`Restored ${display} · vault copy kept at ${context.vaultPath}`);
  } catch (_error) {
    // The editor write succeeded; a notice is only confirmation.
  }
  return true;
};
