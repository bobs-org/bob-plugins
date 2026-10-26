#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const OPEN_TO_CLOSE = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);
const CLOSE_TO_OPEN = new Map([...OPEN_TO_CLOSE].map(([open, close]) => [close, open]));
const BT = String.fromCharCode(96);

function location(file, token) {
  return file + ":" + (token?.line ?? 1) + ":" + (token?.column ?? 1);
}

function fail(message, file, token) {
  throw new Error(location(file, token) + ": " + message);
}

function isIdentifierStart(character) {
  return /[A-Za-z_$]/.test(character) || character.charCodeAt(0) > 127;
}

function isIdentifierPart(character) {
  return /[A-Za-z0-9_$]/.test(character) || character.charCodeAt(0) > 127;
}

function isLineBreak(character) {
  return character === "\n" || character === "\r";
}

function decodeEscape(source, index, file, token) {
  const character = source[index];
  const simple = new Map([
    ["n", "\n"],
    ["r", "\r"],
    ["t", "\t"],
    ["b", "\b"],
    ["f", "\f"],
    ["v", "\v"],
    ["0", "\0"],
    ["\\", "\\"],
    ["'", "'"],
    ['"', '"'],
  ]);

  if (simple.has(character)) return { value: simple.get(character), end: index + 1 };
  if (character === "\n") return { value: "", end: index + 1 };
  if (character === "\r") {
    return { value: "", end: source[index + 1] === "\n" ? index + 2 : index + 1 };
  }

  if (character === "x") {
    const digits = source.slice(index + 1, index + 3);
    if (!/^[0-9a-fA-F]{2}$/.test(digits)) fail("invalid hexadecimal escape", file, token);
    return { value: String.fromCharCode(parseInt(digits, 16)), end: index + 3 };
  }

  if (character === "u") {
    if (source[index + 1] === "{") {
      const close = source.indexOf("}", index + 2);
      const digits = close < 0 ? "" : source.slice(index + 2, close);
      if (!/^[0-9a-fA-F]{1,6}$/.test(digits)) fail("invalid Unicode escape", file, token);
      const codePoint = parseInt(digits, 16);
      if (codePoint > 0x10ffff) fail("Unicode escape is out of range", file, token);
      return { value: String.fromCodePoint(codePoint), end: close + 1 };
    }
    const digits = source.slice(index + 1, index + 5);
    if (!/^[0-9a-fA-F]{4}$/.test(digits)) fail("invalid Unicode escape", file, token);
    return { value: String.fromCharCode(parseInt(digits, 16)), end: index + 5 };
  }

  return { value: character, end: index + 1 };
}

function skipQuoted(source, start, quote) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    if (isLineBreak(source[index])) return index;
    index += 1;
  }
  return index;
}

function canStartRegularExpression(previous) {
  if (!previous) return true;
  if (previous.type === "identifier") {
    return new Set([
      "await",
      "case",
      "delete",
      "else",
      "in",
      "instanceof",
      "new",
      "of",
      "return",
      "throw",
      "typeof",
      "void",
      "yield",
    ]).has(previous.value);
  }
  if (previous.type === "string" || previous.type === "template" || previous.type === "number" || previous.type === "regex") {
    return false;
  }
  return new Set([
    "!",
    "!=",
    "!==",
    "%",
    "&",
    "&&",
    "(",
    "*",
    "**",
    "+",
    "-",
    "/",
    ":",
    ";",
    "<",
    "<=",
    "=",
    "==",
    "===",
    ">",
    ">=",
    "?",
    "??",
    "=>",
    "[",
    "{",
    "|",
    "||",
    "^",
    "~",
  ]).has(previous.value);
}

function skipRegularExpression(source, start) {
  let index = start + 1;
  let inCharacterClass = false;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (isLineBreak(character)) return start + 1;
    if (character === "[") inCharacterClass = true;
    else if (character === "]") inCharacterClass = false;
    else if (character === "/" && !inCharacterClass) {
      index += 1;
      while (/[A-Za-z]/.test(source[index] ?? "")) index += 1;
      return index;
    }
    index += 1;
  }
  return source.length;
}

function skipTemplateExpression(source, start) {
  let index = start;
  let braceDepth = 1;
  let previous = null;

  while (index < source.length && braceDepth > 0) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && !isLineBreak(source[index])) index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      index = close < 0 ? source.length : close + 2;
      continue;
    }
    if (character === "'" || character === '"') {
      index = skipQuoted(source, index, character);
      previous = { type: "string", value: "" };
      continue;
    }
    if (character === String.fromCharCode(96)) {
      const template = skipTemplateLiteral(source, index);
      index = template.end;
      previous = { type: "template", value: "" };
      continue;
    }
    if (character === "/" && canStartRegularExpression(previous)) {
      const end = skipRegularExpression(source, index);
      if (end > index + 1) {
        index = end;
        previous = { type: "regex", value: "" };
        continue;
      }
    }
    if (character === "{") {
      braceDepth += 1;
      index += 1;
      previous = { type: "punctuation", value: "{" };
      continue;
    }
    if (character === "}") {
      braceDepth -= 1;
      index += 1;
      previous = { type: "punctuation", value: "}" };
      continue;
    }
    if (isIdentifierStart(character)) {
      const begin = index;
      index += 1;
      while (index < source.length && isIdentifierPart(source[index])) index += 1;
      previous = { type: "identifier", value: source.slice(begin, index) };
      continue;
    }
    if (/[0-9]/.test(character)) {
      index += 1;
      while (/[A-Za-z0-9_.]/.test(source[index] ?? "")) index += 1;
      previous = { type: "number", value: "" };
      continue;
    }
    const operator = ["...", "===", "!==", "=>", "?.", "==", "!=", "<=", ">=", "&&", "||", "??", "**", "++", "--"]
      .find((candidate) => source.startsWith(candidate, index));
    const value = operator ?? character;
    index += value.length;
    previous = { type: "punctuation", value };
  }

  return index;
}

function skipTemplateLiteral(source, start) {
  let index = start + 1;
  let dynamic = false;
  let staticValue = "";

  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      const decoded = decodeEscape(source, index + 1, "<template>", { line: 1, column: 1 });
      staticValue += decoded.value;
      index = decoded.end;
      continue;
    }
    if (character === String.fromCharCode(96)) {
      return { end: index + 1, dynamic, value: dynamic ? null : staticValue };
    }
    if (character === "$" && source[index + 1] === "{") {
      dynamic = true;
      index = skipTemplateExpression(source, index + 2);
      continue;
    }
    staticValue += character;
    index += 1;
  }

  return { end: source.length, dynamic: true, value: null };
}

function tokenize(file, source) {
  const tokens = [];
  let index = 0;
  let line = 1;
  let column = 1;
  let previous = null;

  function advance(end) {
    while (index < end) {
      if (source[index] === "\r") {
        if (source[index + 1] === "\n" && index + 1 < end) index += 1;
        line += 1;
        column = 1;
      } else if (source[index] === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      index += 1;
    }
  }

  function add(type, value, startLine, startColumn, dynamic = false) {
    const token = { type, value, line: startLine, column: startColumn, dynamic };
    tokens.push(token);
    previous = token;
  }

  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      advance(index + 1);
      continue;
    }

    const start = index;
    const startLine = line;
    const startColumn = column;

    if (character === "/" && source[index + 1] === "/") {
      let end = index + 2;
      while (end < source.length && !isLineBreak(source[end])) end += 1;
      advance(end);
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      if (close < 0) fail("unterminated block comment", file, { line, column });
      advance(close + 2);
      continue;
    }
    if (character === "'" || character === '"') {
      let cursor = index + 1;
      let value = "";
      while (cursor < source.length) {
        if (source[cursor] === character) break;
        if (isLineBreak(source[cursor])) fail("unescaped line break in string", file, { line, column });
        if (source[cursor] === "\\") {
          const decoded = decodeEscape(source, cursor + 1, file, { line, column });
          value += decoded.value;
          cursor = decoded.end;
        } else {
          value += source[cursor];
          cursor += 1;
        }
      }
      if (cursor >= source.length) fail("unterminated string literal", file, { line, column });
      advance(cursor + 1);
      add("string", value, startLine, startColumn);
      continue;
    }
    if (character === String.fromCharCode(96)) {
      const template = skipTemplateLiteral(source, index);
      if (template.end <= index + 1 || source[template.end - 1] !== String.fromCharCode(96)) {
        fail("unterminated template literal", file, { line, column });
      }
      advance(template.end);
      add("template", template.value, startLine, startColumn, template.dynamic);
      continue;
    }
    if (character === "/" && canStartRegularExpression(previous)) {
      const end = skipRegularExpression(source, index);
      if (end > index + 1) {
        const raw = source.slice(index, end);
        advance(end);
        add("regex", raw, startLine, startColumn);
        continue;
      }
    }
    if (isIdentifierStart(character)) {
      let end = index + 1;
      while (end < source.length && isIdentifierPart(source[end])) end += 1;
      const value = source.slice(index, end);
      advance(end);
      add("identifier", value, startLine, startColumn);
      continue;
    }
    if (/[0-9]/.test(character)) {
      let end = index + 1;
      while (/[A-Za-z0-9_.]/.test(source[end] ?? "")) end += 1;
      const value = source.slice(index, end);
      advance(end);
      add("number", value, startLine, startColumn);
      continue;
    }

    const operator = ["...", "===", "!==", "=>", "?.", "==", "!=", "<=", ">=", "&&", "||", "??", "**", "++", "--", "+=", "-=", "*=", "/="]
      .find((candidate) => source.startsWith(candidate, index));
    const value = operator ?? character;
    advance(index + value.length);
    add("punctuation", value, startLine, startColumn);
  }

  const pairs = new Map();
  const stack = [];
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    if (token.type === "punctuation" && OPEN_TO_CLOSE.has(token.value)) {
      stack.push(tokenIndex);
    } else if (token.type === "punctuation" && CLOSE_TO_OPEN.has(token.value)) {
      const openIndex = stack.pop();
      if (openIndex === undefined || tokens[openIndex].value !== CLOSE_TO_OPEN.get(token.value)) {
        const open = openIndex === undefined ? "none" : tokens[openIndex].value + " opened at " + location(file, tokens[openIndex]);
        fail("unmatched delimiter " + token.value + " (top open: " + open + "; tokens: " + tokens.slice(Math.max(0, tokenIndex - 10), tokenIndex + 1).map((item) => item.value + "@" + item.column).join(" ") + ")", file, token);
      }
      pairs.set(openIndex, tokenIndex);
      pairs.set(tokenIndex, openIndex);
    }
  }
  if (stack.length > 0) fail("unclosed delimiter " + tokens[stack[stack.length - 1]].value, file, tokens[stack[stack.length - 1]]);

  return { file, source, tokens, pairs };
}

function splitTopLevel(parsed, start, end, delimiter = ",") {
  const segments = [];
  let segmentStart = start;
  let index = start;
  while (index < end) {
    const token = parsed.tokens[index];
    if (token.type === "punctuation" && OPEN_TO_CLOSE.has(token.value) && parsed.pairs.has(index)) {
      index = parsed.pairs.get(index) + 1;
      continue;
    }
    if (token.value === delimiter) {
      segments.push([segmentStart, index]);
      segmentStart = index + 1;
    }
    index += 1;
  }
  if (segmentStart < end) segments.push([segmentStart, end]);
  return segments;
}

function parseObjectProperties(parsed, openIndex, closeIndex, label) {
  const properties = new Map();
  for (const [start, end] of splitTopLevel(parsed, openIndex + 1, closeIndex)) {
    if (start >= end) continue;
    const first = parsed.tokens[start];
    if (first.value === "...") {
      fail("spread properties are unsupported in " + label, parsed.file, first);
    }
    const keyToken = parsed.tokens[start];
    if ((keyToken.type !== "identifier" && keyToken.type !== "string") || parsed.tokens[start + 1]?.value !== ":") {
      continue;
    }
    const key = keyToken.value;
    if (properties.has(key)) fail("duplicate " + key + " property in " + label, parsed.file, keyToken);
    properties.set(key, {
      key,
      keyToken,
      start,
      end,
      valueStart: start + 2,
      valueEnd: end,
    });
  }
  return properties;
}

function readStaticString(parsed, start, end, label, token = parsed.tokens[start]) {
  if (end - start === 1) {
    const candidate = parsed.tokens[start];
    if (candidate.type === "string") return candidate.value;
    if (candidate.type === "template" && !candidate.dynamic) return candidate.value;
  }
  fail(label + " must be a string literal", parsed.file, token);
}

function readLiteralStringArray(parsed, property, label) {
  if (!property) return [];
  const { valueStart, valueEnd, keyToken } = property;
  if (parsed.tokens[valueStart]?.value !== "[" || parsed.pairs.get(valueStart) !== valueEnd - 1) {
    fail(label + " must be a literal string array", parsed.file, keyToken);
  }
  const values = [];
  for (const [start, end] of splitTopLevel(parsed, valueStart + 1, valueEnd - 1)) {
    values.push(readStaticString(parsed, start, end, label, parsed.tokens[start]));
  }
  return values;
}

function readHotkeys(parsed, property, ownerLabel) {
  if (!property) return [];
  const { valueStart, valueEnd, keyToken } = property;
  if (parsed.tokens[valueStart]?.value !== "[" || parsed.pairs.get(valueStart) !== valueEnd - 1) {
    fail("hotkeys for " + ownerLabel + " must be a literal array", parsed.file, keyToken);
  }

  const hotkeys = [];
  for (const [start, end] of splitTopLevel(parsed, valueStart + 1, valueEnd - 1)) {
    if (parsed.tokens[start]?.value !== "{" || parsed.pairs.get(start) !== end - 1) {
      fail("hotkey entries for " + ownerLabel + " must be object literals", parsed.file, parsed.tokens[start]);
    }
    const fields = parseObjectProperties(parsed, start, end - 1, "hotkey entry");
    const keyField = fields.get("key");
    if (!keyField) fail("hotkey entry for " + ownerLabel + " needs a key", parsed.file, parsed.tokens[start]);
    const key = readStaticString(parsed, keyField.valueStart, keyField.valueEnd, "hotkey key", keyField.keyToken);
    const modifiers = readLiteralStringArray(parsed, fields.get("modifiers"), "hotkey modifiers");
    hotkeys.push([...modifiers, key].join("+"));
  }
  return hotkeys;
}

function parseCommandObject(parsed, openIndex, closeIndex, mode) {
  const fields = parseObjectProperties(parsed, openIndex, closeIndex, "command registration");
  const idField = fields.get("id");
  const nameField = fields.get("name");
  if (!idField) fail("command registration has no id", parsed.file, parsed.tokens[openIndex]);
  if (!nameField) fail("command registration has no name", parsed.file, parsed.tokens[openIndex]);

  const idValue = readFieldOrMember(parsed, idField, "command id");
  const nameValue = readFieldOrMember(parsed, nameField, "command name");
  const hotkeys = readHotkeys(parsed, fields.get("hotkeys"), "command");
  const sourceLocation = location(parsed.file, parsed.tokens[openIndex]);

  if (idValue.kind === "literal" && nameValue.kind === "literal") {
    return {
      kind: "literal",
      id: idValue.value,
      name: nameValue.value,
      hotkeys,
      location: sourceLocation,
      file: parsed.file,
      token: parsed.tokens[openIndex],
    };
  }
  if (
    idValue.kind === "member" &&
    nameValue.kind === "member" &&
    idValue.object === nameValue.object &&
    idValue.property === "id" &&
    nameValue.property === "name"
  ) {
    return {
      kind: "table-row",
      parameter: idValue.object,
      hotkeys,
      location: sourceLocation,
      file: parsed.file,
      token: parsed.tokens[openIndex],
    };
  }
  fail("command id and name must be string literals or matching table fields", parsed.file, parsed.tokens[openIndex]);
}

function readFieldOrMember(parsed, field, label) {
  const { valueStart, valueEnd, keyToken } = field;
  if (valueEnd - valueStart === 1) {
    const candidate = parsed.tokens[valueStart];
    if (candidate.type === "string" || (candidate.type === "template" && !candidate.dynamic)) {
      return { kind: "literal", value: candidate.value };
    }
  }
  if (
    valueEnd - valueStart === 3 &&
    parsed.tokens[valueStart].type === "identifier" &&
    parsed.tokens[valueStart + 1].value === "." &&
    parsed.tokens[valueStart + 2].type === "identifier"
  ) {
    return {
      kind: "member",
      object: parsed.tokens[valueStart].value,
      property: parsed.tokens[valueStart + 2].value,
    };
  }
  fail(label + " must be a string literal", parsed.file, keyToken);
}

function parseStaticCommandRecord(parsed, openIndex, closeIndex) {
  const record = parseCommandObject(parsed, openIndex, closeIndex, "table");
  if (record.kind !== "literal") {
    fail("command table id and name must be string literals", parsed.file, parsed.tokens[openIndex]);
  }
  return record;
}

function findConstantArray(name, sources, reference) {
  const matches = [];
  for (const parsed of sources) {
    const { tokens, pairs } = parsed;
    for (let index = 0; index < tokens.length - 3; index += 1) {
      if (
        tokens[index].value === "const" &&
        tokens[index + 1]?.type === "identifier" &&
        tokens[index + 1].value === name &&
        tokens[index + 2]?.value === "=" &&
        tokens[index + 3]?.value === "["
      ) {
        matches.push({ parsed, openIndex: index + 3, closeIndex: pairs.get(index + 3), token: tokens[index] });
      }
    }
  }
  if (matches.length === 0) fail("no constant array named " + name + " for command loop", reference.parsed.file, reference.token);
  if (matches.length > 1) fail("multiple constant arrays named " + name, matches[1].parsed.file, matches[1].token);

  const match = matches[0];
  if (match.closeIndex === undefined) fail("malformed command table " + name, match.parsed.file, match.token);
  const rows = [];
  for (const [start, end] of splitTopLevel(match.parsed, match.openIndex + 1, match.closeIndex)) {
    if (match.parsed.tokens[start]?.value !== "{" || match.parsed.pairs.get(start) !== end - 1) {
      fail("command table " + name + " entries must be object literals", match.parsed.file, match.parsed.tokens[start]);
    }
    rows.push(parseStaticCommandRecord(match.parsed, start, end - 1));
  }
  if (rows.length === 0) fail("command table " + name + " is empty", match.parsed.file, match.token);
  return rows;
}

function findForEachContexts(parsed) {
  const contexts = [];
  const { tokens, pairs } = parsed;
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      tokens[index].value !== "forEach" ||
      tokens[index - 1]?.value !== "." ||
      tokens[index - 2]?.type !== "identifier" ||
      tokens[index + 1]?.value !== "("
    ) continue;

    const callClose = pairs.get(index + 1);
    if (callClose === undefined) continue;
    const argumentStart = index + 2;
    const callbackParamOpen = tokens[argumentStart]?.value === "(" ? argumentStart : -1;
    if (callbackParamOpen < 0) continue;
    const callbackParamClose = pairs.get(callbackParamOpen);
    if (
      callbackParamClose === undefined ||
      callbackParamClose !== callbackParamOpen + 2 ||
      tokens[callbackParamOpen + 1]?.type !== "identifier" ||
      tokens[callbackParamClose + 1]?.value !== "=>" ||
      tokens[callbackParamClose + 2]?.value !== "{"
    ) continue;

    const bodyOpen = callbackParamClose + 2;
    const bodyClose = pairs.get(bodyOpen);
    if (bodyClose === undefined || bodyClose >= callClose) continue;
    if (bodyClose + 1 < callClose && tokens[bodyClose + 1].value !== ",") continue;

    contexts.push({
      arrayName: tokens[index - 2].value,
      parameter: tokens[callbackParamOpen + 1].value,
      bodyStart: bodyOpen + 1,
      bodyEnd: bodyClose,
      token: tokens[index],
    });
  }
  return contexts;
}

function findCommandCalls(parsed) {
  const calls = [];
  const { tokens, pairs } = parsed;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const isName = token.type === "identifier" && token.value === "addCommand";
    const isComputedName =
      token.type === "string" &&
      token.value === "addCommand" &&
      tokens[index - 1]?.value === "[" &&
      tokens[index + 1]?.value === "]";
    if (!isName && !isComputedName) continue;
    const isMember =
      isComputedName ||
      tokens[index - 1]?.value === "." ||
      tokens[index - 1]?.value === "?.";
    if (!isMember) {
      if (tokens[index + 1]?.value === "(") fail("addCommand must be called as a member method", parsed.file, token);
      continue;
    }

    let openIndex = isComputedName ? index + 2 : index + 1;
    if (tokens[openIndex]?.value === "?." && tokens[openIndex + 1]?.value === "(") openIndex += 1;
    if (tokens[openIndex]?.value !== "(") {
      const isTypeofGuard =
        !isComputedName &&
        tokens[index - 1]?.value === "." &&
        tokens[index - 2]?.type === "identifier" &&
        (tokens[index - 2].value === "this" || tokens[index - 2].value === "plugin") &&
        tokens[index - 3]?.value === "typeof";
      if (isTypeofGuard) continue;
      fail("unsupported non-call addCommand reference", parsed.file, token);
    }
    if (!isComputedName && tokens[index - 1]?.value !== "." && tokens[index - 1]?.value !== "?.") {
      fail("addCommand must be called as a member method", parsed.file, token);
    }
    const closeIndex = pairs.get(openIndex);
    if (closeIndex === undefined) fail("malformed addCommand call", parsed.file, token);
    const firstArgument = openIndex + 1;
    const argumentEnd = closeIndex;
    if (tokens[firstArgument]?.value !== "{") {
      fail("addCommand argument must be an object literal", parsed.file, token);
    }
    const objectClose = pairs.get(firstArgument);
    if (objectClose === undefined || (objectClose + 1 !== argumentEnd && !(objectClose + 2 === argumentEnd && tokens[objectClose + 1].value === ","))) {
      fail("addCommand must receive exactly one object literal", parsed.file, token);
    }
    calls.push({
      index,
      token,
      registration: parseCommandObject(parsed, firstArgument, objectClose, "command"),
    });
  }
  return calls;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function scanCommands(sourceFiles) {
  const sources = sourceFiles.map(({ path: file, content }) => tokenize(file, content));
  const loopsBySource = new Map(sources.map((parsed) => [parsed, findForEachContexts(parsed)]));
  const allCalls = [];

  for (const parsed of sources) {
    const contexts = loopsBySource.get(parsed);
    for (const call of findCommandCalls(parsed)) {
      const enclosing = contexts.filter((context) => call.index > context.bodyStart && call.index < context.bodyEnd)
        .sort((left, right) => (left.bodyEnd - left.bodyStart) - (right.bodyEnd - right.bodyStart))[0];
      const registration = call.registration;
      if (registration.kind === "literal") {
        if (!registration.id.trim()) {
          fail("command id cannot be empty", parsed.file, registration.token);
        }
        if (!registration.name.trim()) {
          fail("command name cannot be empty", parsed.file, registration.token);
        }
        if (enclosing) {
          fail("literal command registrations inside forEach loops are unsupported", parsed.file, call.token);
        }
        allCalls.push({
          id: registration.id,
          name: registration.name,
          hotkeys: registration.hotkeys,
          location: location(parsed.file, call.token),
        });
        continue;
      }
      if (!enclosing || registration.parameter !== enclosing.parameter) {
        fail("dynamic command metadata requires a supported constant-array forEach", parsed.file, call.token);
      }
      const tableRows = findConstantArray(enclosing.arrayName, sources, { parsed, token: enclosing.token });
      for (const row of tableRows) {
        if (!row.id.trim()) {
          fail("command id cannot be empty", row.file, row.token);
        }
        if (!row.name.trim()) {
          fail("command name cannot be empty", row.file, row.token);
        }
        allCalls.push({
          id: row.id,
          name: row.name,
          hotkeys: registration.hotkeys.length > 0 ? registration.hotkeys : row.hotkeys,
          location: location(parsed.file, call.token) + " (table row at " + row.location + ")",
        });
      }
    }
  }

  const ids = new Map();
  for (const command of allCalls) {
    const previous = ids.get(command.id);
    if (previous) {
      throw new Error("duplicate command id " + JSON.stringify(command.id) + " at " + command.location + "; first registered at " + previous);
    }
    ids.set(command.id, command.location);
  }

  return allCalls.sort((left, right) => compareText(left.name, right.name) || compareText(left.id, right.id));
}

function parseSemver(version, label) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) throw new Error(label + " has invalid semantic version " + JSON.stringify(version));
  const prerelease = match[4] ? match[4].split(".") : null;
  if (prerelease) {
    for (const identifier of prerelease) {
      if (!identifier) throw new Error(label + " has invalid semantic version " + JSON.stringify(version));
      if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) {
        throw new Error(label + " has invalid semantic version " + JSON.stringify(version));
      }
    }
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease, text: version };
}

function compareSemver(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease === null && right.prerelease === null) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return Number(a) < Number(b) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return compareText(a, b);
  }
  return 0;
}

function escapeTable(value) {
  return String(value)
    .replace(/\r?\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function escapeCodeCell(value) {
  const source = String(value);
  const runs = [...source.matchAll(/`+/g)].map(([run]) => run.length);
  const fence = BT.repeat(Math.max(1, ...runs) + (runs.length ? 1 : 0));
  return fence + source.replace(/\|/g, "\\|") + fence;
}

function validateManifest(manifest, manifestPath) {
  for (const field of ["id", "name", "version", "minAppVersion", "description"]) {
    if (typeof manifest[field] !== "string" || !manifest[field].trim()) {
      throw new Error(manifestPath + ": manifest field " + field + " must be a nonempty string");
    }
  }
  if (typeof manifest.isDesktopOnly !== "boolean") {
    throw new Error(manifestPath + ": manifest field isDesktopOnly must be a boolean");
  }
  const version = parseSemver(manifest.version, manifestPath + " version");
  const minAppVersion = parseSemver(manifest.minAppVersion, manifestPath + " minAppVersion");
  return { ...manifest, parsedVersion: version, parsedMinAppVersion: minAppVersion };
}

function withinDirectory(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

function loadSourceFiles(root, pluginDirectory, id) {
  const pluginRoot = path.join(root, pluginDirectory);
  const fragmentsPath = path.join(pluginRoot, "src", "fragments.json");
  let selectedPaths;

  if (fs.existsSync(fragmentsPath)) {
    let fragments;
    try {
      fragments = JSON.parse(fs.readFileSync(fragmentsPath, "utf8"));
    } catch (error) {
      throw new Error(path.relative(root, fragmentsPath) + ": cannot parse fragments.json: " + error.message);
    }
    if (!Array.isArray(fragments) || fragments.some((entry) => typeof entry !== "string" || !entry.trim())) {
      throw new Error(path.relative(root, fragmentsPath) + ": fragments.json must be an ordered string array");
    }
    selectedPaths = fragments.map((fragment) => path.resolve(path.dirname(fragmentsPath), fragment));
    for (const selectedPath of selectedPaths) {
      if (!withinDirectory(pluginRoot, selectedPath)) {
        throw new Error(path.relative(root, fragmentsPath) + ": fragment path escapes plugin " + id);
      }
    }
  } else {
    selectedPaths = [path.join(pluginRoot, "main.js")];
  }

  return selectedPaths.map((sourcePath) => {
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(path.relative(root, sourcePath) + ": source file does not exist");
    }
    return {
      path: path.relative(root, sourcePath).split(path.sep).join("/"),
      content: fs.readFileSync(sourcePath, "utf8"),
    };
  });
}

export function loadInventory(root = REPO_ROOT) {
  const pluginsDirectory = path.join(root, "plugins");
  if (!fs.existsSync(pluginsDirectory) || !fs.statSync(pluginsDirectory).isDirectory()) {
    throw new Error("plugins directory is missing from " + root);
  }

  const directories = fs.readdirSync(pluginsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareText);
  const plugins = [];
  const seenPluginIds = new Set();

  for (const directory of directories) {
    const manifestPath = path.join("plugins", directory, "manifest.json");
    const absoluteManifestPath = path.join(root, manifestPath);
    if (!fs.existsSync(absoluteManifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(absoluteManifestPath, "utf8"));
    } catch (error) {
      throw new Error(manifestPath + ": cannot parse manifest: " + error.message);
    }
    const validated = validateManifest(manifest, manifestPath);
    if (validated.id !== directory) {
      throw new Error(manifestPath + ": manifest id " + JSON.stringify(validated.id) + " does not match directory " + directory);
    }
    if (seenPluginIds.has(validated.id)) throw new Error(manifestPath + ": duplicate plugin id " + validated.id);
    seenPluginIds.add(validated.id);
    const sources = loadSourceFiles(root, path.join("plugins", directory), validated.id);
    plugins.push({
      ...validated,
      directory,
      commands: scanCommands(sources),
    });
  }

  if (plugins.length === 0) throw new Error("no plugin manifests were found under " + pluginsDirectory);
  const maxMinimum = plugins.map((plugin) => plugin.parsedMinAppVersion)
    .sort(compareSemver)
    .at(-1);
  return {
    plugins: plugins.sort((left, right) => compareText(left.name, right.name) || compareText(left.id, right.id)),
    minimumObsidianVersion: maxMinimum.text,
  };
}

const PURPOSES = {
  "block-id-prompt": "Block ID Prompt helps create and manage stable block identifiers and task links in Obsidian.",
  "bob-articles": "Bob Articles formats reading notes and presents article metadata in Obsidian.",
  "bob-command-mode": "Bob Command Mode runs bob commands from Obsidian with safe-write guards and run history.",
  "bob-ledger-tools": "Bob Ledger Tools renders task, Pomodoro, freshness, and planning information from Bob notes.",
  "bob-navigation-hotkeys": "Bob Navigation Hotkeys adds keyboard commands for navigating and editing Bob notes.",
  "bob-project-tasks": "Bob Project Tasks keeps project task sections in sync across notes.",
  "bob-vim-surround": "Bob Vim Surround adds Vim-style surround editing to Obsidian.",
  "task-status-cycler": "Task Status Cycler changes task and Pomodoro states in Bob's workflow.",
};

const PAGE_DESCRIPTIONS = {
  "block-id-prompt": "Create and manage block IDs and task links in Bob's Obsidian workflow.",
  "bob-articles": "Format and adopt article notes with Bob Articles.",
  "bob-command-mode": "Run bob commands from Obsidian with guards, history, and an automation API.",
  "bob-ledger-tools": "Inspect task lanes, Pomodoros, freshness, and planning marks.",
  "bob-navigation-hotkeys": "Navigate and edit Bob notes with keyboard commands.",
  "bob-project-tasks": "Synchronize project task sections across notes.",
  "bob-vim-surround": "Edit delimiters around text with Vim-style surround commands.",
  "task-status-cycler": "Change task and Pomodoro states in Bob's workflow.",
};

function generatedRegion(name, body) {
  return "<!-- BEGIN GENERATED: " + name + " -->\n" + body.trimEnd() + "\n<!-- END GENERATED: " + name + " -->";
}

function replaceRegion(markdown, name, body, options = {}) {
  const begin = "<!-- BEGIN GENERATED: " + name + " -->";
  const end = "<!-- END GENERATED: " + name + " -->";
  const beginIndex = markdown.indexOf(begin);
  const endIndex = markdown.indexOf(end);

  if (beginIndex < 0 && endIndex < 0 && options.insertBefore) {
    const anchorIndex = markdown.indexOf(options.insertBefore);
    if (anchorIndex < 0 || markdown.indexOf(options.insertBefore, anchorIndex + options.insertBefore.length) >= 0) {
      throw new Error(options.path + ": cannot find a unique README insertion point for generated requirements");
    }
    const prefix = markdown.slice(0, anchorIndex).trimEnd();
    const suffix = markdown.slice(anchorIndex);
    return prefix + "\n\n" + generatedRegion(name, body) + "\n\n" + suffix;
  }
  if (beginIndex < 0 || endIndex < 0 || endIndex < beginIndex) {
    throw new Error(options.path + ": missing or malformed generated region " + name);
  }
  if (markdown.indexOf(begin, beginIndex + begin.length) >= 0 || markdown.indexOf(end, endIndex + end.length) >= 0) {
    throw new Error(options.path + ": duplicate generated region " + name);
  }
  const beginLineStart = markdown.lastIndexOf("\n", beginIndex - 1) + 1;
  const beginLineEnd = markdown.indexOf("\n", beginIndex);
  const endLineStart = markdown.lastIndexOf("\n", endIndex - 1) + 1;
  if (markdown.slice(beginLineStart, beginIndex).trim() || (beginLineEnd >= 0 && markdown.slice(beginIndex + begin.length, beginLineEnd).trim())) {
    throw new Error(options.path + ": generated region markers must be on their own lines");
  }
  if (markdown.slice(endLineStart, endIndex).trim()) {
    throw new Error(options.path + ": generated region markers must be on their own lines");
  }

  return markdown.slice(0, beginIndex) + generatedRegion(name, body) + markdown.slice(endIndex + end.length);
}

function renderFacts(plugin) {
  const desktop = plugin.isDesktopOnly ? "Yes" : "No";
  const rows = [
    ["Name", plugin.name],
    ["ID", escapeCodeCell(plugin.id), true],
    ["Version", plugin.version],
    ["Minimum Obsidian version", plugin.minAppVersion],
    ["Desktop only", desktop],
    ["Description", plugin.description],
  ];
  return [
    "## Plugin facts",
    "",
    "| Fact | Value |",
    "| --- | --- |",
    ...rows.map(([label, value, isCode = false]) => "| " + escapeTable(label) + " | " + (isCode ? value : escapeTable(value)) + " |"),
  ].join("\n");
}

function renderCommands(plugin) {
  if (plugin.commands.length === 0) {
    return [
      "## Registered commands",
      "",
      "This plugin registers no command palette commands.",
    ].join("\n");
  }
  return [
    "## Registered commands",
    "",
    "| Command | Command ID | Default hotkey |",
    "| --- | --- | --- |",
    ...plugin.commands.map((command) => {
      const hotkeys = command.hotkeys.length ? command.hotkeys.join(", ") : "—";
      return "| " + escapeTable(command.name) + " | " + escapeCodeCell(command.id) + " | " + escapeTable(hotkeys) + " |";
    }),
  ].join("\n");
}

function createPluginPage(plugin) {
  const purpose = PURPOSES[plugin.id] ?? (plugin.name + " adds features to Obsidian.");
  const description = PAGE_DESCRIPTIONS[plugin.id] ?? ("Reference for " + plugin.name + " in Bob's Obsidian setup.");
  return [
    "---",
    "title: " + JSON.stringify(plugin.name),
    "description: " + JSON.stringify(description),
    "---",
    "",
    purpose,
    "",
    generatedRegion("facts", renderFacts(plugin)),
    "",
    generatedRegion("commands", renderCommands(plugin)),
    "",
  ].join("\n");
}

function createHub() {
  return [
    "---",
    'title: "Obsidian plugins"',
    'description: "Browse Bob’s Obsidian plugins and their generated command references."',
    "---",
    "",
    "Browse Bob's Obsidian plugins and their current versions and command defaults.",
    "",
    generatedRegion("inventory", ""),
    "",
  ].join("\n");
}

function renderHubInventory(inventory) {
  return [
    "| Plugin | Version | Minimum Obsidian version | Desktop only |",
    "| --- | ---: | ---: | --- |",
    ...inventory.plugins.map((plugin) =>
      "| [" + escapeTable(plugin.name) + "](" + plugin.id + ".md) | " +
      escapeTable(plugin.version) + " | " +
      escapeTable(plugin.minAppVersion) + " | " +
      (plugin.isDesktopOnly ? "Yes" : "No") + " |"
    ),
  ].join("\n");
}

function renderReadmeRequirements(inventory) {
  return [
    "## Requirements",
    "",
    "The plugins require Obsidian " + inventory.minimumObsidianVersion + " or later.",
  ].join("\n");
}

function readOrCreate(filePath, fallback, relativePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : fallback(relativePath);
}

function buildExpectedOutputs(root, inventory) {
  const docsRoot = path.join(root, "docs");
  const outputs = new Map();
  const hubPath = path.join(docsRoot, "index.md");
  let hub = readOrCreate(hubPath, createHub, "docs/index.md");
  hub = replaceRegion(hub, "inventory", renderHubInventory(inventory), { path: "docs/index.md" });
  outputs.set("docs/index.md", hub);

  for (const plugin of inventory.plugins) {
    const relativePath = "docs/" + plugin.id + ".md";
    const absolutePath = path.join(root, relativePath);
    let page = readOrCreate(absolutePath, () => createPluginPage(plugin), relativePath);
    page = replaceRegion(page, "facts", renderFacts(plugin), { path: relativePath });
    page = replaceRegion(page, "commands", renderCommands(plugin), { path: relativePath });
    outputs.set(relativePath, page);
  }

  const readmePath = path.join(root, "README.md");
  if (!fs.existsSync(readmePath)) throw new Error("README.md is missing from " + root);
  let readme = fs.readFileSync(readmePath, "utf8");
  readme = replaceRegion(readme, "requirements", renderReadmeRequirements(inventory), {
    path: "README.md",
    insertBefore: "## Plugins",
  });
  outputs.set("README.md", readme);
  return outputs;
}

export async function generateInventory(root = REPO_ROOT, { check = false } = {}) {
  const inventory = loadInventory(root);
  const outputs = buildExpectedOutputs(root, inventory);
  const stale = [];

  for (const [relativePath, expected] of outputs) {
    const absolutePath = path.join(root, relativePath);
    const actual = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : null;
    if (actual !== expected) stale.push(relativePath);
  }
  stale.sort(compareText);
  if (check || stale.length === 0) return { stale, inventory };

  for (const relativePath of stale) {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, outputs.get(relativePath));
  }
  return { stale, inventory };
}

function usage() {
  return [
    "Generate plugin reference facts and command tables from manifests and source.",
    "",
    "Usage: node scripts/docs-inventory.mjs [options]",
    "",
    "Options:",
    "  -c, --check  Report stale or missing generated output without writing files.",
    "  -h, --help   Show this help.",
  ].join("\n");
}

async function main(argv) {
  const allowed = new Set(["-c", "--check", "-h", "--help"]);
  const unknown = argv.find((argument) => !allowed.has(argument));
  if (unknown) throw new Error("unknown option " + unknown + "\n\n" + usage());
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(usage() + "\n");
    return;
  }

  const check = argv.includes("-c") || argv.includes("--check");
  const { stale, inventory } = await generateInventory(REPO_ROOT, { check });
  if (check && stale.length > 0) {
    process.stderr.write("Plugin documentation inventory is stale:\n" + stale.map((file) => "  " + file).join("\n") + "\n");
    process.stderr.write("Run npm run docs:gen to update generated regions.\n");
    process.exitCode = 1;
    return;
  }
  if (check) {
    process.stdout.write("Plugin documentation inventory is up to date.\n");
  } else {
    const commandCount = inventory.plugins.reduce((total, plugin) => total + plugin.commands.length, 0);
    process.stdout.write("Generated inventory for " + inventory.plugins.length + " plugins and " + commandCount + " registered commands.\n");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  });
}
