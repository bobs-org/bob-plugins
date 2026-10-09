function loadBulletPropertyConfig(options = {}) {
  const fsModule =
    options.fsModule === undefined
      ? requireOptionalNodeModule("fs")
      : options.fsModule;
  if (!fsModule || typeof fsModule.readFileSync !== "function") {
    showBulletPropertyNotice(BULLET_PROPERTY_CONFIG_MOBILE_NOTICE, options);
    return null;
  }

  const configPath =
    options.configPath ||
    getBulletPropertyConfigPath({
      env: options.env,
      osModule: options.osModule,
    });
  let rawConfig;
  try {
    rawConfig = fsModule.readFileSync(configPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      showBulletPropertyNotice(
        `Bullet property config not found: ${configPath}. Run chezmoi apply ~/.config/bob/config.yml.`,
        options,
      );
    } else {
      showBulletPropertyNotice(
        `Could not read bullet property config: ${
          error && error.message ? error.message : String(error)
        }`,
        options,
      );
    }
    return null;
  }

  const yamlParser =
    options.parseYaml === undefined ? parseYaml : options.parseYaml;
  if (typeof yamlParser !== "function") {
    showBulletPropertyNotice(
      "Bullet property config parser is unavailable",
      options,
    );
    return null;
  }

  let parsedConfig;
  try {
    parsedConfig = yamlParser(rawConfig);
  } catch (error) {
    showBulletPropertyNotice(
      `Could not parse bullet property config: ${
        error && error.message ? error.message : String(error)
      }`,
      options,
    );
    return null;
  }

  return validateBulletPropertyConfig(parsedConfig, {
    ...options,
    configPath,
  });
}

function isBulletLine(line) {
  return BULLET_PROPERTY_LIST_ITEM_RE.test(String(line || ""));
}

function normalizeBulletPropertyName(name) {
  return String(name || "").trim();
}

function normalizeBulletPropertyValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function formatBulletPropertyField(name, value) {
  return `[${normalizeBulletPropertyName(name)}:: ${normalizeBulletPropertyValue(
    value,
  )}]`;
}

function parseBulletPropertyFields(line) {
  const text = String(line || "");
  const fields = [];
  BULLET_PROPERTY_FIELD_RE.lastIndex = 0;

  let match = BULLET_PROPERTY_FIELD_RE.exec(text);
  while (match) {
    const key = String(match[1] || "").trim();
    if (key) {
      fields.push(
        Object.freeze({
          key,
          value: String(match[2] || "").trim(),
          raw: match[0],
          span: Object.freeze({
            start: match.index,
            end: match.index + match[0].length,
          }),
        }),
      );
    }

    match = BULLET_PROPERTY_FIELD_RE.exec(text);
  }

  return fields;
}

function findBulletPropertyField(line, name) {
  const targetName = normalizeBulletPropertyName(name);
  return (
    parseBulletPropertyFields(line).find((field) => field.key === targetName) ||
    null
  );
}

function getTrailingBlockIdSpan(line) {
  const match = BULLET_PROPERTY_TRAILING_BLOCK_ID_RE.exec(String(line || ""));
  if (!match) {
    return null;
  }

  return Object.freeze({
    start: match.index,
    end: match.index + match[0].length,
    text: match[0],
  });
}

function getBulletPropertyAppendIndex(line) {
  const blockIdSpan = getTrailingBlockIdSpan(line);
  return blockIdSpan ? blockIdSpan.start : String(line || "").length;
}

function upsertBulletProperty(line, name, value) {
  const text = String(line || "");
  // Task freshness guard: `fresh` and `refresh` never go through the
  // end-append writer. Placement lives in bob-ledger-tools
  // (`api.freshness.stampLine` / `setRefreshLine`, api `version >= 3`);
  // an end-append would leave them inside the Tasks suffix and hide Tasks
  // fields. Callers must use the injected stamper instead.
  const guardedName = normalizeBulletPropertyName(name);
  if (guardedName === "fresh" || guardedName === "refresh") {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "fresh-guarded",
      field: null,
    });
  }
  if (!isBulletLine(text)) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "not-bullet",
      field: null,
    });
  }

  const fieldText = formatBulletPropertyField(name, value);
  const existingField = findBulletPropertyField(text, name);
  if (existingField) {
    const nextLine =
      text.slice(0, existingField.span.start) +
      fieldText +
      text.slice(existingField.span.end);
    return Object.freeze({
      line: nextLine,
      changed: nextLine !== text,
      action: "update",
      reason: null,
      field: existingField,
    });
  }

  const appendIndex = getBulletPropertyAppendIndex(text);
  const before = text.slice(0, appendIndex).replace(/[ \t]+$/, "");
  const after = text.slice(appendIndex).replace(/^[ \t]+/, " ");
  const nextLine = `${before} ${fieldText}${after}`;

  return Object.freeze({
    line: nextLine,
    changed: nextLine !== text,
    action: "insert",
    reason: null,
    field: null,
  });
}

function applyBulletPropertyEdits(line, edits) {
  const originalLine = String(line || "");
  let nextLine = originalLine;
  for (const edit of Array.isArray(edits) ? edits : []) {
    const result = upsertBulletProperty(nextLine, edit.name, edit.value);
    if (result.reason) {
      return Object.freeze({
        line: originalLine,
        changed: false,
        reason: result.reason,
      });
    }
    nextLine = result.line;
  }

  return Object.freeze({
    line: nextLine,
    changed: nextLine !== originalLine,
    reason: null,
  });
}

function insertMissingBulletProperty(line, name, value) {
  const text = String(line || "");
  // Task freshness guard: see `upsertBulletProperty` above.
  const guardedMissingName = normalizeBulletPropertyName(name);
  if (guardedMissingName === "fresh" || guardedMissingName === "refresh") {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "fresh-guarded",
      field: null,
    });
  }
  const existingField = findBulletPropertyField(text, name);
  if (existingField) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "already-present",
      field: existingField,
    });
  }

  const fieldText = formatBulletPropertyField(name, value);
  const appendIndex = getBulletPropertyAppendIndex(text);
  const before = text.slice(0, appendIndex).replace(/[ \t]+$/, "");
  const after = text.slice(appendIndex).replace(/^[ \t]+/, " ");
  const nextLine = `${before} ${fieldText}${after}`;

  return Object.freeze({
    line: nextLine,
    changed: nextLine !== text,
    action: "insert",
    reason: null,
    field: null,
  });
}

function stripTaskTag(text) {
  return String(text || "")
    .replace(REF_AFTER_TASK_GLOBAL_RE, (match, prefix) => {
      if (!prefix) {
        return "";
      }

      return /\s/.test(prefix) ? " " : prefix;
    })
    .replace(PROJECT_TASK_TAG_GLOBAL_RE, (match, prefix) => {
      if (!prefix) {
        return "";
      }

      return /\s/.test(prefix) ? " " : prefix;
    });
}

function cleanTaskDisplayText(line) {
  const text = String(line || "");
  const match = OBSIDIAN_TASK_LINE_RE.exec(text);
  let body = match ? match[2] || "" : text;

  body = body
    .replace(BULLET_PROPERTY_TRAILING_BLOCK_ID_RE, "")
    .replace(BULLET_PROPERTY_TASKS_INLINE_FIELD_RE, "")
    .replace(BULLET_PROPERTY_TASKS_EMOJI_DATE_RE, "");
  const isRefTask = REF_AFTER_TASK_RE.test(body);
  body = stripTaskTag(body)
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (body === "") {
    return "(untitled task)";
  }
  return isRefTask ? REF_TASK_DISPLAY_PREFIX + body : body;
}

function getTrailingBlockId(line) {
  const span = getTrailingBlockIdSpan(line);
  if (!span) {
    return null;
  }

  const match = /\^([A-Za-z0-9-]+)/.exec(span.text);
  return match ? match[1] : null;
}

function getOpenLocalTasks(content, options = {}) {
  const lines = String(content || "").split(/\r?\n/);
  const excludeLine = Number.isInteger(options.excludeLine)
    ? options.excludeLine
    : null;
  const excludeLines =
    options.excludeLines instanceof Set
      ? options.excludeLines
      : new Set(options.excludeLines || []);

  return getOpenObsidianTaskLines(lines)
    .filter((line) => line !== excludeLine && !excludeLines.has(line))
    .map((line) => {
      const rawLine = String(lines[line] || "");
      const match = OBSIDIAN_TASK_LINE_RE.exec(rawLine);
      const idField = findBulletPropertyField(rawLine, "id");
      const existingIdField = idField
        ? normalizeBulletPropertyValue(idField.value)
        : null;
      const existingBlockId = getTrailingBlockId(rawLine);

      return Object.freeze({
        line,
        status: match ? match[1] : " ",
        existingBlockId,
        existingIdField: existingIdField || null,
        displayText: cleanTaskDisplayText(rawLine),
        rawLine,
      });
    });
}

function blockIdExistsInContent(content, id) {
  if (!BULLET_PROPERTY_BLOCK_ID_RE.test(String(id || ""))) {
    return false;
  }

  const re = new RegExp(
    `(^|[ \\t])\\^${escapeRegExp(id)}(?=$|[ \\t\\r\\n])`,
    "gm",
  );
  return re.test(String(content || ""));
}

function truncateBlockIdSlug(slug, maxLength) {
  return String(slug || "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

function suggestBlockIdFromTask(displayText, content, options = {}) {
  const reservedIds =
    options.reservedIds instanceof Set
      ? options.reservedIds
      : new Set(options.reservedIds || []);
  const isTaken = (candidate) =>
    blockIdExistsInContent(content, candidate) || reservedIds.has(candidate);
  const maxLength = 32;
  let slug = String(displayText || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  slug = truncateBlockIdSlug(slug, maxLength) || "task";

  let candidate = slug;
  let suffix = 2;
  while (isTaken(candidate)) {
    const suffixText = `-${suffix}`;
    const base =
      truncateBlockIdSlug(slug, Math.max(1, maxLength - suffixText.length)) ||
      "task";
    candidate = `${base}${suffixText}`;
    suffix += 1;
  }

  return candidate;
}

function appendBlockIdToLine(line, id) {
  const text = String(line || "");
  const trailingWhitespace = /[ \t]*$/.exec(text)[0] || "";
  const body = text
    .slice(0, text.length - trailingWhitespace.length)
    .replace(/[ \t]+$/g, "");
  return `${body} ^${normalizeBulletPropertyValue(id)}${trailingWhitespace}`;
}

function getTargetEdit(kind, oldLine, newLine) {
  if (oldLine === newLine) {
    return [];
  }

  return [Object.freeze({ kind, line: newLine })];
}

// True when an open task being added as a dependency has no trailing `^block-id`
// and therefore needs the user to be prompted for one before the navigation
// bullet can link to it. An existing `[id:: value]` does NOT remove this need:
// it is a valid Tasks dependency value but not yet a navigation block target.
function taskNeedsPromptedBlockId(task) {
  if (!task) {
    return false;
  }

  const blockId = Object.prototype.hasOwnProperty.call(task, "existingBlockId")
    ? task.existingBlockId
    : getTrailingBlockId(task.rawLine);
  return !normalizeBulletPropertyValue(blockId);
}

// Contract-aware prompted block-id application (`docs/task-dependencies.md`
// §3): always append the trailing `^id`, but write `[id::]` only when the
// target has none — an existing valid `[id::]` is never rewritten. Returns
// null only when the target has no `[id::]` yet and the note path cannot be
// encoded (ADJ-9 defers the path codec).
function applyPromptedBlockIdPreservingLegacyId(line, id, filePath = "") {
  const text = String(line || "");
  const idField = findBulletPropertyField(text, "id");
  const existing = idField
    ? normalizeBulletPropertyValue(idField.value)
    : "";
  if (existing && TASKS_DEPENDENCY_ID_RE.test(existing)) {
    return appendBlockIdToLine(text, id);
  }
  return applyPromptedBlockIdToTaskLine(line, id, filePath);
}

// Apply a confirmed/prompted block ID to a task line: append the trailing `^id`
// navigation target and replace any existing `[id::]` value with the canonical
// path-qualified dependency ID. Returns null when the note path is unqualifiable.
function applyPromptedBlockIdToTaskLine(line, id, filePath = "") {
  const withBlockId = appendBlockIdToLine(line, id);
  const canonicalId = filePath ? tryDependencyId(filePath, id) : id;
  if (!canonicalId) {
    return null;
  }
  return upsertBulletProperty(withBlockId, "id", canonicalId).line;
}

function resolveTargetTaskIdentity(line, options = {}) {
  const promptWhenBlockIdMissing = options.promptWhenBlockIdMissing === true;
  const text = String(line || "");
  const idField = findBulletPropertyField(text, "id");
  const idFieldValue = idField
    ? normalizeBulletPropertyValue(idField.value)
    : "";
  const blockId = getTrailingBlockId(text);
  const filePath = normalizeVaultRelativePath(options.filePath || "");

  // Stricter rule for the prompted flows: a missing trailing block ID always
  // means "ask the user", even when an `[id:: value]` is already present. The
  // caller will run the prompt, then replace the existing `[id::]` with the
  // canonical dependency value while linking to the confirmed block ID.
  if (promptWhenBlockIdMissing && !blockId) {
    return Object.freeze({
      value: null,
      linkBlockId: null,
      legacyValue: idFieldValue || null,
      needsBlockIdPrompt: true,
      targetEdits: Object.freeze([]),
    });
  }

  if (blockId) {
    const canonicalId = filePath ? tryDependencyId(filePath, blockId) : blockId;
    if (!canonicalId) {
      return Object.freeze({
        value: null,
        linkBlockId: blockId,
        legacyValue: idFieldValue || null,
        needsBlockIdPrompt: false,
        reason: "unqualifiable-note-path",
        targetEdits: Object.freeze([]),
      });
    }
    const idResult = upsertBulletProperty(text, "id", canonicalId);
    return Object.freeze({
      value: canonicalId,
      linkBlockId: blockId,
      legacyValue: idFieldValue && idFieldValue !== canonicalId ? idFieldValue : null,
      needsBlockIdPrompt: false,
      reason: null,
      targetEdits: Object.freeze(
        getTargetEdit(idField ? "normalize-id-field" : "add-id-field", text, idResult.line),
      ),
    });
  }

  return Object.freeze({
    value: null,
    linkBlockId: null,
    legacyValue: idFieldValue || null,
    needsBlockIdPrompt: true,
    reason: null,
    targetEdits: Object.freeze([]),
  });
}

// A blockquoted task can never own a Depends-On line (DP29): every
// dependency gesture there refuses with `⛓ Dependencies can't be edited
// inside a blockquote`.
function isBlockquotedMarkdownLine(lineText) {
  return /^\s*>/.test(String(lineText || ""));
}

function dependencyPlanFailureNotice(reason, verb = "update") {
  if (reason === "in-blockquote") {
    return "⛓ Dependencies can't be edited inside a blockquote";
  }
  return `⛓ Could not ${verb} dependencies (${reason})`;
}

// Recovery snapshots cost a whole-vault read, so build one only when ADJ-8
// recovery can actually fire on a Blocked dependent: a prerequisite was
// removed, the field was cleared with no link removed (field-only Ctrl+D),
// or the mirror touched. Pure adds never recover.
function needsDependencyRecoverySnapshot(content, parentLine, remove, mirrorTouch, add) {
  const lines = String(content || "").split(/\r?\n/);
  const at = Math.floor(numericOrDefault(parentLine, Number.NaN));
  if (!Number.isFinite(at) || at < 0 || at >= lines.length) {
    return false;
  }
  if (getObsidianTaskCheckboxStatus(String(lines[at] || "")) !== "?") {
    return false;
  }
  if (mirrorTouch === true) {
    return true;
  }
  if (Array.isArray(remove) && remove.length > 0) {
    return true;
  }
  if (Array.isArray(add) && add.length > 0) {
    return false;
  }
  const field = findBulletPropertyField(String(lines[at] || ""), "dependsOn");
  return Boolean(field);
}

// Leading list container prefix, including any Markdown blockquote markers.
function getBulletIndent(line) {
  const match = /^(\s*(?:>\s*)*)/.exec(String(line || ""));
  return match ? match[1] : "";
}

function getBulletIndentWidth(line) {
  let width = 0;
  for (const character of getBulletIndent(line)) {
    if (character === "\t") {
      width += 4 - (width % 4);
    } else if (character === ">") {
      // Treat each quote level as one logical indentation stop so quoted
      // navigation children remain inside the source task's quote context.
      width += 4;
    } else {
      width += 1;
    }
  }
  return width;
}

function findNearestParentListItem(lines, childLine) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const childIndex = Math.floor(numericOrDefault(childLine, Number.NaN));
  if (!Number.isFinite(childIndex) || childIndex <= 0) {
    return null;
  }
  const childIndentWidth = getBulletIndentWidth(sourceLines[childIndex] || "");
  for (let line = childIndex - 1; line >= 0; line -= 1) {
    const text = String(sourceLines[line] || "");
    if (!text.trim() || getBulletIndentWidth(text) >= childIndentWidth) {
      continue;
    }
    if (BULLET_PROPERTY_LIST_ITEM_RE.test(text)) {
      return line;
    }
  }
  return null;
}

function dependencyNavigationTargetKey(target) {
  const blockId = normalizeBulletPropertyValue(
    target && typeof target === "object" ? target.blockId : target,
  );
  const note =
    target && typeof target === "object"
      ? String(target.note || target.target || "").trim()
      : "";
  return blockId ? `${note}#^${blockId}` : "";
}

function compactDependencyNavigationTarget(target) {
  return target.note || target.terminal
    ? Object.freeze({ ...target })
    : target.blockId;
}

function normalizeDependencyNavigationTargets(targets) {
  const rawTargets = Array.isArray(targets) ? targets : [targets];
  const normalized = [];
  const seen = new Set();
  rawTargets.forEach((target) => {
    const blockId = normalizeBulletPropertyValue(
      target && typeof target === "object" ? target.blockId : target,
    );
    const note =
      target && typeof target === "object"
        ? String(target.note || target.target || "").trim()
        : "";
    const key = dependencyNavigationTargetKey({ blockId, note });
    if (!blockId || seen.has(key)) {
      return;
    }
    seen.add(key);
    normalized.push(
      Object.freeze({
        blockId,
        note,
        terminal: Boolean(
          target && typeof target === "object" && target.terminal,
        ),
      }),
    );
  });
  return normalized;
}

function formatDependencyNavigationLinkRef(target) {
  const blockId = normalizeBulletPropertyValue(
    target && typeof target === "object" ? target.blockId : target,
  );
  const note =
    target && typeof target === "object"
      ? String(target.note || target.target || "").trim()
      : "";
  return `[[${note}#^${blockId}]]`;
}

function formatDependencyNavigationBulletWithMarker(target, indent, marker) {
  const indentText = typeof indent === "string" ? indent : "";
  const markerText = typeof marker === "string" && marker ? marker : "-";
  const targets = normalizeDependencyNavigationTargets(target);
  if (targets.length === 0) {
    return "";
  }
  // Writer form (`docs/task-dependencies.md` §2.1): one managed line, plain
  // links only, joined by `•`. Strikes, embeds, and aliases are canonicalised
  // away here; existing links keep their order.
  return (
    `${indentText}${markerText} ${DEPENDENCY_NAVIGATION_EMOJI} ` +
    `**${DEPENDENCY_NAVIGATION_LABEL}:** ` +
    targets.map(formatDependencyNavigationLinkRef).join(" • ")
  );
}

function formatDependencyNavigationBullet(target, indent) {
  return formatDependencyNavigationBulletWithMarker(target, indent, "-");
}

function parseDependencyTransclusionBulletDetails(line) {
  const match = DEPENDENCY_TRANSCLUSION_BULLET_RE.exec(String(line || ""));
  if (!match) {
    return null;
  }
  const { indent, marker, strike, embed, note, blockId } = match.groups;
  if (strike && embed) {
    return null;
  }
  return Object.freeze({
    indent,
    marker,
    note: String(note || "").trim(),
    blockId,
    blockIds: Object.freeze([blockId]),
    transcluded: Boolean(embed),
    terminal: Boolean(strike),
  });
}

function extractDependencyNavigationBlockIds(linkSpan) {
  return extractDependencyLineLinks(linkSpan).map((link) => link.blockId);
}

// Every block link on the span, in order, as `{note, blockId}`. Finds the
// links first and never splits on separators, because an alias can contain
// one (`docs/task-dependencies.md` §2.3).
function extractDependencyLineLinks(linkSpan) {
  const links = [];
  const text = String(linkSpan || "");
  let match = null;
  DEPENDENCY_NAVIGATION_LINK_RE.lastIndex = 0;
  while ((match = DEPENDENCY_NAVIGATION_LINK_RE.exec(text)) !== null) {
    const blockId = normalizeBulletPropertyValue(match[2]);
    if (!blockId) {
      continue;
    }
    links.push(
      Object.freeze({
        note: String(match[1] || "").trim(),
        blockId,
      }),
    );
  }
  return links;
}

// True when the span holds nothing but block links, strikes, and separators.
// Anything else (prose, a bare `[[note]]`, a half-typed link) makes the line
// malformed.
function isDependencyLineLinkRemainderClean(linkSpan) {
  const rest = String(linkSpan || "")
    .replace(DEPENDENCY_LINE_LINK_TOKEN_RE, "")
    .replace(/~~/g, "");
  return /^[\s•·,]*$/.test(rest);
}

function getDependencyNavigationBlockIds(line) {
  const details =
    parseDependencyNavigationBulletDetails(line) ||
    parseDependencyTransclusionBulletDetails(line);
  return details ? details.blockIds.slice() : [];
}

// Return the linked block ID when a line is a managed dependency navigation
// bullet (current or legacy label), otherwise null. Kept for narrow legacy
// callers; new code should use getDependencyNavigationBlockIds.
function parseDependencyNavigationBullet(line) {
  const details =
    parseDependencyNavigationBulletDetails(line) ||
    parseDependencyTransclusionBulletDetails(line);
  return details && details.blockIds.length > 0 ? details.blockIds[0] : null;
}

// Parse a managed Depends-On line into its parts, or null when the line is
// not one. `isLegacy` is true when the visible label is a legacy label
// (e.g. DEPENDENCIES) rather than DEPENDENCY_NAVIGATION_LABEL; `hasEmoji`
// tracks legacy emoji-less lines independently. `links` carries every link in
// order as `{note, blockId}`; `canonical` is true only for the exact writer
// form. Malformed lines (trailing prose, half-typed links, bare `[[note]]`
// links) and label-only lines return null here; use `parseDependencyLine`
// when the verdict matters.
function parseDependencyNavigationBulletDetails(line) {
  const details = parseDependencyLine(String(line || ""), {
    isDirectChildOfTask: true,
  });
  if (!details || details.verdict !== "accept") {
    return null;
  }
  return Object.freeze({
    indent: details.indent,
    marker: details.marker,
    label: details.label,
    blockId: details.links[0].blockId,
    blockIds: Object.freeze(details.links.map((link) => link.blockId)),
    links: Object.freeze(details.links.map((link) => Object.freeze({ ...link }))),
    isLegacy: details.isLegacy,
    hasEmoji: details.hasEmoji,
    canonical: details.canonical,
  });
}

// Verdict machine for one candidate Depends-On line
// (`docs/task-dependencies.md` §§2, 11.1). `options.isDirectChildOfTask`
// asserts the caller already established task ownership; `options.inFence`
// marks fenced code. Verdicts: `accept(n)` (n links), `empty` (label but no
// links, R9), `malformed` (R10), or `not-a-line` (fenced, nested, Work Log,
// or no line shape at all).
function parseDependencyLine(lineText, options = {}) {
  const text = String(lineText || "");
  const match = DEPENDENCY_NAVIGATION_BULLET_RE.exec(text);
  if (!match) {
    return Object.freeze({ verdict: "not-a-line", links: Object.freeze([]) });
  }
  if (options.inFence === true) {
    return Object.freeze({ verdict: "not-a-line", links: Object.freeze([]) });
  }
  if (options.isDirectChildOfTask === false) {
    return Object.freeze({ verdict: "not-a-line", links: Object.freeze([]) });
  }
  const { indent, marker, emoji, label, linkSpan } = match.groups;
  const base = { indent, marker, label };
  const isLegacy =
    LEGACY_DEPENDENCY_NAVIGATION_LABELS.has(label) || emoji === "🔗";
  const hasEmoji = Boolean(emoji);
  const links = extractDependencyLineLinks(linkSpan);
  if (links.length === 0) {
    if (String(linkSpan || "").trim() === "") {
      return Object.freeze({ ...base, verdict: "empty", links: Object.freeze([]), isLegacy, hasEmoji, canonical: false });
    }
    return Object.freeze({ ...base, verdict: "malformed", links: Object.freeze([]), isLegacy, hasEmoji, canonical: false });
  }
  if (!isDependencyLineLinkRemainderClean(linkSpan)) {
    return Object.freeze({ ...base, verdict: "malformed", links: Object.freeze([]), isLegacy, hasEmoji, canonical: false });
  }
  const canonical =
    emoji === DEPENDENCY_NAVIGATION_EMOJI &&
    label === DEPENDENCY_NAVIGATION_LABEL &&
    isDependencyLineWriterSeparators(linkSpan) &&
    isDependencyLineWriterTokens(linkSpan);
  return Object.freeze({
    ...base,
    verdict: "accept",
    links: Object.freeze(links),
    isLegacy,
    hasEmoji,
    canonical,
  });
}

// True when every link token is the plain writer form (`[[note#^id]]`, no
// alias, embed, or strike) and no stray strikes remain on the span.
function isDependencyLineWriterTokens(linkSpan) {
  const span = String(linkSpan || "");
  if (span.includes("~~")) {
    return false;
  }
  const tokens = span.match(DEPENDENCY_LINE_LINK_TOKEN_RE) || [];
  return (
    tokens.length > 0 &&
    tokens.every((token) => /^\[\[[^\]|#!\n]*?#\^[A-Za-z0-9-]+\]\]$/.test(token))
  );
}

// True when the separators between the span's links are exactly the writer
// form (` • `). Any tolerated variant (`·`, `,`, bare whitespace) parses but
// is not canonical.
function isDependencyLineWriterSeparators(linkSpan) {
  const rest = String(linkSpan || "")
    .replace(DEPENDENCY_LINE_LINK_TOKEN_RE, "\x00")
    .replace(/~~/g, "");
  return rest.split("\x00").every((gap, index, gaps) => {
    if (index === 0 || index === gaps.length - 1) {
      return /^[\s]*$/.test(gap);
    }
    return gap === " • ";
  });
}

// Rewrite a managed dependency navigation bullet to the current label while
// preserving its existing indentation and list marker, so a legacy bullet can be
// normalized in place without disturbing tab-indented or non-dash markers.
function getTaskIdentityByBlockId(content, lineContexts = null, sourceLines = null) {
  const identities = new Map();
  const text = String(content || "");
  const lines = sourceLines || text.split(/\r?\n/);
  const contexts = lineContexts || getMarkdownLineContextsForLines(lines);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (!isObsidianTaskAtLine(text, lineIndex, contexts, lines)) {
      continue;
    }
    const line = lines[lineIndex];
    const blockId = getTrailingBlockId(line);
    if (!blockId) {
      continue;
    }
    const idField = findBulletPropertyField(line, "id");
    identities.set(
      blockId,
      idField
        ? normalizeBulletPropertyValue(idField.value) || blockId
        : blockId,
    );
  }
  return identities;
}

// Capture the index range of the current bullet's child block: every later line
// that is blank or indented deeper than the parent, stopping at the first
// nonblank line indented at or shallower than the parent (or EOF). Trailing
// blank lines past the last deeper-indented child are excluded. Mirrors
// getProjectSourceTaskBlock but operates on a plain line array and returns only
// the bounds. `parentLine` is a 0-based index into `lines`.
