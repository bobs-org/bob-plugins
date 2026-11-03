// Path-bullet import for Z image zoom (pathz phase).
// `Z` on a bullet holding only an image path imports it through
// `bob attachments import` (the same copy rules `%c` uses), rewrites the
// bullet to bob's embed in one undoable edit, and opens the viewer on the
// new image with an "Imported" pill. `r` in that viewer restores the bullet
// in display form, so `Z`/`r` round-trips.

// Match an optional bullet marker (`-`, `*`, `+`, or `N.`/`N)`) plus its
// trailing whitespace. The import content is whatever follows.
const IMAGE_ZOOM_PATH_BULLET_PREFIX = /^[ \t]*(?:(?:-|\*|\+|\d+[.)])[ \t]+)?/;

// Task checkboxes (`[ ]`, `[x]`, …) are never image paths.
const IMAGE_ZOOM_PATH_CHECKBOX_PREFIX = /^\[[^\]\r\n]\]/;

// Find a bullet whose whole content is exactly one image path. Returns
// `{start, end, raw}` spanning the content (including any `'...'`, `"..."`,
// or `<...>` wrapper), or null when the line is not a path-only bullet.
// Throws `Not an image: <path>` for a path-only bullet whose extension is
// not an image extension. Fences and image-reference priority are the
// caller's job: the line must have no image candidates and be outside a
// fence before this runs.
function findImagePathBullet(lineText) {
  const text = String(lineText === null || lineText === undefined ? "" : lineText);
  const prefix = IMAGE_ZOOM_PATH_BULLET_PREFIX.exec(text);
  const contentStart = prefix ? prefix[0].length : 0;
  const raw = text.slice(contentStart).replace(/[ \t]+$/, "");
  if (!raw) {
    return null;
  }
  if (IMAGE_ZOOM_PATH_CHECKBOX_PREFIX.test(raw)) {
    return null;
  }
  let inner = raw;
  if (inner.length >= 2) {
    const first = inner[0];
    const last = inner[inner.length - 1];
    if (
      (first === "'" && last === "'") ||
      (first === '"' && last === '"') ||
      (first === "<" && last === ">")
    ) {
      inner = inner.slice(1, -1).trim();
    }
  }
  if (!inner) {
    return null;
  }
  if (
    !inner.startsWith("~/") &&
    !inner.startsWith("/") &&
    !inner.startsWith("file://")
  ) {
    return null;
  }
  const extension = imageZoomExtensionOfPath(inner);
  if (!extension) {
    return null;
  }
  if (!IMAGE_ZOOM_EXTENSIONS.has(extension)) {
    throw new Error(`Not an image: ${inner}`);
  }
  return { start: contentStart, end: contentStart + raw.length, raw };
}

BobNavigationHotkeysImageZoomMixin.prototype.openImageZoomViewerOnImport = function openImageZoomViewerOnImport({ src, saved, attachment, restore }) {
  const savedName = String(saved.split("/").pop() || saved);
  const basePath = typeof this.getVaultBasePath === "function"
    ? this.getVaultBasePath()
    : "";
  const context = {
    kind: "vault",
    vaultPath: saved,
    absolutePath: basePath
      ? `${String(basePath).replace(/\/+$/, "")}/${saved}`
      : "",
    url: "",
    restore,
    origin: {
      source: attachment.source,
      display: attachment.display,
      state: "present",
      via: "zoom",
    },
    justImported: true,
    imported: { saved, reused: attachment.reused === true },
  };
  let modal = null;
  modal = new ImageZoomModal(this.app, {
    src,
    title: savedName,
    context,
    onClosed: () => {
      if (this.activeImageZoomModal === modal) {
        this.activeImageZoomModal = null;
      }
      this.restoreImageZoomSourceEditor(restore);
    },
  });
  this.activeImageZoomModal = modal;
  try {
    modal.open();
  } catch (error) {
    if (this.activeImageZoomModal === modal) {
      this.activeImageZoomModal = null;
    }
    throw error;
  }
};

BobNavigationHotkeysImageZoomMixin.prototype.importImagePathOnLine = async function importImagePathOnLine(editor, view, bullet) {
  // A second `Z` while an import is in flight is ignored.
  if (this.imageZoomImporting) {
    return;
  }
  this.imageZoomImporting = true;
  try {
    const raw = bullet && typeof bullet.raw === "string" ? bullet.raw : "";
    const api = getNavigationAttachmentsApi(this.app);
    if (!api) {
      new Notice("Importing images needs bob-ledger-tools on desktop");
      return;
    }
    if (
      !view ||
      !view.file ||
      !editor ||
      typeof editor.getCursor !== "function" ||
      typeof editor.getLine !== "function"
    ) {
      return;
    }
    const head = editor.getCursor("head");
    if (!head || !Number.isInteger(head.line) || !Number.isFinite(head.ch)) {
      return;
    }
    const anchor = editor.getCursor("anchor") || head;
    const snapshot = {
      view,
      filePath: view.file.path,
      editor,
      line: head.line,
      lineText: editor.getLine(head.line),
      start: bullet.start,
      end: bullet.end,
      anchor: { line: anchor.line, ch: anchor.ch },
      head: { line: head.line, ch: head.ch },
      scroll:
        typeof editor.getScrollInfo === "function"
          ? editor.getScrollInfo()
          : null,
    };
    let result = null;
    try {
      result = await api.import(raw, { via: "zoom" });
    } catch (_error) {
      result = null;
    }
    if (!result || result.ok !== true) {
      const message = result && typeof result.message === "string" && result.message
        ? result.message
        : "import failed";
      new Notice(`Couldn't import ${raw}: ${message}`);
      return;
    }
    const attachment = result.attachments && result.attachments[0];
    if (
      !attachment ||
      attachment.kind !== "image" ||
      typeof attachment.saved !== "string" ||
      typeof attachment.embed !== "string"
    ) {
      new Notice(`Not an image: ${raw}`);
      return;
    }
    const workspace = this.app && this.app.workspace;
    const activeView = workspace && typeof workspace.getActiveViewOfType === "function"
      ? workspace.getActiveViewOfType(MarkdownView)
      : null;
    if (
      activeView !== view ||
      !view.file ||
      view.file.path !== snapshot.filePath ||
      editor.getLine(snapshot.line) !== snapshot.lineText
    ) {
      new Notice(`Line changed while importing · image saved at ${attachment.saved}; note unchanged`);
      return;
    }
    const from = { line: snapshot.line, ch: snapshot.start };
    const to = { line: snapshot.line, ch: snapshot.end };
    const cursor = { line: snapshot.line, ch: snapshot.start };
    if (typeof editor.transaction === "function") {
      editor.transaction({
        changes: [{ from, to, text: attachment.embed }],
        selection: { from: cursor, to: cursor },
      });
    } else if (typeof editor.replaceRange === "function") {
      editor.replaceRange(attachment.embed, from, to);
      if (typeof editor.setCursor === "function") {
        editor.setCursor(cursor);
      }
    } else {
      new Notice(`Couldn't import ${raw}: the editor cannot edit this note`);
      return;
    }
    let src = "";
    try {
      const adapter = this.app && this.app.vault && this.app.vault.adapter;
      if (adapter && typeof adapter.getResourcePath === "function") {
        src = adapter.getResourcePath(attachment.saved);
      }
    } catch (_error) {
      src = "";
    }
    if (!src) {
      new Notice(`Imported ${attachment.saved} but couldn't open the viewer`);
      return;
    }
    const updatedLine = editor.getLine(snapshot.line);
    const restore = {
      view,
      filePath: snapshot.filePath,
      editor,
      line: snapshot.line,
      lineText: typeof updatedLine === "string" ? updatedLine : "",
      start: snapshot.start,
      end: snapshot.start + attachment.embed.length,
      anchor: { ...cursor },
      head: { ...cursor },
      scroll: snapshot.scroll,
    };
    this.openImageZoomViewerOnImport({
      src,
      saved: attachment.saved,
      attachment,
      restore,
    });
  } finally {
    this.imageZoomImporting = false;
  }
};
