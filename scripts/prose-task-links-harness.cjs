// Small block-id-prompt api.taskLinks fixture shared by prose host tests.
function createTaskLinksApi(rows = null) {
  const taskRows = rows || [{
    key: "t:2026/2026-11-21#reply-dana",
    notePath: "2026/2026-11-21.md",
    line: 0,
    blockId: null,
    needsId: true,
    status: "todo",
    glyph: "[ ]",
    taskKind: null,
    titleParts: [{ text: "Reply to Dana about launch", kind: "text" }],
    displayText: "Reply to Dana about launch",
    primary: "Reply to Dana about launch",
    section: null,
    group: "other-open",
    hidden: false,
    linkTarget: "2026/2026-11-21",
    suggestedId: "reply-dana",
    disabled: null,
    link: null,
  }];
  const state = { requests: [], named: [], sessions: [] };
  const session = {
    rank(query) {
      const terms = String(query || "").toLowerCase().split(/\s+/u).filter(Boolean);
      const matching = taskRows.filter((row) => {
        const text = String(row.displayText || row.primary || "").toLowerCase();
        return terms.every((term) => text.includes(term));
      });
      return { rows: matching, total: matching.length, indexing: null };
    },
    linkFor(row) {
      return row && (row.link || (row.blockId ? `[[${row.linkTarget}#^${row.blockId}]]` : null));
    },
    suggestions(row) {
      return Promise.resolve([row.suggestedId || "reply-dana", "follow-up"]);
    },
    validate(_row, id) {
      return /^[A-Za-z0-9-]+$/u.test(String(id || ""))
        ? { ok: true }
        : { ok: false, short: "invalid", message: "Use letters, numbers, and dashes" };
    },
    async name(row, id) {
      state.named.push({ row, id });
      return {
        ok: true,
        link: `[[${String(row.notePath || "").replace(/\.md$/iu, "")}#^${id}]]`,
        notePath: row.notePath,
        id,
      };
    },
    onChange() { return () => {}; },
    close() {},
  };
  return {
    version: 1,
    fieldAt(text, caret, options = {}) {
      const value = String(text || "");
      const before = value.slice(0, Number.isInteger(caret) ? caret : value.length);
      const lineStart = before.lastIndexOf("\n") + 1;
      const line = before.slice(lineStart);
      const opener = line.lastIndexOf("((");
      if (opener < 0) return null;
      const localStart = opener;
      const previous = line[localStart - 1];
      if (localStart > 0 && previous !== " " && previous !== "\t") return null;
      if (line[localStart + 2] === "(") return null;
      const start = lineStart + localStart;
      if (start < (Number.isInteger(options.minOffset) ? options.minOffset : 0)) return null;
      if (options.mode === "field" && start !== 0) return null;
      return { start, end: before.length, query: line.slice(localStart + 2), closed: false };
    },
    open(request) {
      state.requests.push(request);
      state.sessions.push(session);
      return session;
    },
    state,
  };
}

function taskLinksApp(taskLinks = createTaskLinksApi()) {
  return { plugins: { plugins: { "block-id-prompt": { api: { taskLinks } } } } };
}

module.exports = { createTaskLinksApi, taskLinksApp };
