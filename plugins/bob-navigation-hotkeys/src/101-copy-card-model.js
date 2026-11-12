// Pure Copy card model: builtin rows, owning-task resolver, single-pass
// template grammar, and frozen snapshot. Key resolution lives in
// 101a-copy-card-keys.js. Obsidian-free so Node tests can load it through
// the navigation-hotkeys harness.

const COPY_CARD_NOTICE_VALUE_LIMIT = 60;
const COPY_CARD_NEWLINE_MARK = "⏎";
const COPY_CARD_NORMALIZED_TEMPLATE = Symbol("bob-copy-card-normalized-template");
const COPY_CARD_VARIABLE_NAMES = Object.freeze([
  "path",
  "absolute_path",
  "file_name",
  "note_name",
  "block_id",
]);
const COPY_CARD_VARIABLE_SET = new Set(COPY_CARD_VARIABLE_NAMES);
const COPY_CARD_VARIABLE_ALIASES = Object.freeze({
  task_id: "block_id",
  abs_file_with_tilde: "path",
  abs_file: "absolute_path",
  absolute: "absolute_path",
  basename: "file_name",
  basename_no_ext: "note_name",
  stem: "note_name",
  block_ref: "^{block_id}",
});
const COPY_CARD_BUILTIN_ROWS = Object.freeze([
  Object.freeze({
    id: "path",
    key: "p",
    label: "Path",
    variable: "path",
    needs: Object.freeze(["path"]),
  }),
  Object.freeze({
    id: "absolute",
    key: "a",
    label: "Absolute path",
    variable: "absolute_path",
    needs: Object.freeze(["absolute_path"]),
  }),
  Object.freeze({
    id: "file",
    key: "f",
    label: "File name",
    variable: "file_name",
    needs: Object.freeze(["file_name"]),
  }),
  Object.freeze({
    id: "note",
    key: "n",
    label: "Note name",
    variable: "note_name",
    needs: Object.freeze(["note_name"]),
  }),
  Object.freeze({
    id: "block-id",
    key: "i",
    label: "Block ID",
    variable: "block_id",
    needs: Object.freeze(["block_id"]),
  }),
]);
const COPY_CARD_RESERVED_KEYS = Object.freeze(
  COPY_CARD_BUILTIN_ROWS.map((row) => row.key),
);
const COPY_CARD_CLOSE_KEY = "q";
const COPY_CARD_NONE_TASK = Object.freeze({
  state: "none",
  line: null,
  blockId: null,
  title: null,
});

function freezeCopyCardValue(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      freezeCopyCardValue(entry);
    }
    return Object.freeze(value);
  }
  for (const key of Object.keys(value)) {
    freezeCopyCardValue(value[key]);
  }
  return Object.freeze(value);
}

function copyCardLevenshtein(left, right) {
  const source = String(left);
  const target = String(right);
  const sourceLength = source.length;
  const targetLength = target.length;
  if (sourceLength === 0) {
    return targetLength;
  }
  if (targetLength === 0) {
    return sourceLength;
  }
  const row = new Array(targetLength + 1);
  for (let index = 0; index <= targetLength; index += 1) {
    row[index] = index;
  }
  for (let i = 1; i <= sourceLength; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= targetLength; j += 1) {
      const next = row[j];
      const cost =
        source.charCodeAt(i - 1) === target.charCodeAt(j - 1) ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + cost);
      previous = next;
    }
  }
  return row[targetLength];
}

function formatCopyCardUnknownVariable(name) {
  const token = String(name || "");
  if (Object.prototype.hasOwnProperty.call(COPY_CARD_VARIABLE_ALIASES, token)) {
    const alias = COPY_CARD_VARIABLE_ALIASES[token];
    const hint = alias.includes("{") ? alias : `{${alias}}`;
    return `unknown {${token}} · did you mean ${hint}?`;
  }
  let best = null;
  let bestDistance = 3;
  for (const known of COPY_CARD_VARIABLE_NAMES) {
    const distance = copyCardLevenshtein(token, known);
    if (distance < bestDistance || (distance === bestDistance && best && known < best)) {
      bestDistance = distance;
      best = known;
    }
  }
  if (best && bestDistance <= 2) {
    return `unknown {${token}} · did you mean {${best}}?`;
  }
  const list = COPY_CARD_VARIABLE_NAMES.map((known) => `{${known}}`).join(", ");
  return `unknown {${token}} · valid names: ${list}`;
}

function parseCopyTemplate(text) {
  if (text === null || text === undefined) {
    return Object.freeze({ ok: false, reason: "template is empty" });
  }
  if (typeof text !== "string") {
    if (text && typeof text === "object" && !Array.isArray(text)) {
      return Object.freeze({
        ok: false,
        reason: "quote the template — YAML read it as a mapping",
      });
    }
    return Object.freeze({ ok: false, reason: "quote the template" });
  }
  if (text.trim() === "") {
    return Object.freeze({ ok: false, reason: "template is empty" });
  }

  const tokens = [];
  const variables = [];
  const seen = new Set();
  let index = 0;
  let textStart = 0;
  const flushText = (end) => {
    if (end > textStart) {
      tokens.push(
        Object.freeze({ type: "text", value: text.slice(textStart, end) }),
      );
    }
  };

  while (index < text.length) {
    const current = text.charAt(index);
    const next = index + 1 < text.length ? text.charAt(index + 1) : "";
    if (current === "{" && next === "{") {
      flushText(index);
      tokens.push(Object.freeze({ type: "text", value: "{" }));
      index += 2;
      textStart = index;
      continue;
    }
    if (current === "}" && next === "}") {
      flushText(index);
      tokens.push(Object.freeze({ type: "text", value: "}" }));
      index += 2;
      textStart = index;
      continue;
    }
    if (current === "{") {
      let nameEnd = index + 1;
      while (nameEnd < text.length && /[a-z_]/.test(text.charAt(nameEnd))) {
        nameEnd += 1;
      }
      const name = text.slice(index + 1, nameEnd);
      if (name && nameEnd < text.length && text.charAt(nameEnd) === "}") {
        if (!COPY_CARD_VARIABLE_SET.has(name)) {
          return Object.freeze({
            ok: false,
            reason: formatCopyCardUnknownVariable(name),
          });
        }
        flushText(index);
        tokens.push(Object.freeze({ type: "var", name }));
        if (!seen.has(name)) {
          seen.add(name);
          variables.push(name);
        }
        index = nameEnd + 1;
        textStart = index;
        continue;
      }
      return Object.freeze({
        ok: false,
        reason: `unmatched { at column ${index + 1}`,
      });
    }
    if (current === "}") {
      return Object.freeze({
        ok: false,
        reason: `unmatched } at column ${index + 1}`,
      });
    }
    index += 1;
  }

  flushText(text.length);
  return freezeCopyCardValue({
    ok: true,
    tokens,
    variables,
  });
}

function renderCopyTemplate(tokens, values) {
  const parts = [];
  const source = Array.isArray(tokens) ? tokens : [];
  const table = values && typeof values === "object" ? values : {};
  for (const token of source) {
    if (!token || typeof token !== "object") {
      continue;
    }
    if (token.type === "text") {
      parts.push(String(token.value || ""));
      continue;
    }
    if (token.type !== "var") {
      continue;
    }
    const value = table[token.name];
    if (value === null || value === undefined || value === "") {
      return null;
    }
    parts.push(String(value));
  }
  return parts.join("");
}

function copyCardSelectionPoint(point) {
  if (point === null || point === undefined) {
    return null;
  }
  if (typeof point === "number" && Number.isFinite(point)) {
    return { line: Math.floor(point), ch: 0 };
  }
  if (typeof point !== "object") {
    return null;
  }
  const line = Math.floor(numericOrDefault(point.line, Number.NaN));
  if (!Number.isFinite(line)) {
    return null;
  }
  const ch = Math.floor(numericOrDefault(point.ch, 0));
  return { line, ch: Number.isFinite(ch) ? ch : 0 };
}

function copyCardSelectionIsEmpty(anchor, head) {
  return anchor.line === head.line && anchor.ch === head.ch;
}

const COPY_CARD_NESTED_FENCE_OPEN_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const COPY_CARD_NESTED_FENCE_CLOSE_RE = /^(\s*)(`{3,}|~{3,})\s*$/;

function copyCardNestedFenceOpening(line) {
  const match = String(line).match(COPY_CARD_NESTED_FENCE_OPEN_RE);
  if (!match) {
    return null;
  }
  const marker = match[2];
  const info = match[3] || "";
  if (marker.charAt(0) === "`" && info.includes("`")) {
    return null;
  }
  return {
    indent: match[1].length,
    markerChar: marker.charAt(0),
    markerLength: marker.length,
  };
}

function copyCardNestedFenceCloses(line, opening) {
  const match = String(line).match(COPY_CARD_NESTED_FENCE_CLOSE_RE);
  if (!match || !opening) {
    return false;
  }
  if (match[2].charAt(0) !== opening.markerChar) {
    return false;
  }
  if (match[2].length < opening.markerLength) {
    return false;
  }
  return match[1].length <= opening.indent + 3;
}

function copyCardLineIsInFence(lines, lineIndex) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  if (
    !Number.isInteger(lineIndex) ||
    lineIndex < 0 ||
    lineIndex >= sourceLines.length
  ) {
    return false;
  }
  const contexts = getMarkdownLineContextsForLines(sourceLines);
  if (contexts[lineIndex] && contexts[lineIndex].inFence) {
    return true;
  }
  let inFence = null;
  for (let index = 0; index <= lineIndex; index += 1) {
    const line = String(sourceLines[index] || "");
    if (inFence) {
      const atTarget = index === lineIndex;
      if (copyCardNestedFenceCloses(line, inFence)) {
        inFence = null;
      }
      if (atTarget) {
        return true;
      }
      continue;
    }
    const opening = copyCardNestedFenceOpening(line);
    if (opening) {
      inFence = opening;
      if (index === lineIndex) {
        return true;
      }
    }
  }
  return false;
}

function resolveCopyCardTask(lines, selections) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const list = Array.isArray(selections) ? selections : [];
  if (list.length !== 1) {
    return COPY_CARD_NONE_TASK;
  }
  const selection = list[0] && typeof list[0] === "object" ? list[0] : {};
  const head = copyCardSelectionPoint(selection.head || selection);
  const anchor = copyCardSelectionPoint(selection.anchor || selection.head || selection);
  if (!head || !anchor) {
    return COPY_CARD_NONE_TASK;
  }
  if (copyCardLineIsInFence(sourceLines, head.line)) {
    return COPY_CARD_NONE_TASK;
  }
  if (
    !copyCardSelectionIsEmpty(anchor, head) &&
    copyCardLineIsInFence(sourceLines, anchor.line)
  ) {
    return COPY_CARD_NONE_TASK;
  }
  const headOwner = findOwningTaskLine(sourceLines, head.line);
  if (headOwner === null || headOwner === undefined) {
    return COPY_CARD_NONE_TASK;
  }
  if (!copyCardSelectionIsEmpty(anchor, head)) {
    const anchorOwner = findOwningTaskLine(sourceLines, anchor.line);
    if (anchorOwner !== headOwner) {
      return COPY_CARD_NONE_TASK;
    }
  }
  const ownerLine = String(sourceLines[headOwner] || "");
  const blockId = getTrailingBlockId(ownerLine);
  const title = cleanTaskDisplayText(ownerLine);
  if (!blockId) {
    return freezeCopyCardValue({
      state: "no-id",
      line: headOwner,
      blockId: null,
      title,
    });
  }
  return freezeCopyCardValue({
    state: "ready",
    line: headOwner,
    blockId,
    title,
  });
}

function copyCardPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function copyCardInvalidKey() {
  return Object.freeze({
    key: null,
    reason: "key must be one letter or digit",
    invalid: true,
  });
}

function copyCardPositionalKey(index) {
  const position = index + 1;
  if (position > 9) {
    return Object.freeze({
      key: null,
      reason: "add key: to bind",
      invalid: false,
    });
  }
  return Object.freeze({
    key: String(position),
    reason: null,
    invalid: false,
  });
}

function copyCardNormalizeKey(raw, index, supplied) {
  if (supplied !== true) {
    return copyCardPositionalKey(index);
  }
  let text = "";
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 0) {
      return copyCardInvalidKey();
    }
    text = String(raw);
  } else if (typeof raw === "string") {
    text = raw.toLowerCase();
  } else {
    return copyCardInvalidKey();
  }
  if (!/^[a-z0-9]$/.test(text)) {
    return copyCardInvalidKey();
  }
  return Object.freeze({ key: text, reason: null, invalid: false });
}

function copyCardTemplateLabel(raw, index) {
  if (raw === null || raw === undefined) {
    return "";
  }
  return String(raw).trim();
}

function normalizeCopyCardTemplates(list) {
  const source = Array.isArray(list) ? list : [];
  if (
    source.length > 0 &&
    source.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        entry[COPY_CARD_NORMALIZED_TEMPLATE] === true,
    )
  ) {
    return source;
  }
  const templates = [];
  for (let index = 0; index < source.length; index += 1) {
    const entry = source[index];
    const id = `template-${index + 1}`;
    const fallbackLabel = `Template ${index + 1}`;
    if (!copyCardPlainObject(entry)) {
      templates.push(
        freezeCopyCardValue({
          id,
          index,
          label: fallbackLabel,
          key: null,
          template: null,
          tokens: null,
          variables: Object.freeze([]),
          state: "error",
          reason: "expected label and template",
        }),
      );
      continue;
    }
    const labelText = copyCardTemplateLabel(entry.label, index);
    const label = labelText || fallbackLabel;
    const labelReason = labelText ? null : "add a label";
    const parsed = parseCopyTemplate(entry.template);
    const keySupplied = Object.prototype.hasOwnProperty.call(entry, "key");
    const keyInfo = copyCardNormalizeKey(entry.key, index, keySupplied);
    if (!parsed.ok) {
      templates.push(
        freezeCopyCardValue({
          id,
          index,
          label,
          key: null,
          template: entry.template,
          tokens: null,
          variables: Object.freeze([]),
          state: "error",
          reason: parsed.reason,
        }),
      );
      continue;
    }
    if (labelReason) {
      templates.push(
        freezeCopyCardValue({
          id,
          index,
          label,
          key: null,
          template: entry.template,
          tokens: parsed.tokens,
          variables: parsed.variables,
          state: "error",
          reason: labelReason,
        }),
      );
      continue;
    }
    if (keyInfo.invalid) {
      templates.push(
        freezeCopyCardValue({
          id,
          index,
          label,
          key: null,
          template: entry.template,
          tokens: parsed.tokens,
          variables: parsed.variables,
          state: "error",
          reason: keyInfo.reason,
        }),
      );
      continue;
    }
    templates.push(
      freezeCopyCardValue({
        id,
        index,
        label,
        key: keyInfo.key,
        template: entry.template,
        tokens: parsed.tokens,
        variables: parsed.variables,
        state: "ready",
        reason: keyInfo.reason,
      }),
    );
  }

  const owners = new Map();
  owners.set(COPY_CARD_CLOSE_KEY, [
    Object.freeze({ kind: "close", label: "Close", index: -1 }),
  ]);
  for (const builtin of COPY_CARD_BUILTIN_ROWS) {
    owners.set(builtin.key, [
      Object.freeze({ kind: "builtin", label: builtin.label, index: -1 }),
    ]);
  }
  for (const template of templates) {
    if (!template.key || template.state === "error") {
      continue;
    }
    const listForKey = owners.get(template.key) || [];
    listForKey.push(
      Object.freeze({
        kind: "template",
        label: template.label,
        index: template.index,
      }),
    );
    owners.set(template.key, listForKey);
  }

  return freezeCopyCardValue(
    templates.map((template) => {
      const preserve = (value) => {
        const copy = { ...value };
        Object.defineProperty(copy, COPY_CARD_NORMALIZED_TEMPLATE, {
          value: true,
        });
        return freezeCopyCardValue(copy);
      };
      if (!template.key || template.state === "error") {
        return preserve(template);
      }
      const claimed = owners.get(template.key) || [];
      const others = claimed.filter(
        (owner) => owner.kind !== "template" || owner.index !== template.index,
      );
      const uniqueTemplate =
        claimed.length === 1 && claimed[0].kind === "template";
      if (uniqueTemplate || others.length === 0) {
        return preserve(template);
      }
      const builtin = others.find((owner) => owner.kind === "builtin");
      const close = others.find((owner) => owner.kind === "close");
      const otherTemplate = others.find((owner) => owner.kind === "template");
      const originalKey = template.key;
      let reason;
      if (builtin) {
        reason = `key ${originalKey} is ${builtin.label}'s`;
      } else if (close) {
        reason = `key ${originalKey} closes the card`;
      } else {
        reason = `key ${originalKey} is also ${otherTemplate.label}'s`;
      }
      return preserve({
        ...template,
        key: null,
        state: "collision",
        reason,
      });
    }),
  );
}

function copyCardPreviewText(value) {
  return String(value ?? "").replace(/\r\n|\n|\r/g, COPY_CARD_NEWLINE_MARK);
}

function copyCardPathPreviewParts(value) {
  const text = String(value ?? "");
  const slash = text.lastIndexOf("/");
  if (slash === -1) {
    return Object.freeze({ head: "", tail: text });
  }
  return Object.freeze({
    head: text.slice(0, slash + 1),
    tail: text.slice(slash + 1),
  });
}

function copyCardMiddleTruncate(text, limit) {
  const value = String(text ?? "");
  const max = Math.max(1, Math.floor(numericOrDefault(limit, COPY_CARD_NOTICE_VALUE_LIMIT)));
  if (value.length <= max) {
    return value;
  }
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

function formatCopiedNotice(value) {
  const display = copyCardPreviewText(value);
  return `Copied ${copyCardMiddleTruncate(display, COPY_CARD_NOTICE_VALUE_LIMIT)}`;
}

function copyCardTaskState(task) {
  const state = task && typeof task === "object" ? String(task.state || "") : "none";
  if (state === "ready" || state === "no-id") {
    return state;
  }
  return "none";
}

function copyCardAvailableValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value);
  return text === "" ? null : text;
}

function copyCardTemplateUsesBlockId(template) {
  const variables = Array.isArray(template && template.variables)
    ? template.variables
    : [];
  return variables.includes("block_id");
}

function isCopyableCopyCardRow(row) {
  return Boolean(row) && (row.state === "ready" || row.state === "collision");
}

function buildCopyCardRow(fields) {
  return freezeCopyCardValue({
    id: fields.id,
    group: fields.group,
    key: fields.key || null,
    label: fields.label,
    value: fields.value === undefined ? null : fields.value,
    preview: fields.preview,
    previewParts: fields.previewParts || null,
    state: fields.state,
    reason: fields.reason || null,
    isPath: fields.isPath === true,
  });
}

function buildCopyCardBuiltinRow(spec, values, taskState) {
  if (spec.id === "block-id") {
    if (taskState === "none") {
      return null;
    }
    if (taskState === "no-id") {
      const reason = "none yet · Ctrl+6 on the task line names one";
      return buildCopyCardRow({
        id: spec.id,
        group: "task",
        key: spec.key,
        label: spec.label,
        value: null,
        preview: reason,
        state: "unavailable",
        reason,
        isPath: false,
      });
    }
    const blockId = copyCardAvailableValue(values.block_id);
    const value = blockId ? `^${blockId}` : null;
    if (!value) {
      const reason = "none yet · Ctrl+6 on the task line names one";
      return buildCopyCardRow({
        id: spec.id,
        group: "task",
        key: spec.key,
        label: spec.label,
        value: null,
        preview: reason,
        state: "unavailable",
        reason,
        isPath: false,
      });
    }
    return buildCopyCardRow({
      id: spec.id,
      group: "task",
      key: spec.key,
      label: spec.label,
      value,
      preview: value,
      state: "ready",
      reason: null,
      isPath: false,
    });
  }

  const isPath = spec.id === "path" || spec.id === "absolute";
  const needed = spec.needs[0];
  const value = copyCardAvailableValue(values[needed]);
  if (!value) {
    const reason =
      needed === "path" || needed === "absolute_path"
        ? "needs an absolute vault path"
        : `needs {${needed}}`;
    return buildCopyCardRow({
      id: spec.id,
      group: "file",
      key: spec.key,
      label: spec.label,
      value: null,
      preview: reason,
      previewParts: null,
      state: "unavailable",
      reason,
      isPath,
    });
  }
  return buildCopyCardRow({
    id: spec.id,
    group: "file",
    key: spec.key,
    label: spec.label,
    value,
    preview: copyCardPreviewText(value),
    previewParts: isPath ? copyCardPathPreviewParts(value) : null,
    state: "ready",
    reason: null,
    isPath,
  });
}

function buildCopyCardTemplateRow(template, values, taskState) {
  const usesBlockId = copyCardTemplateUsesBlockId(template);
  const group = usesBlockId ? "task" : "file";
  if (template.state === "error") {
    return buildCopyCardRow({
      id: template.id,
      group,
      key: null,
      label: template.label,
      value: null,
      preview: template.reason,
      state: "error",
      reason: template.reason,
      isPath: false,
    });
  }
  if (usesBlockId && taskState === "none") {
    return null;
  }
  if (usesBlockId && taskState === "no-id") {
    const reason = "needs a block ID";
    return buildCopyCardRow({
      id: template.id,
      group: "task",
      key: template.key,
      label: template.label,
      value: null,
      preview: reason,
      state: "unavailable",
      reason,
      isPath: false,
    });
  }
  const rendered = renderCopyTemplate(template.tokens, values);
  if (rendered === null) {
    const needsPath =
      Array.isArray(template.variables) &&
      (template.variables.includes("path") ||
        template.variables.includes("absolute_path"));
    const reason = needsPath
      ? "needs an absolute vault path"
      : "needs a block ID";
    return buildCopyCardRow({
      id: template.id,
      group,
      key: template.key,
      label: template.label,
      value: null,
      preview: reason,
      state: "unavailable",
      reason,
      isPath: false,
    });
  }
  return buildCopyCardRow({
    id: template.id,
    group,
    key: template.key,
    label: template.label,
    value: rendered,
    preview: copyCardPreviewText(rendered),
    state: template.state,
    reason: template.reason,
    isPath: false,
  });
}

function buildCopyCardModel(input) {
  const options = input && typeof input === "object" ? input : {};
  const filePath = String(options.filePath || "");
  const basePath = String(options.basePath || "");
  const homePath = String(options.homePath || "");
  const relative = normalizeVaultRelativePath(filePath);
  const absolute = getYankPathText("absolute", relative, basePath, homePath);
  const pathText = getYankPathText(
    "absolute-tilde",
    relative,
    basePath,
    homePath,
  );
  const fileName = getYankPathText("basename", relative, basePath, homePath);
  const noteName = getYankPathText(
    "basename-no-extension",
    relative,
    basePath,
    homePath,
  );
  const task = options.task && typeof options.task === "object"
    ? options.task
    : COPY_CARD_NONE_TASK;
  const taskState = copyCardTaskState(task);
  const values = Object.freeze({
    path: copyCardAvailableValue(pathText),
    absolute_path: copyCardAvailableValue(absolute),
    file_name: copyCardAvailableValue(fileName),
    note_name: copyCardAvailableValue(noteName),
    block_id:
      taskState === "ready" ? copyCardAvailableValue(task.blockId) : null,
  });
  const templates = normalizeCopyCardTemplates(options.templates);
  const diagnostic =
    typeof options.diagnostic === "string" && options.diagnostic.trim()
      ? options.diagnostic.trim()
      : null;
  const fileBuiltins = [];
  const taskBuiltins = [];
  for (const spec of COPY_CARD_BUILTIN_ROWS) {
    const row = buildCopyCardBuiltinRow(spec, values, taskState);
    if (!row) {
      continue;
    }
    if (spec.id === "block-id") {
      taskBuiltins.push(row);
    } else {
      fileBuiltins.push(row);
    }
  }
  const fileTemplates = [];
  const taskTemplates = [];
  for (const template of templates) {
    const row = buildCopyCardTemplateRow(template, values, taskState);
    if (!row) {
      continue;
    }
    if (row.group === "task") {
      taskTemplates.push(row);
    } else {
      fileTemplates.push(row);
    }
  }
  const diagnosticRow = diagnostic
    ? [
        buildCopyCardRow({
          id: "diagnostic",
          group: "file",
          key: null,
          label: "Templates",
          value: null,
          preview: diagnostic,
          state: "error",
          reason: diagnostic,
          isPath: false,
        }),
      ]
    : [];
  const rows = [
    ...fileBuiltins,
    ...fileTemplates,
    ...diagnosticRow,
    ...taskBuiltins,
    ...taskTemplates,
  ];
  const copyable = rows.filter(isCopyableCopyCardRow);
  const pathRow = rows.find((row) => row.id === "path");
  let defaultRowId = null;
  if (pathRow && isCopyableCopyCardRow(pathRow)) {
    defaultRowId = pathRow.id;
  } else if (copyable.length > 0) {
    defaultRowId = copyable[0].id;
  } else if (rows.length > 0) {
    defaultRowId = rows[0].id;
  }
  return freezeCopyCardValue({
    title: "Copy",
    subtitle: relative,
    rows,
    defaultRowId,
    task: Object.freeze({
      state: taskState,
      title: taskState === "none" ? null : task.title || null,
    }),
  });
}
