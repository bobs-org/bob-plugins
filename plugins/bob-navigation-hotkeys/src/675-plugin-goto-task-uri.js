// Line digests match bob-cli `line_digest` (SHA-256 of UTF-8 after Rust
// `str::trim_end()`). Vectors are mirrored from
// `bob-cli tests/fixtures/line_digest/vectors.json`. Never use
// `String.prototype.trimEnd()`: JS strips U+FEFF and keeps U+0085, which is
// the opposite of Rust.
const GO_TO_TASK_TRAILING_WS =
  /[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/u;
const GO_TO_TASK_REF_RE = /^[1-9][0-9]*:[0-9a-f]{8}$/;
const GO_TO_TASK_BLOCK_RE = /^[A-Za-z0-9-]+$/;
const GO_TO_TASK_LINE_RE = /^[1-9][0-9]*$/;

function goToTaskParamValue(params, key) {
  if (!params || typeof params !== "object") {
    return "";
  }
  const raw = params[key];
  if (raw == null) {
    return "";
  }
  if (Array.isArray(raw)) {
    return raw.length > 0 ? String(raw[0]) : "";
  }
  return String(raw);
}

function parseGoToTaskLine(raw) {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 1 ? raw : null;
  }
  const text = String(raw ?? "").trim();
  if (!GO_TO_TASK_LINE_RE.test(text)) {
    return null;
  }
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 ? value : null;
}

function parseGoToTaskParams(params) {
  if (!params || typeof params !== "object") {
    return null;
  }

  const path = goToTaskParamValue(params, "path").trim();
  const line = parseGoToTaskLine(params.line);
  if (!path || line === null) {
    return null;
  }

  const ref = goToTaskParamValue(params, "ref").trim();
  if (ref && !GO_TO_TASK_REF_RE.test(ref)) {
    return null;
  }

  const block = goToTaskParamValue(params, "block").trim();
  if (block && !GO_TO_TASK_BLOCK_RE.test(block)) {
    return null;
  }

  return Object.freeze({
    path,
    line,
    ref: ref || null,
    block: block || null,
  });
}

function vaultPathFromAbsolute(absolutePath, vaultBasePath) {
  const absolute = normalizeFilesystemPath(absolutePath);
  const base = normalizeFilesystemPath(vaultBasePath).replace(/\/+$/, "");
  if (!absolute || !base || absolute === base) {
    return null;
  }

  const prefix = `${base}/`;
  if (!absolute.startsWith(prefix)) {
    return null;
  }

  const relative = absolute.slice(prefix.length);
  return relative || null;
}

function realpathGoToTaskPath(target) {
  const fs = requireOptionalNodeModule("fs");
  if (!fs || typeof fs.realpathSync !== "function") {
    return null;
  }

  try {
    return normalizeFilesystemPath(fs.realpathSync(String(target || "")));
  } catch (error) {
    return null;
  }
}

function resolveGoToVaultRelativePath(absolutePath, vaultBasePath) {
  const mapped = vaultPathFromAbsolute(absolutePath, vaultBasePath);
  if (mapped) {
    return mapped;
  }

  const realAbsolute = realpathGoToTaskPath(absolutePath);
  const realBase = realpathGoToTaskPath(vaultBasePath);
  if (!realAbsolute || !realBase) {
    return null;
  }
  return vaultPathFromAbsolute(realAbsolute, realBase);
}

async function bobLineDigestSubtle(stripped) {
  const subtle =
    globalThis.crypto && globalThis.crypto.subtle
      ? globalThis.crypto.subtle
      : null;
  if (!subtle || typeof subtle.digest !== "function") {
    return null;
  }

  const bytes = new TextEncoder().encode(stripped);
  const buffer = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  )
    .join("")
    .slice(0, 8);
}

async function bobLineDigest(line) {
  const stripped = String(line ?? "").replace(GO_TO_TASK_TRAILING_WS, "");
  const nodeCrypto = requireOptionalNodeModule("crypto");
  if (nodeCrypto && typeof nodeCrypto.createHash === "function") {
    return nodeCrypto
      .createHash("sha256")
      .update(stripped, "utf8")
      .digest("hex")
      .slice(0, 8);
  }
  return bobLineDigestSubtle(stripped);
}

function parseGoToTaskRefDigest(ref) {
  const text = String(ref || "");
  const match = /^[1-9][0-9]*:([0-9a-f]{8})$/.exec(text);
  return match ? match[1] : null;
}

function clampGoToTaskLine(planned, lineCount) {
  if (lineCount <= 0) {
    return 0;
  }
  const raw = Number.isInteger(planned) ? planned : 0;
  return Math.min(Math.max(raw, 0), lineCount - 1);
}

async function refindGoToTaskLine(lines, options) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const info = options && typeof options === "object" ? options : {};
  const planned =
    Number.isInteger(info.line) && info.line >= 1 ? info.line - 1 : Number.NaN;
  const digest = parseGoToTaskRefDigest(info.ref);
  const block = String(info.block || "").trim();

  if (
    digest &&
    Number.isInteger(planned) &&
    planned >= 0 &&
    planned < sourceLines.length
  ) {
    const plannedDigest = await bobLineDigest(sourceLines[planned]);
    if (plannedDigest && plannedDigest === digest) {
      return Object.freeze({ line: planned, source: "planned" });
    }
  }

  if (block) {
    const blockIdLine = findTaskLineByBlockId(sourceLines, block);
    if (blockIdLine !== null) {
      return Object.freeze({ line: blockIdLine, source: "block-id" });
    }
  }

  if (digest) {
    const content = sourceLines.join("\n");
    const matches = [];
    for (let index = 0; index < sourceLines.length; index += 1) {
      if (!isObsidianTaskAtLine(content, index, null, sourceLines)) {
        continue;
      }
      const lineDigest = await bobLineDigest(sourceLines[index]);
      if (lineDigest !== digest) {
        continue;
      }
      matches.push(index);
      if (matches.length > 1) {
        break;
      }
    }
    if (matches.length === 1) {
      return Object.freeze({ line: matches[0], source: "digest" });
    }
  }

  return Object.freeze({
    line: clampGoToTaskLine(planned, sourceLines.length),
    source: "clamped",
  });
}

function resolveGoToVaultFile(plugin, vaultPath) {
  const vault = plugin && plugin.app && plugin.app.vault;
  if (!vault || !vaultPath) {
    return null;
  }

  if (typeof vault.getAbstractFileByPath === "function") {
    const file = vault.getAbstractFileByPath(vaultPath);
    if (plugin.isMarkdownFile(file)) {
      return file;
    }
  }

  if (typeof vault.getMarkdownFiles === "function") {
    const files = vault.getMarkdownFiles() || [];
    const match = files.find((file) => file && file.path === vaultPath);
    return plugin.isMarkdownFile(match) ? match : null;
  }

  return null;
}

async function readGoToNoteContent(plugin, file) {
  if (plugin && typeof plugin.getOpenMarkdownEditorForPath === "function") {
    const editor = plugin.getOpenMarkdownEditorForPath(file.path);
    if (editor && typeof editor.getValue === "function") {
      return String(editor.getValue() || "");
    }
  }

  const vault = plugin && plugin.app && plugin.app.vault;
  if (vault && typeof vault.cachedRead === "function") {
    return String((await vault.cachedRead(file)) || "");
  }

  return "";
}

class BobNavigationHotkeysGoToTaskUriMixin {
  waitForGoToTaskLayout() {
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.onLayoutReady !== "function") {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      try {
        workspace.onLayoutReady(() => resolve());
      } catch (error) {
        resolve();
      }
    });
  }

  async ensureGoToTaskEditingLeaf(file) {
    if (!file || !file.path || typeof this.findMarkdownLeafByPath !== "function") {
      return false;
    }

    const leaf = this.findMarkdownLeafByPath(file.path);
    if (!leaf || typeof leaf.setViewState !== "function") {
      return false;
    }

    const viewState = this.getLeafViewState(leaf);
    const mode =
      viewState && viewState.state && typeof viewState.state === "object"
        ? viewState.state.mode
        : null;
    if (mode !== "preview") {
      return false;
    }

    const nextState =
      typeof this.cloneViewState === "function"
        ? this.cloneViewState(viewState)
        : null;
    if (!nextState || !nextState.state || typeof nextState.state !== "object") {
      return false;
    }

    nextState.state.mode = "source";
    await leaf.setViewState(nextState);
    return true;
  }

  focusGoToTaskEditor() {
    try {
      const view = this.getActiveMarkdownView();
      if (view && view.editor && typeof view.editor.focus === "function") {
        view.editor.focus();
      }
    } catch (error) {
      // Best-effort focus after landing.
    }
  }

  captureGoToTaskJumpContext() {
    try {
      const view = this.getActiveMarkdownView();
      if (
        !view ||
        !view.file ||
        !view.editor ||
        typeof view.editor.getCursor !== "function"
      ) {
        return null;
      }
      const cursor = normalizePosition(view.editor.getCursor());
      if (!cursor) {
        return null;
      }
      return this.createVimJumpContextWithOrigin({
        path: view.file.path,
        line: cursor.line,
        ch: cursor.ch,
      });
    } catch (error) {
      return null;
    }
  }

  async handleGoToTaskUri(params) {
    try {
      await this.waitForGoToTaskLayout();
    } catch (error) {
      // Continue even if layout readiness is unavailable.
    }

    const parsed = parseGoToTaskParams(params);
    if (!parsed) {
      new Notice("Bob Go To: invalid task link");
      return false;
    }

    const vaultBasePath =
      typeof this.getVaultBasePath === "function" ? this.getVaultBasePath() : "";
    const vaultPath = resolveGoToVaultRelativePath(parsed.path, vaultBasePath);
    if (!vaultPath) {
      new Notice(`Bob Go To: ${parsed.path} is outside this vault`);
      return false;
    }

    const file = resolveGoToVaultFile(this, vaultPath);
    if (!file) {
      new Notice(`Bob Go To: ${vaultPath} not found`);
      return false;
    }

    let content = "";
    try {
      content = await readGoToNoteContent(this, file);
    } catch (error) {
      new Notice(`Bob Go To: ${vaultPath} not found`);
      return false;
    }

    const lines = String(content || "").split(/\r?\n/);
    const found = await refindGoToTaskLine(lines, {
      line: parsed.line,
      ref: parsed.ref,
      block: parsed.block,
    });
    const resolvedLine = found.line;
    const liveLineText =
      resolvedLine >= 0 && resolvedLine < lines.length
        ? String(lines[resolvedLine] ?? "")
        : "";

    if (found.source === "clamped" && parsed.ref) {
      new Notice(
        `Task changed since search — landed near line ${resolvedLine + 1}`,
      );
    }

    const destinationName =
      file.basename || getVaultPathBasenameWithoutExtension(file.path);
    return this.focusTaskAnchor(
      file,
      {
        line: resolvedLine,
        text: liveLineText,
        blockId: parsed.block,
      },
      {
        vimJumpContext: this.captureGoToTaskJumpContext(),
        failureNotice: `Bob Go To: could not open ${destinationName}`,
        ensureEditing: true,
      },
    );
  }
}
