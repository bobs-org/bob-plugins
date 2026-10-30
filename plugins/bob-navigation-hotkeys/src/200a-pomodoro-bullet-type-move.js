function pomodoroBulletMoveDestinationName(row) {
  if (!row || typeof row !== "object") {
    return "";
  }
  if (row.kind === "existing") {
    return String(getNormalizedPomodoroEntryName(row.entry) || "").trim();
  }
  return String(row.name || "").trim();
}

function pomodoroBulletMovePickerRowKey(row) {
  if (!row || typeof row !== "object") {
    return "";
  }
  if (row.kind === "existing") {
    const entry = row.entry || {};
    return `existing:${entry.entryLine}:${String(entry.name || "")}`;
  }
  return `${String(row.kind || "")}:${String(row.name || "")}`;
}

function pomodoroBulletMoveTypeCandidates(api, destinationName) {
  try {
    const rows = api && typeof api.typeComponentsOf === "function"
      ? api.typeComponentsOf(destinationName)
      : [];
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.isType === true && row.key && row.name)
      .map((row) => ({ key: String(row.key), name: String(row.name) }));
  } catch (_error) {
    return [];
  }
}

function collectPomodoroBulletMoveTaskLinks(session) {
  const content = String(session && session.sourceContent || "");
  const lines = splitMarkdownContent(content).lines;
  const context = session && session.discovery && session.discovery.context;
  const entry = context && context.entry;
  if (!entry) {
    return [];
  }
  const byIdentity = new Map();
  for (const target of session.discovery.targets || []) {
    const subtree = capturePomodoroBulletSubtree(
      lines,
      target.line,
      entry.childEndLineExclusive,
    );
    for (let line = subtree.startLine; line < subtree.endLineExclusive; line += 1) {
      const rawLine = String(lines[line] || "");
      const link = parseLinkPickerTaskLink(rawLine);
      if (!link) {
        continue;
      }
      const identity = `${link.target}\u0000${link.blockId}`;
      if (!byIdentity.has(identity)) {
        byIdentity.set(identity, Object.freeze({ line, rawLine, link }));
      }
    }
  }
  return [...byIdentity.values()];
}

function pomodoroBulletMoveTaskTypeParts(effective, field) {
  const inherited = effective && effective.inherited
    ? effective.inherited
    : field && field.state === "set"
      ? null
      : effective;
  const theme = effective && effective.theme && typeof effective.theme === "object"
    ? effective.theme
    : null;
  return {
    inherited,
    key: theme && typeof theme.key === "string" ? theme.key : null,
    name: theme && typeof theme.name === "string"
      ? theme.name
      : effective && typeof effective.name === "string"
        ? effective.name
        : null,
  };
}

async function resolvePomodoroBulletMoveTypePreview(plugin, session) {
  const links = collectPomodoroBulletMoveTaskLinks(session);
  const api = getNavigationPomodoroThemesApi(plugin && plugin.app);
  const preview = {
    api,
    candidates: links.length,
    unresolved: 0,
    records: [],
    error: null,
  };
  if (links.length === 0) {
    return preview;
  }
  if (
    !api ||
    typeof api.effectiveTypeFor !== "function" ||
    typeof api.taskThemeOf !== "function" ||
    typeof api.planRetype !== "function"
  ) {
    preview.error = "Task type routing is unavailable";
    return preview;
  }

  const noteContents = new Map();
  const records = [];
  for (const candidate of links) {
    const linkTarget = `${candidate.link.target}#^${candidate.link.blockId}`;
    let file = null;
    try {
      file = plugin.resolveLinkTargetFile(linkTarget, session.sourcePath);
    } catch (_error) {
      file = null;
    }
    if (!file || !plugin.isMarkdownFile(file)) {
      preview.unresolved += 1;
      continue;
    }
    const path = normalizeVaultRelativePath(file.path);
    if (!path) {
      preview.unresolved += 1;
      continue;
    }
    let content;
    if (noteContents.has(path)) {
      content = noteContents.get(path);
    } else if (path === normalizeVaultRelativePath(session.sourcePath)) {
      content = String(session.sourceContent || "");
      noteContents.set(path, content);
    } else {
      try {
        content = await plugin.readLinkPickerNoteContent(path, file);
      } catch (_error) {
        content = null;
      }
      if (typeof content === "string") {
        noteContents.set(path, content);
      }
    }
    if (typeof content !== "string") {
      preview.unresolved += 1;
      continue;
    }
    const resolved = findUniqueLinkPickerTargetLine(
      content,
      candidate.link.blockId,
      { allowClosed: true },
    );
    if (!resolved.valid || !isOpenObsidianTaskLine(resolved.rawLine)) {
      preview.unresolved += 1;
      continue;
    }

    let field;
    let effective;
    try {
      field = api.taskThemeOf(resolved.rawLine);
      effective = api.effectiveTypeFor({
        path,
        line: resolved.line + 1,
        text: content,
      });
    } catch (_error) {
      preview.error = "Task type routing could not read a linked task";
      return preview;
    }
    if (!field || typeof field !== "object") {
      preview.error = "Task type routing could not read a linked task";
      return preview;
    }
    const type = pomodoroBulletMoveTaskTypeParts(effective, field);
    records.push(Object.freeze({
      path,
      file,
      content,
      line: resolved.line,
      rawLine: resolved.rawLine,
      blockId: candidate.link.blockId,
      field,
      effective,
      inherited: type.inherited,
      typeKey: type.key,
      typeName: type.name,
    }));
  }
  preview.records = records;
  return preview;
}

function planPomodoroBulletMoveRetypes(api, records, destinationName, tabPick) {
  if (!api || typeof api.planRetype !== "function") {
    return [];
  }
  return (Array.isArray(records) ? records : []).map((record) => {
    let plan = null;
    try {
      plan = api.planRetype({
        field: record.field,
        effective: record.effective,
        inherited: record.inherited,
        destination: destinationName,
        ...(tabPick ? { tabPick } : {}),
      });
    } catch (_error) {
      plan = null;
    }
    return Object.freeze({ record, plan });
  });
}

function pomodoroBulletMoveRetypeDefaultKey(api, records, destinationName) {
  const plans = planPomodoroBulletMoveRetypes(api, records, destinationName);
  const selected = plans.find((item) => item.plan && item.plan.kind === "set");
  if (selected) {
    return selected.plan.key || null;
  }
  const candidates = pomodoroBulletMoveTypeCandidates(api, destinationName);
  return candidates.length ? candidates[0].key : null;
}

function pomodoroBulletMoveTypeName(effective) {
  const theme = effective && effective.theme && typeof effective.theme === "object"
    ? effective.theme
    : null;
  if (theme && typeof theme.name === "string" && theme.name) {
    return theme.name;
  }
  return effective && typeof effective.name === "string" ? effective.name : "";
}

function mergePomodoroBulletMoveTaskTypes(api, records, destinationName) {
  let name = String(destinationName || "").trim();
  const appended = [];
  for (const record of Array.isArray(records) ? records : []) {
    let outcome = null;
    try {
      outcome = api.planRetype({
        field: record.field,
        effective: record.effective,
        inherited: record.inherited,
        destination: destinationName,
        keepType: true,
      });
    } catch (_error) {
      outcome = null;
    }
    if (!outcome || outcome.kind !== "merge" || !record.typeKey) {
      continue;
    }
    let currentKeys = new Set();
    try {
      currentKeys = new Set(
        (api.typeComponentsOf(name) || []).map((component) => component && component.key).filter(Boolean),
      );
    } catch (_error) {
      currentKeys = new Set();
    }
    if (currentKeys.has(record.typeKey)) {
      continue;
    }
    const typeName = pomodoroBulletMoveTypeName(record.effective);
    if (!typeName) {
      continue;
    }
    name = name ? `${name} + ${typeName}` : typeName;
    appended.push(typeName);
  }
  return Object.freeze({ name, appended: Object.freeze(appended) });
}

function pomodoroBulletMoveSuggestionText(effective) {
  const label = String(effective && effective.label || "").trim();
  const name = pomodoroBulletMoveTypeName(effective);
  if (!label || !name) {
    return "";
  }
  const source = label.replace(/^from\s+/i, "");
  return `${source} suggests ${name}`;
}

function pomodoroBulletMovePickerTabPick(modal, row) {
  const key = pomodoroBulletMovePickerRowKey(row);
  return key && modal.moveTypePicks instanceof Map
    ? modal.moveTypePicks.get(key) || null
    : null;
}

function pomodoroBulletMovePickerCommitOptions(modal, row) {
  return {
    typePreviewState: modal && modal.moveTypePreviewState,
    typeMode: modal && modal.pendingMoveTypeMode === "keepType"
      ? "keepType"
      : "retype",
    tabPick: pomodoroBulletMovePickerTabPick(modal, row),
    typePreview: modal && modal.moveTypePreview,
  };
}

function pomodoroBulletMovePickerConsequence(modal, row) {
  const state = modal && modal.moveTypePreviewState;
  if (state === "loading") {
    return "Checking linked task types…";
  }
  const preview = modal && modal.moveTypePreview;
  if (state === "unavailable" || preview && preview.error) {
    return "Task type preview unavailable · nothing will be moved";
  }
  const candidates = pomodoroBulletMoveTypeCandidates(
    preview && preview.api,
    pomodoroBulletMoveDestinationName(row),
  );
  const destinationName = pomodoroBulletMoveDestinationName(row) || "unnamed";
  const records = preview && Array.isArray(preview.records) ? preview.records : [];
  if (!preview || !preview.candidates) {
    return "no live link · ledger unchanged";
  }
  if (records.length === 0) {
    const unresolved = preview.unresolved > 0
      ? ` · ${preview.unresolved} links not retyped`
      : "";
    return `${destinationName} · no open task types change${unresolved}`;
  }

  const selectedPick = pomodoroBulletMovePickerTabPick(modal, row);
  const plans = planPomodoroBulletMoveRetypes(
    preview.api,
    records,
    destinationName,
    selectedPick,
  );
  const changes = plans.filter((item) =>
    item.plan && (item.plan.kind === "set" || item.plan.kind === "clear"),
  );
  let targetLabel = destinationName;
  const setNames = [...new Set(changes
    .filter((item) => item.plan.kind === "set")
    .map((item) => item.plan.name)
    .filter(Boolean))];
  const clearCount = changes.filter((item) => item.plan.kind === "clear").length;
  if (setNames.length === 1 && clearCount === 0) {
    targetLabel = setNames[0];
  } else if (setNames.length === 0 && clearCount > 0) {
    const inheritedName = changes.find((item) => item.plan.kind === "clear")
      ?.record.inherited;
    targetLabel = pomodoroBulletMoveTypeName(inheritedName) || destinationName;
  }
  let consequence;
  if (changes.length === 0) {
    const kept = [...new Set(records.map((record) => record.typeName).filter(Boolean))];
    consequence = kept.length === 1
      ? `→ ${destinationName} · keeps ${kept[0]}`
      : `→ ${destinationName} · keeps task types`;
  } else if (clearCount > 0 && setNames.length === 0 && changes.length === 1) {
    const inherited = changes[0].record.inherited;
    const label = String(inherited && inherited.label || "").trim();
    consequence = `→ ${targetLabel} · type cleared${label ? ` · ${label}` : ""}`;
  } else if (setNames.length === 1 && clearCount === 0) {
    const taskCount = changes.length === 1 ? "task" : `${changes.length} tasks`;
    consequence = `→ ${targetLabel} · ${taskCount} become${changes.length === 1 ? "s" : ""} ${targetLabel}`;
    if (changes.length === 1) {
      const suggestion = pomodoroBulletMoveSuggestionText(changes[0].record.effective);
      if (suggestion) {
        consequence += ` · ${suggestion}`;
      }
    }
  } else {
    consequence = `→ ${destinationName} · ${changes.length} task types change`;
  }

  const merged = mergePomodoroBulletMoveTaskTypes(
    preview.api,
    records,
    destinationName,
  );
  if (merged.name && merged.name !== destinationName) {
    const names = [...new Set(records.map((record) => record.typeName).filter(Boolean))];
    if (records.length === 1 && names.length === 1) {
      consequence += ` · ⌥↵ keep ${names[0]} (${merged.name})`;
    } else {
      consequence += ` · ⌥↵ keep types (${merged.name})`;
    }
  }
  if (candidates.length > 1) {
    const currentKey = selectedPick || pomodoroBulletMoveRetypeDefaultKey(
      preview.api,
      records,
      destinationName,
    );
    const currentIndex = Math.max(0, candidates.findIndex((item) => item.key === currentKey));
    const next = candidates[(currentIndex + 1) % candidates.length];
    if (next) {
      consequence += ` · ⇥ ${next.name}`;
    }
  }
  if (preview.unresolved > 0) {
    consequence += ` · ${preview.unresolved} links not retyped`;
  }
  return consequence;
}

function pomodoroEntryRenameTypeConsequence(modal, row) {
  const isRename = row && (row.kind === "rename" ||
    (row.kind === "recent" && row.operation === "rename"));
  if (!isRename) {
    return null;
  }
  const state = modal && modal.renameTypePreviewState;
  if (state === "loading") {
    return "Checking linked task types…";
  }
  const preview = modal && modal.renameTypePreview;
  if (state === "unavailable" || preview && preview.error) {
    return "Task type preview unavailable · nothing will be renamed";
  }
  if (!preview || !preview.candidates) {
    return "No linked tasks · task types unchanged";
  }
  const plans = pomodoroBulletMoveTypePlanRows(
    preview.api,
    preview,
    String(row.name || "").trim(),
    {},
  );
  if (plans.some((item) => !item.plan)) {
    return "Task type preview unavailable · nothing will be renamed";
  }
  const changes = new Map();
  let inheritedCount = 0;
  for (const item of plans) {
    if (item.plan.kind === "set") {
      const name = String(item.plan.name || "type");
      changes.set(name, (changes.get(name) || 0) + 1);
    } else if (item.plan.kind === "clear") {
      inheritedCount += 1;
    }
  }
  const countText = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;
  const pieces = [...changes.entries()].map(([name, count]) =>
    `${countText(count, "task", "tasks")} ${count === 1 ? "becomes" : "become"} ${name}`,
  );
  if (inheritedCount > 0) {
    pieces.push(`${countText(inheritedCount, "task", "tasks")} ${inheritedCount === 1 ? "uses" : "use"} inherited types`);
  }
  if (pieces.length === 0) {
    const container = plans.some((item) => item.plan.kind === "container");
    const unresolved = Number(preview.unresolved) || 0;
    const reason = container
      ? "Container or label destination · no task types change"
      : "All linked tasks already agree · no task types change";
    return unresolved > 0 ? `${reason} · ${unresolved} links not checked` : reason;
  }
  const unresolved = Number(preview.unresolved) || 0;
  const suffix = unresolved > 0 ? ` · ${unresolved} links not checked` : "";
  return `${pieces.join(" · ")}${suffix}`;
}

function cyclePomodoroBulletMoveType(modal, row, backwards = false) {
  const preview = modal && modal.moveTypePreview;
  if (!preview || preview.error || !preview.api) {
    return false;
  }
  const destinationName = pomodoroBulletMoveDestinationName(row);
  const candidates = pomodoroBulletMoveTypeCandidates(preview.api, destinationName);
  if (candidates.length < 2) {
    return false;
  }
  const rowKey = pomodoroBulletMovePickerRowKey(row);
  const selected = pomodoroBulletMovePickerTabPick(modal, row);
  const currentKey = selected || pomodoroBulletMoveRetypeDefaultKey(
    preview.api,
    preview.records,
    destinationName,
  );
  const currentIndex = Math.max(0, candidates.findIndex((item) => item.key === currentKey));
  const nextIndex = (currentIndex + (backwards ? -1 : 1) + candidates.length) % candidates.length;
  modal.moveTypePicks.set(rowKey, candidates[nextIndex].key);
  modal.renderResults();
  return true;
}

function installPomodoroEntryMoveTypePreview() {
  const prototype = PomodoroEntryMovePickerModal.prototype;
  const originalOnOpen = prototype.onOpen;
  const originalRenderResults = prototype.renderResults;
  const originalRenderFooter = prototype.renderFooter;

  prototype.onOpen = function () {
    const linkedTaskCount = collectPomodoroBulletMoveTaskLinks(this.session).length;
    this.renameTypePreviewState = linkedTaskCount > 0 ? "loading" : "ready";
    this.renameTypePreview = linkedTaskCount > 0
      ? null
      : { api: this.themesApi, candidates: 0, unresolved: 0, records: [], error: null };
    originalOnOpen.call(this);
    if (linkedTaskCount === 0) {
      return;
    }
    void resolvePomodoroBulletMoveTypePreview(this.plugin, this.session)
      .then((preview) => {
        if (!this.pickerOpen) return;
        this.renameTypePreview = preview;
        this.renameTypePreviewState = preview.error ? "unavailable" : "ready";
        this.renderResults();
      })
      .catch(() => {
        if (!this.pickerOpen) return;
        this.renameTypePreview = { candidates: 0, unresolved: 0, records: [], error: "Task type preview failed" };
        this.renameTypePreviewState = "unavailable";
        this.renderResults();
      });
  };

  prototype.renderFooter = function () {
    originalRenderFooter.call(this);
    if (!this.footerEl) return;
    const row = (this.visibleItems || [])[this.selectedIndex];
    const consequence = pomodoroEntryRenameTypeConsequence(this, row);
    if (consequence) {
      this.footerEl.createDiv({ cls: "bob-cnp-consequence-strip-text", text: consequence });
    }
  };

  prototype.renderResults = function () {
    originalRenderResults.call(this);
    this.renderFooter();
  };
}

function installPomodoroBulletMoveTypePicker() {
  const prototype = PomodoroBulletMovePickerModal.prototype;
  const originalOnOpen = prototype.onOpen;
  const originalRenderResults = prototype.renderResults;
  const originalRenderFooter = prototype.renderFooter;
  const originalHandleKeydown = prototype.handleKeydown;

  prototype.onOpen = function () {
    const candidates = collectPomodoroBulletMoveTaskLinks(this.session);
    const api = getNavigationPomodoroThemesApi(this.app);
    this.moveTypePreviewState = candidates.length === 0 ? "ready" : "loading";
    this.moveTypePreview = candidates.length === 0
      ? { api, candidates: 0, unresolved: 0, records: [], error: null }
      : null;
    this.moveTypePicks = new Map();
    this.pendingMoveTypeMode = "retype";
    originalOnOpen.call(this);
    if (candidates.length === 0) {
      return;
    }
    void resolvePomodoroBulletMoveTypePreview(this.plugin, this.session)
      .then((preview) => {
        if (!this.pickerOpen) {
          return;
        }
        this.moveTypePreview = preview;
        this.moveTypePreviewState = preview.error ? "unavailable" : "ready";
        this.renderResults();
      })
      .catch(() => {
        if (!this.pickerOpen) {
          return;
        }
        this.moveTypePreview = {
          candidates: 0,
          unresolved: 0,
          records: [],
          error: "Task type preview failed",
        };
        this.moveTypePreviewState = "unavailable";
        this.renderResults();
      });
  };

  prototype.renderFooter = function () {
    originalRenderFooter.call(this);
    if (this.footerEl) {
      this.footerEl.createDiv({
        cls: "bob-cnp-consequence-strip-text",
        text: pomodoroBulletMovePickerConsequence(
          this,
          (this.visibleItems || [])[this.selectedIndex],
        ),
      });
    }
  };

  prototype.renderResults = function () {
    originalRenderResults.call(this);
    this.renderFooter();
  };

  prototype.handleKeydown = function (event) {
    if (
      event &&
      event.key === "Enter" &&
      event.altKey === true &&
      event.ctrlKey !== true &&
      event.metaKey !== true
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (!this.opening) {
        this.pendingMoveTypeMode = "keepType";
        this.openSelectedItem();
      }
      return;
    }
    if (
      event &&
      event.key === "Tab" &&
      event.altKey !== true &&
      event.ctrlKey !== true &&
      event.metaKey !== true &&
      event.isComposing !== true
    ) {
      const row = (this.visibleItems || [])[this.selectedIndex];
      if (cyclePomodoroBulletMoveType(this, row, event.shiftKey === true)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    originalHandleKeydown.call(this, event);
  };
}

installPomodoroEntryMoveTypePreview();
installPomodoroBulletMoveTypePicker();
