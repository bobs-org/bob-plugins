// Requirement-line guard (bob-cli-on.10.1.3): consult the RQ twin at every
// cycler task gesture, link target, transclusion, and status-writer site.
// Bank checks stay first wherever both apply. Guards fail open to today's
// behavior only on an internal error, never on a recognized req.

const CYCLER_REQ_LANE_COPY = "Requirements have no lane or schedule — Ctrl+Shift+T makes it a task";
const CYCLER_REQ_CARRIED_COPY = "Carried — open the linked task";
const CYCLER_REQ_DROP_PLACEHOLDER = "Why drop it? (optional)";
const CYCLER_REQ_STALE_COPY = "The line changed — try again";

function cyclerReqOwnerCopy(ownerName) {
  const owner = String(ownerName == null ? "" : ownerName).trim() || "the task";
  return `Requirements are met when “${owner}” closes — Ctrl+Enter on the task`;
}

function cyclerReqDropNotice(reqText, descendants) {
  const base = `⊘ Dropped “${String(reqText == null ? "" : reqText)}”`;
  const count = Number(descendants) || 0;
  return count > 0 ? `${base} · ${count} nested go with it` : base;
}

function cyclerReqRestoreNotice(reqText) {
  return `↺ Restored “${String(reqText == null ? "" : reqText)}”`;
}

// Forest cache per document text: reuse while editor.getValue() returns the
// same string. Prefilter cheaply so only a checkbox list item without #task
// ever builds a forest.
let cyclerReqForestCacheText = null;
let cyclerReqForestCacheForest = null;

function cyclerReqForestForGuard(text) {
  const value = String(text == null ? "" : text);
  if (cyclerReqForestCacheText === value && Array.isArray(cyclerReqForestCacheForest)) {
    return cyclerReqForestCacheForest;
  }
  let forest = null;
  try {
    forest = taskReqForest(value);
  } catch (error) {
    return null;
  }
  cyclerReqForestCacheText = value;
  cyclerReqForestCacheForest = forest;
  return forest;
}

function cyclerReqInfoForText(text, lineIndex) {
  try {
    if (!Number.isInteger(lineIndex) || lineIndex < 0) {
      return null;
    }
    const value = String(text == null ? "" : text);
    const lines = value.split("\n");
    if (lineIndex >= lines.length) {
      return null;
    }
    const lineText = lines[lineIndex];
    // Cheap prefilter: only a checkbox without the global filter can be a req.
    let mark = null;
    try {
      mark = taskReqCheckboxMarkWithoutFilter(lineText);
    } catch (error) {
      return null;
    }
    if (mark === null) {
      return null;
    }
    const forest = cyclerReqForestForGuard(value);
    if (!forest) {
      return null;
    }
    const row = forest.find((entry) => entry.lineIndex === lineIndex) || null;
    if (!row) {
      return null;
    }
    return row;
  } catch (error) {
    return null;
  }
}

function cyclerReqTargetIsReq(noteText, lineIndex) {
  try {
    return cyclerReqInfoForText(noteText, lineIndex) !== null;
  } catch (error) {
    return false;
  }
}

// Pick the contract copy for a refused gesture on a req line.
function cyclerReqRefuse(info, gesture) {
  if (!info) {
    return null;
  }
  try {
    if (info.mark === "carried" || info.markChar === ">") {
      return CYCLER_REQ_CARRIED_COPY;
    }
    const kind = String(gesture || "lane");
    if (kind === "ctrl-enter" || kind === "alt-restore" || kind === "link" || kind === "transclusion" || kind === "writer") {
      return cyclerReqOwnerCopy(info.ownerName);
    }
    return CYCLER_REQ_LANE_COPY;
  } catch (error) {
    return CYCLER_REQ_LANE_COPY;
  }
}

class TaskStatusCyclerReqGuardMixin {
  cyclerReqInfoForText(text, lineIndex) {
    return cyclerReqInfoForText(text, lineIndex);
  }

  cyclerReqInfoAtCursor(editor) {
    try {
      if (!editor || typeof editor.getCursor !== "function" || typeof editor.getLine !== "function") {
        return null;
      }
      const cursor = editor.getCursor();
      if (!cursor || !Number.isInteger(cursor.line)) {
        return null;
      }
      let value = null;
      try {
        value = typeof editor.getValue === "function" ? editor.getValue() : null;
      } catch (error) {
        value = null;
      }
      if (typeof value !== "string") {
        // Fall back to single-line prefilter when the full note is unreadable.
        let lineText = null;
        try {
          lineText = editor.getLine(cursor.line);
        } catch (error) {
          return null;
        }
        if (taskReqCheckboxMarkWithoutFilter(String(lineText || "")) === null) {
          return null;
        }
        return null;
      }
      return cyclerReqInfoForText(value, cursor.line);
    } catch (error) {
      return null;
    }
  }

  cyclerReqTargetIsReq(noteText, lineIndex) {
    return cyclerReqTargetIsReq(noteText, lineIndex);
  }

  cyclerReqRefuse(info, gesture) {
    return cyclerReqRefuse(info, gesture);
  }

  // One-line guard for command/Vim sites: when the cursor sits on a req,
  // show its contract copy (unless checking) and report handled.
  cyclerReqGuardRefuse(editor, gesture, checking) {
    let info = null;
    try {
      info = this.cyclerReqInfoAtCursor(editor);
    } catch (error) {
      return false;
    }
    if (!info) {
      return false;
    }
    if (!checking) {
      try {
        new Notice(cyclerReqRefuse(info, gesture));
      } catch (error) {
        try {
          new Notice(CYCLER_REQ_LANE_COPY);
        } catch (_ignored) {}
      }
    }
    return true;
  }

  cyclerReqGuardRefuseTarget(noteText, lineIndex, gesture, checking) {
    let info = null;
    try {
      info = cyclerReqInfoForText(noteText, lineIndex);
    } catch (error) {
      return false;
    }
    if (!info) {
      return false;
    }
    if (!checking) {
      try {
        new Notice(cyclerReqRefuse(info, gesture));
      } catch (error) {
        try {
          new Notice(CYCLER_REQ_LANE_COPY);
        } catch (_ignored) {}
      }
    }
    return true;
  }

  // Silent line-accurate backstop for status writers: true when the given
  // line index is a req in the editor's current text. No notice; callers
  // already showed the contract copy at the gesture entry.
  cyclerReqRefuseLine(editor, lineIndex) {
    try {
      if (!editor || typeof editor.getValue !== "function" || !Number.isInteger(lineIndex)) {
        return false;
      }
      return cyclerReqInfoForText(editor.getValue(), lineIndex) !== null;
    } catch (error) {
      return false;
    }
  }
}

// Requirement drop / restore through the RW twin as one undo step each.
// The modal lives here so the full completion fragments stay untouched.

class TaskStatusCyclerReqDropModal extends Modal {
  constructor(app, plugin, snapshot) {
    super(app);
    this.plugin = plugin;
    this.snapshot = snapshot;
    this.submitted = false;
    this.inputEl = null;
    this.bandHost = null;
    this.recallApi = null;
  }

  onOpen() {
    const { contentEl } = this;
    try {
      if (contentEl && typeof contentEl.empty === "function") {
        contentEl.empty();
      }
    } catch (error) {}
    const snapshot = this.snapshot || {};
    const title = String(snapshot.reqText || "Drop requirement");
    try {
      const titleEl = contentEl.createDiv({ cls: "tsc-req-drop-title" });
      titleEl.setText(`Drop “${title}”`);
    } catch (error) {}
    try {
      // bob-text: literal requirement drop reason
      this.inputEl = contentEl.createEl("input", {
        cls: "tsc-req-drop-input",
        attr: { placeholder: CYCLER_REQ_DROP_PLACEHOLDER, type: "text" },
      });
      if (this.inputEl) {
        this.inputEl.value = "";
      }
    } catch (error) {
      this.inputEl = null;
    }
    try {
      this.bandHost = contentEl.createDiv({ cls: "tsc-req-drop-recall" });
    } catch (error) {
      this.bandHost = null;
    }
    // Attach nav's Log Recall band when it exposes logRecall v >= 1.
    try {
      const holder = this.app && this.app.plugins && this.app.plugins.plugins;
      const nav = holder && holder["bob-navigation-hotkeys"];
      const api = nav && nav.api && nav.api.logRecall;
      if (api && Number(api.version) >= 1 && typeof api.attach === "function" && this.inputEl && this.bandHost) {
        this.recallApi = api;
        try {
          api.attach({ inputEl: this.inputEl, bandHost: this.bandHost, kind: "cancel", app: this.app });
        } catch (error) {
          this.recallApi = null;
        }
      }
    } catch (error) {
      this.recallApi = null;
    }
    try {
      if (this.inputEl && typeof this.inputEl.focus === "function") {
        this.inputEl.focus();
      }
    } catch (error) {}
    // Enter submits; Esc and Ctrl+[ close without writing. `q` types into
    // the reason field (decisions:q-and-ctrl-bracket-mirrors-esc).
    try {
      if (this.inputEl && typeof this.inputEl.addEventListener === "function") {
        this.inputEl.addEventListener("keydown", (event) => {
          try {
            if (!event) {
              return;
            }
            const key = String(event.key || "");
            if (key === "Enter") {
              event.preventDefault();
              this.submit();
            } else if (key === "Escape") {
              event.preventDefault();
              this.close();
            } else if (key === "[" && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
              event.preventDefault();
              this.close();
            }
          } catch (_error) {}
        });
      }
    } catch (error) {}
    try {
      if (contentEl && typeof contentEl.addEventListener === "function") {
        contentEl.addEventListener("keydown", (event) => {
          try {
            if (!event) {
              return;
            }
            const target = event.target;
            const inInput = target === this.inputEl;
            const key = String(event.key || "");
            if (key === "Escape") {
              event.preventDefault();
              this.close();
              return;
            }
            if (key === "[" && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !inInput) {
              event.preventDefault();
              this.close();
            }
          } catch (_error) {}
        });
      }
    } catch (error) {}
  }

  submit() {
    if (this.submitted) {
      return;
    }
    this.submitted = true;
    let reason = "";
    try {
      reason = String((this.inputEl && this.inputEl.value) || "");
    } catch (error) {
      reason = "";
    }
    const snapshot = this.snapshot || {};
    const plugin = this.plugin;
    this.close();
    try {
      if (plugin && typeof plugin.cyclerReqSubmitDrop === "function") {
        plugin.cyclerReqSubmitDrop(snapshot, reason);
      }
    } catch (error) {}
  }

  onClose() {
    this.inputEl = null;
    this.bandHost = null;
  }
}

class TaskStatusCyclerReqDropMixin {
  cyclerReqLocalDate() {
    try {
      if (typeof formatLocalDate === "function") {
        return formatLocalDate();
      }
    } catch (error) {}
    const now = new Date();
    const year = String(now.getFullYear()).padStart(4, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  cyclerReqApplyWholeNote(editor, updated, cursorLine, cursorCh) {
    let oldLines = null;
    try {
      oldLines = this.getEditorLineArray(editor);
    } catch (error) {
      return false;
    }
    let nextLines = null;
    try {
      nextLines = String(updated == null ? "" : updated).split("\n");
    } catch (error) {
      return false;
    }
    try {
      this.applyDocumentLineReplacement(editor, oldLines, nextLines);
    } catch (error) {
      return false;
    }
    try {
      if (editor && typeof editor.setCursor === "function" && Number.isInteger(cursorLine)) {
        const line = Math.max(0, Math.min(cursorLine, nextLines.length - 1));
        let ch = cursorCh;
        if (!Number.isInteger(ch)) {
          try {
            ch = editor.getCursor ? (editor.getCursor() || {}).ch : 0;
          } catch (_error) {
            ch = 0;
          }
        }
        const maxCh = String(nextLines[line] || "").length;
        editor.setCursor({ line, ch: Math.max(0, Math.min(Number(ch) || 0, maxCh)) });
      }
    } catch (error) {}
    return true;
  }

  // Alt+[ entry: dry-run with an empty reason, then open the reason modal.
  cyclerReqHandleDrop(checking, editor, view, info) {
    if (checking) {
      return true;
    }
    if (!editor || !info) {
      return true;
    }
    if (info.mark === "carried" || info.markChar === ">") {
      try {
        new Notice(CYCLER_REQ_CARRIED_COPY);
      } catch (error) {}
      return true;
    }
    let content = "";
    try {
      content = editor.getValue();
    } catch (error) {
      return true;
    }
    const cursor = (() => {
      try {
        return editor.getCursor();
      } catch (error) {
        return null;
      }
    })();
    const lineIndex = info.lineIndex;
    let preimage = null;
    try {
      preimage = String(content || "").split("\n")[lineIndex];
    } catch (error) {
      preimage = null;
    }
    // Dry-run refusal with an empty reason (Already dropped, Already met,
    // Its parent requirement was dropped — restore it first, …).
    try {
      const dry = taskReqDrop(content, { lineIndex, preimage }, this.cyclerReqLocalDate(), "");
      if (dry && dry.ok === false) {
        try {
          new Notice(String(dry.message || CYCLER_REQ_LANE_COPY));
        } catch (_error) {}
        return true;
      }
    } catch (error) {
      return true;
    }
    const snapshot = {
      lineIndex,
      preimage,
      reqText: info.text,
      cursorCh: cursor && Number.isInteger(cursor.ch) ? cursor.ch : 0,
    };
    try {
      const modal = new TaskStatusCyclerReqDropModal(this.app, this, snapshot);
      modal.open();
    } catch (error) {
      return true;
    }
    return true;
  }

  cyclerReqSubmitDrop(snapshot, reason) {
    try {
      const editor = (() => {
        try {
          const view = this.app && this.app.workspace && typeof this.app.workspace.getActiveViewOfType === "function"
            ? this.app.workspace.getActiveViewOfType(MarkdownView)
            : null;
          return (view && view.editor) || null;
        } catch (error) {
          return null;
        }
      })();
      if (!editor || !snapshot || !Number.isInteger(snapshot.lineIndex)) {
        return false;
      }
      let content = "";
      try {
        content = editor.getValue();
      } catch (error) {
        return false;
      }
      let result = null;
      try {
        result = taskReqDrop(content, { lineIndex: snapshot.lineIndex, preimage: snapshot.preimage }, this.cyclerReqLocalDate(), String(reason || ""));
      } catch (error) {
        return false;
      }
      if (!result || result.ok === false) {
        const message = result && result.code === "req_stale" ? CYCLER_REQ_STALE_COPY : String((result && result.message) || CYCLER_REQ_LANE_COPY);
        try {
          new Notice(message);
        } catch (error) {}
        return false;
      }
      const cursorCh = Number.isInteger(snapshot.cursorCh) ? snapshot.cursorCh : 0;
      this.cyclerReqApplyWholeNote(editor, result.updated, result.lineIndex, cursorCh);
      try {
        new Notice(cyclerReqDropNotice(snapshot.reqText, result.descendants));
      } catch (error) {}
      const clean = String(reason || "").replace(/\s+/gu, " ").trim();
      if (clean) {
        try {
          const holder = this.app && this.app.plugins && this.app.plugins.plugins;
          const nav = holder && holder["bob-navigation-hotkeys"];
          const api = nav && nav.api && nav.api.logRecall;
          if (api && typeof api.noteUsed === "function") {
            api.noteUsed("cancel", clean);
          }
        } catch (error) {}
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  // Alt+] entry: restore through the RW twin as one undo step.
  cyclerReqHandleRestore(checking, editor, view, info) {
    if (checking) {
      return true;
    }
    if (!editor || !info) {
      return true;
    }
    let content = "";
    try {
      content = editor.getValue();
    } catch (error) {
      return true;
    }
    const cursor = (() => {
      try {
        return editor.getCursor();
      } catch (error) {
        return null;
      }
    })();
    let preimage = null;
    try {
      preimage = String(content || "").split("\n")[info.lineIndex];
    } catch (error) {
      preimage = null;
    }
    let result = null;
    try {
      result = taskReqRestore(content, { lineIndex: info.lineIndex, preimage });
    } catch (error) {
      return true;
    }
    if (!result || result.ok === false) {
      try {
        new Notice(String((result && result.message) || CYCLER_REQ_LANE_COPY));
      } catch (_error) {}
      return true;
    }
    const cursorCh = cursor && Number.isInteger(cursor.ch) ? cursor.ch : 0;
    this.cyclerReqApplyWholeNote(editor, result.updated, result.lineIndex, cursorCh);
    try {
      new Notice(cyclerReqRestoreNotice(info.text));
    } catch (error) {}
    return true;
  }
}
