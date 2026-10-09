// Reopen receipts and status-cycle closes (plan:202610/successor_links.md
// `cycler_polish`). After a successful recover-and-link pass, an in-memory
// receipt keyed by predecessor (`path#^blockId`) remembers the inserted
// successor bullets and the applied status edits. Reopening the predecessor
// the same day through Ctrl+Enter takes back untouched links and restores
// their statuses; anything edited since survives. Alt+]/Alt+[ moves into
// Done or Cancelled join the same `finalizeClosedTasks` pass as Ctrl+Enter
// (a cancel recovers only and never links).

class TaskStatusCyclerSuccessorReceiptMixin {
  // Receipt store, created lazily so older serialized state never matters.
  // Dropped at local midnight (checked on consume), on plugin unload, and
  // after use. Never persisted to Markdown. Never throws.
  successorReopenReceipts() {
    try {
      if (!this.successorReopenReceiptStore) {
        this.successorReopenReceiptStore = new Map();
      }
      return this.successorReopenReceiptStore;
    } catch (error) {
      return new Map();
    }
  }

  // Key forms for one closed/reopened identity. The `^block` form is
  // primary; the `id:` form covers predecessors that carry `[id::]` but no
  // block ID. Both sides (store and consume) build keys this way. Never
  // throws.
  successorReceiptKeysFor(identity) {
    try {
      if (!identity || !identity.path) {
        return [];
      }
      const path = String(identity.path);
      const keys = [];
      if (identity.blockId) {
        keys.push(`${path}#^${String(identity.blockId)}`);
      }
      if (identity.taskId) {
        keys.push(`${path}#id:${String(identity.taskId)}`);
      }
      return keys;
    } catch (error) {
      return [];
    }
  }

  // Store the reopen receipt for a successful pass. `plan` carries the
  // applied `edits` and the final `unblocked` rows (failed rows already
  // unlinked); `insertion.text` is the post-insertion daily text the row
  // line numbers address. Only rows still linked are remembered. Capture
  // closes never reach this method, so they never gain a receipt (Alt+N is
  // their per-link undo). Never throws.
  rememberSuccessorPass(closedIdentities, plan, insertion, info) {
    try {
      const rows = plan && Array.isArray(plan.unblocked)
        ? plan.unblocked.filter((row) => row && row.link && !row.not_linked)
        : [];
      if (rows.length === 0) {
        return;
      }
      const text = insertion && typeof insertion.text === "string"
        ? insertion.text
        : null;
      if (!text) {
        return;
      }
      const lines = text.split(/\r?\n/);
      const afterByEdit = new Map();
      for (const edit of (plan && plan.edits) || []) {
        if (edit && edit.path != null && Number.isInteger(edit.line)) {
          afterByEdit.set(`${edit.path}\0${edit.line}`, edit.after);
        }
      }
      const links = [];
      const statuses = [];
      for (const row of rows) {
        const link = row.link || {};
        if (!Number.isInteger(link.line) || !Number.isInteger(link.entry_line)) {
          continue;
        }
        const lineText = lines[link.line - 1];
        const headline = lines[link.entry_line - 1];
        if (typeof lineText !== "string" || typeof headline !== "string") {
          continue;
        }
        const by = (row.unblocked_by || []).map((pred) =>
          `${pred && pred.note_path ? pred.note_path : ""}#^${pred && pred.block_id ? pred.block_id : ""}`
        );
        links.push({
          line_text: lineText,
          entry_headline: headline,
          entry_created: link.entry_created === true,
          by,
        });
        const after = afterByEdit.get(`${row.note_path}\0${row.line}`);
        if (typeof after === "string") {
          statuses.push({
            path: row.note_path,
            after_line: after,
            previous_symbol: row.previous_status_symbol,
            by,
          });
        }
      }
      if (links.length === 0 && statuses.length === 0) {
        return;
      }
      const store = this.successorReopenReceipts();
      const receipt = {
        date: info && info.today ? String(info.today) : null,
        daily_path: info && info.dailyPath ? String(info.dailyPath) : "",
        predecessor_text: (Array.isArray(closedIdentities) ? closedIdentities : [])
          .map((identity) => identity && identity.text ? String(identity.text) : "")
          .find((value) => value) || "task",
        links,
        statuses,
      };
      for (const identity of Array.isArray(closedIdentities) ? closedIdentities : []) {
        for (const key of this.successorReceiptKeysFor(identity)) {
          store.set(key, receipt);
        }
      }
    } catch (error) {
      // Best effort: a missed receipt only loses the take-back shortcut.
    }
  }

  // Route one status-cycle batch through `finalizeClosedTasks`, partitioned
  // so Done closes link and Cancelled closes recover only
  // (`closeKind: "cancelled"`). Each entry is `{ identity, symbol }` with
  // symbol `"x"` (Done) or `"-"` (Cancelled); other symbols never reach
  // here. Bare, counted, and transcluded-target cycles share this worker,
  // so every Alt+]/Alt+[ close recovers immediately (bead bob-cli-3k).
  // Never throws; callers use `void`.
  async finalizeCycledClosedTasks(entries, context) {
    try {
      const done = [];
      const cancelled = [];
      const seen = new Set();
      for (const entry of Array.isArray(entries) ? entries : []) {
        const identity = entry && entry.identity;
        if (!identity || !identity.path) {
          continue;
        }
        const key = `${identity.path}\0${identity.blockId || ""}\0${identity.taskId || ""}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        if (entry.symbol === "-") {
          cancelled.push(identity);
        } else if (entry.symbol === "x") {
          done.push(identity);
        }
      }
      if (done.length === 0 && cancelled.length === 0) {
        return;
      }
      const active = context && typeof context === "object" ? context : {};
      if (done.length > 0) {
        try {
          await this.finalizeClosedTasks(done, active);
        } catch (error) {
          // Best effort: the cycle write already landed.
        }
      }
      if (cancelled.length > 0) {
        let cancelContext = active;
        try {
          cancelContext = { ...active, closeKind: "cancelled" };
        } catch (error) {
          cancelContext = active;
        }
        try {
          await this.finalizeClosedTasks(cancelled, cancelContext);
        } catch (error) {
          // Best effort: the cycle write already landed.
        }
      }
    } catch (error) {
      // Never throw out of a cycle gesture.
    }
  }

  // Take back this pass's untouched successor links when the predecessor is
  // reopened the same day through Ctrl+Enter. `opened` are identity-ish
  // `{ path, blockId, taskId }` values for the reopened task. Removes each
  // remembered bullet that still exists verbatim under the same entry
  // headline and has no children (a created placeholder goes only when it
  // became empty), and restores each successor whose note line still equals
  // its post-close text to its previous status. Only entries unblocked
  // solely by the reopened predecessor are touched. Single use, then the
  // receipt is dropped; a different day is a no-op. Shows the `↩` notice
  // only when at least one link was taken back. Never throws.
  async consumeSuccessorReopenReceipt(opened, context) {
    try {
      const store = this.successorReopenReceipts();
      if (!store || store.size === 0) {
        return null;
      }
      const list = Array.isArray(opened) ? opened : [opened];
      let receipt = null;
      let matchedKey = null;
      for (const item of list) {
        for (const key of this.successorReceiptKeysFor(item)) {
          if (store.has(key)) {
            receipt = store.get(key);
            matchedKey = key;
            break;
          }
        }
        if (receipt) {
          break;
        }
      }
      if (!receipt) {
        return null;
      }
      for (const [key, value] of store) {
        if (value === receipt) {
          store.delete(key);
        }
      }
      let today = null;
      try {
        today = typeof this.getScheduleLogDateString === "function"
          ? this.getScheduleLogDateString()
          : formatLocalDate();
      } catch (error) {
        today = formatLocalDate();
      }
      if (!receipt.date || receipt.date !== today) {
        return null;
      }
      const active = context && typeof context === "object" ? context : {};
      const owned = (entry) =>
        !!entry && Array.isArray(entry.by) &&
        entry.by.length === 1 && entry.by[0] === matchedKey;
      const linksRemoved = await this.takeBackSuccessorLinks(
        receipt,
        (receipt.links || []).filter(owned),
        active,
      );
      const statusesRestored = await this.restoreSuccessorStatuses(
        receipt,
        (receipt.statuses || []).filter(owned),
        active,
      );
      if (linksRemoved > 0) {
        const name = truncateSuccessorNoticeText(receipt.predecessor_text || "task");
        try {
          new Notice(
            `↩ Reopened ${name} · took back ${linksRemoved} successor link${linksRemoved === 1 ? "" : "s"}`,
          );
        } catch (error) {
          // Best effort: the take-back already landed.
        }
      }
      return { linksRemoved, statusesRestored };
    } catch (error) {
      return null;
    }
  }

  // Remove remembered successor bullets (`{ line_text, entry_headline,
  // entry_created }`) from the receipt's daily note. A bullet goes only
  // when it still exists verbatim under its entry headline and the next
  // line is not one of its children; a created placeholder headline goes
  // only when it has no child bullets left. Resolves to the removed count.
  // Never throws.
  async takeBackSuccessorLinks(receipt, links, context) {
    try {
      if (!receipt || !receipt.daily_path || links.length === 0) {
        return 0;
      }
      const path = String(receipt.daily_path);
      const editors = this.getOpenMarkdownEditors(context || {});
      const editor = editors.get(path);
      const createdHeadlines = [];
      let removed = 0;
      if (editor && typeof editor.getValue === "function") {
        for (const link of links) {
          const lines = String(editor.getValue() || "").split(/\r?\n/);
          const at = findSuccessorReceiptLine(lines, link);
          if (at < 0) {
            continue;
          }
          if (!removeSuccessorReceiptLineFromEditor(editor, at)) {
            continue;
          }
          removed += 1;
          if (link.entry_created && !createdHeadlines.includes(link.entry_headline)) {
            createdHeadlines.push(link.entry_headline);
          }
        }
        for (const headline of createdHeadlines) {
          const lines = String(editor.getValue() || "").split(/\r?\n/);
          const at = lines.findIndex((line) => line === headline);
          if (at < 0) {
            continue;
          }
          const next = lines[at + 1];
          if (next !== undefined && INDENTED_LIST_LINE_RE.test(next)) {
            continue;
          }
          removeSuccessorReceiptLineFromEditor(editor, at);
        }
        return removed;
      }
      const vault = this.app && this.app.vault;
      const file = vault && typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(path)
        : null;
      const target = file ||
        (vault && typeof vault.getMarkdownFiles === "function"
          ? vault.getMarkdownFiles().find((candidate) =>
            candidate && candidate.path === path
          ) || null
          : null);
      if (!target || typeof vault.process !== "function") {
        return 0;
      }
      const created = links.filter((link) => link.entry_created)
        .map((link) => link.entry_headline);
      try {
        await vault.process(target, (liveText) => {
          const ending = String(liveText || "").includes("\r\n") ? "\r\n" : "\n";
          const lines = String(liveText || "").split(/\r?\n/);
          let changed = false;
          const order = links
            .map((link) => findSuccessorReceiptLine(lines, link))
            .filter((at) => at >= 0)
            .sort((left, right) => right - left);
          for (const at of order) {
            lines.splice(at, 1);
            changed = true;
            removed += 1;
          }
          for (const headline of created) {
            const at = lines.findIndex((line) => line === headline);
            if (at < 0) {
              continue;
            }
            const next = lines[at + 1];
            if (next !== undefined && INDENTED_LIST_LINE_RE.test(next)) {
              continue;
            }
            lines.splice(at, 1);
            changed = true;
          }
          return changed ? lines.join(ending) : String(liveText || "");
        });
      } catch (error) {
        // Best effort: matched removals already counted only land on write.
        return 0;
      }
      return removed;
    } catch (error) {
      return 0;
    }
  }

  // Restore remembered successor statuses (`{ path, after_line,
  // previous_symbol }`): each note line that still equals its post-close
  // text moves back to its previous status; edited lines survive. Writes go
  // through the open editor or `vault.process`. Resolves to the restored
  // count. Never throws.
  async restoreSuccessorStatuses(receipt, statuses, context) {
    try {
      if (!receipt || statuses.length === 0) {
        return 0;
      }
      const byPath = new Map();
      for (const status of statuses) {
        if (!status || !status.path || typeof status.after_line !== "string") {
          continue;
        }
        if (!byPath.has(status.path)) {
          byPath.set(status.path, []);
        }
        byPath.get(status.path).push(status);
      }
      const editors = this.getOpenMarkdownEditors(context || {});
      const vault = this.app && this.app.vault;
      let restored = 0;
      for (const [path, items] of byPath) {
        const editor = editors.get(path);
        if (editor && typeof editor.getValue === "function") {
          for (const status of items) {
            try {
              const lines = String(editor.getValue() || "").split(/\r?\n/);
              const at = lines.findIndex((line) => line === status.after_line);
              if (at < 0) {
                continue;
              }
              const next = replaceTaskStatusSymbol(
                status.after_line,
                status.previous_symbol,
              );
              if (next === status.after_line) {
                continue;
              }
              if (typeof editor.replaceRange !== "function") {
                continue;
              }
              editor.replaceRange(
                next,
                { line: at, ch: 0 },
                { line: at, ch: status.after_line.length },
              );
              restored += 1;
            } catch (error) {
              // One stale line must not block its siblings.
            }
          }
          continue;
        }
        const file = vault && typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(path)
          : null;
        const target = file ||
          (vault && typeof vault.getMarkdownFiles === "function"
            ? vault.getMarkdownFiles().find((candidate) =>
              candidate && candidate.path === path
            ) || null
            : null);
        if (!target || typeof vault.process !== "function") {
          continue;
        }
        try {
          await vault.process(target, (liveText) => {
            const ending = String(liveText || "").includes("\r\n") ? "\r\n" : "\n";
            const lines = String(liveText || "").split(/\r?\n/);
            let changed = false;
            for (const status of items) {
              const at = lines.findIndex((line) => line === status.after_line);
              if (at < 0) {
                continue;
              }
              const next = replaceTaskStatusSymbol(
                status.after_line,
                status.previous_symbol,
              );
              if (next === status.after_line) {
                continue;
              }
              lines[at] = next;
              changed = true;
              restored += 1;
            }
            return changed ? lines.join(ending) : String(liveText || "");
          });
        } catch (error) {
          // Best effort: see the editor branch.
        }
      }
      return restored;
    } catch (error) {
      return 0;
    }
  }
}

// Locate a remembered successor bullet: the first line equal to
// `line_text` whose owning ledger entry headline equals
// `entry_headline`, and whose next line is not one of its children.
// Returns the 0-based line or -1. Never throws.
function findSuccessorReceiptLine(lines, link) {
  try {
    if (!link || typeof link.line_text !== "string") {
      return -1;
    }
    const list = Array.isArray(lines) ? lines : [];
    let entries = [];
    try {
      entries = parseSuccessorLedgerEntries(list);
    } catch (error) {
      entries = [];
    }
    const entryOfLine = (line) => {
      let owner = null;
      for (const entry of entries) {
        if (entry.entryLine <= line) {
          owner = entry;
        } else {
          break;
        }
      }
      return owner;
    };
    for (let line = 0; line < list.length; line += 1) {
      if (String(list[line] || "") !== link.line_text) {
        continue;
      }
      if (entries.length > 0) {
        const owner = entryOfLine(line);
        const headline = owner ? String(list[owner.entryLine] || "") : null;
        if (headline !== link.entry_headline) {
          continue;
        }
      }
      const next = list[line + 1];
      if (
        next !== undefined &&
        INDENTED_LIST_LINE_RE.test(next) &&
        successorIndentOf(next).length > successorIndentOf(list[line]).length
      ) {
        continue;
      }
      return line;
    }
  } catch (error) {
    // Fall through to -1.
  }
  return -1;
}

// Delete one daily-note line through the open editor, keeping the newline
// structure intact (the last line loses its preceding newline instead).
// Resolves true when a write landed. Never throws.
function removeSuccessorReceiptLineFromEditor(editor, at) {
  try {
    if (!editor || typeof editor.replaceRange !== "function") {
      return false;
    }
    const count = typeof editor.lineCount === "function"
      ? editor.lineCount()
      : typeof editor.lastLine === "function"
        ? editor.lastLine() + 1
        : null;
    if (count == null || at < 0 || at >= count) {
      return false;
    }
    if (at === count - 1 && at > 0) {
      const previous = typeof editor.getLine === "function"
        ? editor.getLine(at - 1) || ""
        : "";
      const current = typeof editor.getLine === "function"
        ? editor.getLine(at) || ""
        : "";
      editor.replaceRange(
        "",
        { line: at - 1, ch: previous.length },
        { line: at, ch: current.length },
      );
      return true;
    }
    editor.replaceRange("", { line: at, ch: 0 }, { line: at + 1, ch: 0 });
    return true;
  } catch (error) {
    return false;
  }
}
