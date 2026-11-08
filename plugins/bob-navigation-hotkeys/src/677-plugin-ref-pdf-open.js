const HIGHLIGHTS_BUNDLE_ID = "net.highlightsapp.universal";
const HIGHLIGHTS_APP_NAME = "Highlights";
const HIGHLIGHTS_OPEN_TIMEOUT_MS = 15000;
const HIGHLIGHTS_REENTRY_MS = 400;
const OPEN_LINK_IN_NEW_TAB_COMMAND_ID = "editor:open-link-in-new-leaf";

function parseRefPdfBlockLinkLine(lineText) {
  const taskLink = parseLinkPickerTaskLink(lineText);
  if (taskLink) {
    return Object.freeze({
      target: taskLink.target,
      blockId: taskLink.blockId,
    });
  }

  const match = /^\s*!?\[\[([^\]\n]*?)#\^([A-Za-z0-9-]+)(?:\|[^\]\n]*)?\]\]\s*$/.exec(
    String(lineText || ""),
  );
  return match
    ? Object.freeze({ target: match[1].trim(), blockId: match[2] })
    : null;
}

function normalizeRefSourcePdfPath(value) {
  if (typeof value !== "string") {
    return null;
  }
  const path = normalizeVaultRelativePath(value);
  if (
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\0") ||
    path.split("/").some((segment) => segment === "..") ||
    !/\.pdf$/i.test(path)
  ) {
    return null;
  }
  return path;
}

function buildHighlightsOpenAttempts(absolutePath) {
  const path = String(absolutePath || "");
  return Object.freeze([
    Object.freeze(["-b", HIGHLIGHTS_BUNDLE_ID, path]),
    Object.freeze(["-a", HIGHLIGHTS_APP_NAME, path]),
  ]);
}

function refPdfError(message) {
  return Object.freeze({ kind: "error", message });
}

function refPdfPath(path) {
  return Object.freeze({ kind: "pdf", path });
}

function isReferenceNotePath(path) {
  const normalized = normalizeVaultRelativePath(path);
  return Boolean(
    normalized &&
      normalized.startsWith("ref/") &&
      normalized.toLowerCase().endsWith(".md"),
  );
}

function errorDetail(error, stderr) {
  const stderrText =
    typeof stderr === "string"
      ? stderr
      : stderr && typeof stderr.toString === "function"
        ? stderr.toString()
        : "";
  const firstLine = stderrText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || (error && error.message) || String(error || "Unknown error");
}

class BobNavigationHotkeysRefPdfOpenMixin {
  async openReferencePdfInHighlightsOrLink() {
    const now = Date.now();
    if (this._highlightsLaunchActive === true) {
      return;
    }
    if (
      typeof this._highlightsLastLaunchEnd === "number" &&
      now - this._highlightsLastLaunchEnd < HIGHLIGHTS_REENTRY_MS
    ) {
      return;
    }
    const context = this.getRefPdfEditorContext();
    if (!context) {
      this.delegateOpenLinkInNewTab();
      return;
    }
    let target = null;
    try {
      target = await this.resolveHighlightsTargetAtCursor(
        context.editor,
        context.file,
      );
    } catch (_error) {
      target = null;
    }
    if (!target || target.kind === "none") {
      this.delegateOpenLinkInNewTab();
      return;
    }
    if (
      target.kind === "removed" ||
      target.kind === "missing-highlight" ||
      target.kind === "error"
    ) {
      this.reportHighlightsOutcome(target);
      return;
    }
    this._highlightsLaunchActive = true;
    try {
      await this.openReferencePdfPath(target.pdfPath, {
        page: target.page,
        target,
      });
    } finally {
      this._highlightsLaunchActive = false;
      this._highlightsLastLaunchEnd = Date.now();
    }
  }

  getRefPdfEditorContext() {
    const view =
      this.app &&
      this.app.workspace &&
      this.app.workspace.getActiveViewOfType(MarkdownView);
    if (
      !view ||
      !view.file ||
      !this.isMarkdownFile(view.file) ||
      !view.editor ||
      typeof view.editor.getCursor !== "function" ||
      typeof view.editor.getValue !== "function"
    ) {
      return null;
    }

    if (typeof view.getMode === "function" && view.getMode() !== "source") {
      return null;
    }

    const container = view.containerEl;
    const activeDocument =
      (container && container.ownerDocument) ||
      (typeof document !== "undefined" ? document : null);
    const activeElement = activeDocument && activeDocument.activeElement;
    if (!activeElement) {
      return null;
    }
    if (activeElement !== activeDocument.body) {
      if (typeof activeElement.closest !== "function") {
        return null;
      }
      const editorElement = activeElement.closest(".cm-editor");
      if (
        !editorElement ||
        !container ||
        typeof container.contains !== "function" ||
        !container.contains(editorElement)
      ) {
        return null;
      }
    }

    return Object.freeze({ editor: view.editor, file: view.file });
  }

  resolveReferencePdfFromTaskLine(lineText, sourcePath) {
    const line = String(lineText || "");
    let index = 0;
    while (index < line.length) {
      const start = line.indexOf("[[", index);
      if (start === -1) {
        break;
      }
      const link = this.parseWikiLinkAt(line, start, {
        allowTransclusion: true,
      });
      if (!link) {
        index = start + 2;
        continue;
      }
      index = link.endIndex;
      const targetFile = this.resolveLinkTargetFile(link.target, sourcePath);
      if (!targetFile) {
        continue;
      }

      const targetPath = normalizeVaultRelativePath(targetFile.path);
      if (
        targetFile.extension === "pdf" ||
        (targetPath && targetPath.toLowerCase().endsWith(".pdf"))
      ) {
        return refPdfPath(targetPath);
      }
      if (!this.isMarkdownFile(targetFile)) {
        continue;
      }

      const frontmatter =
        this.app &&
        this.app.metadataCache &&
        this.app.metadataCache.getFileCache(targetFile)?.frontmatter;
      if (isManagedRefNote(targetPath, frontmatter)) {
        return refPdfPath(frontmatter.source_pdf);
      }
      if (isReferenceNotePath(targetPath)) {
        return refPdfError(
          `${targetPath} has no source_pdf (legacy reference)`,
        );
      }
    }

    const sourcePathNormalized = normalizeVaultRelativePath(sourcePath);
    const ownFrontmatter =
      this.app &&
      this.app.metadataCache &&
      this.app.metadataCache.getFileCache(
        this.app.vault.getAbstractFileByPath(sourcePathNormalized),
      )?.frontmatter;
    if (isManagedRefNote(sourcePathNormalized, ownFrontmatter)) {
      return refPdfPath(ownFrontmatter.source_pdf);
    }
    return refPdfError("Reading task links no reference PDF");
  }

  announceHighlightsOpen(target) {
    const title =
      target && typeof target.title === "string" && target.title
        ? target.title
        : "Untitled";
    const page = normalizeHighlightsPageOption(target ? target.page : null);
    let message = null;
    if (!target || target.kind === "reading") {
      message = `Opening ${title} in Highlights — resumes where you left off`;
    } else if (page !== null) {
      message = `Opening ${title} in Highlights at p. ${page}`;
    } else {
      message = `Opening ${title} in Highlights — no page number on this highlight`;
    }
    const opening = highlightsNoticeModel(target, "opening", message);
    const notice = showHighlightsNotice(this, opening, this.highlightsNotice);
    return {
      pageJumpUnavailable: () => {
        const model = highlightsNoticeModel(
          target,
          "unavailable",
          `Opened ${title} — jumping to p. ${page} needs Hammerspoon`,
        );
        showHighlightsNotice(this, model, notice);
      },
      failed: (reason) => {
        const failure = String(reason || "Could not open in Highlights");
        showHighlightsNotice(
          this,
          highlightsNoticeModel(target, "failed", failure),
          notice,
        );
      },
    };
  }

  reportHighlightsOutcome(target) {
    const message = String((target && target.message) || "Could not open in Highlights");
    const model = highlightsNoticeModel(target, "failed", message);
    showHighlightsNotice(this, model, this.highlightsNotice);
  }

  async openReferencePdfPath(path, options = {}) {
    const target = options.target || null;
    const requestedPage = Object.prototype.hasOwnProperty.call(options, "page")
      ? options.page
      : target
        ? target.page
        : null;
    const page = normalizeHighlightsPageOption(requestedPage);
    const normalizedPath = normalizeRefSourcePdfPath(path);
    if (!normalizedPath) {
      const message = `Unsafe source_pdf: ${String(path || "")}`;
      if (target) {
        this.reportHighlightsOutcome({ ...target, kind: "error", message });
      } else {
        new Notice(message);
      }
      return false;
    }
    const fail = (message) => {
      if (target) {
        this.reportHighlightsOutcome({ ...target, kind: "error", message });
      } else {
        new Notice(message);
      }
    };

    const adapter = this.app && this.app.vault && this.app.vault.adapter;
    const exists =
      options.exists ||
      (adapter && typeof adapter.exists === "function"
        ? adapter.exists.bind(adapter)
        : null);
    if (typeof exists !== "function") {
      fail(`Reference PDF not found: ${normalizedPath}`);
      return false;
    }
    try {
      if (!(await exists(normalizedPath))) {
        fail(`Reference PDF not found: ${normalizedPath}`);
        return false;
      }
    } catch (_error) {
      fail(`Reference PDF not found: ${normalizedPath}`);
      return false;
    }

    const basePath = Object.prototype.hasOwnProperty.call(options, "basePath")
      ? options.basePath
      : this.getVaultBasePath();
    if (!basePath) {
      fail("Opening PDFs needs the desktop app");
      return false;
    }
    const absolutePath = joinFilesystemPath(basePath, normalizedPath);
    const isMacOS = Object.prototype.hasOwnProperty.call(options, "isMacOS")
      ? options.isMacOS === true
      : Boolean(obsidian.Platform && obsidian.Platform.isMacOS === true);
    if (!isMacOS) {
      fail(`Highlights is macOS-only: ${normalizedPath}`);
      return false;
    }

    let execFile = options.execFile;
    try {
      if (typeof execFile !== "function") {
        ({ execFile } = require("child_process"));
      }
    } catch (error) {
      fail(
        `Could not open ${normalizedPath.split("/").at(-1)} in Highlights: ${error.message}`,
      );
      return false;
    }

    const announceTarget =
      target ||
      freezeHighlightsTarget({
        kind: page !== null ? "page" : "reading",
        pdfPath: normalizedPath,
        page,
        title: getHighlightsRefTitle(null, null, normalizedPath),
        snippet: null,
        detail: null,
        captionCount: null,
        archived: null,
        blockId: null,
        via: "cursor",
        railLines: null,
        message: null,
      });
    const handle = this.announceHighlightsOpen(announceTarget);

    const [bundleAttempt, appAttempt] =
      buildHighlightsOpenAttempts(absolutePath);
    const runAttempt = (args) =>
      new Promise((resolve) => {
        try {
          execFile(
            "/usr/bin/open",
            args,
            { timeout: HIGHLIGHTS_OPEN_TIMEOUT_MS },
            (error, _stdout, stderr) => resolve({ error, stderr }),
          );
        } catch (error) {
          resolve({ error, stderr: "" });
        }
      });

    const first = await runAttempt(bundleAttempt);
    if (first.error) {
      const firstDetail = errorDetail(first.error, first.stderr);
      const second = await runAttempt(appAttempt);
      if (second.error) {
        const detail = firstDetail || errorDetail(second.error, second.stderr);
        handle.failed(
          `Could not open ${normalizedPath.split("/").at(-1)} in Highlights: ${detail}`,
        );
        return false;
      }
    }
    if (page === null) {
      return true;
    }
    const url = buildHighlightsPageUrl(absolutePath, page);
    if (!url) {
      return true;
    }
    const pageResult = await new Promise((resolve) => {
      try {
        execFile(
          "/usr/bin/open",
          ["-g", url],
          { timeout: HIGHLIGHTS_OPEN_TIMEOUT_MS },
          (error, _stdout, stderr) => resolve({ error, stderr }),
        );
      } catch (error) {
        resolve({ error, stderr: "" });
      }
    });
    if (pageResult && pageResult.error) {
      handle.pageJumpUnavailable(
        errorDetail(pageResult.error, pageResult.stderr),
      );
    }
    return true;
  }

  delegateOpenLinkInNewTab() {
    try {
      this.app.commands.executeCommandById(OPEN_LINK_IN_NEW_TAB_COMMAND_ID);
    } catch (_error) {
      // Obsidian versions without the built-in command have nothing to delegate.
    }
  }
}
