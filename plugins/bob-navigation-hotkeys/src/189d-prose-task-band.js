// Tasks-mode renderer for nav's proseField v2 (phase bob-cli-oz.3).
//
// Paints the LINK band's tasks mode (list stage and NAME stage) on the
// shared `bob-link-band-*` frame, with `bob-task-band-*` classes for the
// pill, locator, ID line, suggestions, and validation glyph. Reuses the
// log-recall element helpers. Never throws, never uses innerHTML, never
// moves focus.

function proseTaskBandPillClass(row) {
  try {
    const status = String((row && row.status) || "todo").toLowerCase();
    if (status === "active" || status === "in-progress" || status === "inprogress") return "is-active";
    if (status === "next") return "is-next";
    if (status === "blocked") return "is-blocked";
    if (status === "done" || status === "completed") return "is-done";
    if (status === "cancelled" || status === "canceled") return "is-cancelled";
    return "is-todo";
  } catch (_error) {
    return "is-todo";
  }
}

function proseTaskBandTitleParts(rowEl, row) {
  try {
    const parts = row && Array.isArray(row.titleParts) ? row.titleParts : null;
    if (!parts || !parts.length || typeof rowEl.createSpan !== "function") {
      const fallback = String((row && (row.displayText || row.primary)) || "");
      try { rowEl.textContent = fallback; } catch (_error) {}
      return;
    }
    try { rowEl.textContent = ""; } catch (_error) {}
    for (const part of parts) {
      const text = String((part && part.text) || "");
      if (!text) continue;
      const kind = String((part && part.kind) || "text");
      if (kind === "match") {
        logRecallCreateElement(rowEl, "span", "bob-link-band-match", text);
      } else if (kind === "code") {
        logRecallCreateElement(rowEl, "span", "bob-task-band-code", text);
      } else if (kind === "link" || kind === "url") {
        logRecallCreateElement(rowEl, "span", "bob-task-band-link", text);
      } else if (typeof rowEl.appendText === "function") {
        rowEl.appendText(text);
      } else {
        logRecallCreateElement(rowEl, "span", "", text);
      }
    }
  } catch (_error) {}
}

function proseTaskBandRowLocator(metaEl, row) {
  try {
    const locator = String(proseTaskLocatorFor(row));
    if (!locator) return;
    const hashAt = locator.indexOf("#^");
    const line = logRecallCreateElement(metaEl, "span", "bob-task-band-locator");
    if (hashAt < 0) {
      line.textContent = locator;
      return;
    }
    const target = locator.slice(0, hashAt);
    const rest = locator.slice(hashAt);
    if (typeof line.createSpan === "function" || typeof line.appendChild === "function") {
      try { line.textContent = ""; } catch (_error) {}
      const targetEl = logRecallCreateElement(line, "span", "bob-task-band-target", target);
      void targetEl;
      logRecallCreateElement(line, "span", "bob-task-band-id", rest);
    } else {
      line.textContent = locator;
    }
  } catch (_error) {}
}

function proseTaskBandRenderList(root, view, slots) {
  const state = view && typeof view === "object" ? view : {};
  const windowed = Array.isArray(state.view) ? state.view : [];
  const runs = proseTaskGroupRuns(state.rows, Math.max(0, (state.windowStart || 0) + windowed.length));
  const selectedKey = state.selectedKey || null;
  for (let index = 0; index < slots; index += 1) {
    const row = windowed[index];
    if (!row) {
      logRecallCreateElement(root, "div", "bob-link-band-row is-empty");
      continue;
    }
    const selected = row.key === selectedKey;
    const dimmed = Boolean(row.disabled) || row.status === "done" || row.status === "completed" || row.status === "cancelled" || row.hidden === true;
    const rowEl = logRecallCreateElement(
      root,
      "div",
      `bob-link-band-row bob-task-band-row${selected ? " is-selected" : ""}${dimmed ? " is-dim" : ""}`,
    );
    const rowId = `${state.listId || "bob-link-band-list"}-${index}`;
    logRecallSetAttr(rowEl, "id", rowId);
    logRecallSetAttr(rowEl, "role", "option");
    logRecallSetAttr(rowEl, "aria-selected", selected ? "true" : "false");
    logRecallSetAttr(rowEl, "data-key", row.key);
    const pill = logRecallCreateElement(rowEl, "span", `bob-task-band-pill ${proseTaskBandPillClass(row)}`, proseTaskPillFor(row));
    void pill;
    if (row.taskKind === "ref") {
      const book = logRecallCreateElement(rowEl, "span", "bob-task-band-book");
      proseApplyIcon(book, "book-open");
    }
    const primary = logRecallCreateElement(rowEl, "span", "bob-link-band-text bob-task-band-text");
    proseTaskBandTitleParts(primary, row);
    const meta = logRecallCreateElement(rowEl, "span", "bob-link-band-meta bob-task-band-meta");
    const runCapsule = runs.get(row.key);
    if (runCapsule) logRecallCreateElement(meta, "span", "bob-task-band-capsule is-group", runCapsule);
    if (row.hidden) logRecallCreateElement(meta, "span", "bob-task-band-capsule is-hidden-tier", "Hidden");
    else if (row.disabled && row.disabled.short) logRecallCreateElement(meta, "span", "bob-task-band-capsule is-guard", String(row.disabled.short));
    proseTaskBandRowLocator(meta, row);
    if (typeof rowEl.addEventListener === "function") {
      rowEl.addEventListener("mousedown", (event) => {
        try { event.preventDefault(); } catch (_error) {}
      });
      if (typeof state.onRowClick === "function") {
        const captured = row;
        rowEl.addEventListener("click", () => state.onRowClick(captured));
      }
    }
  }
}

function proseTaskBandRenderName(root, view) {
  const state = view && typeof view === "object" ? view : {};
  const row = state.nameRow || null;
  const idLine = state.idLine || createProseTaskIdLine("");
  const suggestions = Array.isArray(state.nameSuggestions) ? state.nameSuggestions : [];
  const validation = state.nameValidation || null;
  const pending = state.namePending === true;
  const slots = state.density === "dense" ? PROSE_TASK_SLOTS_DENSE() : PROSE_TASK_SLOTS_ROOMY();
  void slots;
  const pinned = logRecallCreateElement(root, "div", "bob-link-band-row bob-task-band-row is-selected is-pinned");
  logRecallSetAttr(pinned, "role", "option");
  logRecallSetAttr(pinned, "aria-selected", "true");
  logRecallCreateElement(pinned, "span", `bob-task-band-pill ${proseTaskBandPillClass(row)}`, proseTaskPillFor(row));
  const pinnedText = logRecallCreateElement(pinned, "span", "bob-link-band-text bob-task-band-text");
  try { pinnedText.textContent = String((row && (row.displayText || row.primary)) || ""); } catch (_error) {}
  logRecallCreateElement(pinned, "span", "bob-task-band-capsule is-name", "⊕ Add ID");
  const idRow = logRecallCreateElement(root, "div", "bob-link-band-row bob-task-band-id-row is-selected");
  logRecallSetAttr(idRow, "id", `${state.listId || "bob-link-band-list"}-id`);
  logRecallSetAttr(idRow, "role", "option");
  logRecallSetAttr(idRow, "aria-label", `Block ID ${String(idLine.value || "")}`);
  const sigil = logRecallCreateElement(idRow, "span", "bob-task-band-sigil", "^");
  void sigil;
  const idText = logRecallCreateElement(idRow, "span", "bob-task-band-id-entry", String(idLine.value || ""));
  void idText;
  const glyph = validation && validation.ok === false
    ? `✕ ${validation.short || "invalid"}`
    : "✓ free";
  const glyphEl = logRecallCreateElement(idRow, "span", `bob-task-band-glyph${validation && validation.ok === false ? " is-invalid" : " is-valid"}`, pending && PROSE_TASK_NAME_SHOWS_PENDING() ? "Adding…" : glyph);
  void glyphEl;
  const suggRow = logRecallCreateElement(root, "div", "bob-link-band-row bob-task-band-sugg-row");
  const shown = suggestions.filter(Boolean).slice(0, 4);
  if (shown.length) {
    shown.forEach((suggestion, index) => {
      if (index > 0) logRecallCreateElement(suggRow, "span", "bob-task-band-sugg-sep", "·");
      logRecallCreateElement(
        suggRow,
        "span",
        `bob-task-band-sugg${index === 0 ? " is-current" : ""}`,
        String(suggestion),
      );
    });
    logRecallCreateElement(suggRow, "span", "bob-task-band-next", "⇥ next idea");
  } else {
    logRecallCreateElement(suggRow, "span", "bob-task-band-sugg is-none", "type an ID: letters, digits, -");
  }
}

function PROSE_TASK_SLOTS_ROOMY() {
  try {
    if (Number.isInteger(PROSE_LINK_SLOTS_ROOMY)) return PROSE_LINK_SLOTS_ROOMY;
  } catch (_error) {}
  return 5;
}

function PROSE_TASK_SLOTS_DENSE() {
  try {
    if (Number.isInteger(PROSE_LINK_SLOTS_DENSE)) return PROSE_LINK_SLOTS_DENSE;
  } catch (_error) {}
  return 3;
}

function PROSE_TASK_NAME_SHOWS_PENDING() {
  return true;
}

function renderProseTaskBand(host, view) {
  if (!host) return null;
  const state = view && typeof view === "object" ? view : {};
  proseClearHost(host);
  logRecallAddClass(host, "bob-link-band", true);
  logRecallAddClass(host, "bob-task-band", true);
  logRecallAddClass(host, "is-hidden", state.open !== true);
  logRecallAddClass(host, "is-dense", state.density === "dense");
  logRecallAddClass(host, "is-settled", state.fadePlayed === true);
  logRecallAddClass(host, "is-tasks", true);
  logRecallAddClass(host, "is-naming", state.stage === "name");
  if (state.open !== true) return host;
  const slots = state.density === "dense" ? PROSE_TASK_SLOTS_DENSE() : PROSE_TASK_SLOTS_ROOMY();
  try { host.style.setProperty("--bob-link-band-slots", String(slots)); } catch (_error) {}
  const id = state.listId || "bob-link-band-list";
  const root = logRecallCreateElement(host, "div", "bob-link-band-inner");
  const header = logRecallCreateElement(root, "div", "bob-link-band-header");
  const count = state.headerCount || "";
  logRecallCreateElement(header, "span", "bob-link-band-title", state.headerTitle || "🔗 LINK · tasks");
  if (count) logRecallCreateElement(header, "span", "bob-link-band-count", count);
  const list = logRecallCreateElement(root, "div", "bob-link-band-rows");
  logRecallSetAttr(list, "id", id);
  logRecallSetAttr(list, "role", "listbox");
  logRecallSetAttr(list, "aria-label", "Task link completion");
  if (state.stage === "name") {
    proseTaskBandRenderName(list, state);
  } else if ((state.total || 0) === 0) {
    const empty = logRecallCreateElement(list, "div", "bob-link-band-empty");
    logRecallCreateElement(empty, "span", "bob-link-band-empty-text", state.message || "No task matches — keep typing, or esc");
    for (let index = 1; index < slots; index += 1) {
      logRecallCreateElement(list, "div", "bob-link-band-row is-empty");
    }
  } else {
    proseTaskBandRenderList(list, state, slots);
  }
  const detail = logRecallCreateElement(root, "div", "bob-link-band-detail");
  logRecallCreateElement(detail, "span", "bob-link-band-result is-mono", state.detailLeft || "");
  const hints = logRecallCreateElement(detail, "span", "bob-link-band-hints");
  const caps = state.stage === "name"
    ? (state.density === "dense" ? ["esc back"] : ["↵ adds", "esc back"])
    : (state.density === "dense" ? ["⇥ insert"] : ["⇥ insert"]);
  for (const cap of caps) {
    logRecallCreateElement(hints, "span", "bob-log-recall-keycap", cap);
  }
  const right = logRecallCreateElement(detail, "span", "bob-task-band-right", state.detailRight || "");
  void right;
  const live = logRecallCreateElement(root, "span", "bob-link-band-live bob-log-recall-sr-only");
  logRecallSetAttr(live, "aria-live", "polite");
  logRecallSetAttr(live, "role", "status");
  try {
    live.textContent = String(state.liveText || state.detailLeft || "");
  } catch (_error) {}
  return host;
}

function proseTaskBandHeaderCount(selectedIndex, total, indexing) {
  try {
    if (indexing) return `Indexing · ${Number(indexing.done) || 0} of ${Number(indexing.total) || 0} notes`;
    if (!total) return "";
    return `${(Number.isInteger(selectedIndex) ? selectedIndex : 0) + 1} of ${total}`;
  } catch (_error) {
    return "";
  }
}
