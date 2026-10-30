// Pure Task Card type relocation helpers (D8). They never write.
// The picker supplies the field edit, today's daily snapshot, and the
// Ledger Tools type API; these helpers plan the ledger side, render the
// D10 consequence line, and apply the ledger edit with the bullet-move
// subtree primitive and the existing placeholder-cleanup rule.
function taskCardTypeNewTypeForEdit(edit) {
  if (!edit || typeof edit !== "object") {
    return null;
  }
  if (edit.action === "set" && typeof edit.key === "string" && edit.key) {
    const name = typeof edit.name === "string" && edit.name ? edit.name : edit.key;
    return Object.freeze({ key: edit.key, name });
  }
  if (edit.action === "clear") {
    const inherited = edit.target && edit.target.inherited;
    const theme = inherited && inherited.theme;
    if (theme && (theme.key || theme.name)) {
      const key = typeof theme.key === "string" && theme.key
        ? theme.key
        : String(theme.name || "").trim().toLowerCase().replace(/\s+/g, " ");
      const name = typeof theme.name === "string" && theme.name
        ? theme.name
        : theme.key;
      if (key) {
        return Object.freeze({ key, name: name || key });
      }
    }
    return null;
  }
  return null;
}

function taskCardTypeLedgerEntries(dailyContent) {
  const text = String(dailyContent || "");
  let rawEntries = [];
  try {
    const collected = collectPomodoroEntries(text);
    if (collected && Array.isArray(collected.entries)) {
      rawEntries = collected.entries;
    }
  } catch (_error) {
    rawEntries = [];
  }
  let lines = [];
  try {
    lines = splitMarkdownContent(text).lines;
  } catch (_error) {
    lines = text.split(/\r?\n/);
  }
  const timedOpen = rawEntries.filter(
    (entry) => entry && entry.open === true && entry.placeholder !== true,
  );
  const runningLine = timedOpen.length === 1 ? timedOpen[0].entryLine : null;
  const entries = [];
  const details = [];
  for (const raw of rawEntries) {
    const running = raw.entryLine === runningLine;
    const linksList = [];
    const start = Number.isInteger(raw.childStartLine) ? raw.childStartLine : null;
    const end = Number.isInteger(raw.childEndLineExclusive) ? raw.childEndLineExclusive : null;
    if (start !== null && end !== null) {
      for (let line = start; line < end; line += 1) {
        let link = null;
        try {
          link = parseLinkPickerTaskLink(String(lines[line] || ""));
        } catch (_error) {
          link = null;
        }
        if (link) {
          linksList.push(Object.freeze({
            line,
            rawLine: String(lines[line] || ""),
            blockId: link.blockId,
            target: link.target,
          }));
        }
      }
    }
    entries.push(Object.freeze({
      name: typeof raw.name === "string" ? raw.name : raw.name == null ? null : String(raw.name),
      open: raw.open === true,
      running,
      links: linksList.length,
    }));
    details.push(Object.freeze({
      entryLine: raw.entryLine,
      childStartLine: start,
      childEndLineExclusive: end,
      placeholder: raw.placeholder === true,
      name: typeof raw.name === "string" ? raw.name : raw.name == null ? null : String(raw.name),
      open: raw.open === true,
      running,
      linksList: Object.freeze(linksList),
    }));
  }
  return Object.freeze({ entries: Object.freeze(entries), details: Object.freeze(details) });
}

function taskCardTypeLedgerKeys(entries, api) {
  const keys = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const name = entry && typeof entry.name === "string" ? entry.name : null;
    if (!name) continue;
    let components = null;
    try {
      components = api && typeof api.typeComponentsOf === "function"
        ? api.typeComponentsOf(name)
        : null;
    } catch (_error) {
      components = null;
    }
    if (!Array.isArray(components)) continue;
    for (const component of components) {
      if (component && component.isType === true && component.key) {
        keys.add(String(component.key));
      }
    }
  }
  return [...keys];
}

function taskCardTypeFindLiveLink(details, blockId) {
  const id = typeof blockId === "string" ? blockId.trim() : "";
  if (!id) return null;
  const matches = [];
  const list = Array.isArray(details) ? details : [];
  for (let entryIndex = 0; entryIndex < list.length; entryIndex += 1) {
    const detail = list[entryIndex];
    const links = detail && Array.isArray(detail.linksList) ? detail.linksList : [];
    for (const item of links) {
      if (item && item.blockId === id) {
        matches.push(Object.freeze({ entryIndex, line: item.line, rawLine: item.rawLine, entry: detail }));
      }
    }
  }
  if (matches.length === 0) return null;
  if (matches.length !== 1) return Object.freeze({ multiple: true, matches: Object.freeze(matches) });
  return matches[0];
}

function taskCardTypeConsequence(edit, relocationInfo) {
  const info = relocationInfo && typeof relocationInfo === "object" ? relocationInfo : {};
  const relocation = info.relocation || null;
  const sourceName = typeof info.sourceEntryName === "string" && info.sourceEntryName
    ? info.sourceEntryName
    : "FIX";
  const newType = info.newType && typeof info.newType.name === "string" && info.newType.name
    ? info.newType.name
    : typeof info.newTypeName === "string" && info.newTypeName
      ? info.newTypeName
      : null;
  if (!relocation || relocation.kind === "unchanged") {
    if (info.hasLiveLink !== true) {
      return "no live link · ledger unchanged";
    }
    return `already under ${newType || sourceName}`;
  }
  if (relocation.kind === "refused") {
    const typeName = relocation.typeName || newType || "TYPE";
    const cap = Number(relocation.cap) || 0;
    const before = Number(relocation.themesBefore) || 0;
    return `plan.strict: ${typeName} would be type ${before + 1} of ${cap} · nothing written`;
  }
  if (relocation.kind === "renameEntry" || relocation.kind === "appendComponent") {
    const next = typeof relocation.newName === "string" && relocation.newName
      ? relocation.newName
      : newType || sourceName;
    return `running ${sourceName} becomes ${next}`;
  }
  if (relocation.kind === "moveTo") {
    return `link moves ${sourceName} → ${newType || sourceName}`;
  }
  if (relocation.kind === "renamePlaceholder") {
    return `${sourceName} placeholder becomes ${newType || sourceName}`;
  }
  if (relocation.kind === "createBelow") {
    const name = typeof relocation.name === "string" && relocation.name
      ? relocation.name
      : newType || sourceName;
    return `new ${name} Pomodoro below ${sourceName}`;
  }
  return "no live link · ledger unchanged";
}

function taskCardTypeApplyLedgerEdit(dailyContent, relocation, liveLink, details) {
  const text = String(dailyContent || "");
  if (!relocation || relocation.kind === "unchanged" || relocation.kind === "refused") {
    return Object.freeze({ valid: true, after: text, changed: false });
  }
  let lines = [];
  let lineEnding = "\n";
  try {
    const split = splitMarkdownContent(text);
    lines = split.lines;
    lineEnding = split.lineEnding || "\n";
  } catch (_error) {
    return Object.freeze({ valid: false, error: "Daily note could not be read", after: text });
  }
  const list = Array.isArray(details) ? details : [];
  if (relocation.kind === "renameEntry" || relocation.kind === "appendComponent" || relocation.kind === "renamePlaceholder") {
    const detail = list[relocation.index];
    if (!detail || !Number.isInteger(detail.entryLine)) {
      return Object.freeze({ valid: false, error: "Pomodoro entry changed; reopen the card", after: text });
    }
    const plan = planPomodoroEntryRename(text, {
      sourceEntryLine: detail.entryLine,
      sourceRawLine: String(lines[detail.entryLine] || ""),
      name: relocation.newName,
      preserveSpelling: true,
    });
    if (!plan.valid) {
      return Object.freeze({ valid: false, error: plan.error || "Pomodoro entry could not be renamed", after: text });
    }
    return Object.freeze({ valid: true, after: plan.after, changed: plan.after !== text });
  }
  if (relocation.kind === "moveTo") {
    const source = list[relocation.from];
    const dest = list[relocation.to];
    if (!source || !dest || !liveLink || !Number.isInteger(liveLink.line)) {
      return Object.freeze({ valid: false, error: "Task link changed; reopen the card", after: text });
    }
    if (String(lines[liveLink.line] || "") !== liveLink.rawLine) {
      return Object.freeze({ valid: false, error: "Task link changed; reopen the card", after: text });
    }
    const plan = planPomodoroBulletMove(text, {
      targets: [{ line: liveLink.line, rawLine: liveLink.rawLine }],
      sourceEntryLine: source.entryLine,
      sourceRawLine: String(lines[source.entryLine] || ""),
      destination: { kind: "existing", entryLine: dest.entryLine },
      preserveSourceEntry: source.placeholder !== true,
    });
    if (!plan.valid) {
      return Object.freeze({ valid: false, error: plan.error || "Task link could not be moved", after: text });
    }
    return Object.freeze({ valid: true, after: plan.after, changed: plan.after !== text });
  }
  if (relocation.kind === "createBelow") {
    const source = list[relocation.from];
    if (!source || !liveLink || !Number.isInteger(liveLink.line)) {
      return Object.freeze({ valid: false, error: "Task link changed; reopen the card", after: text });
    }
    if (String(lines[liveLink.line] || "") !== liveLink.rawLine) {
      return Object.freeze({ valid: false, error: "Task link changed; reopen the card", after: text });
    }
    const plan = planPomodoroBulletMove(text, {
      targets: [{ line: liveLink.line, rawLine: liveLink.rawLine }],
      sourceEntryLine: source.entryLine,
      sourceRawLine: String(lines[source.entryLine] || ""),
      destination: { kind: "new", name: relocation.name, preserveSpelling: true },
      preserveSourceEntry: source.placeholder !== true,
    });
    if (!plan.valid) {
      return Object.freeze({ valid: false, error: plan.error || "Task link could not be moved", after: text });
    }
    return Object.freeze({ valid: true, after: plan.after, changed: plan.after !== text });
  }
  return Object.freeze({ valid: false, error: "Task link could not be moved", after: text });
}

function planTaskCardTypeLedgerMoves(edits, dailyContent, api) {
  const working = { content: String(dailyContent || ""), moves: [], refused: null };
  let built = null;
  try {
    built = taskCardTypeLedgerEntries(working.content);
  } catch (_error) {
    return { valid: false, error: "Daily note could not be read", moves: [], refused: null, content: working.content };
  }
  for (const edit of Array.isArray(edits) ? edits : []) {
    const newType = taskCardTypeNewTypeForEdit(edit);
    if (!newType) continue;
    const blockId = edit.target && edit.target.identity && edit.target.identity.blockId;
    let details = built.details;
    let entries = built.entries;
    try {
      const rebuilt = taskCardTypeLedgerEntries(working.content);
      details = rebuilt.details;
      entries = rebuilt.entries;
      built = rebuilt;
    } catch (_error) {
      // Keep the last good snapshot.
    }
    const found = taskCardTypeFindLiveLink(details, blockId);
    if (!found || found.multiple === true) continue;
    let relocation = null;
    try {
      relocation = api.planRelocation({
        entries,
        liveLink: found.entryIndex,
        typeKey: newType.key,
        typeName: newType.name,
      });
    } catch (_error) {
      relocation = null;
    }
    if (!relocation) continue;
    if (relocation.kind === "refused") {
      const sourceName = entries[found.entryIndex] && entries[found.entryIndex].name;
      return {
        valid: true,
        refused: { relocation, sourceName, newType, edit },
        moves: working.moves,
        content: working.content,
      };
    }
    if (relocation.kind === "unchanged") continue;
    const applied = taskCardTypeApplyLedgerEdit(working.content, relocation, found, details);
    if (!applied.valid) {
      return { valid: false, error: applied.error || "Task link could not be moved", moves: working.moves, refused: null, content: working.content };
    }
    if (applied.changed) {
      working.content = applied.after;
    }
    const sourceName = entries[found.entryIndex] && entries[found.entryIndex].name;
    let destinationName = newType.name;
    try {
      const rebuilt = taskCardTypeLedgerEntries(working.content);
      if (relocation.kind === "moveTo" && rebuilt.entries[relocation.to]) {
        destinationName = rebuilt.entries[relocation.to].name || newType.name;
      } else if ((relocation.kind === "renameEntry" || relocation.kind === "appendComponent" || relocation.kind === "renamePlaceholder") && typeof relocation.newName === "string" && relocation.newName) {
        destinationName = relocation.newName;
      } else if (relocation.kind === "createBelow" && typeof relocation.name === "string" && relocation.name) {
        destinationName = relocation.name;
      }
    } catch (_error) {
      // Destination naming is best-effort.
    }
    working.moves.push(Object.freeze({ edit, relocation, liveLink: found, sourceName, destinationName, newType }));
  }
  return { valid: true, error: null, moves: working.moves, refused: null, content: working.content };
}

async function writeTaskCardTypeDailyContent(deps, snapshot, preimage, nextContent) {
  const plugin = deps && deps.plugin;
  const app = deps && deps.app;
  if (!snapshot || typeof nextContent !== "string") return false;
  if (String(preimage || "") === String(nextContent || "")) return true;
  const dailyPath = normalizeVaultRelativePath(snapshot.dailyPath || "");
  if (!dailyPath) return false;
  try {
    const openEditor = plugin && typeof plugin.getOpenMarkdownEditorForPath === "function"
      ? plugin.getOpenMarkdownEditorForPath(dailyPath)
      : (snapshot.editor && typeof snapshot.editor.getValue === "function" ? snapshot.editor : null);
    if (openEditor && typeof openEditor.getValue === "function") {
      if (String(openEditor.getValue() || "") !== String(preimage || "")) {
        return false;
      }
      const cursor = typeof openEditor.getCursor === "function" ? openEditor.getCursor() : null;
      const applied = applyEditorContentTransaction(openEditor, String(preimage || ""), String(nextContent || ""), cursor ? { line: cursor.line, ch: cursor.ch } : null);
      return applied && String(openEditor.getValue() || "") === String(nextContent || "");
    }
  } catch (_error) {
    return false;
  }
  try {
    const vault = app && app.vault;
    const file = snapshot.file || (vault && typeof vault.getAbstractFileByPath === "function" ? vault.getAbstractFileByPath(dailyPath) : null);
    if (!vault || typeof vault.process !== "function" || !file) return false;
    let wrote = false;
    await vault.process(file, (content) => {
      if (String(content || "") !== String(preimage || "")) {
        throw new Error("Daily note preimage changed");
      }
      wrote = true;
      return String(nextContent || "");
    });
    return wrote;
  } catch (_error) {
    return false;
  }
}
