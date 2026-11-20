// Additive nav `api.landOnTask` (root api stays v3). Re-finds a task by
// identity, focuses it, records a Vim jump, and flashes the line. Never
// clamps onto a nearby line, never stamps, and never touches the `]s` walk.
function successorJumpQuote(text) {
  const value = String(text === null || text === undefined ? "" : text).trim();
  return `“${value}”`;
}

function formatSuccessorJumpReceipt(label) {
  const value = String(label === null || label === undefined ? "" : label).trim();
  if (!value) {
    return "";
  }
  return `↗ ${successorJumpQuote(value)}`;
}

function formatSuccessorJumpLostNotice(label) {
  const value =
    String(label === null || label === undefined ? "" : label).trim() || "task";
  return `Couldn't find ${successorJumpQuote(value)} to jump to — your changes are saved`;
}

function taskLandingTargetLabel(target) {
  const info = target && typeof target === "object" ? target : {};
  if (typeof info.label === "string" && info.label.trim()) {
    return info.label.trim();
  }
  if (typeof info.description === "string" && info.description.trim()) {
    return info.description.trim();
  }
  if (typeof info.text === "string" && info.text.trim()) {
    try {
      const cleaned = cleanTaskDisplayText(info.text);
      if (cleaned && cleaned !== "(untitled task)") {
        return cleaned;
      }
    } catch (_error) {
      // Fall through to the raw text.
    }
    return info.text.trim();
  }
  return "";
}

function resolveTaskLandingLine(content, target) {
  const info = target && typeof target === "object" ? target : {};
  const text = String(content || "");
  const { lines } = splitMarkdownContent(text);
  let contexts = [];
  try {
    contexts = getMarkdownLineContexts(text);
  } catch (_error) {
    contexts = [];
  }
  const wantedText = typeof info.text === "string" ? info.text : "";
  const rawLine = info.line;
  const blockId = info.blockId || info.block_id || null;

  if (wantedText && Number.isInteger(rawLine)) {
    if (rawLine >= 0 && rawLine < lines.length && lines[rawLine] === wantedText) {
      return Object.freeze({ ok: true, line: rawLine, source: "planned" });
    }
    if (
      rawLine >= 1 &&
      rawLine <= lines.length &&
      lines[rawLine - 1] === wantedText
    ) {
      return Object.freeze({ ok: true, line: rawLine - 1, source: "planned" });
    }
  }

  if (blockId) {
    try {
      const blockIdLine = findTaskLineByBlockId(lines, blockId);
      if (blockIdLine !== null) {
        return Object.freeze({ ok: true, line: blockIdLine, source: "block-id" });
      }
    } catch (_error) {
      // Fall through to text identity.
    }
  }

  if (wantedText) {
    const hits = [];
    for (let index = 0; index < lines.length; index += 1) {
      const context = contexts[index];
      if (context && (context.inFrontmatter || context.inFence)) {
        continue;
      }
      if (lines[index] === wantedText) {
        hits.push(index);
      }
    }
    if (hits.length === 1) {
      return Object.freeze({ ok: true, line: hits[0], source: "text" });
    }
  }

  let needle = "";
  if (typeof info.description === "string" && info.description.trim()) {
    needle = info.description.trim();
  } else if (wantedText) {
    try {
      needle = cleanTaskDisplayText(wantedText);
    } catch (_error) {
      needle = "";
    }
  }
  if (needle) {
    const hits = [];
    for (let index = 0; index < lines.length; index += 1) {
      const context = contexts[index];
      if (context && (context.inFrontmatter || context.inFence)) {
        continue;
      }
      let isTask = false;
      try {
        isTask = isObsidianTaskAtLine(text, index, contexts, lines);
      } catch (_error) {
        isTask = false;
      }
      if (!isTask) {
        continue;
      }
      let cleaned = "";
      try {
        cleaned = cleanTaskDisplayText(lines[index]);
      } catch (_error) {
        cleaned = "";
      }
      if (cleaned === needle) {
        hits.push(index);
      }
    }
    if (hits.length === 1) {
      return Object.freeze({ ok: true, line: hits[0], source: "description" });
    }
  }

  return Object.freeze({ ok: false, reason: "lost", source: "lost" });
}

function resolveTaskLandingFile(plugin, target) {
  const info = target && typeof target === "object" ? target : {};
  const raw =
    typeof info.path === "string" && info.path
      ? info.path
      : typeof info.relative_path === "string"
        ? info.relative_path
        : "";
  if (!raw) {
    return null;
  }
  try {
    const vault = plugin && plugin.app ? plugin.app.vault : null;
    if (!vault || typeof vault.getAbstractFileByPath !== "function") {
      return null;
    }
    let file = vault.getAbstractFileByPath(raw);
    if (file) {
      return file;
    }
    if (raw.startsWith("/")) {
      const vaultBase =
        plugin && typeof plugin.getVaultBasePath === "function"
          ? plugin.getVaultBasePath()
          : "";
      const relative =
        typeof resolveGoToVaultRelativePath === "function"
          ? resolveGoToVaultRelativePath(raw, vaultBase)
          : null;
      if (relative) {
        file = vault.getAbstractFileByPath(relative);
      }
    }
    return file || null;
  } catch (_error) {
    return null;
  }
}

async function readTaskLandingContent(plugin, file) {
  try {
    const view =
      plugin && typeof plugin.getActiveMarkdownView === "function"
        ? plugin.getActiveMarkdownView()
        : null;
    if (
      view &&
      view.file &&
      file &&
      view.file.path === file.path &&
      view.editor &&
      typeof view.editor.getValue === "function"
    ) {
      return String(view.editor.getValue() || "");
    }
  } catch (_error) {
    // Fall through to vault reads.
  }
  try {
    if (plugin && typeof plugin.readLinkPickerNoteContent === "function") {
      const content = await plugin.readLinkPickerNoteContent(file.path, file);
      if (typeof content === "string") {
        return content;
      }
    }
  } catch (_error) {
    // Fall through to cachedRead.
  }
  try {
    const vault = plugin && plugin.app ? plugin.app.vault : null;
    if (vault && typeof vault.cachedRead === "function") {
      return String((await vault.cachedRead(file)) || "");
    }
  } catch (_error) {
    return null;
  }
  return null;
}

const createDependencyNavApiBeforeLanding = createDependencyNavApi;
createDependencyNavApi = function createDependencyNavApiWithLanding(plugin) {
  const api = createDependencyNavApiBeforeLanding(plugin);
  const shape = (result) =>
    result && typeof result === "object" && "ok" in result
      ? result
      : { ok: false, reason: "unexpected-result" };
  const settle = (call) => {
    try {
      return Promise.resolve()
        .then(call)
        .then(shape, () => ({ ok: false, reason: "api-failed" }));
    } catch (_error) {
      return Promise.resolve({ ok: false, reason: "api-failed" });
    }
  };
  return Object.freeze({
    ...api,
    landOnTask(target, options) {
      if (!plugin || typeof plugin.landOnTask !== "function") {
        return Promise.resolve({ ok: false, reason: "unavailable" });
      }
      return settle(() => plugin.landOnTask(target, options));
    },
  });
};

class BobNavigationHotkeysTaskLandingMixin {
  async landOnTask(target, options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const silent = opts.silent === true;
    const label = taskLandingTargetLabel(target);
    const lost = async (reason) => {
      if (!silent) {
        try {
          new Notice(formatSuccessorJumpLostNotice(label));
        } catch (_error) {
          // Best effort: Obsidian is tearing down.
        }
      }
      return Object.freeze({ ok: false, reason: reason || "lost" });
    };
    try {
      const file = resolveTaskLandingFile(this, target);
      if (!file || (typeof this.isMarkdownFile === "function" && !this.isMarkdownFile(file))) {
        return lost("lost");
      }
      const content = await readTaskLandingContent(this, file);
      if (typeof content !== "string") {
        return lost("lost");
      }
      const resolved = resolveTaskLandingLine(content, target);
      if (!resolved || resolved.ok !== true || !Number.isInteger(resolved.line)) {
        return lost("lost");
      }
      const { lines } = splitMarkdownContent(content);
      const lineText = String(lines[resolved.line] ?? "");
      const info = target && typeof target === "object" ? target : {};
      const jumpContext =
        opts.vimJumpContext ||
        (typeof this.captureGoToTaskJumpContext === "function"
          ? this.captureGoToTaskJumpContext()
          : null);
      const focused = await this.focusTaskAnchor(
        file,
        {
          line: resolved.line,
          text: lineText,
          blockId: info.blockId || info.block_id || null,
          resolve: (text) => resolveTaskLandingLine(text, target),
        },
        {
          vimJumpContext: jumpContext,
          ensureEditing: true,
        },
      );
      if (!focused) {
        return lost("lost");
      }
      try {
        const view =
          typeof this.getActiveMarkdownView === "function"
            ? this.getActiveMarkdownView()
            : null;
        if (
          view &&
          view.file &&
          view.file.path === file.path &&
          view.editor &&
          typeof this.flashBobOpenNotesLandingLine === "function"
        ) {
          this.flashBobOpenNotesLandingLine(view.editor, resolved.line);
        }
      } catch (_error) {
        // The flash is best-effort after a successful focus.
      }
      return Object.freeze({ ok: true, line: resolved.line });
    } catch (_error) {
      return lost("lost");
    }
  }
}
