// Resolver for Highlights page jumps (open_at_page).
const HIGHLIGHTS_PAGE_URL_SCHEME = "hammerspoon://bob-highlights-page";
const HIGHLIGHTS_PAGE_MIN = 1;
const HIGHLIGHTS_PAGE_MAX = 999999;
const HIGHLIGHTS_STUB_MAX_HOPS = 3;
const HIGHLIGHTS_REMOVED_MESSAGE =
  "This highlight was removed in Highlights — no page to open";

function normalizeHighlightsPageOption(value) {
  const page = typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(page)) {
    return null;
  }
  if (page < HIGHLIGHTS_PAGE_MIN || page > HIGHLIGHTS_PAGE_MAX) {
    return null;
  }
  return page;
}

function buildHighlightsPageUrl(absolutePath, page) {
  const path = String(absolutePath || "");
  const validatedPage = normalizeHighlightsPageOption(page);
  if (!path || validatedPage === null) {
    return null;
  }
  return (
    `${HIGHLIGHTS_PAGE_URL_SCHEME}?path=${encodeURIComponent(path)}` +
    `&page=${validatedPage}`
  );
}

function getHighlightsRefTitle(frontmatter, notePath, pdfPath) {
  const fmTitle =
    frontmatter && typeof frontmatter.title === "string"
      ? frontmatter.title.trim()
      : "";
  if (fmTitle) {
    return fmTitle;
  }
  const noteBase =
    typeof notePath === "string" && notePath
      ? getVaultPathBasenameWithoutExtension(notePath)
      : "";
  if (noteBase && String(noteBase).trim()) {
    return String(noteBase).trim();
  }
  const pdfBase =
    typeof pdfPath === "string" && pdfPath
      ? getVaultPathBasenameWithoutExtension(pdfPath) ||
        getVaultPathBasename(pdfPath)
      : "";
  if (pdfBase && String(pdfBase).trim()) {
    return String(pdfBase).trim();
  }
  return "Untitled";
}

function freezeHighlightsTarget(target) {
  const frozen = Object.freeze({
    kind: target.kind,
    pdfPath: target.pdfPath ?? null,
    page: target.page ?? null,
    title: target.title ?? null,
    snippet: target.snippet ?? null,
    detail: target.detail ?? null,
    captionCount: target.captionCount ?? null,
    archived: target.archived
      ? Object.freeze({ replaced: target.archived.replaced ?? null })
      : null,
    blockId: target.blockId ?? null,
    via: target.via ?? "cursor",
    railLines: target.railLines
      ? Object.freeze({ from: target.railLines.from, to: target.railLines.to })
      : null,
    message: target.message ?? null,
  });
  return frozen;
}

function highlightsNoneTarget() {
  return freezeHighlightsTarget({
    kind: "none",
    pdfPath: null,
    page: null,
    title: null,
    snippet: null,
    detail: null,
    captionCount: null,
    archived: null,
    blockId: null,
    via: "cursor",
    railLines: null,
    message: null,
  });
}

function parseHighlightsStubLink(blockText) {
  const match = /\[\[([^\]#\n]*?)#\^(h-[A-Za-z0-9-]+)(?:\|[^\]\n]*)?\]\]/.exec(
    String(blockText || ""),
  );
  if (!match) {
    return null;
  }
  return Object.freeze({ target: match[1].trim(), blockId: match[2] });
}

class BobNavigationHotkeysRefPdfTargetResolverMixin {
  async resolveHighlightsTargetAtCursor(editor, file, options = {}) {
    const dry = Boolean(options && options.dry === true);
    const content = String((editor && editor.getValue && editor.getValue()) || "");
    const cursor =
      editor && typeof editor.getCursor === "function" ? editor.getCursor() : null;
    const lines = content.split(/\r?\n/);
    const lineIndex =
      cursor && Number.isInteger(cursor.line) ? cursor.line : -1;
    if (lineIndex < 0 || lineIndex >= lines.length) {
      return highlightsNoneTarget();
    }
    const filePath = normalizeVaultRelativePath(file && file.path);
    if (!filePath) {
      return highlightsNoneTarget();
    }
    const lineText = String(lines[lineIndex] || "");
    const contexts = getMarkdownLineContexts(content);

    if (
      isObsidianTaskAtLine(content, lineIndex, contexts, lines) &&
      REF_AFTER_TASK_RE.test(lineText)
    ) {
      return this._resolveHighlightsReadingTarget(
        lineText,
        filePath,
        "cursor",
        { from: lineIndex, to: lineIndex },
        dry,
      );
    }

    const bookmark = parseRefBookmarkLink(lineText);
    if (bookmark) {
      return this._resolveHighlightsBookmarkTarget(
        bookmark,
        filePath,
        "bookmark",
        { from: lineIndex, to: lineIndex },
        dry,
      );
    }

    const taskLink = parseLinkPickerTaskLink(lineText);
    const blockLink = taskLink || parseRefPdfBlockLinkLine(lineText);
    if (blockLink) {
      const via =
        taskLink && taskLink.embedded
          ? "embed"
          : /^\s*!/.test(lineText)
            ? "embed"
            : taskLink
              ? "task-link"
              : /^\s*!/.test(lineText)
                ? "embed"
                : "task-link";
      const resolved = await this._resolveHighlightsTaskLinkTarget(
        blockLink,
        filePath,
        via,
        { from: lineIndex, to: lineIndex },
        dry,
      );
      if (resolved) {
        return resolved;
      }
      return highlightsNoneTarget();
    }

    const located = locateRefAnnotation(lines, lineIndex);
    if (!located) {
      return highlightsNoneTarget();
    }
    if (located.kind === "tombstone") {
      return this._resolveHighlightsRemovedTarget(
        filePath,
        located,
        "cursor",
        { from: located.rail.from, to: located.rail.to },
        dry,
      );
    }
    if (located.kind === "stub") {
      return this._resolveHighlightsStubChain(
        filePath,
        located.blockId,
        lines.slice(located.rail.from, located.rail.to + 1).join("\n"),
        "cursor",
        { from: located.rail.from, to: located.rail.to },
        dry,
        located.blockId,
      );
    }
    if (located.kind === "caption" || located.kind === "annotation") {
      return this._resolveHighlightsBlockTarget(
        filePath,
        located,
        "cursor",
        { from: located.rail.from, to: located.rail.to },
        dry,
      );
    }
    return highlightsNoneTarget();
  }

  async _resolveHighlightsReadingTarget(lineText, sourcePath, via, rail, dry) {
    const result = this.resolveReferencePdfFromTaskLine(lineText, sourcePath);
    if (result.kind === "error") {
      const frontmatter = this._getHighlightsNoteFrontmatter(sourcePath);
      return freezeHighlightsTarget({
        kind: "error",
        pdfPath: null,
        page: null,
        title: getHighlightsRefTitle(frontmatter, sourcePath, null),
        snippet: null,
        detail: null,
        captionCount: null,
        archived: null,
        blockId: null,
        via,
        railLines: rail,
        message: result.message,
      });
    }
    const pdfPath = normalizeRefSourcePdfPath(result.path);
    if (!pdfPath) {
      const frontmatter = this._getHighlightsNoteFrontmatter(sourcePath);
      return freezeHighlightsTarget({
        kind: "error",
        pdfPath: null,
        page: null,
        title: getHighlightsRefTitle(frontmatter, sourcePath, result.path),
        snippet: null,
        detail: null,
        captionCount: null,
        archived: null,
        blockId: null,
        via,
        railLines: rail,
        message: `Unsafe source_pdf: ${String(result.path || "")}`,
      });
    }
    const refNotePath = this._findHighlightsReadingRefNote(lineText, sourcePath);
    const titleNote = refNotePath || sourcePath;
    const frontmatter = this._getHighlightsNoteFrontmatter(titleNote);
    const title = getHighlightsRefTitle(frontmatter, titleNote, pdfPath);
    if (dry && !this._highlightsPdfExistsSync(pdfPath)) {
      return freezeHighlightsTarget({
        kind: "error",
        pdfPath: null,
        page: null,
        title,
        snippet: null,
        detail: null,
        captionCount: null,
        archived: null,
        blockId: null,
        via,
        railLines: rail,
        message: `Reference PDF not found: ${pdfPath}`,
      });
    }
    return freezeHighlightsTarget({
      kind: "reading",
      pdfPath,
      page: null,
      title,
      snippet: null,
      detail: null,
      captionCount: null,
      archived: null,
      blockId: null,
      via,
      railLines: rail,
      message: null,
    });
  }

  _findHighlightsReadingRefNote(lineText, sourcePath) {
    const line = String(lineText || "");
    let index = 0;
    while (index < line.length) {
      const start = line.indexOf("[[", index);
      if (start === -1) {
        break;
      }
      const link = this.parseWikiLinkAt
        ? this.parseWikiLinkAt(line, start, { allowTransclusion: true })
        : null;
      if (!link) {
        index = start + 2;
        continue;
      }
      index = link.endIndex;
      let targetFile = null;
      try {
        targetFile = this.resolveLinkTargetFile(link.target, sourcePath);
      } catch (_error) {
        targetFile = null;
      }
      if (!targetFile) {
        continue;
      }
      const targetPath = normalizeVaultRelativePath(targetFile.path);
      if (!targetPath) {
        continue;
      }
      if (
        targetFile.extension === "pdf" ||
        targetPath.toLowerCase().endsWith(".pdf")
      ) {
        continue;
      }
      if (!this.isMarkdownFile(targetFile)) {
        continue;
      }
      let frontmatter = null;
      try {
        frontmatter =
          this.app &&
          this.app.metadataCache &&
          this.app.metadataCache.getFileCache(targetFile)?.frontmatter;
      } catch (_error) {
        frontmatter = null;
      }
      if (isManagedRefNote(targetPath, frontmatter)) {
        return targetPath;
      }
    }
    const sourceNormalized = normalizeVaultRelativePath(sourcePath);
    const ownFrontmatter = this._getHighlightsNoteFrontmatter(sourceNormalized);
    if (isManagedRefNote(sourceNormalized, ownFrontmatter)) {
      return sourceNormalized;
    }
    return null;
  }

  async _resolveHighlightsTaskLinkTarget(blockLink, sourcePath, via, rail, dry) {
    const linkTarget = `${blockLink.target || ""}#^${blockLink.blockId}`;
    let targetFile = null;
    try {
      targetFile = this.resolveLinkTargetFile(linkTarget, sourcePath);
    } catch (_error) {
      targetFile = null;
    }
    if (!targetFile || !this.isMarkdownFile(targetFile)) {
      return null;
    }
    const targetPath = normalizeVaultRelativePath(targetFile.path);
    if (!targetPath) {
      return null;
    }
    let targetContent = null;
    try {
      targetContent = await this.readLinkPickerNoteContent(targetPath, targetFile);
    } catch (_error) {
      targetContent = null;
    }
    if (targetContent === null) {
      return null;
    }
    const found = findUniqueLinkPickerTargetLine(targetContent, blockLink.blockId, {
      allowClosed: true,
    });
    if (!found.valid) {
      return null;
    }
    const targetLines = targetContent.split(/\r?\n/);
    const targetContexts = getMarkdownLineContexts(targetContent);
    if (
      isObsidianTaskAtLine(targetContent, found.line, targetContexts, targetLines) &&
      REF_AFTER_TASK_RE.test(found.rawLine)
    ) {
      return this._resolveHighlightsReadingTarget(
        found.rawLine,
        targetPath,
        via,
        rail,
        dry,
      );
    }
    const bookmark = parseRefBookmarkLink(found.rawLine);
    if (bookmark) {
      return this._resolveHighlightsBookmarkTarget(bookmark, targetPath, via, rail, dry);
    }
    return null;
  }

  async _resolveHighlightsBookmarkTarget(bookmark, sourcePath, via, rail, dry) {
    const requestedId = bookmark.blockId;
    let notePath = sourcePath;
    if (bookmark.target) {
      let targetFile = null;
      try {
        targetFile = this.resolveLinkTargetFile(bookmark.target, sourcePath);
      } catch (_error) {
        targetFile = null;
      }
      if (!targetFile || !this.isMarkdownFile(targetFile)) {
        return this._resolveHighlightsUniqueFallback(
          requestedId,
          sourcePath,
          via,
          rail,
          dry,
        );
      }
      notePath = normalizeVaultRelativePath(targetFile.path);
      if (!notePath) {
        return this._resolveHighlightsUniqueFallback(
          requestedId,
          sourcePath,
          via,
          rail,
          dry,
        );
      }
    }
    let noteContent = null;
    try {
      const noteFile =
        this.app &&
        this.app.vault &&
        typeof this.app.vault.getAbstractFileByPath === "function"
          ? this.app.vault.getAbstractFileByPath(notePath)
          : null;
      noteContent = await this.readLinkPickerNoteContent(notePath, noteFile);
    } catch (_error) {
      noteContent = null;
    }
    if (noteContent === null) {
      return this._resolveHighlightsUniqueFallback(
        requestedId,
        sourcePath,
        via,
        rail,
        dry,
      );
    }
    const noteLines = noteContent.split(/\r?\n/);
    const idLine = findRefAnnotationBlockLine(noteLines, requestedId);
    if (idLine === -1) {
      return this._resolveHighlightsUniqueFallback(
        requestedId,
        sourcePath,
        via,
        rail,
        dry,
      );
    }
    const located = locateRefAnnotation(noteLines, idLine);
    if (!located) {
      return freezeHighlightsTarget({
        kind: "missing-highlight",
        pdfPath: null,
        page: null,
        title: getHighlightsRefTitle(
          this._getHighlightsNoteFrontmatter(notePath),
          notePath,
          null,
        ),
        snippet: null,
        detail: null,
        captionCount: null,
        archived: null,
        blockId: requestedId,
        via,
        railLines: rail,
        message: `Can't find highlight ${requestedId}`,
      });
    }
    if (located.kind === "tombstone") {
      return this._resolveHighlightsRemovedTarget(
        notePath,
        located,
        via,
        rail,
        dry,
      );
    }
    if (located.kind === "stub") {
      const blockText = noteLines
        .slice(located.rail.from, located.rail.to + 1)
        .join("\n");
      return this._resolveHighlightsStubChain(
        notePath,
        located.blockId,
        blockText,
        via,
        rail,
        dry,
        requestedId,
      );
    }
    return this._resolveHighlightsBlockTarget(notePath, located, via, rail, dry);
  }

  _highlightsMissingTarget(requestedId, sourcePath, via, rail) {
    const frontmatter = this._getHighlightsNoteFrontmatter(sourcePath);
    return freezeHighlightsTarget({
      kind: "missing-highlight",
      pdfPath: null,
      page: null,
      title: getHighlightsRefTitle(frontmatter, sourcePath, null),
      snippet: null,
      detail: null,
      captionCount: null,
      archived: null,
      blockId: requestedId,
      via,
      railLines: rail,
      message: `Can't find highlight ${requestedId}`,
    });
  }

  async _resolveHighlightsUniqueFallback(requestedId, sourcePath, via, rail, dry) {
    const miss = () =>
      this._highlightsMissingTarget(requestedId, sourcePath, via, rail);
    const matches = this._findUniqueHighlightsBlock(requestedId);
    if (matches.length !== 1) {
      return miss();
    }
    const notePath = normalizeVaultRelativePath(matches[0].path);
    let noteContent = null;
    try {
      noteContent = await this.readLinkPickerNoteContent(notePath, matches[0]);
    } catch (_error) {
      noteContent = null;
    }
    if (noteContent === null) {
      return miss();
    }
    const noteLines = noteContent.split(/\r?\n/);
    const idLine = findRefAnnotationBlockLine(noteLines, requestedId);
    if (idLine === -1) {
      return miss();
    }
    const located = locateRefAnnotation(noteLines, idLine);
    if (!located) {
      return miss();
    }
    if (located.kind === "tombstone") {
      return this._resolveHighlightsRemovedTarget(notePath, located, via, rail, dry);
    }
    if (located.kind === "stub") {
      const blockText = noteLines
        .slice(located.rail.from, located.rail.to + 1)
        .join("\n");
      return this._resolveHighlightsStubChain(
        notePath,
        located.blockId,
        blockText,
        via,
        rail,
        dry,
        requestedId,
      );
    }
    return this._resolveHighlightsBlockTarget(notePath, located, via, rail, dry);
  }

  async _resolveHighlightsStubChain(
    notePath,
    blockId,
    blockText,
    via,
    rail,
    dry,
    requestedId,
  ) {
    const visited = new Set();
    let currentPath = notePath;
    let currentId = blockId;
    let currentText = blockText;
    const originId = requestedId || blockId;
    for (let hop = 0; hop < HIGHLIGHTS_STUB_MAX_HOPS; hop += 1) {
      const key = `${currentPath}#${currentId}`;
      if (visited.has(key)) {
        return this._highlightsCantFollowTarget(
          currentPath,
          originId,
          via,
          rail,
        );
      }
      visited.add(key);
      const parsed = parseHighlightsStubLink(currentText);
      const nextTarget = parsed && parsed.target ? parsed.target : "";
      const nextId = parsed ? parsed.blockId : null;
      if (!nextId) {
        return this._highlightsCantFollowTarget(currentPath, originId, via, rail);
      }
      let nextPath = currentPath;
      if (nextTarget) {
        let targetFile = null;
        try {
          targetFile = this.resolveLinkTargetFile(nextTarget, currentPath);
        } catch (_error) {
          targetFile = null;
        }
        if (!targetFile || !this.isMarkdownFile(targetFile)) {
          return this._highlightsCantFollowTarget(currentPath, originId, via, rail);
        }
        nextPath = normalizeVaultRelativePath(targetFile.path);
        if (!nextPath) {
          return this._highlightsCantFollowTarget(currentPath, originId, via, rail);
        }
      }
      let nextContent = null;
      try {
        const nextFile =
          this.app &&
          this.app.vault &&
          typeof this.app.vault.getAbstractFileByPath === "function"
            ? this.app.vault.getAbstractFileByPath(nextPath)
            : null;
        nextContent = await this.readLinkPickerNoteContent(nextPath, nextFile);
      } catch (_error) {
        nextContent = null;
      }
      if (nextContent === null) {
        return this._highlightsCantFollowTarget(currentPath, originId, via, rail);
      }
      const nextLines = nextContent.split(/\r?\n/);
      const nextLine = findRefAnnotationBlockLine(nextLines, nextId);
      if (nextLine === -1) {
        return this._highlightsCantFollowTarget(currentPath, originId, via, rail);
      }
      const located = locateRefAnnotation(nextLines, nextLine);
      if (!located) {
        return this._highlightsCantFollowTarget(currentPath, originId, via, rail);
      }
      if (located.kind === "tombstone") {
        return this._resolveHighlightsRemovedTarget(nextPath, located, via, rail, dry);
      }
      if (located.kind === "stub") {
        currentPath = nextPath;
        currentId = located.blockId;
        currentText = nextLines
          .slice(located.rail.from, located.rail.to + 1)
          .join("\n");
        continue;
      }
      if (located.kind === "caption" || located.kind === "annotation") {
        return this._resolveHighlightsBlockTarget(nextPath, located, via, rail, dry);
      }
      return this._highlightsCantFollowTarget(currentPath, originId, via, rail);
    }
    return this._highlightsCantFollowTarget(currentPath, originId, via, rail);
  }

  _highlightsCantFollowTarget(notePath, blockId, via, rail) {
    const frontmatter = this._getHighlightsNoteFrontmatter(notePath);
    return freezeHighlightsTarget({
      kind: "missing-highlight",
      pdfPath: null,
      page: null,
      title: getHighlightsRefTitle(frontmatter, notePath, null),
      snippet: null,
      detail: null,
      captionCount: null,
      archived: null,
      blockId,
      via,
      railLines: rail,
      message: `Can't follow highlight ${blockId}`,
    });
  }

  _resolveHighlightsRemovedTarget(notePath, located, via, rail, dry) {
    const frontmatter = this._getHighlightsNoteFrontmatter(notePath);
    const archived = this._highlightsArchivedForNote(notePath, frontmatter);
    void dry;
    return freezeHighlightsTarget({
      kind: "removed",
      pdfPath: null,
      page: null,
      title: getHighlightsRefTitle(frontmatter, notePath, null),
      snippet: null,
      detail: null,
      captionCount: null,
      archived,
      blockId: located.blockId,
      via,
      railLines: rail,
      message: HIGHLIGHTS_REMOVED_MESSAGE,
    });
  }

  _resolveHighlightsBlockTarget(notePath, located, via, rail, dry) {
    const frontmatter = this._getHighlightsNoteFrontmatter(notePath);
    if (notePath.startsWith("ref_history/")) {
      const raw =
        frontmatter && typeof frontmatter.annotated_pdf === "string"
          ? frontmatter.annotated_pdf
          : null;
      const linkpath = raw ? parseRefArchivePdfLink(raw) : null;
      if (!linkpath) {
        return freezeHighlightsTarget({
          kind: "error",
          pdfPath: null,
          page: null,
          title: getHighlightsRefTitle(frontmatter, notePath, null),
          snippet: null,
          detail: null,
          captionCount: null,
          archived: null,
          blockId: located.blockId || null,
          via,
          railLines: rail,
          message: `${notePath} has no annotated_pdf`,
        });
      }
      let dest = null;
      try {
        const cache = this.app && this.app.metadataCache;
        if (cache && typeof cache.getFirstLinkpathDest === "function") {
          dest = cache.getFirstLinkpathDest(linkpath, notePath);
        }
      } catch (_error) {
        dest = null;
      }
      const candidate = dest
        ? normalizeVaultRelativePath(dest.path)
        : normalizeVaultRelativePath(linkpath);
      const pdfPath = candidate ? normalizeRefSourcePdfPath(candidate) : null;
      if (!pdfPath) {
        return freezeHighlightsTarget({
          kind: "error",
          pdfPath: null,
          page: null,
          title: getHighlightsRefTitle(frontmatter, notePath, candidate),
          snippet: null,
          detail: null,
          captionCount: null,
          archived: null,
          blockId: located.blockId || null,
          via,
          railLines: rail,
          message: `Unsafe source_pdf: ${String(candidate || linkpath || "")}`,
        });
      }
      const archived = this._highlightsArchivedForNote(notePath, frontmatter);
      const title = getHighlightsRefTitle(frontmatter, notePath, pdfPath);
      if (dry && !this._highlightsPdfExistsSync(pdfPath)) {
        return freezeHighlightsTarget({
          kind: "error",
          pdfPath: null,
          page: null,
          title,
          snippet: null,
          detail: null,
          captionCount: null,
          archived: null,
          blockId: located.blockId || null,
          via,
          railLines: rail,
          message: `Reference PDF not found: ${pdfPath}`,
        });
      }
      return this._freezeHighlightsPageTarget(
        located,
        pdfPath,
        title,
        archived,
        via,
        rail,
      );
    }
    if (notePath.startsWith("ref/")) {
      const sourcePdf =
        frontmatter && typeof frontmatter.source_pdf === "string"
          ? frontmatter.source_pdf
          : null;
      if (!sourcePdf || !sourcePdf.trim()) {
        return freezeHighlightsTarget({
          kind: "error",
          pdfPath: null,
          page: null,
          title: getHighlightsRefTitle(frontmatter, notePath, null),
          snippet: null,
          detail: null,
          captionCount: null,
          archived: null,
          blockId: located.blockId || null,
          via,
          railLines: rail,
          message: `${notePath} has no source_pdf (legacy reference)`,
        });
      }
      const pdfPath = normalizeRefSourcePdfPath(sourcePdf);
      if (!pdfPath) {
        return freezeHighlightsTarget({
          kind: "error",
          pdfPath: null,
          page: null,
          title: getHighlightsRefTitle(frontmatter, notePath, sourcePdf),
          snippet: null,
          detail: null,
          captionCount: null,
          archived: null,
          blockId: located.blockId || null,
          via,
          railLines: rail,
          message: `Unsafe source_pdf: ${String(sourcePdf || "")}`,
        });
      }
      const title = getHighlightsRefTitle(frontmatter, notePath, pdfPath);
      if (dry && !this._highlightsPdfExistsSync(pdfPath)) {
        return freezeHighlightsTarget({
          kind: "error",
          pdfPath: null,
          page: null,
          title,
          snippet: null,
          detail: null,
          captionCount: null,
          archived: null,
          blockId: located.blockId || null,
          via,
          railLines: rail,
          message: `Reference PDF not found: ${pdfPath}`,
        });
      }
      return this._freezeHighlightsPageTarget(
        located,
        pdfPath,
        title,
        null,
        via,
        rail,
      );
    }
    return freezeHighlightsTarget({
      kind: "error",
      pdfPath: null,
      page: null,
      title: getHighlightsRefTitle(frontmatter, notePath, null),
      snippet: null,
      detail: null,
      captionCount: null,
      archived: null,
      blockId: located.blockId || null,
      via,
      railLines: rail,
      message: `${notePath} is not a reference note`,
    });
  }

  _freezeHighlightsPageTarget(located, pdfPath, title, archived, via, rail) {
    if (located.kind === "caption") {
      return freezeHighlightsTarget({
        kind: "page",
        pdfPath,
        page: located.page,
        title,
        snippet: null,
        detail: "caption",
        captionCount: located.count,
        archived,
        blockId: null,
        via,
        railLines: rail,
        message: null,
      });
    }
    let detail = null;
    if (located.annotationKind === "quote") {
      detail = "quote";
    } else if (located.annotationKind === "note") {
      detail = "note";
    } else if (located.annotationKind === "image") {
      detail = "image";
    }
    return freezeHighlightsTarget({
      kind: "page",
      pdfPath,
      page: located.page,
      title,
      snippet: located.snippet,
      detail,
      captionCount: null,
      archived,
      blockId: located.blockId,
      via,
      railLines: rail,
      message: null,
    });
  }

  _highlightsArchivedForNote(notePath, frontmatter) {
    if (!notePath.startsWith("ref_history/")) {
      return null;
    }
    const replaced =
      frontmatter && typeof frontmatter.replaced === "string"
        ? frontmatter.replaced.trim()
        : null;
    return { replaced: replaced || null };
  }

  _getHighlightsNoteFrontmatter(notePath) {
    try {
      const normalized = normalizeVaultRelativePath(notePath);
      if (!normalized) {
        return null;
      }
      const vault = this.app && this.app.vault;
      const file =
        vault && typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(normalized)
          : null;
      if (!file) {
        return null;
      }
      const cache =
        this.app &&
        this.app.metadataCache &&
        typeof this.app.metadataCache.getFileCache === "function"
          ? this.app.metadataCache.getFileCache(file)
          : null;
      return (cache && cache.frontmatter) || null;
    } catch (_error) {
      return null;
    }
  }

  _highlightsPdfExistsSync(pdfPath) {
    try {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getAbstractFileByPath !== "function") {
        return true;
      }
      return Boolean(vault.getAbstractFileByPath(pdfPath));
    } catch (_error) {
      return true;
    }
  }

  _findUniqueHighlightsBlock(blockId) {
    try {
      const vault = this.app && this.app.vault;
      const cache = this.app && this.app.metadataCache;
      if (
        !vault ||
        typeof vault.getMarkdownFiles !== "function" ||
        !cache ||
        typeof cache.getFileCache !== "function"
      ) {
        return [];
      }
      const files = vault.getMarkdownFiles() || [];
      const matches = [];
      for (const file of files) {
        if (!file || typeof file.path !== "string") {
          continue;
        }
        const normalized = normalizeVaultRelativePath(file.path);
        if (!normalized) {
          continue;
        }
        if (
          !normalized.startsWith("ref/") &&
          !normalized.startsWith("ref_history/")
        ) {
          continue;
        }
        if (!normalized.toLowerCase().endsWith(".md")) {
          continue;
        }
        let entry = null;
        try {
          entry = cache.getFileCache(file);
        } catch (_error) {
          entry = null;
        }
        const blocks = entry && entry.blocks;
        if (
          blocks &&
          Object.prototype.hasOwnProperty.call(blocks, blockId)
        ) {
          matches.push(file);
          if (matches.length > 1) {
            break;
          }
        }
      }
      return matches;
    } catch (_error) {
      return [];
    }
  }
}
