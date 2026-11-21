// LINK band renderer (phase bob-cli-om.3). Paints into a host-owned slot
// using the same element helpers as USED BEFORE. Never throws, never
// writes innerHTML, never moves focus.

function proseApplyIcon(el, iconName) {
  if (!el) return;
  try {
    if (typeof el.setAttribute === "function") el.setAttribute("data-icon", String(iconName || ""));
  } catch (_error) {}
  try {
    const paint = typeof setIcon === "function"
      ? setIcon
      : (typeof obsidian !== "undefined" && obsidian && typeof obsidian.setIcon === "function" ? obsidian.setIcon : null);
    if (typeof paint === "function") paint(el, iconName);
  } catch (_error) {}
}

function proseHighlightText(rowEl, text, ranges) {
  const source = String(text == null ? "" : text);
  const spans = Array.isArray(ranges) ? ranges.filter((range) => Array.isArray(range) && range.length >= 2) : [];
  if (!spans.length || typeof rowEl.createSpan !== "function") {
    try { rowEl.textContent = source; } catch (_error) {}
    return;
  }
  try { rowEl.textContent = ""; } catch (_error) {}
  let cursor = 0;
  for (const [start, end] of spans) {
    const from = Math.max(0, Math.min(source.length, start));
    const to = Math.max(from, Math.min(source.length, end));
    if (from > cursor && typeof rowEl.appendText === "function") rowEl.appendText(source.slice(cursor, from));
    else if (from > cursor) {
      const gap = logRecallCreateElement(rowEl, "span", "", source.slice(cursor, from));
      void gap;
    }
    logRecallCreateElement(rowEl, "span", "bob-link-band-match", source.slice(from, to));
    cursor = to;
  }
  if (cursor < source.length && typeof rowEl.appendText === "function") rowEl.appendText(source.slice(cursor));
  else if (cursor < source.length) logRecallCreateElement(rowEl, "span", "", source.slice(cursor));
}

function proseCapsuleFor(row) {
  if (!row) return null;
  if (row.reason) return { text: row.reason, cls: "is-reason" };
  if (row.alias) return { text: "Alias", cls: "is-alias" };
  if (row.kind === "heading" && row.level) return { text: `H${row.level}`, cls: "is-heading" };
  if (row.kind === "block" && row.blockId) return { text: `^${row.blockId}`, cls: "is-block" };
  if (row.tier === "archive") return { text: "Archived", cls: "is-archive" };
  if (row.tier === "hidden") return { text: "Hidden", cls: "is-hidden-tier" };
  return null;
}

function proseKeycapsFor(field, density) {
  if (density === "dense") return ["⇥ insert"];
  if (!field || field.aliasStage) return [];
  if (field.context === LINK_CONTEXT_HEADING || field.context === LINK_CONTEXT_BLOCK) {
    return ["⇥ insert"];
  }
  return ["⇥ insert", "# heading", "^ block", "| alias"];
}

function proseClearHost(host) {
  if (!host) return;
  try {
    if (typeof host.empty === "function") host.empty();
    else while (host.firstChild) host.removeChild(host.firstChild);
  } catch (_error) {
    try { host.textContent = ""; } catch (_ignored) {}
  }
}

function renderProseLinkBand(host, view) {
  if (!host) return null;
  const state = view && typeof view === "object" ? view : {};
  proseClearHost(host);
  const open = state.open === true;
  logRecallAddClass(host, "bob-link-band", true);
  logRecallAddClass(host, "is-hidden", !open);
  logRecallAddClass(host, "is-dense", state.density === "dense");
  logRecallAddClass(host, "is-settled", state.fadePlayed === true);
  if (!open) return host;
  const slots = state.density === "dense" ? PROSE_LINK_SLOTS_DENSE : PROSE_LINK_SLOTS_ROOMY;
  try { host.style.setProperty("--bob-link-band-slots", String(slots)); } catch (_error) {}
  try { host.style.setProperty("--bob-log-recall-slots", String(slots)); } catch (_error) {}
  const id = state.listId || "bob-link-band-list";
  const root = logRecallCreateElement(host, "div", "bob-link-band-inner");
  const header = logRecallCreateElement(root, "div", "bob-link-band-header");
  const crumb = state.crumb || "notes";
  const total = Number(state.total) || 0;
  const selectedIndex = Number.isInteger(state.selectedIndex) ? state.selectedIndex : -1;
  const count = total > 0 && selectedIndex >= 0 ? `${selectedIndex + 1} of ${total}` : "";
  logRecallCreateElement(header, "span", "bob-link-band-title", `🔗 LINK · ${crumb}`);
  if (count) logRecallCreateElement(header, "span", "bob-link-band-count", count);
  const list = logRecallCreateElement(root, "div", "bob-link-band-rows");
  logRecallSetAttr(list, "id", id);
  logRecallSetAttr(list, "role", "listbox");
  logRecallSetAttr(list, "aria-label", "Wikilink completion");
  const windowed = Array.isArray(state.view) ? state.view : [];
  const emptyMessage = state.message || null;
  if (emptyMessage && total === 0) {
    const empty = logRecallCreateElement(list, "div", "bob-link-band-empty");
    logRecallCreateElement(empty, "span", "bob-link-band-empty-text", emptyMessage);
    for (let index = 1; index < slots; index += 1) {
      logRecallCreateElement(list, "div", "bob-link-band-row is-empty");
    }
  } else {
    for (let index = 0; index < slots; index += 1) {
      const row = windowed[index];
      if (!row) {
        logRecallCreateElement(list, "div", "bob-link-band-row is-empty");
        continue;
      }
      const selected = row.key === state.selectedKey;
      const dim = row.tier === "archive" || row.tier === "hidden";
      const rowEl = logRecallCreateElement(
        list,
        "div",
        `bob-link-band-row${selected ? " is-selected" : ""}${dim ? " is-dim" : ""}`,
      );
      const rowId = `${id}-${index}`;
      logRecallSetAttr(rowEl, "id", rowId);
      logRecallSetAttr(rowEl, "role", "option");
      logRecallSetAttr(rowEl, "aria-selected", selected ? "true" : "false");
      logRecallSetAttr(rowEl, "data-key", row.key);
      const indent = row.kind === "heading" ? Math.min(3, Math.max(0, (Number(row.level) || 1) - 1)) : 0;
      if (indent) {
        try { rowEl.style.setProperty("--bob-link-band-indent", `${indent * 8}px`); } catch (_error) {}
        logRecallAddClass(rowEl, "is-indented", true);
      }
      const icon = logRecallCreateElement(rowEl, "span", "bob-link-band-icon");
      proseApplyIcon(icon, proseIconForRow(row));
      const primary = logRecallCreateElement(rowEl, "span", "bob-link-band-text");
      const primaryText = row.kind === "block" && row.preview ? row.preview : row.primary || row.stem || "";
      proseHighlightText(primary, primaryText, row.matchRanges);
      const meta = logRecallCreateElement(rowEl, "span", "bob-link-band-meta");
      if (row.alias) {
        logRecallCreateElement(meta, "span", "bob-link-band-secondary", `→ ${row.stem}`);
      } else if (row.folder) {
        logRecallCreateElement(meta, "span", "bob-link-band-folder", row.folder);
      }
      const capsule = proseCapsuleFor(row);
      if (capsule) logRecallCreateElement(meta, "span", `bob-link-band-capsule ${capsule.cls}`, capsule.text);
      if (typeof rowEl.addEventListener === "function") {
        rowEl.addEventListener("mousedown", (event) => {
          try { event.preventDefault(); } catch (_error) {}
        });
        if (typeof state.onRowClick === "function") {
          rowEl.addEventListener("click", () => state.onRowClick(row));
        }
      }
    }
  }
  const detail = logRecallCreateElement(root, "div", "bob-link-band-detail");
  const selected = (state.rows || []).find((row) => row && row.key === state.selectedKey) || null;
  if (state.aliasStage) {
    logRecallCreateElement(detail, "span", "bob-link-band-result", "Type the label — ↵ finishes the link");
    if (state.resultLink) logRecallCreateElement(detail, "span", "bob-link-band-result is-mono", `↵ ${state.resultLink}`);
  } else if (total === 0) {
    logRecallCreateElement(detail, "span", "bob-link-band-result", "↵ closes this list · nothing is inserted");
    logRecallCreateElement(detail, "span", "bob-link-band-keycaps", "");
    const caps = logRecallCreateElement(detail, "span", "bob-link-band-hints");
    logRecallCreateElement(caps, "span", "bob-log-recall-keycap", "esc close");
  } else {
    const result = (selected && selected.resultLink) || state.resultLink || "";
    logRecallCreateElement(detail, "span", "bob-link-band-result is-mono", result ? `↵ ${result}` : "");
    const hints = logRecallCreateElement(detail, "span", "bob-link-band-hints");
    for (const cap of proseKeycapsFor(state.field, state.density)) {
      logRecallCreateElement(hints, "span", "bob-log-recall-keycap", cap);
    }
  }
  const live = logRecallCreateElement(root, "span", "bob-link-band-live bob-log-recall-sr-only");
  logRecallSetAttr(live, "aria-live", "polite");
  logRecallSetAttr(live, "role", "status");
  if (selected && total > 0) {
    live.textContent = `Link ${selectedIndex + 1} of ${total}: ${selected.primary || selected.stem || ""}`;
  } else if (state.aliasStage) {
    live.textContent = "Alias stage. Enter finishes the link.";
  } else if (emptyMessage) {
    live.textContent = emptyMessage;
  }
  return host;
}

function renderProseLinkHint(host, messages) {
  if (!host) return null;
  proseClearHost(host);
  const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
  logRecallAddClass(host, "bob-link-hint", true);
  logRecallAddClass(host, "is-hidden", list.length === 0);
  if (list.length === 0) return host;
  const line = logRecallCreateElement(host, "div", "bob-link-hint-line");
  logRecallCreateElement(line, "span", "bob-link-hint-text", list[0]);
  if (list[1]) logRecallCreateElement(line, "span", "bob-link-hint-more", list[1]);
  return host;
}

function proseBindInputAria(inputEl, view) {
  if (!inputEl) return;
  const state = view && typeof view === "object" ? view : {};
  const isTextarea = String(inputEl.tagName || "").toLowerCase() === "textarea";
  try {
    if (state.open) {
      if (!isTextarea) logRecallSetAttr(inputEl, "aria-autocomplete", "list");
      logRecallSetAttr(inputEl, "aria-expanded", "true");
      logRecallSetAttr(inputEl, "aria-controls", state.listId || "bob-link-band-list");
      const windowed = Array.isArray(state.view) ? state.view : [];
      const selectedAt = windowed.findIndex((row) => row && row.key === state.selectedKey);
      if (selectedAt >= 0) {
        logRecallSetAttr(inputEl, "aria-activedescendant", `${state.listId || "bob-link-band-list"}-${selectedAt}`);
      } else {
        try { inputEl.removeAttribute("aria-activedescendant"); } catch (_error) {}
      }
    } else {
      proseClearInputAria(inputEl);
    }
  } catch (_error) {}
}

function proseClearInputAria(inputEl) {
  if (!inputEl) return;
  try { inputEl.removeAttribute("aria-autocomplete"); } catch (_error) {}
  try { inputEl.removeAttribute("aria-expanded"); } catch (_error) {}
  try { inputEl.removeAttribute("aria-controls"); } catch (_error) {}
  try { inputEl.removeAttribute("aria-activedescendant"); } catch (_error) {}
}
