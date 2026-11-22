// Tasks-mode state machine for nav's proseField v2 (phase bob-cli-oz.3).
//
// `createProseTaskMode(ctx)` owns one tasks-mode session: list stage with
// ranked rows from block-id-prompt `api.taskLinks`, plus the in-band NAME
// stage fed through the field's own `beforeinput`/`keydown` (no second
// input). Focus never leaves the prompt field. The only vault write is an
// explicit NAME Enter via `session.name`. Fail-open: without bip, or with
// an old bip, every entry returns null/false and the field stays literal.

function proseTaskLinksApiFromApp(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const bip = plugins && plugins["block-id-prompt"];
    const api = bip && bip.api && bip.api.taskLinks;
    if (api && Number(api.version) >= 1 && typeof api.fieldAt === "function" && typeof api.open === "function") {
      return api;
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function proseTaskResolveSubjects(subjects) {
  try {
    if (typeof subjects === "function") return subjects();
    return Array.isArray(subjects) ? subjects : [];
  } catch (_error) {
    return [];
  }
}

function createProseTaskMode(ctx) {
  const options = ctx && typeof ctx === "object" ? ctx : {};
  const inputEl = () => options.inputEl ? options.inputEl() : null;
  const app = options.app || null;
  const density = options.density === "dense" ? "dense" : "roomy";
  let sourcePathOpt = options.sourcePath;
  let subjectsOpt = options.subjects;
  let minOffsetOpt = options.minOffset;
  let modeOpt = options.mode;
  const listId = options.listId || `bob-link-band-${Math.random().toString(36).slice(2, 10)}`;
  let disposed = false;
  let open = false;
  let stage = "list";
  let field = null;
  let rows = [];
  let total = 0;
  let indexing = null;
  let selectedKey = null;
  let session = null;
  let unsubscribe = null;
  let nameRow = null;
  let idLine = createProseTaskIdLine("");
  let nameSuggestions = [];
  let nameValidation = null;
  let namePending = false;
  let nameWriteTimer = null;
  let justNamed = new Set();
  let inserting = false;
  let snapshot = null;
  let dismissed = null;
  let fadePlayed = false;
  let edge = null;

  const sourcePathNow = () => proseResolveSourcePath(sourcePathOpt);
  const apiNow = () => proseTaskLinksApiFromApp(app);

  const announce = (text) => {
    try {
      if (typeof options.announce === "function") options.announce(text);
    } catch (_error) {}
  };

  const notice = (text) => {
    try {
      if (typeof options.notice === "function") options.notice(text);
      else if (typeof Notice !== "undefined") new Notice(text);
    } catch (_error) {}
  };

  const closeSession = () => {
    try { if (typeof unsubscribe === "function") unsubscribe(); } catch (_error) {}
    unsubscribe = null;
    try { if (session && typeof session.close === "function") session.close(); } catch (_error) {}
    session = null;
  };

  const selectedRow = () => {
    if (!rows.length) return null;
    const index = rows.findIndex((row) => row && row.key === selectedKey);
    return index >= 0 ? rows[index] : rows[0];
  };

  const rerank = () => {
    if (!session || !field) return;
    let result = null;
    try {
      result = session.rank(String(field.query || ""));
    } catch (_error) {
      result = null;
    }
    if (!result || !Array.isArray(result.rows)) {
      rows = [];
      total = 0;
      indexing = null;
      return;
    }
    rows = result.rows;
    total = Number(result.total) || rows.length;
    indexing = result.indexing || null;
    if (!rows.some((row) => row && row.key === selectedKey)) {
      selectedKey = rows[0] ? rows[0].key : null;
    }
  };

  const headerTitle = () => {
    if (stage === "name") return "🔗 LINK · tasks › name it";
    if (!field || !field.query) {
      const first = rows[0] || null;
      const group = first ? proseTaskGroupCapsule(first.group) : "";
      return group ? `🔗 LINK · tasks › ${group}` : "🔗 LINK · tasks";
    }
    return "🔗 LINK · tasks";
  };

  const currentView = () => {
    const slots = density === "dense" ? PROSE_TASK_SLOTS_DENSE() : PROSE_TASK_SLOTS_ROOMY();
    const index = rows.length ? Math.max(0, rows.findIndex((row) => row && row.key === selectedKey)) : -1;
    const safeIndex = index >= 0 ? index : 0;
    const start = rows.length <= slots ? 0 : Math.min(Math.max(0, rows.length - slots), Math.max(0, safeIndex - Math.floor((slots - 1) / 2)));
    const selected = selectedRow();
    let detail = proseTaskDetailFor(selected);
    let live = "";
    if (stage === "name") {
      const named = proseTaskNameDetailFor(idLine.value, nameRow && nameRow.notePath);
      detail = { left: nameValidation && !nameValidation.ok ? `⊘ ${nameValidation.message || nameValidation.short}` : named.left, right: named.right };
      live = `Name a block ID for ${String((nameRow && (nameRow.displayText || nameRow.primary)) || "task")}: ${String(idLine.value || "")}. Enter adds it and links.`;
    } else if (total === 0) {
      detail = { left: "↵ closes this list · nothing is inserted", right: "esc close" };
      live = `No task matches. ${detail.left}`;
    } else if (selected) {
      live = `Task ${safeIndex + 1} of ${total}: ${String(selected.displayText || selected.primary || "")}${selected.disabled ? `. ${selected.disabled.full}` : ""}`;
    }
    return {
      open,
      stage,
      field,
      rows,
      view: rows.slice(start, start + slots),
      windowStart: start,
      selectedKey,
      selectedIndex: safeIndex,
      total,
      density,
      fadePlayed,
      listId,
      headerTitle: headerTitle(),
      headerCount: stage === "name"
        ? `in ${String((nameRow && nameRow.notePath) || "note")}`
        : proseTaskBandHeaderCount(safeIndex, total, indexing),
      message: total === 0 && stage === "list" ? "No task matches — keep typing, or esc" : null,
      detailLeft: detail.left,
      detailRight: detail.right,
      liveText: live,
      nameRow,
      idLine,
      nameSuggestions,
      nameValidation,
      namePending,
      onRowClick: (row) => acceptRow(row, false),
    };
  };

  const render = () => {
    if (disposed) return;
    try {
      if (typeof options.render === "function") options.render(currentView());
    } catch (_error) {}
    try {
      if (typeof options.bindAria === "function") options.bindAria(currentView());
    } catch (_error) {}
    if (open) fadePlayed = true;
  };

  const restoreSnapshot = () => {
    const el = inputEl();
    if (!el || !snapshot) return;
    try {
      if (String(el.value || "") !== String(snapshot.value || "")) {
        el.value = String(snapshot.value || "");
        if (typeof el.setSelectionRange === "function") {
          el.setSelectionRange(snapshot.caret, snapshot.caret);
        }
        const EventClass = (typeof InputEvent !== "undefined" ? InputEvent : Event);
        try {
          el.dispatchEvent(new EventClass("input", { bubbles: true, inputType: "insertReplacementText" }));
        } catch (_error) {}
      }
    } catch (_error) {}
  };

  const fieldIsByteIdentical = () => {
    const el = inputEl();
    if (!el || !snapshot) return true;
    try {
      return String(el.value || "") === String(snapshot.value || "");
    } catch (_error) {
      return false;
    }
  };

  const takeSnapshot = () => {
    const el = inputEl();
    try {
      snapshot = { value: String((el && el.value) || ""), caret: Number((el && el.selectionStart) || 0) };
    } catch (_error) {
      snapshot = { value: "", caret: 0 };
    }
  };

  const openSession = () => {
    const api = apiNow();
    if (!api) return null;
    try {
      const next = api.open({ sourcePath: sourcePathNow(), subjects: proseTaskResolveSubjects(subjectsOpt) });
      if (!next || typeof next.rank !== "function") return null;
      return next;
    } catch (_error) {
      return null;
    }
  };

  const tryOpen = (nextField, keepKey) => {
    const api = apiNow();
    if (!api) return false;
    let detected = null;
    try {
      detected = nextField || null;
    } catch (_error) {
      return false;
    }
    if (!detected) return false;
    if (dismissed && dismissed.opener === detected.start && dismissed.query === detected.query) return false;
    closeSession();
    session = openSession();
    if (!session) return false;
    try {
      if (typeof session.onChange === "function") {
        unsubscribe = session.onChange(() => {
          if (disposed || !open || stage !== "list") return;
          rerank();
          render();
        });
      }
    } catch (_error) {
      unsubscribe = null;
    }
    field = detected;
    stage = "list";
    rerank();
    if (keepKey && rows.some((row) => row && row.key === keepKey)) selectedKey = keepKey;
    else selectedKey = rows[0] ? rows[0].key : null;
    open = true;
    dismissed = null;
    takeSnapshot();
    render();
    return true;
  };

  const close = (memory) => {
    if (!open) return;
    if (memory && field) {
      dismissed = { opener: field.start, query: field.query, mode: "tasks" };
    } else if (!memory) {
      dismissed = null;
    }
    open = false;
    stage = "list";
    field = null;
    rows = [];
    total = 0;
    indexing = null;
    selectedKey = null;
    nameRow = null;
    namePending = false;
    if (nameWriteTimer) {
      try { clearTimeout(nameWriteTimer); } catch (_error) {}
      nameWriteTimer = null;
    }
    closeSession();
    snapshot = null;
    render();
  };

  const detectAt = (fromInput) => {
    const el = inputEl();
    if (!el) return null;
    let text = "";
    let caret = 0;
    try {
      text = String(el.value || "");
      caret = Number.isInteger(el.selectionStart) ? el.selectionStart : text.length;
    } catch (_error) {
      return null;
    }
    try {
      if (el.selectionStart !== el.selectionEnd) return null;
    } catch (_error) {}
    const api = apiNow();
    if (!api) return null;
    let minOffset = 0;
    try {
      minOffset = proseResolveMinOffset(minOffsetOpt);
    } catch (_error) {
      minOffset = 0;
    }
    let token = null;
    try {
      token = api.fieldAt(text, caret, { minOffset, mode: modeOpt === "field" ? "field" : undefined });
    } catch (_error) {
      return null;
    }
    if (!token) return null;
    void fromInput;
    return token;
  };

  const consider = (fromInput) => {
    if (disposed) return false;
    if (open && stage === "name") return true;
    const token = detectAt(fromInput);
    if (!token) {
      if (open) close(false);
      return false;
    }
    if (!fromInput && !open) return false;
    if (open && field && field.start === token.start && field.query === token.query && stage === "list") {
      rerank();
      render();
      return true;
    }
    return tryOpen(token, selectedKey);
  };

  const insertLink = (link) => {
    const el = inputEl();
    if (!el || !field) return false;
    const start = field.start;
    const end = field.end;
    const inserted = String(link || "");
    let caretAfter = start + inserted.length;
    inserting = true;
    try {
      if (typeof el.focus === "function") el.focus();
    } catch (_error) {}
    try {
      if (typeof el.setSelectionRange === "function") el.setSelectionRange(start, end);
    } catch (_error) {}
    let ok = false;
    try {
      const doc = el.ownerDocument || (typeof document !== "undefined" ? document : null);
      if (doc && typeof doc.execCommand === "function") ok = doc.execCommand("insertText", false, inserted) === true;
    } catch (_error) {
      ok = false;
    }
    if (!ok) {
      try {
        if (typeof el.setRangeText === "function") {
          el.setRangeText(inserted, start, end, "end");
          ok = true;
        } else {
          el.value = String(el.value || "").slice(0, start) + inserted + String(el.value || "").slice(end);
          if (typeof el.setSelectionRange === "function") el.setSelectionRange(caretAfter, caretAfter);
          ok = true;
        }
      } catch (_error) {
        inserting = false;
        return false;
      }
    }
    try {
      caretAfter = Number.isInteger(el.selectionStart) ? el.selectionStart : caretAfter;
    } catch (_error) {}
    inserting = false;
    return { ok, caret: caretAfter };
  };

  const acceptRow = (row, viaEnter) => {
    if (!row || !field) {
      close(false);
      return true;
    }
    if (row.disabled) {
      announce(`⊘ ${row.disabled.full || row.disabled.short}`);
      try {
        if (typeof options.bump === "function") options.bump();
      } catch (_error) {}
      if (viaEnter === true && typeof options.armSwallow === "function") {
        try { options.armSwallow(); } catch (_error) {}
      }
      render();
      return true;
    }
    if (!row.blockId) {
      enterName(row);
      if (viaEnter === true && typeof options.armSwallow === "function") {
        try { options.armSwallow(); } catch (_error) {}
      }
      return true;
    }
    let link = null;
    try {
      link = session ? session.linkFor(row) : null;
    } catch (_error) {
      link = null;
    }
    if (!link) {
      close(false);
      return true;
    }
    insertLink(link);
    try {
      if (typeof options.markResolved === "function") options.markResolved(row.notePath, row.blockId);
    } catch (_error) {}
    announce(`Linked ${String(row.displayText || row.primary || "task")}`);
    if (viaEnter === true && typeof options.armSwallow === "function") {
      try { options.armSwallow(); } catch (_error) {}
    }
    close(false);
    return true;
  };

  const enterName = (row) => {
    nameRow = row;
    stage = "name";
    namePending = false;
    takeSnapshot();
    let suggestions = [];
    try {
      const out = session ? session.suggestions(row) : null;
      if (out && typeof out.then === "function") {
        out.then((list) => {
          if (disposed || !open || stage !== "name" || nameRow !== row) return;
          nameSuggestions = Array.isArray(list) ? list.filter(Boolean).slice(0, 4) : [];
          idLine = createProseTaskIdLine(nameSuggestions[0] || "");
          idLine.suggestions = nameSuggestions.slice();
          nameValidation = { ok: true };
          announce(`Name a block ID for ${String(row.displayText || row.primary || "task")}: ${String(idLine.value || "")}. Enter adds it and links.`);
          render();
        }).catch(() => {});
        nameSuggestions = [];
        idLine = createProseTaskIdLine("");
      } else {
        suggestions = Array.isArray(out) ? out : [];
      }
    } catch (_error) {
      suggestions = [];
    }
    if (!nameSuggestions.length && !idLine.value) {
      nameSuggestions = suggestions.filter(Boolean).slice(0, 4);
      const seed = row.suggestedId || nameSuggestions[0] || "";
      idLine = createProseTaskIdLine(seed);
      idLine.suggestions = nameSuggestions.slice();
    }
    nameValidation = { ok: true };
    announce(`Name a block ID for ${String(row.displayText || row.primary || "task")}: ${String(idLine.value || "")}. Enter adds it and links.`);
    render();
  };

  const exitName = (toList) => {
    if (toList === true && field) {
      stage = "list";
      nameRow = null;
      namePending = false;
      if (nameWriteTimer) {
        try { clearTimeout(nameWriteTimer); } catch (_error) {}
        nameWriteTimer = null;
      }
      render();
      return true;
    }
    return false;
  };

  const commitName = async () => {
    if (!session || !nameRow) return false;
    const id = String(idLine.value || "");
    let valid = null;
    try {
      valid = session.validate(nameRow, id);
    } catch (_error) {
      valid = { ok: false, short: "invalid", message: "Use letters, numbers, and dashes" };
    }
    if (!valid || !valid.ok) {
      nameValidation = valid;
      announce(String((valid && valid.message) || "Invalid ID"));
      render();
      return true;
    }
    if (!fieldIsByteIdentical()) {
      notice("The field changed — nothing was inserted");
      close(false);
      return true;
    }
    namePending = true;
    render();
    let outcome = null;
    let timedOut = false;
    const timer = new Promise((resolve) => {
      nameWriteTimer = setTimeout(() => {
        timedOut = true;
        resolve({ ok: false, message: `Couldn't add ^${id} — try again` });
      }, PROSE_TASK_NAME_TIMEOUT_MS);
    });
    try {
      const pending = session.name(nameRow, id);
      outcome = await Promise.race([Promise.resolve(pending), timer]);
    } catch (_error) {
      outcome = { ok: false, message: "The task note could not be modified" };
    }
    try { clearTimeout(nameWriteTimer); } catch (_error) {}
    nameWriteTimer = null;
    if (timedOut && outcome && outcome.ok) {
      timedOut = false;
    }
    namePending = false;
    if (!outcome || !outcome.ok) {
      nameValidation = { ok: false, short: "failed", message: String((outcome && outcome.message) || "The task note could not be modified") };
      announce(String(nameValidation.message));
      render();
      return true;
    }
    if (!fieldIsByteIdentical()) {
      notice(`Added ^${outcome.id} to ${outcome.notePath}`);
      close(false);
      return true;
    }
    insertLink(outcome.link);
    try {
      if (typeof options.markResolved === "function") options.markResolved(outcome.notePath, outcome.id);
    } catch (_error) {}
    justNamed.add(`${outcome.notePath}#^${outcome.id}`);
    try {
      if (typeof options.markNamed === "function") options.markNamed(outcome.notePath, outcome.id);
    } catch (_error) {}
    notice(`Added ^${outcome.id} to ${outcome.notePath}`);
    announce(`Linked ${String((nameRow && (nameRow.displayText || nameRow.primary)) || "task")}`);
    if (typeof options.armSwallow === "function") {
      try { options.armSwallow(); } catch (_error) {}
    }
    close(false);
    return true;
  };

  const moveSelection = (direction) => {
    if (stage === "name") {
      idLine = proseTaskIdLineCycle(idLine, direction);
      nameValidation = { ok: true };
      render();
      return true;
    }
    if (!rows.length) {
      try { if (typeof options.bump === "function") options.bump("empty"); } catch (_error) {}
      return true;
    }
    const index = Math.max(0, rows.findIndex((row) => row && row.key === selectedKey));
    const next = index + direction;
    if (next < 0 || next >= rows.length) {
      try { if (typeof options.bump === "function") options.bump(next < 0 ? "top" : "bottom"); } catch (_error) {}
      return true;
    }
    selectedKey = rows[next].key;
    render();
    return true;
  };

  const handleBeforeinput = (event) => {
    if (disposed || !open || stage !== "name") return false;
    const type = event ? event.inputType : "";
    try {
      if (type === "insertText" && typeof event.data === "string") {
        const result = proseTaskIdLineInsert(idLine, event.data);
        idLine = result.line;
        if (result.refused) announce("letters, digits, - only");
        else nameValidation = { ok: true };
        render();
        return true;
      }
      if (type === "insertFromPaste" && event.clipboardData) {
        const pasted = event.clipboardData.getData("text/plain");
        const result = proseTaskIdLineInsert(idLine, pasted);
        idLine = result.line;
        nameValidation = { ok: true };
        render();
        return true;
      }
      if (type === "insertReplacementText") {
        idLine = proseTaskIdLineSetSuggestion(idLine, "");
        render();
        return true;
      }
      if (type === "deleteContentBackward" || type === "deleteWordBackward") {
        idLine = type === "deleteWordBackward" ? proseTaskIdLineDeleteWord({ ...idLine, caret: Math.min(idLine.caret, idLine.value.length) }) : proseTaskIdLineBackspace(idLine);
        nameValidation = { ok: true };
        render();
        return true;
      }
      if (type === "deleteContentForward" || type === "deleteWordForward" || (typeof type === "string" && type.startsWith("delete"))) {
        nameValidation = { ok: true };
        render();
        return true;
      }
      if (type === "insertLineBreak" || type === "insertParagraph") return true;
    } catch (_error) {}
    return true;
  };

  const handleKeydown = (event) => {
    if (disposed || !event || !open) return false;
    if (event.isComposing) return false;
    const key = String(event.key || "");
    const lower = key.toLowerCase();
    if (stage === "name") {
      if ((event.ctrlKey || event.metaKey || event.altKey) && lower !== "enter" && lower !== "backspace" && lower !== "a" && lower !== "[" && lower !== "m") return false;
      if (lower === "escape" || (event.ctrlKey && !event.altKey && !event.metaKey && lower === "[")) return exitName(true);
      if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (key === " " || key === "_") {
          idLine = proseTaskIdLineInsert(idLine, "-").line;
          nameValidation = { ok: true };
          render();
          return true;
        }
        if (/[A-Za-z0-9-]/u.test(key)) {
          idLine = proseTaskIdLineInsert(idLine, key).line;
          nameValidation = { ok: true };
          render();
          return true;
        }
        announce("letters, digits, - only");
        try { if (typeof options.shake === "function") options.shake(); } catch (_error) {}
        render();
        return true;
      }
      if (lower === "backspace") {
        idLine = event.ctrlKey || event.altKey || event.metaKey
          ? proseTaskIdLineDeleteWord(idLine)
          : proseTaskIdLineBackspace(idLine);
        nameValidation = { ok: true };
        render();
        return true;
      }
      if (lower === "delete") {
        nameValidation = { ok: true };
        render();
        return true;
      }
      if (lower === "arrowleft" || lower === "arrowright" || lower === "home" || lower === "end") {
        try {
          if (lower === "arrowleft") idLine.caret = Math.max(0, (idLine.caret || 0) - 1);
          if (lower === "arrowright") idLine.caret = Math.min(String(idLine.value || "").length, (idLine.caret || 0) + 1);
          if (lower === "home") idLine.caret = 0;
          if (lower === "end") idLine.caret = String(idLine.value || "").length;
          idLine.selected = false;
          render();
        } catch (_error) {}
        return true;
      }
      if ((event.ctrlKey || event.metaKey) && lower === "a") {
        idLine.selected = true;
        idLine.caret = String(idLine.value || "").length;
        render();
        return true;
      }
      if (lower === "tab" || lower === "arrowdown" || lower === "arrowup" || ((event.ctrlKey || event.metaKey) && (lower === "n" || lower === "p"))) {
        if (lower === "tab" && event.shiftKey) idLine = proseTaskIdLineCycle(idLine, -1);
        else if (lower === "tab" || lower === "arrowdown" || lower === "n") idLine = proseTaskIdLineCycle(idLine, 1);
        else idLine = proseTaskIdLineCycle(idLine, -1);
        nameValidation = { ok: true };
        render();
        return true;
      }
      if (lower === "enter") {
        if (event.repeat) return true;
        void commitName();
        return true;
      }
      return true;
    }
    if ((event.altKey || event.metaKey) && lower !== "enter") return false;
    if (event.shiftKey && lower !== "enter" && lower !== "tab") return false;
    if (lower === "arrowdown" || (event.ctrlKey && lower === "n")) return moveSelection(1);
    if (lower === "arrowup" || (event.ctrlKey && lower === "p")) return moveSelection(-1);
    if (lower === "tab" && event.shiftKey) return false;
    if (lower === "tab") {
      if (!rows.length) return false;
      return acceptRow(selectedRow(), false);
    }
    if (lower === "enter") {
      if (event.repeat) return true;
      const row = selectedRow();
      if (!row) {
        close(false);
        return true;
      }
      if (event.shiftKey && String(inputEl() && inputEl().tagName || "").toLowerCase() === "textarea") {
        close(false);
        return false;
      }
      return acceptRow(row, true);
    }
    if (lower === "arrowleft" || lower === "arrowright" || lower === "home" || lower === "end") return false;
    if (lower === "q") return false;
    return false;
  };

  const backOut = () => {
    if (!open) return false;
    if (stage === "name") {
      exitName(true);
      return true;
    }
    close(true);
    return true;
  };

  const onInput = () => {
    if (disposed || inserting) return;
    if (open && stage === "name") {
      restoreSnapshot();
      return;
    }
  };

  return {
    get isOpen() { return open; },
    get isNaming() { return open && stage === "name"; },
    get mode() { return "tasks"; },
    consider,
    detectAt,
    handleKeydown,
    handleBeforeinput,
    backOut,
    onInput,
    acceptRow,
    close,
    rerank,
    currentView,
    restoreSnapshot,
    setSubjects(next) {
      subjectsOpt = next;
      if (open) {
        closeSession();
        session = openSession();
        if (session) {
          rerank();
          render();
        } else {
          close(false);
        }
      }
      return true;
    },
    setSourcePath(next) {
      sourcePathOpt = next;
      if (open) consider(true);
      return true;
    },
    rebind() {
      if (open) {
        takeSnapshot();
        consider(true);
      }
      return true;
    },
    detach() {
      disposed = true;
      if (nameWriteTimer) {
        try { clearTimeout(nameWriteTimer); } catch (_error) {}
      }
      closeSession();
      open = false;
    },
    isJustNamed(notePath, blockId) {
      try {
        return justNamed.has(`${notePath}#^${blockId}`);
      } catch (_error) {
        return false;
      }
    },
    markNamed(notePath, blockId) {
      try { justNamed.add(`${notePath}#^${blockId}`); } catch (_error) {}
    },
  };
}

function createControllerTaskMode(deps) {
  const d = deps && typeof deps === "object" ? deps : {};
  try {
    if (typeof createProseTaskMode !== "function") return null;
    return createProseTaskMode({
      app: d.app || null,
      density: d.density === "dense" ? "dense" : "roomy",
      sourcePath: d.sourcePath,
      subjects: d.subjects,
      minOffset: d.minOffset,
      mode: d.mode,
      listId: d.listId,
      inputEl: d.inputEl,
      announce: d.announce,
      notice: d.notice,
      render: d.render,
      bindAria: d.bindAria,
      armSwallow: d.armSwallow,
      bump: d.bump,
      shake: d.shake,
      markResolved: d.markResolved,
      markNamed: d.markNamed,
    });
  } catch (_error) {
    return null;
  }
}
