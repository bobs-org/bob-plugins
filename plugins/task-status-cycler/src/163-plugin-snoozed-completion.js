function snoozeCleanPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.md$/i, "")
    .toLocaleLowerCase();
}

function snoozeEditorPosition(source, offset) {
  const prefix = String(source || "").slice(0, Math.max(0, offset));
  const line = (prefix.match(/\n/g) || []).length;
  const lastNewline = prefix.lastIndexOf("\n");
  return { line, ch: prefix.length - lastNewline - 1 };
}

class TaskStatusCyclerSnoozedCompletionMixin {
  resolveClosedSnoozedRowIdentity(row, dailyPath, files) {
    if (!row || row.kind !== "active" || !row.blockId) return null;
    if (!row.target) return snoozeModel.identityKey(dailyPath, row.blockId);
    const target = snoozeCleanPath(row.target);
    const hasPath = target.includes("/");
    const matches = (Array.isArray(files) ? files : []).filter((file) => {
      const path = snoozeCleanPath(file && file.path);
      return hasPath ? path === target : path.split("/").pop() === target;
    });
    if (matches.length !== 1) return null;
    return snoozeModel.identityKey(matches[0].path, row.blockId);
  }

  async pruneClosedSnoozedRowsNow(closedIdentities, context = {}) {
    const closed = normalizeTaskReferenceIdentities(closedIdentities);
    if (closed.length === 0) return { removedCount: 0, failures: [] };
    const vault = this.app && this.app.vault;
    if (!vault || typeof vault.getAbstractFileByPath !== "function") {
      return { removedCount: 0, failures: [] };
    }
    let dailyPath = "";
    try { dailyPath = todayDailyPath(this.app) || ""; } catch (_error) {}
    if (!dailyPath) return { removedCount: 0, failures: [] };
    const file = vault.getAbstractFileByPath(dailyPath);
    if (!file) return { removedCount: 0, failures: [] };
    const files = typeof vault.getMarkdownFiles === "function" ? vault.getMarkdownFiles() : [];
    const wanted = closed.map((identity) => snoozeModel.identityKey(identity.path, identity.blockId));
    const options = {
      resolveIdentity: (row) => this.resolveClosedSnoozedRowIdentity(row, dailyPath, files),
    };
    const editors = this.getOpenMarkdownEditors(context);
    const editor = editors.get(dailyPath) || null;

    if (editor && typeof editor.getValue === "function") {
      const before = String(editor.getValue() || "");
      const plan = snoozeModel.planRemoveRows(before, wanted, options);
      if (!plan.edits.length) return { removedCount: 0, failures: [] };
      const applied = this.applyTaskSettleToEditor(editor, dailyPath, {
        expected: before,
        contents: plan.postimage,
        joinHistory: true,
      });
      if (applied && applied.applied) {
        return { removedCount: plan.detachedSubtrees.length, failures: [] };
      }
      if (String(editor.getValue() || "") !== before) {
        return { removedCount: 0, failures: ["daily note changed before Snoozed cleanup"] };
      }
      if (typeof editor.replaceRange !== "function") {
        return { removedCount: 0, failures: ["daily note editor cannot apply Snoozed cleanup"] };
      }
      const cursor = typeof editor.getCursor === "function" ? editor.getCursor() : null;
      for (const edit of plan.edits.slice().sort((left, right) => right.start - left.start)) {
        editor.replaceRange(
          edit.replacement,
          snoozeEditorPosition(before, edit.start),
          snoozeEditorPosition(before, edit.end),
        );
      }
      if (cursor && typeof editor.setCursor === "function") {
        const current = editor.getLine(cursor.line) || "";
        editor.setCursor({ line: cursor.line, ch: Math.min(cursor.ch, current.length) });
      }
      return { removedCount: plan.detachedSubtrees.length, failures: [] };
    }

    let removedCount = 0;
    const transform = (source) => {
      const plan = snoozeModel.planRemoveRows(String(source || ""), wanted, options);
      removedCount = plan.detachedSubtrees.length;
      return plan.postimage;
    };
    try {
      if (typeof vault.process === "function") {
        await vault.process(file, transform);
      } else if (typeof vault.read === "function" && typeof vault.modify === "function") {
        const before = await vault.read(file);
        const after = transform(before);
        if (after !== before) await vault.modify(file, after);
      }
      return { removedCount, failures: [] };
    } catch (error) {
      return { removedCount: 0, failures: [error && error.message ? error.message : String(error)] };
    }
  }
}
