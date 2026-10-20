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

class BobNavigationHotkeysImageZoomMixin {
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

  buildImageZoomRef(line, parsed) {
    const text = String(line || "");
    const embed = parsed.transcluded === true;
    const start = embed ? parsed.markerIndex : parsed.startIndex;
    const end = parsed.endIndex;
    if (parsed.kind === "wiki") {
      const inner = text.slice(parsed.startIndex + 2, parsed.endIndex - 2);
      const pipeIndex = inner.indexOf("|");
      const beforePipe = pipeIndex === -1 ? inner : inner.slice(0, pipeIndex);
      const normalized = this.normalizeLinkTarget(beforePipe);
      if (!normalized) {
        return null;
      }
      const external = isExternalLinkTarget(normalized);
      const target = external
        ? normalized
        : this.stripLinkSubpath(normalized);
      return {
        form: "wiki",
        embed,
        start,
        end,
        rawTarget: normalized,
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
      const decoded = this.extractMarkdownDestination(
        text.slice(destStart, destEnd),
      );
      if (!decoded) {
        return null;
      }
      const external = isExternalLinkTarget(decoded);
      const target = external ? decoded : this.stripLinkSubpath(decoded);
      return {
        form: "markdown",
        embed,
        start,
        end,
        rawTarget: decoded,
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
      // An http(s) embed is an image even when the pathname has no extension.
      if (ref.embed) {
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
        let title = picked.target;
        try {
          const url = new URL(picked.target);
          const segments = String(url.pathname || "")
            .split("/")
            .filter(Boolean);
          const last = segments.length > 0 ? segments[segments.length - 1] : "";
          const decoded = last ? this.safeDecodeUri(last) : "";
          title = decoded || url.hostname || picked.target;
        } catch (_error) {
          title = picked.target;
        }
        return Object.freeze({
          kind: "image",
          source: "url",
          src: picked.target,
          title,
        });
      }
      const resolved = this.resolveLinkTargetFile(picked.target, sourcePath);
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
