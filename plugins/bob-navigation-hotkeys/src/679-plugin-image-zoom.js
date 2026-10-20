// Line-scoped image target resolver for Z image zoom (target phase).
// Finds embed, wikilink, and Markdown image references on the live cursor
// line, skips inline and fenced code, picks one by the containing/next/previous
// rule, and resolves it against the source note to a resource URL or notice.
const IMAGE_ZOOM_EXTENSIONS = Object.freeze(
  new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]),
);

function imageZoomExtensionOfPath(pathText) {
  const withoutQuery = String(pathText || "").split("?")[0];
  const base = withoutQuery.split("/").pop() || "";
  const dotIndex = base.lastIndexOf(".");
  if (dotIndex === -1) {
    return "";
  }
  return base.slice(dotIndex + 1).toLowerCase();
}

// Unescape CommonMark backslash escapes so `a\(1\).png` resolves to `a(1).png`.
function unescapeImageZoomDestination(value) {
  return String(value || "").replace(
    /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,
    "$1",
  );
}

class BobNavigationHotkeysImageZoomMixin {
  zoomImageOnLine(editor, view) {
    if (
      !view ||
      !view.file ||
      !editor ||
      typeof editor.getCursor !== "function" ||
      typeof editor.getLine !== "function" ||
      typeof editor.getValue !== "function"
    ) {
      return;
    }
    if (typeof view.getMode === "function" && view.getMode() !== "source") {
      new Notice("Zoom image needs the editor; in Reading view, click the image");
      return;
    }
    if (this.activeImageZoomModal && !this.activeImageZoomModal.imageZoomClosed) {
      return;
    }

    const head = editor.getCursor("head");
    if (!head || !Number.isInteger(head.line) || !Number.isFinite(head.ch)) {
      return;
    }
    const lineText = editor.getLine(head.line);
    if (typeof lineText !== "string") {
      return;
    }
    const contexts = getMarkdownLineContexts(editor.getValue());
    const target = this.resolveImageZoomTargetOnLine({
      lineText,
      ch: head.ch,
      sourcePath: view.file.path,
      inCodeFence: Boolean(contexts[head.line] && contexts[head.line].inFence),
    });
    if (target.kind === "notice") {
      new Notice(target.message);
      return;
    }

    const anchor = editor.getCursor("anchor") || head;
    const snapshot = {
      view,
      filePath: view.file.path,
      editor,
      anchor: { line: anchor.line, ch: anchor.ch },
      head: { line: head.line, ch: head.ch },
      scroll:
        typeof editor.getScrollInfo === "function"
          ? editor.getScrollInfo()
          : null,
    };
    let modal = null;
    modal = new ImageZoomModal(this.app, {
      src: target.src,
      title: target.title,
      onClosed: () => {
        if (this.activeImageZoomModal === modal) {
          this.activeImageZoomModal = null;
        }
        this.restoreImageZoomSourceEditor(snapshot);
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
  }

  restoreImageZoomSourceEditor(snapshot) {
    const defer =
      typeof window !== "undefined" && typeof window.setTimeout === "function"
        ? window.setTimeout.bind(window)
        : (callback) => callback();
    defer(() => {
      if (this.taskCardPluginUnloading || !snapshot) {
        return;
      }
      const workspace = this.app && this.app.workspace;
      const activeView =
        workspace && typeof workspace.getActiveViewOfType === "function"
          ? workspace.getActiveViewOfType(MarkdownView)
          : null;
      if (
        activeView !== snapshot.view ||
        !activeView.file ||
        activeView.file.path !== snapshot.filePath
      ) {
        return;
      }

      const editor = snapshot.editor;
      const samePosition = (left, right) =>
        Boolean(
          left &&
            right &&
            left.line === right.line &&
            left.ch === right.ch,
        );
      if (typeof editor.getCursor === "function") {
        const anchor = editor.getCursor("anchor");
        const head = editor.getCursor("head");
        if (
          (!samePosition(anchor, snapshot.anchor) ||
            !samePosition(head, snapshot.head)) &&
          typeof editor.setSelection === "function"
        ) {
          editor.setSelection(snapshot.anchor, snapshot.head);
        }
      }
      if (snapshot.scroll && typeof editor.getScrollInfo === "function") {
        const current = editor.getScrollInfo();
        if (
          current &&
          (current.left !== snapshot.scroll.left ||
            current.top !== snapshot.scroll.top) &&
          typeof editor.scrollTo === "function"
        ) {
          editor.scrollTo(snapshot.scroll.left, snapshot.scroll.top);
        }
      }
      if (typeof editor.focus === "function") {
        editor.focus();
      }
    }, 0);
  }

  findInlineCodeSpans(line) {
    const text = String(line || "");
    const runs = [];
    let index = 0;
    while (index < text.length) {
      if (text[index] !== "`") {
        index += 1;
        continue;
      }
      let end = index + 1;
      while (end < text.length && text[end] === "`") {
        end += 1;
      }
      runs.push({ start: index, end, length: end - index });
      index = end;
    }
    // A run of N backticks closes only on a run of exactly N; an unmatched
    // run is literal and later runs can still open.
    const spans = [];
    let runIndex = 0;
    while (runIndex < runs.length) {
      const open = runs[runIndex];
      let closerIndex = -1;
      for (let scan = runIndex + 1; scan < runs.length; scan += 1) {
        if (runs[scan].length === open.length) {
          closerIndex = scan;
          break;
        }
      }
      if (closerIndex === -1) {
        runIndex += 1;
        continue;
      }
      spans.push(Object.freeze([open.start, runs[closerIndex].end]));
      runIndex = closerIndex + 1;
    }
    return Object.freeze(spans);
  }

  findImageZoomRefs(line) {
    const text = String(line || "");
    const codeSpans = this.findInlineCodeSpans(text);
    const isInCode = (offset) => {
      for (const span of codeSpans) {
        if (span[0] <= offset && offset < span[1]) {
          return true;
        }
      }
      return false;
    };
    const refs = [];
    let index = 0;
    while (index < text.length) {
      const parsed = parseTransclusionToggleTargetAt(text, index);
      if (parsed) {
        // Skip code-span targets by marker only; the scan still advances.
        if (!isInCode(parsed.markerIndex)) {
          const ref = this.buildImageZoomRef(text, parsed);
          if (ref) {
            refs.push(ref);
          }
        }
        index = parsed.endIndex;
        continue;
      }
      const bracketEnd = findNonWikiBracketGroupEnd(text, index);
      if (bracketEnd !== -1) {
        index = bracketEnd + 1;
        continue;
      }
      index += 1;
    }
    return Object.freeze(refs.map((ref) => Object.freeze(ref)));
  }

  // Remove Markdown delimiters and titles without URI decoding, so an
  // http(s) destination keeps its original percent escapes for loading.
  stripImageZoomWrapping(value) {
    let target = String(value || "").trim();
    if (!target) {
      return "";
    }
    if (
      target.length >= 2 &&
      ((target[0] === '"' && target[target.length - 1] === '"') ||
        (target[0] === "'" && target[target.length - 1] === "'"))
    ) {
      target = target.slice(1, -1).trim();
    }
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1).trim();
    }
    return target;
  }

  extractRawImageZoomDestination(destination) {
    const text = String(destination || "").trim();
    if (!text) {
      return null;
    }
    if (text.startsWith("<")) {
      const endIndex = text.indexOf(">");
      if (endIndex === -1) {
        return null;
      }
      const inner = text.slice(1, endIndex).trim();
      return inner || null;
    }
    const titleMatch = text.match(/^(\S+)\s+["'(].*["')]$/);
    const token = titleMatch ? titleMatch[1] : text;
    const stripped = this.stripImageZoomWrapping(token);
    return stripped || null;
  }

  // Normalize a vault target exactly once: unescape Markdown punctuation,
  // decode percent escapes, then drop any subpath. External targets skip this.
  normalizeImageZoomVaultTarget(raw) {
    const unescaped = unescapeImageZoomDestination(raw);
    const decoded = this.safeDecodeUri(unescaped);
    const withoutMd = typeof this.stripMarkdownExtension === "function"
      ? this.stripMarkdownExtension(decoded)
      : decoded;
    return this.stripLinkSubpath(withoutMd);
  }

  safeDecodeImageZoomTitle(value) {
    try {
      return decodeURIComponent(value);
    } catch (_error) {
      return value;
    }
  }

  buildImageZoomRef(line, parsed) {
    const text = String(line || "");
    const embed = parsed.transcluded === true;
    const start = embed ? parsed.markerIndex : parsed.startIndex;
    const end = parsed.endIndex;
    if (parsed.kind === "wiki") {
      const inner = text.slice(parsed.startIndex + 2, parsed.endIndex - 2);
      const pipeIndex = inner.indexOf("|");
      const beforePipe = pipeIndex === -1 ? inner : inner.slice(0, pipeIndex);
      const raw = this.stripImageZoomWrapping(beforePipe);
      if (!raw) {
        return null;
      }
      const external = isExternalLinkTarget(raw);
      const target = external ? raw : this.normalizeImageZoomVaultTarget(raw);
      if (!target) {
        return null;
      }
      return {
        form: "wiki",
        embed,
        start,
        end,
        rawTarget: raw,
        target,
        external,
      };
    }
    if (parsed.kind === "markdown") {
      const labelEnd = findClosingMarkdownLabelBracket(text, parsed.startIndex);
      if (labelEnd === -1 || text[labelEnd + 1] !== "(") {
        return null;
      }
      const destStart = labelEnd + 2;
      const destEnd = findClosingMarkdownDestinationParen(text, destStart);
      if (destEnd === -1) {
        return null;
      }
      const raw = this.extractRawImageZoomDestination(
        text.slice(destStart, destEnd),
      );
      if (!raw) {
        return null;
      }
      const external = isExternalLinkTarget(raw);
      const target = external ? raw : this.normalizeImageZoomVaultTarget(raw);
      if (!target) {
        return null;
      }
      return {
        form: "markdown",
        embed,
        start,
        end,
        rawTarget: raw,
        target,
        external,
      };
    }
    return null;
  }

  isImageZoomCandidate(ref) {
    if (!ref || typeof ref.target !== "string" || !ref.target) {
      return false;
    }
    if (ref.external) {
      let url = null;
      try {
        url = new URL(ref.target);
      } catch (_error) {
        return false;
      }
      const protocol = String(url.protocol || "").toLowerCase();
      if (protocol !== "http:" && protocol !== "https:") {
        return false;
      }
      // Only Markdown image syntax allows an extensionless http(s) URL.
      if (ref.form === "markdown" && ref.embed) {
        return true;
      }
      return IMAGE_ZOOM_EXTENSIONS.has(
        imageZoomExtensionOfPath(url.pathname || ""),
      );
    }
    return IMAGE_ZOOM_EXTENSIONS.has(
      imageZoomExtensionOfPath(ref.target),
    );
  }

  pickImageZoomRef(candidates, ch) {
    const list = Array.isArray(candidates) ? candidates : [];
    if (list.length === 0) {
      return null;
    }
    const pos = typeof ch === "number" ? ch : Number(ch);
    if (!Number.isFinite(pos)) {
      return null;
    }
    for (const ref of list) {
      if (ref.start <= pos && pos < ref.end) {
        return ref;
      }
    }
    for (const ref of list) {
      if (ref.start >= pos) {
        return ref;
      }
    }
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (list[index].end <= pos) {
        return list[index];
      }
    }
    return null;
  }

  resolveImageZoomTargetOnLine({ lineText, ch, sourcePath, inCodeFence }) {
    if (inCodeFence) {
      return Object.freeze({
        kind: "notice",
        message: "No image on this line",
      });
    }
    const text = String(lineText || "");
    const pos = typeof ch === "number" ? ch : Number(ch);
    const refs = this.findImageZoomRefs(text);
    const candidates = refs.filter((ref) => this.isImageZoomCandidate(ref));
    const picked = this.pickImageZoomRef(candidates, pos);
    if (picked) {
      if (picked.external) {
        const src = picked.rawTarget || picked.target;
        let title = src;
        try {
          const url = new URL(src);
          const segments = String(url.pathname || "")
            .split("/")
            .filter(Boolean);
          const last = segments.length > 0 ? segments[segments.length - 1] : "";
          const decoded = last ? this.safeDecodeImageZoomTitle(last) : "";
          title = decoded || url.hostname || src;
        } catch (_error) {
          title = src;
        }
        return Object.freeze({
          kind: "image",
          source: "url",
          src,
          title,
        });
      }
      // The vault target is already normalized once in buildImageZoomRef, so
      // look it up directly instead of calling resolveLinkTargetFile again.
      const resolved =
        this.app &&
        this.app.metadataCache &&
        typeof this.app.metadataCache.getFirstLinkpathDest === "function"
          ? this.app.metadataCache.getFirstLinkpathDest(
              picked.target,
              sourcePath,
            ) || null
          : null;
      if (!resolved) {
        return Object.freeze({
          kind: "notice",
          message: `Image not found: ${picked.target}`,
        });
      }
      const resolvedExt = String(
        resolved.extension ||
          imageZoomExtensionOfPath(resolved.path || ""),
      ).toLowerCase();
      if (!IMAGE_ZOOM_EXTENSIONS.has(resolvedExt)) {
        return Object.freeze({
          kind: "notice",
          message: `Not an image: ${picked.target}`,
        });
      }
      let src = null;
      try {
        src = this.app.vault.getResourcePath(resolved);
      } catch (_error) {
        return Object.freeze({
          kind: "notice",
          message: `Image not found: ${picked.target}`,
        });
      }
      const filePath = resolved.path || "";
      const title =
        (resolved.name && String(resolved.name)) ||
        (resolved.basename && String(resolved.basename)) ||
        String(filePath.split("/").pop() || picked.target);
      return Object.freeze({
        kind: "image",
        source: "vault",
        path: filePath,
        src,
        title,
      });
    }
    for (const ref of refs) {
      if (ref.start <= pos && pos < ref.end) {
        return Object.freeze({
          kind: "notice",
          message: `Not an image: ${ref.target}`,
        });
      }
    }
    return Object.freeze({
      kind: "notice",
      message: "No image on this line",
    });
  }
}
