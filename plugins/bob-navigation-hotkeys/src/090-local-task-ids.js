function getUniqueLocalTaskIdValues(values) {
  const uniqueValues = [];
  const seenValues = new Set();

  (Array.isArray(values) ? values : []).forEach((value) => {
    const normalized = normalizeBulletPropertyValue(value);
    if (!normalized || seenValues.has(normalized)) {
      return;
    }

    seenValues.add(normalized);
    uniqueValues.push(normalized);
  });

  return uniqueValues;
}

function upsertLocalTaskIdValue(line, name, id) {
  const text = String(line || "");
  const value = normalizeBulletPropertyValue(id);
  if (!isBulletLine(text)) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "not-bullet",
      alreadyPresent: false,
      field: null,
    });
  }

  if (!value) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "empty-id",
      alreadyPresent: false,
      field: null,
    });
  }

  const existingField = findBulletPropertyField(text, name);
  if (existingField) {
    const values = parseLocalTaskIdList(existingField.value);
    if (values.includes(value)) {
      return Object.freeze({
        line: text,
        changed: false,
        action: "none",
        reason: null,
        alreadyPresent: true,
        field: existingField,
      });
    }

    const uniqueValues = [];
    const seenValues = new Set();
    values.forEach((existingValue) => {
      if (seenValues.has(existingValue)) {
        return;
      }

      seenValues.add(existingValue);
      uniqueValues.push(existingValue);
    });

    const nextFieldText = formatBulletPropertyField(
      name,
      [...uniqueValues, value].join(", "),
    );
    const nextLine =
      text.slice(0, existingField.span.start) +
      nextFieldText +
      text.slice(existingField.span.end);

    return Object.freeze({
      line: nextLine,
      changed: nextLine !== text,
      action: "update",
      reason: null,
      alreadyPresent: false,
      field: existingField,
    });
  }

  const insertResult = insertMissingBulletProperty(text, name, value);
  return Object.freeze({
    line: insertResult.line,
    changed: insertResult.changed,
    action: "insert",
    reason: insertResult.reason,
    alreadyPresent: false,
    field: null,
  });
}

function removeBulletPropertyFieldSpan(line, span) {
  const before = line.slice(0, span.start);
  const after = line.slice(span.end);
  const nextWhitespace = /^[ \t]+/.exec(after);
  const previousWhitespace = /[ \t]+$/.exec(before);
  const afterWithoutSpaces = nextWhitespace
    ? after.slice(nextWhitespace[0].length)
    : after;
  const nextIsTrailingBlockId =
    nextWhitespace &&
    BULLET_PROPERTY_BLOCK_ID_ONLY_RE.test(afterWithoutSpaces);

  if (nextWhitespace && !nextIsTrailingBlockId) {
    return before + after.slice(1);
  }

  if (previousWhitespace) {
    return before.slice(0, -1) + after;
  }

  if (nextWhitespace) {
    return before + after.slice(1);
  }

  return before + after;
}

function deleteBulletProperty(line, name) {
  const text = String(line || "");
  if (!isBulletLine(text)) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "not-bullet",
      field: null,
    });
  }

  const existingField = findBulletPropertyField(text, name);
  if (!existingField) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "not-found",
      field: null,
    });
  }

  const nextLine = removeBulletPropertyFieldSpan(text, existingField.span);
  return Object.freeze({
    line: nextLine,
    changed: nextLine !== text,
    action: "delete",
    reason: null,
    field: existingField,
  });
}

function applyLocalTaskDependencyListEdits(line, name, edits = {}) {
  const text = String(line || "");
  const addValues = getUniqueLocalTaskIdValues(edits.add || []);
  const removeValues = getUniqueLocalTaskIdValues(edits.remove || []);

  if (!isBulletLine(text)) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "not-bullet",
      added: Object.freeze([]),
      removed: Object.freeze([]),
      finalValues: Object.freeze([]),
      fieldDropped: false,
      field: null,
    });
  }

  const existingField = findBulletPropertyField(text, name);
  const existingValues = existingField
    ? getUniqueLocalTaskIdValues(parseLocalTaskIdList(existingField.value))
    : [];
  const existingSet = new Set(existingValues);
  const removeSet = new Set(removeValues);
  const finalValues = [];
  const finalSet = new Set();

  existingValues.forEach((value) => {
    if (removeSet.has(value) || finalSet.has(value)) {
      return;
    }

    finalSet.add(value);
    finalValues.push(value);
  });

  addValues.forEach((value) => {
    if (finalSet.has(value)) {
      return;
    }

    finalSet.add(value);
    finalValues.push(value);
  });

  const added = addValues.filter(
    (value) => !existingSet.has(value) && finalSet.has(value),
  );
  const removed = removeValues.filter(
    (value) => existingSet.has(value) && !finalSet.has(value),
  );

  if (!existingField && finalValues.length === 0) {
    return Object.freeze({
      line: text,
      changed: false,
      action: "none",
      reason: "not-found",
      added: Object.freeze(added),
      removed: Object.freeze(removed),
      finalValues: Object.freeze(finalValues),
      fieldDropped: false,
      field: null,
    });
  }

  if (finalValues.length === 0) {
    const deleteResult = deleteBulletProperty(text, name);
    return Object.freeze({
      line: deleteResult.line,
      changed: deleteResult.changed,
      action: deleteResult.changed ? "delete" : "none",
      reason: deleteResult.reason,
      added: Object.freeze(added),
      removed: Object.freeze(removed),
      finalValues: Object.freeze(finalValues),
      fieldDropped: deleteResult.changed,
      field: existingField,
    });
  }

  const nextFieldText = formatBulletPropertyField(name, finalValues.join(", "));
  if (existingField) {
    const nextLine =
      text.slice(0, existingField.span.start) +
      nextFieldText +
      text.slice(existingField.span.end);
    return Object.freeze({
      line: nextLine,
      changed: nextLine !== text,
      action: "update",
      reason: null,
      added: Object.freeze(added),
      removed: Object.freeze(removed),
      finalValues: Object.freeze(finalValues),
      fieldDropped: false,
      field: existingField,
    });
  }

  const insertResult = insertMissingBulletProperty(
    text,
    name,
    finalValues.join(", "),
  );
  return Object.freeze({
    line: insertResult.line,
    changed: insertResult.changed,
    action: insertResult.changed ? "insert" : "none",
    reason: insertResult.reason,
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    finalValues: Object.freeze(finalValues),
    fieldDropped: false,
    field: null,
  });
}

function normalizeVimRepeat(value) {
  const repeat = Math.floor(numericOrDefault(value, 1));
  return Number.isFinite(repeat) && repeat > 0 ? repeat : 1;
}

function getVimRepeat(actionArgs) {
  return normalizeVimRepeat(actionArgs && actionArgs.repeat);
}

function hasVimRepeat(actionArgs) {
  if (!actionArgs) {
    return false;
  }
  // CodeMirror's Vim always sets actionArgs.repeat (defaulting to 1 when no
  // count is typed) and signals an explicitly-typed count via repeatIsExplicit.
  // Trust that flag when present; bare <Enter> arrives as
  // { repeat: 1, repeatIsExplicit: false } and must be treated as "no count".
  if (typeof actionArgs.repeatIsExplicit === "boolean") {
    return actionArgs.repeatIsExplicit;
  }
  // Fallback for callers/tests that omit repeatIsExplicit.
  return actionArgs.repeat !== undefined && actionArgs.repeat !== null;
}

function getPendingVimRepeat(cm) {
  const inputState = cm && cm.state && cm.state.vim && cm.state.vim.inputState;
  const rawKeyBuffer = inputState && inputState.keyBuffer;
  const keyBufferText = Array.isArray(rawKeyBuffer)
    ? rawKeyBuffer.join("")
    : typeof rawKeyBuffer === "string"
      ? rawKeyBuffer
      : "";
  const keyBufferMatch = keyBufferText.match(/^([1-9]\d*)/);
  if (keyBufferMatch) {
    const repeat = Math.floor(
      numericOrDefault(keyBufferMatch[1], Number.NaN),
    );
    if (Number.isFinite(repeat) && repeat > 0) {
      return { repeat, explicit: true };
    }
  }

  // Between keyBuffer digits and getRepeat(), join prefixRepeat and
  // motionRepeat (each an array of digit strings in CodeMirror Vim) and
  // multiply them, matching Vim's own getRepeat() semantics. This covers
  // adapters that expose the arrays but not the method. task-status-cycler's
  // copy of this helper is intentionally left without this fallback — its
  // own chords work today.
  const digits = (value) =>
    Array.isArray(value)
      ? value.join("")
      : typeof value === "string"
        ? value
        : "";
  const prefixText = digits(inputState && inputState.prefixRepeat);
  const motionText = digits(inputState && inputState.motionRepeat);
  const prefixOk = /^[1-9]\d*$/.test(prefixText);
  const motionOk = /^[1-9]\d*$/.test(motionText);
  if (prefixOk || motionOk) {
    const prefix = prefixOk
      ? Math.floor(numericOrDefault(prefixText, 1))
      : 1;
    const motion = motionOk
      ? Math.floor(numericOrDefault(motionText, 1))
      : 1;
    const product = prefix * motion;
    if (Number.isFinite(product) && product > 0) {
      return { repeat: product, explicit: true };
    }
  }

  const rawRepeat =
    inputState && typeof inputState.getRepeat === "function"
      ? inputState.getRepeat()
      : null;
  const repeat = Math.floor(numericOrDefault(rawRepeat, Number.NaN));

  return Number.isFinite(repeat) && repeat > 0
    ? { repeat, explicit: true }
    : { repeat: 1, explicit: false };
}

function resetPendingVimInputState(cm, reason = "") {
  const vimState = cm && cm.state && cm.state.vim;
  const inputState = vimState && vimState.inputState;
  if (!vimState || !inputState) {
    return false;
  }

  const clearedArrayFields = [
    "prefixRepeat",
    "motionRepeat",
    "keyBuffer",
  ];
  const clearedNullFields = [
    "operator",
    "operatorArgs",
    "motion",
    "motionArgs",
    "registerName",
    "selectedCharacter",
  ];
  const clearedFalseFields = ["operatorShortcut", "visualLine", "visualBlock"];

  try {
    for (const field of clearedArrayFields) {
      inputState[field] = [];
    }
    for (const field of clearedNullFields) {
      if (Object.prototype.hasOwnProperty.call(inputState, field)) {
        inputState[field] = null;
      }
    }
    for (const field of clearedFalseFields) {
      if (Object.prototype.hasOwnProperty.call(inputState, field)) {
        inputState[field] = false;
      }
    }
    if (Object.prototype.hasOwnProperty.call(inputState, "repeat")) {
      inputState.repeat = null;
    }
    if (reason && Object.prototype.hasOwnProperty.call(inputState, "reason")) {
      inputState.reason = reason;
    }
    return true;
  } catch (error) {
    // Fall through to replacing the inputState as a last resort.
  }

  try {
    if (typeof inputState.constructor === "function") {
      vimState.inputState = new inputState.constructor();
      return true;
    }
  } catch (error) {
    return false;
  }

  return false;
}

function getVimTargetOffset(actionArgs, direction, defaultOffset) {
  if (!hasVimRepeat(actionArgs)) {
    return defaultOffset;
  }

  const offsetDirection = direction < 0 ? -1 : 1;
  return offsetDirection * getVimRepeat(actionArgs);
}

function getVimOffsetTargetLine(cm, actionArgs, direction, defaultOffset) {
  const cursor = getEditorCursor(cm);
  if (!cursor) {
    return null;
  }

  const firstLine = getEditorFirstLine(cm);
  const lastLine = getEditorLastLine(cm);
  const targetOffset = getVimTargetOffset(
    actionArgs,
    direction,
    defaultOffset === undefined ? (direction < 0 ? -1 : 1) : defaultOffset,
  );
  let targetLine = cursor.line + targetOffset;

  targetLine = Math.max(
    targetLine,
    firstLine === null ? 0 : firstLine,
  );

  return lastLine === null ? targetLine : Math.min(targetLine, lastLine);
}

function getVimEnterTargetLine(cm, actionArgs) {
  return getVimOffsetTargetLine(cm, actionArgs, 1, 0);
}

function getVimBackspaceTargetLine(cm, actionArgs) {
  return getVimOffsetTargetLine(cm, actionArgs, -1, -1);
}

function normalizeVimJumpLocation(location) {
  if (!location || typeof location !== "object") {
    return null;
  }

  const path =
    typeof location.path === "string" && location.path.trim()
      ? location.path
      : null;
  if (!path) {
    return null;
  }

  const position = normalizePosition(location);
  if (!position) {
    return null;
  }

  return { path, line: position.line, ch: position.ch };
}

function cloneVimJumpLocation(location) {
  const normalized = normalizeVimJumpLocation(location);
  if (!normalized) {
    return null;
  }

  return { path: normalized.path, line: normalized.line, ch: normalized.ch };
}

function vimJumpLocationsEqual(left, right) {
  const normalizedLeft = normalizeVimJumpLocation(left);
  const normalizedRight = normalizeVimJumpLocation(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      normalizedLeft.path === normalizedRight.path &&
      normalizedLeft.line === normalizedRight.line &&
      normalizedLeft.ch === normalizedRight.ch,
  );
}

function createVimJumpHistory() {
  return { entries: [], index: -1 };
}

function getVimJumpHistoryLength(state) {
  if (!state || !Array.isArray(state.entries)) {
    return 0;
  }

  return state.entries.length;
}

function getVimJumpCurrentIndex(state) {
  if (!state || !Array.isArray(state.entries) || state.entries.length === 0) {
    return -1;
  }

  const index = Math.floor(numericOrDefault(state.index, -1));
  if (!Number.isFinite(index)) {
    return state.entries.length - 1;
  }

  return Math.min(Math.max(index, 0), state.entries.length - 1);
}

function releaseVimJumpBookmark(entry) {
  if (!entry || !entry.bookmark) {
    return;
  }

  try {
    if (typeof entry.bookmark.clear === "function") {
      entry.bookmark.clear();
    }
  } catch (error) {
    // Best-effort release only.
  }
  entry.bookmark = null;
}

function recordVimJumpLocation(state, location) {
  if (!state || !Array.isArray(state.entries)) {
    return false;
  }

  const normalized = cloneVimJumpLocation(location);
  if (!normalized) {
    return false;
  }

  let index = getVimJumpCurrentIndex(state);
  if (index !== -1) {
    const current = state.entries[index];
    if (vimJumpLocationsEqual(current, normalized)) {
      return false;
    }

    if (index < state.entries.length - 1) {
      const discarded = state.entries.slice(index + 1);
      for (const entry of discarded) {
        releaseVimJumpBookmark(entry);
      }
      state.entries = state.entries.slice(0, index + 1);
    }
  } else if (state.entries.length > 0) {
    state.entries = [];
  }

  state.entries.push(normalized);
  while (state.entries.length > VIM_JUMP_HISTORY_LIMIT) {
    const evicted = state.entries.shift();
    releaseVimJumpBookmark(evicted);
  }
  state.index = state.entries.length - 1;
  return true;
}

function recordVimJumpTransition(state, origin, destination) {
  const normalizedOrigin = normalizeVimJumpLocation(origin);
  const normalizedDestination = normalizeVimJumpLocation(destination);
  if (!normalizedOrigin || !normalizedDestination) {
    return false;
  }

  if (vimJumpLocationsEqual(normalizedOrigin, normalizedDestination)) {
    return false;
  }

  if (
    !state ||
    !Array.isArray(state.entries) ||
    state.entries.length === 0
  ) {
    recordVimJumpLocation(state, normalizedOrigin);
    return recordVimJumpLocation(state, normalizedDestination);
  }

  const index = getVimJumpCurrentIndex(state);
  const current = index === -1 ? null : state.entries[index];
  if (!current || !vimJumpLocationsEqual(current, normalizedOrigin)) {
    recordVimJumpLocation(state, normalizedOrigin);
  }

  return recordVimJumpLocation(state, normalizedDestination);
}

function refreshVimJumpCurrentLocation(state, liveLocation) {
  if (!state || !Array.isArray(state.entries) || state.entries.length === 0) {
    return false;
  }

  const normalized = normalizeVimJumpLocation(liveLocation);
  if (!normalized) {
    return false;
  }

  const index = getVimJumpCurrentIndex(state);
  const current = state.entries[index];
  if (!current || vimJumpLocationsEqual(current, normalized)) {
    return false;
  }

  // At the tip any live file counts (the user may have switched notes by hand
  // after landing). Deeper in the stack only refresh the same file so a manual
  // note switch never rewrites an older entry to a different file.
  if (index !== state.entries.length - 1 && current.path !== normalized.path) {
    return false;
  }

  releaseVimJumpBookmark(current);
  state.entries[index] = cloneVimJumpLocation(normalized);
  return true;
}

function updateVimJumpHistoryPath(state, oldPath, newPath) {
  if (
    !state ||
    !Array.isArray(state.entries) ||
    typeof oldPath !== "string" ||
    typeof newPath !== "string" ||
    !oldPath ||
    !newPath ||
    oldPath === newPath
  ) {
    return 0;
  }

  let updated = 0;
  for (const entry of state.entries) {
    if (entry && entry.path === oldPath) {
      entry.path = newPath;
      updated += 1;
    }
  }

  return updated;
}

function removeVimJumpHistoryPath(state, path) {
  if (!state || !Array.isArray(state.entries) || typeof path !== "string") {
    return 0;
  }

  const kept = [];
  let removed = 0;
  for (const entry of state.entries) {
    if (entry && entry.path === path) {
      releaseVimJumpBookmark(entry);
      removed += 1;
      continue;
    }
    kept.push(entry);
  }

  state.entries = kept.slice(-VIM_JUMP_HISTORY_LIMIT);
  state.index =
    state.entries.length === 0
      ? -1
      : Math.min(getVimJumpCurrentIndex(state), state.entries.length - 1);
  if (state.entries.length === 0) {
    state.index = -1;
  }
  return removed;
}

function clearVimJumpHistory(state) {
  if (!state || !Array.isArray(state.entries)) {
    return;
  }

  for (const entry of state.entries) {
    releaseVimJumpBookmark(entry);
  }
  state.entries = [];
  state.index = -1;
}

function resolveVimJumpCount(actionArgs) {
  return normalizeVimRepeat(actionArgs && actionArgs.repeat);
}

function isVimJumpBridgeAvailable(vim) {
  if (!vim || typeof vim.getVimGlobalState_ !== "function") {
    return false;
  }

  let globalState = null;
  try {
    globalState = vim.getVimGlobalState_();
  } catch (error) {
    return false;
  }

  const jumpList = globalState && globalState.jumpList;
  return Boolean(
    jumpList &&
      typeof jumpList.add === "function" &&
      typeof jumpList.move === "function",
  );
}

function isExternalLinkTarget(target) {
  const text = String(target || "").trim();
  return URL_OR_URI_SCHEME_RE.test(text) || text.startsWith("//");
}

function normalizeVaultRelativePath(path) {
  return String(path || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\/+/, "");
}

function validateDependencyId(value) {
  const id = String(value || "");
  if (!id) {
    return Object.freeze({ valid: false, id, error: "dependency ID is empty" });
  }
  if (!TASKS_DEPENDENCY_ID_RE.test(id)) {
    return Object.freeze({
      valid: false,
      id,
      error: `dependency ID contains unsupported characters: ${id}`,
    });
  }
  return Object.freeze({ valid: true, id, error: null });
}

function dependencyId(vaultRelativeMarkdownPath, blockId) {
  const path = normalizeVaultRelativePath(vaultRelativeMarkdownPath);
  const block = normalizeBulletPropertyValue(blockId).replace(/^\^/, "");
  if (!path || !MARKDOWN_EXTENSION_RE.test(path)) {
    throw new Error(`dependency note path must end in .md: ${path || "(empty)"}`);
  }
  if (!BULLET_PROPERTY_BLOCK_ID_RE.test(block)) {
    throw new Error(`invalid dependency block ID: ${block || "(empty)"}`);
  }
  const id = `${path.replace(MARKDOWN_EXTENSION_RE, "").replaceAll("/", "__")}__${block}`;
  const validation = validateDependencyId(id);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  return id;
}

function tryDependencyId(vaultRelativeMarkdownPath, blockId) {
  try {
    return dependencyId(vaultRelativeMarkdownPath, blockId);
  } catch (_error) {
    return null;
  }
}

function isUnsafeVaultPath(path) {
  const text = String(path || "");
  if (
    !text ||
    text.startsWith("/") ||
    text.includes("\0") ||
    WINDOWS_ABSOLUTE_PATH_RE.test(text)
  ) {
    return true;
  }

  return text
    .split("/")
    .some((part) => part === "" || part === "." || part === "..");
}

function hasNonMarkdownExtension(path) {
  const lastPart = String(path || "").split("/").pop() || "";
  const extensionMatch = lastPart.match(/\.([A-Za-z0-9]+)$/);
  return !!extensionMatch && extensionMatch[1].toLowerCase() !== "md";
}

function splitVaultPath(path) {
  const normalized = normalizeVaultRelativePath(path);
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex === -1) {
    return {
      folderPath: "",
      basename: normalized.replace(MARKDOWN_EXTENSION_RE, ""),
      fileName: normalized,
    };
  }

  const folderPath = normalized.slice(0, slashIndex);
  const fileName = normalized.slice(slashIndex + 1);
  return {
    folderPath,
    basename: fileName.replace(MARKDOWN_EXTENSION_RE, ""),
    fileName,
  };
}

function stripFinalExtension(fileName) {
  const text = String(fileName || "");
  const dotIndex = text.lastIndexOf(".");
  if (dotIndex <= 0) {
    return text;
  }

  return text.replace(FINAL_EXTENSION_RE, "");
}

function getVaultRelativeFilePath(file) {
  return file && file.path ? normalizeVaultRelativePath(file.path) : "";
}

function getVaultRelativeParentDirectory(path) {
  return splitVaultPath(path).folderPath;
}

function getVaultPathBasename(path) {
  return splitVaultPath(path).fileName;
}

function getVaultPathBasenameWithoutExtension(path) {
  return stripFinalExtension(getVaultPathBasename(path));
}

function normalizeFilesystemPath(path) {
  const text = String(path || "").trim().replace(/\\/g, "/");
  if (!text) {
    return "";
  }

  const leadingDoubleSlash = text.startsWith("//");
  const body = leadingDoubleSlash ? text.slice(2) : text;
  return `${leadingDoubleSlash ? "//" : ""}${body.replace(/\/+/g, "/")}`;
}

function joinFilesystemPath(basePath, relativePath) {
  const base = normalizeFilesystemPath(basePath).replace(/\/+$/, "");
  const relative = normalizeVaultRelativePath(relativePath).replace(/^\/+/, "");
  if (!base) {
    return "";
  }

  return relative ? `${base}/${relative}` : base;
}

function compactHomePath(path, homePath) {
  const normalizedPath = normalizeFilesystemPath(path);
  const normalizedHome = normalizeFilesystemPath(homePath).replace(/\/+$/, "");
  if (!normalizedPath || !normalizedHome) {
    return normalizedPath;
  }

  if (normalizedPath === normalizedHome) {
    return "~";
  }

  return normalizedPath.startsWith(`${normalizedHome}/`)
    ? `~${normalizedPath.slice(normalizedHome.length)}`
    : normalizedPath;
}

function getHomeDirectoryPath() {
  if (typeof process === "undefined" || !process.env) {
    return "";
  }

  return process.env.HOME || process.env.USERPROFILE || "";
}

