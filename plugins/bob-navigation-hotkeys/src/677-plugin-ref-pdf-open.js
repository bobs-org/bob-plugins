const HIGHLIGHTS_BUNDLE_ID = "net.highlightsapp.universal";
const HIGHLIGHTS_APP_NAME = "Highlights";
const HIGHLIGHTS_OPEN_TIMEOUT_MS = 15000;
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
    const context = this.getRefPdfEditorContext();
    if (!context) {
      this.delegateOpenLinkInNewTab();
      return;
    }

    const result = await this.resolveReferencePdfAtCursor(
      context.editor,
      context.file,
    );
    if (result.kind === "none") {
      this.delegateOpenLinkInNewTab();
      return;
    }
    if (result.kind === "error") {
      new Notice(result.message);
      return;
    }
    await this.openReferencePdfPath(result.path);
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

  async resolveReferencePdfAtCursor(editor, file) {
    const content = String(editor.getValue() || "");
    const cursor = editor.getCursor();
    const lines = content.split(/\r?\n/);
    const lineIndex = cursor && Number.isInteger(cursor.line) ? cursor.line : -1;
    if (lineIndex < 0 || lineIndex >= lines.length) {
      return Object.freeze({ kind: "none" });
    }

    const lineText = String(lines[lineIndex] || "");
    const contexts = getMarkdownLineContexts(content);
    if (isObsidianTaskAtLine(content, lineIndex, contexts, lines)) {
      if (!REF_AFTER_TASK_RE.test(lineText)) {
        return Object.freeze({ kind: "none" });
      }
      return this.resolveReferencePdfFromTaskLine(lineText, file.path);
    }

    const blockLink = parseRefPdfBlockLinkLine(lineText);
    if (!blockLink) {
      return Object.freeze({ kind: "none" });
    }

    const targetFile = this.resolveLinkTargetFile(
      `${blockLink.target}#^${blockLink.blockId}`,
      file.path,
    );
    if (!targetFile || !this.isMarkdownFile(targetFile)) {
      return Object.freeze({ kind: "none" });
    }

    const targetPath = normalizeVaultRelativePath(targetFile.path);
    const targetContent = await this.readLinkPickerNoteContent(
      targetPath,
      targetFile,
    );
    if (targetContent === null) {
      return Object.freeze({ kind: "none" });
    }
    const found = findUniqueLinkPickerTargetLine(
      targetContent,
      blockLink.blockId,
      { allowClosed: true },
    );
    if (!found.valid) {
      return Object.freeze({ kind: "none" });
    }

    const targetLines = targetContent.split(/\r?\n/);
    const targetContexts = getMarkdownLineContexts(targetContent);
    if (
      !isObsidianTaskAtLine(
        targetContent,
        found.line,
        targetContexts,
        targetLines,
      ) ||
      !REF_AFTER_TASK_RE.test(found.rawLine)
    ) {
      return Object.freeze({ kind: "none" });
    }
    return this.resolveReferencePdfFromTaskLine(found.rawLine, targetPath);
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

  async openReferencePdfPath(path, options = {}) {
    const normalizedPath = normalizeRefSourcePdfPath(path);
    if (!normalizedPath) {
      new Notice(`Unsafe source_pdf: ${String(path || "")}`);
      return false;
    }

    const adapter = this.app && this.app.vault && this.app.vault.adapter;
    const exists =
      options.exists ||
      (adapter && typeof adapter.exists === "function"
        ? adapter.exists.bind(adapter)
        : null);
    if (typeof exists !== "function") {
      new Notice(`Reference PDF not found: ${normalizedPath}`);
      return false;
    }
    try {
      if (!(await exists(normalizedPath))) {
        new Notice(`Reference PDF not found: ${normalizedPath}`);
        return false;
      }
    } catch (_error) {
      new Notice(`Reference PDF not found: ${normalizedPath}`);
      return false;
    }

    const basePath = Object.prototype.hasOwnProperty.call(options, "basePath")
      ? options.basePath
      : this.getVaultBasePath();
    if (!basePath) {
      new Notice("Opening PDFs needs the desktop app");
      return false;
    }
    const absolutePath = joinFilesystemPath(basePath, normalizedPath);
    const isMacOS = Object.prototype.hasOwnProperty.call(options, "isMacOS")
      ? options.isMacOS === true
      : Boolean(obsidian.Platform && obsidian.Platform.isMacOS === true);
    if (!isMacOS) {
      new Notice(`Highlights is macOS-only: ${normalizedPath}`);
      return false;
    }

    let execFile = options.execFile;
    try {
      if (typeof execFile !== "function") {
        ({ execFile } = require("child_process"));
      }
    } catch (error) {
      new Notice(
        `Could not open ${normalizedPath.split("/").at(-1)} in Highlights: ${error.message}`,
      );
      return false;
    }

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
    if (!first.error) {
      new Notice(`Opened ${normalizedPath.split("/").at(-1)} in Highlights`);
      return true;
    }
    const firstDetail = errorDetail(first.error, first.stderr);
    const second = await runAttempt(appAttempt);
    if (!second.error) {
      new Notice(`Opened ${normalizedPath.split("/").at(-1)} in Highlights`);
      return true;
    }
    const detail = firstDetail || errorDetail(second.error, second.stderr);
    new Notice(
      `Could not open ${normalizedPath.split("/").at(-1)} in Highlights: ${detail}`,
    );
    return false;
  }

  delegateOpenLinkInNewTab() {
    try {
      this.app.commands.executeCommandById(OPEN_LINK_IN_NEW_TAB_COMMAND_ID);
    } catch (_error) {
      // Obsidian versions without the built-in command have nothing to delegate.
    }
  }
}
