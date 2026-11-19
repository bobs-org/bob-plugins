// Cursor command, public copy/flash path, and source-range flashes.
// All public methods are frozen and never throw or reject.
const copyChipWidgetPositions = new WeakMap();

function copyChipNoteWidgetPosition(el, from, to) {
  try {
    if (el) copyChipWidgetPositions.set(el, { from: Number(from), to: Number(to) });
  } catch (error) {
    // Position bookkeeping is best-effort.
  }
}

function copyChipWidgetPositionOf(el) {
  try {
    return copyChipWidgetPositions.get(el) || null;
  } catch (error) {
    return null;
  }
}

function copyChipDocOffsetForLine(lines, line, ch) {
  try {
    let offset = 0;
    for (let index = 0; index < line; index += 1) {
      offset += String(lines[index] || "").length + 1;
    }
    return offset + Number(ch || 0);
  } catch (error) {
    return 0;
  }
}

function copyChipReadEditorLines(editor, view) {
  try {
    if (editor && typeof editor.getValue === "function") {
      return String(editor.getValue()).split("\n");
    }
    if (view && view.state && view.state.doc && typeof view.state.doc.toString === "function") {
      return String(view.state.doc.toString()).split("\n");
    }
    if (editor && typeof editor.getLine === "function" && Number.isInteger(editor.lineCount)) {
      const count = typeof editor.lineCount === "function" ? editor.lineCount() : editor.lineCount;
      const lines = [];
      for (let index = 0; index < count; index += 1) {
        try {
          lines.push(String(editor.getLine(index)));
        } catch (error) {
          lines.push("");
        }
      }
      return lines;
    }
  } catch (error) {
    // Buffer reading is best-effort.
  }
  return null;
}

function copyChipReadEditorCursor(editor, view) {
  try {
    if (editor && typeof editor.getCursor === "function") {
      const cursor = editor.getCursor();
      if (cursor && typeof cursor === "object") {
        return { line: Math.floor(cursor.line), ch: Math.floor(cursor.ch) };
      }
    }
    if (view && view.state && view.state.selection && view.state.selection.main) {
      const head = view.state.selection.main.head;
      if (Number.isFinite(head) && view.state.doc && typeof view.state.doc.lineAt === "function") {
        try {
          const line = view.state.doc.lineAt(head);
          const lineNo = typeof line.number === "number" ? line.number - 1 : 0;
          return { line: lineNo, ch: head - line.from };
        } catch (error) {
          // Cursor mapping is best-effort.
        }
      }
    }
  } catch (error) {
    // Cursor reading is best-effort.
  }
  return null;
}

function copyChipFindWidgetInView(view, chip) {
  try {
    if (!view || !view.dom || typeof view.dom.querySelectorAll !== "function") return null;
    if (!chip || typeof chip.text !== "string") return null;
    let list = null;
    try {
      list = view.dom.querySelectorAll(".bob-copy-chip");
    } catch (error) {
      return null;
    }
    if (!list || typeof list.length !== "number") return null;
    const matches = [];
    for (let index = 0; index < list.length; index += 1) {
      try {
        const el = list[index];
        if (copyChipPayloadOf(el) !== chip.text) continue;
        matches.push(el);
      } catch (error) {
        continue;
      }
    }
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    // Identical payloads at different positions stay independent: prefer
    // the widget whose recorded document range matches.
    try {
      if (Number.isInteger(chip.from) && Number.isInteger(chip.to) && view.state && view.state.doc) {
        let docFrom = null;
        let docTo = null;
        try {
          if (Number.isInteger(chip.line) && typeof view.state.doc.line === "function") {
            const line = view.state.doc.line(chip.line + 1);
            docFrom = line.from + chip.from;
            docTo = line.from + chip.to;
          }
        } catch (error) {
          docFrom = null;
        }
        if (Number.isFinite(docFrom) && Number.isFinite(docTo)) {
          for (const el of matches) {
            try {
              const pos = copyChipWidgetPositionOf(el);
              if (pos && pos.from === docFrom && pos.to === docTo) return el;
            } catch (error) {
              continue;
            }
          }
        }
      }
    } catch (error) {
      // Position matching is best-effort.
    }
    // Ambiguous DOM match: do not guess.
    return null;
  } catch (error) {
    return null;
  }
}

function copyChipFlashSourceRange(view, chip) {
  try {
    if (!view || typeof view.dispatch !== "function") return false;
    if (!chip || !Number.isInteger(chip.line) || !Number.isInteger(chip.from) || !Number.isInteger(chip.to)) {
      return false;
    }
    const effect = copyChipEnsureSourceFlash();
    if (!effect) return false;
    let from = null;
    let to = null;
    try {
      if (view.state && view.state.doc && typeof view.state.doc.line === "function") {
        const line = view.state.doc.line(chip.line + 1);
        from = line.from + chip.from;
        to = line.from + chip.to;
      } else if (view.state && view.state.doc && typeof view.state.doc.lineAt === "function") {
        // Fallback for stub docs without line().
        from = null;
      }
    } catch (error) {
      return false;
    }
    if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
    try {
      view.dispatch({ effects: effect.of({ from, to }) });
    } catch (error) {
      return false;
    }
    // Clear the transient flash shortly after paint.
    try {
      const doc = (view.dom && view.dom.ownerDocument) || (typeof document !== "undefined" ? document : null);
      copyChipTimerHost(doc).set(() => {
        try {
          view.dispatch({ effects: effect.of(null) });
        } catch (error) {
          // Clearing is best-effort.
        }
      }, COPY_CHIP_SUCCESS_MS);
    } catch (error) {
      // Clearing is best-effort.
    }
    return true;
  } catch (error) {
    return false;
  }
}

// Promise of {ok, reason?}. Never throws or rejects.
async function copyChipCopyText(text) {
  try {
    return await copyChipWrite(text);
  } catch (error) {
    return copyChipFreeze({ ok: false, reason: "copy failed" });
  }
}

// One clipboard write plus success/failure feedback. A failed visual lookup
// never turns a successful write into a false failure.
async function copyChipCopyChip(chip, options) {
  try {
    const opts = options && typeof options === "object" ? options : {};
    const view = opts.view || null;
    if (!chip || typeof chip.text !== "string" || !/\S/.test(chip.text)) {
      return copyChipFreeze({ ok: false, reason: "nothing to copy" });
    }
    let result = null;
    try {
      result = await copyChipWrite(chip.text);
    } catch (error) {
      result = copyChipFreeze({ ok: false, reason: "copy failed" });
    }
    if (result && result.ok) {
      let shown = false;
      try {
        if (view) {
          const widget = copyChipFindWidgetInView(view, chip);
          if (widget) shown = copyChipShowFeedback(widget, "success");
          if (!shown) shown = copyChipFlashSourceRange(view, chip);
        }
      } catch (error) {
        shown = false;
      }
      return copyChipFreeze({ ok: true });
    }
    try {
      if (view) {
        const widget = copyChipFindWidgetInView(view, chip);
        if (widget) copyChipFail(widget, (result && result.reason) || "copy failed");
        else if (CopyChipsNotice && typeof CopyChipsNotice === "function") {
          try {
            // eslint-disable-next-line no-new
            new CopyChipsNotice("Couldn't copy: " + String((result && result.reason) || "copy failed"));
          } catch (error) {
            // Notice is best-effort.
          }
        }
      } else if (CopyChipsNotice && typeof CopyChipsNotice === "function") {
        try {
          // eslint-disable-next-line no-new
          new CopyChipsNotice("Couldn't copy: " + String((result && result.reason) || "copy failed"));
        } catch (error) {
          // Notice is best-effort.
        }
      }
    } catch (error) {
      // Failure feedback is best-effort.
    }
    return copyChipFreeze({ ok: false, reason: (result && result.reason) || "copy failed" });
  } catch (error) {
    return copyChipFreeze({ ok: false, reason: "copy failed" });
  }
}

// Boolean indicating success feedback was shown; never writes.
function copyChipFlashChip(chip, options) {
  try {
    const opts = options && typeof options === "object" ? options : {};
    const view = opts.view || null;
    if (!chip || typeof chip.text !== "string" || !/\S/.test(chip.text)) return false;
    if (!view) return false;
    try {
      const widget = copyChipFindWidgetInView(view, chip);
      if (widget) return copyChipShowFeedback(widget, "success");
      return copyChipFlashSourceRange(view, chip);
    } catch (error) {
      return false;
    }
  } catch (error) {
    return false;
  }
}

function copyChipNotify(message) {
  try {
    if (CopyChipsNotice && typeof CopyChipsNotice === "function") {
      // eslint-disable-next-line no-new
      new CopyChipsNotice(String(message));
    }
  } catch (error) {
    // Notices are best-effort.
  }
}

async function copyChipRunCursorCommand(editor, view) {
  try {
    const lines = copyChipReadEditorLines(editor, view);
    const cursor = copyChipReadEditorCursor(editor, view);
    if (!lines || !cursor) {
      copyChipNotify("No copy chip on this line");
      return false;
    }
    let resolved = null;
    try {
      resolved = copyChipAt({ lines, line: cursor.line, ch: cursor.ch });
    } catch (error) {
      resolved = copyChipFreeze({ state: "none", count: 0 });
    }
    if (!resolved || resolved.state === "none") {
      copyChipNotify("No copy chip on this line");
      return false;
    }
    if (resolved.state === "ambiguous") {
      copyChipNotify(String(resolved.count) + " chips on this line · move onto one");
      return false;
    }
    const chip = resolved.chip;
    const result = await copyChipCopyChip(chip, { view: view || null });
    if (result && result.ok) {
      // copyChip already flashed the widget or the revealed source range.
      // A missing view still copies; there is simply nothing to flash.
      if (!view) return true;
      return true;
    }
    return false;
  } catch (error) {
    try {
      copyChipNotify("No copy chip on this line");
    } catch (ignore) {
      // Notice is best-effort.
    }
    return false;
  }
}

function copyChipRegisterCursorCommand(plugin) {
  try {
    if (!plugin || typeof plugin.addCommand !== "function") return false;
    if (plugin.copyChipCursorCommandRegistered === true) return true;
    plugin.copyChipCursorCommandRegistered = true;
    try {
      plugin.addCommand({
        id: "copy-on-cursor-line",
        name: "Copy chip on cursor line",
        editorCallback: (editor, view) => {
          try {
            const maybe = copyChipRunCursorCommand(editor, view);
            if (maybe && typeof maybe.catch === "function") {
              maybe.catch(() => false);
            }
          } catch (error) {
            // Command callback never throws.
          }
        },
      });
    } catch (error) {
      return false;
    }
    try {
      if (typeof plugin.register === "function") {
        plugin.register(() => {
          plugin.copyChipCursorCommandRegistered = false;
        });
      }
    } catch (error) {
      // Unload cleanup is best-effort.
    }
    return true;
  } catch (error) {
    return false;
  }
}
