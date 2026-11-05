const path = require("node:path");

function stripYamlComment(value) {
  const text = String(value || "");
  let quote = null;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === "[" || character === "{") depth += 1;
    else if (character === "]" || character === "}") depth = Math.max(0, depth - 1);
    else if (character === "#" && depth === 0 && (index === 0 || /\s/.test(text[index - 1]))) {
      return text.slice(0, index).trimEnd();
    }
  }
  return text.trimEnd();
}

function splitFlowItems(value) {
  const items = [];
  let start = 0;
  let quote = null;
  let depth = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== "\\") quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "[" || character === "{") {
      depth += 1;
    } else if (character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      items.push(text.slice(start, index));
      start = index + 1;
    }
  }
  items.push(text.slice(start));
  return items;
}

function parseYamlScalar(raw) {
  const text = stripYamlComment(raw).trim();
  if (!text) return null;
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
    const inner = text.slice(1, -1);
    return text[0] === '"' ? inner.replace(/\\(["\\])/g, "$1") : inner.replace(/''/g, "'");
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    return inner ? splitFlowItems(inner).map(parseYamlScalar) : [];
  }
  if (text === "{}") return {};
  if (/^(?:null|~)$/i.test(text)) return null;
  if (/^(?:true|false)$/i.test(text)) return text.toLowerCase() === "true";
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return Number(text);
  return text;
}

function parseVectorFrontmatter(source) {
  const match = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(String(source || ""));
  if (!match) return {};
  const lines = match[1].split("\n");
  const values = {};
  for (let index = 0; index < lines.length; index += 1) {
    const field = /^( *)([A-Za-z0-9_-]+):(?:[ \t]*(.*))?$/.exec(lines[index]);
    if (!field) continue;
    const key = field[2];
    const raw = field[3] || "";
    if (raw.trim()) {
      values[key] = parseYamlScalar(raw);
      continue;
    }
    const indent = field[1].length;
    const items = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      if (!lines[cursor].trim()) {
        cursor += 1;
        continue;
      }
      const item = /^( +)-(?:[ \t]*(.*))?$/.exec(lines[cursor]);
      if (!item || item[1].length <= indent) break;
      items.push(parseYamlScalar(item[2] || ""));
      cursor += 1;
    }
    values[key] = items.length ? items : null;
    index = cursor - 1;
  }
  return values;
}

function planCapsForVector(vector, defaults = {}) {
  const plan = vector && vector.config && vector.config.plan && typeof vector.config.plan === "object"
    ? vector.config.plan
    : {};
  return {
    ...defaults,
    readingTheme: Object.prototype.hasOwnProperty.call(plan, "reading_type")
      ? plan.reading_type
      : (Object.prototype.hasOwnProperty.call(defaults, "readingTheme") ? defaults.readingTheme : "READ"),
    defaultType: Object.prototype.hasOwnProperty.call(plan, "default_type")
      ? plan.default_type
      : (Object.prototype.hasOwnProperty.call(defaults, "defaultType") ? defaults.defaultType : null),
  };
}

function clockEnvFor(notes, dailyPath, dailyText = "") {
  const sources = new Map(Object.entries(notes || {}));
  if (dailyText) sources.set(dailyPath, dailyText);
  const files = new Map([...sources.keys()].map((notePath) => [notePath, { path: notePath }]));
  const resolve = (target) => {
    const name = String(target || "").replace(/\.md$/i, "");
    const exact = `${name}.md`;
    if (files.has(exact)) return files.get(exact);
    const stem = name.split("/").pop().toLowerCase();
    return [...files.values()].find((file) => path.basename(file.path, ".md").toLowerCase() === stem) || null;
  };
  const vault = { getAbstractFileByPath: (notePath) => files.get(notePath) || null };
  const metadataCache = {
    getFileCache: (file) => ({ frontmatter: parseVectorFrontmatter(sources.get(file.path)) }),
    getFirstLinkpathDest: (target) => resolve(target),
  };
  return { files, sources, vault, metadataCache, resolve };
}

module.exports = { clockEnvFor, parseVectorFrontmatter, planCapsForVector };
