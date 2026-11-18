// Pure gate, value models, and coverage for the read-only record sheet.
// Paints from metadataCache plus the cached album report; never writes.
const RECORD_SHEET_CLASS = "bob-record-sheet";
const RECORD_SHEET_SURFACE_CLASS = "bob-record-sheet-surface";
const RECORD_SHEET_HIDES_CLASS = "bob-record-sheet-hides-properties";
const RECORD_SHEET_BAND_ATTR = "data-bob-record-sheet-band";
const RECORD_SHEET_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const RECORD_SHEET_IDENTITY_KEYS = new Set(["parent", "type", "title", "created"]);
const RECORD_SHEET_WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g;
const RECORD_SHEET_SAFE_URL_RE = /^(https?:)\/\//i;
const RECORD_SHEET_OVERLAY_TTL_MS = 5000;

function recordSheetPath(value) {
  return typeof albumHeaderPath === "function"
    ? albumHeaderPath(value)
    : String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function recordSheetFail(reason, extra = {}) {
  return {
    mount: false,
    hideEligible: false,
    editable: false,
    state: "closed",
    reason,
    ...extra,
  };
}

function recordSheetIsCanonicalRecordType(frontmatter) {
  const names = typeof albumTypeNames === "function"
    ? albumTypeNames(frontmatter && typeof frontmatter === "object" ? frontmatter.type : undefined)
    : [];
  return names.length === 1 && names[0] === "record";
}

function recordSheetIsSyntheticKey(key, value) {
  if (key !== "position") return false;
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && ("start" in value || "end" in value));
}

function recordSheetAuthoredKeys(frontmatter) {
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) return [];
  return Object.keys(frontmatter).filter((key) => !recordSheetIsSyntheticKey(key, frontmatter[key]));
}

function recordSheetCapabilities(report) {
  if (!report || typeof report !== "object") return { present: false, valid: true, values: [] };
  if (!Object.prototype.hasOwnProperty.call(report, "capabilities")) {
    return { present: false, valid: true, values: [] };
  }
  const raw = report.capabilities;
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    return { present: false, valid: false, values: [] };
  }
  return { present: true, valid: true, values: raw };
}

function recordSheetHasValuesCapability(report) {
  const caps = recordSheetCapabilities(report);
  return caps.valid && caps.values.includes("record_values_v1");
}

function recordSheetAlbumHealthy(entry) {
  if (!entry) return false;
  const fingerprint = entry.schema_fingerprint;
  if (fingerprint === null || fingerprint === undefined || String(fingerprint) === "") return false;
  const issues = Array.isArray(entry.issues) ? entry.issues : [];
  return !issues.some((issue) => issue && issue.severity === "error");
}

function recordSheetAlbumError(entry) {
  const issues = Array.isArray(entry?.issues) ? entry.issues : [];
  return issues.find((issue) => issue && issue.severity === "error") || null;
}

function recordSheetFolderKind(path, albumStem) {
  const normalized = recordSheetPath(path);
  if (!normalized || !/\.md$/i.test(normalized)) return "outside-folder";
  const dir = typeof albumDirname === "function" ? albumDirname(normalized) : "";
  if (!dir) return "outside-folder";
  if (dir.includes("/")) return "nested-folder";
  if (String(albumStem || "") && dir !== String(albumStem)) return "mismatched-parent";
  return "ok";
}

function recordSheetParentIsAlbum(albumPath, metadataCache, vault) {
  const path = recordSheetPath(albumPath);
  if (!path) return false;
  try {
    const file = vault && typeof vault.getAbstractFileByPath === "function"
      ? vault.getAbstractFileByPath(path)
      : null;
    const cache = file && metadataCache && typeof metadataCache.getFileCache === "function"
      ? metadataCache.getFileCache(file)
      : null;
    const names = typeof albumTypeNames === "function"
      ? albumTypeNames(cache && cache.frontmatter ? cache.frontmatter.type : undefined)
      : [];
    if (names.includes("album")) return true;
  } catch (_) {}
  return false;
}

function recordSheetGate({ path, frontmatter, report, desktop, metadataCache, vault } = {}) {
  const filePath = recordSheetPath(path);
  if (desktop !== true) return recordSheetFail("mobile", { filePath });
  if (!report || typeof report !== "object") return recordSheetFail("no-report", { filePath });
  if (frontmatter === null || frontmatter === undefined || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    return recordSheetFail("no-metadata", { filePath });
  }
  if (!recordSheetIsCanonicalRecordType(frontmatter)) {
    const names = typeof albumTypeNames === "function" ? albumTypeNames(frontmatter.type) : [];
    const reason = names.includes("bank_month") ? "bank-month"
      : names.includes("record") ? "mixed-type"
        : names.length ? "other-type"
          : "not-record";
    return recordSheetFail(reason, { filePath });
  }
  if (!filePath) return recordSheetFail("missing-path");
  let resolution = null;
  try {
    resolution = typeof albumResolveSchemaTargetForFile === "function"
      ? albumResolveSchemaTargetForFile(filePath, { frontmatter, report, metadataCache, vault })
      : null;
  } catch (_) {
    resolution = null;
  }
  if (!resolution || resolution.ok !== true) {
    const reason = resolution && resolution.reason ? String(resolution.reason) : "missing-parent";
    return recordSheetFail(reason, { filePath, resolution });
  }
  const albumPath = recordSheetPath(resolution.albumPath);
  const album = typeof albumSchemaEntryReportAlbum === "function"
    ? albumSchemaEntryReportAlbum(report, albumPath)
    : null;
  if (!album) return recordSheetFail("non-album-parent", { filePath, albumPath, resolution });
  if (!recordSheetParentIsAlbum(albumPath, metadataCache, vault)) {
    return recordSheetFail("non-album-parent", { filePath, albumPath, resolution });
  }
  const folder = recordSheetFolderKind(filePath, album.stem);
  if (folder !== "ok") return recordSheetFail(folder, { filePath, albumPath, album, resolution });
  const healthy = recordSheetAlbumHealthy(album);
  const caps = recordSheetCapabilities(report);
  const capabilityOk = recordSheetHasValuesCapability(report);
  const hideEligible = healthy && capabilityOk;
  return {
    mount: true,
    hideEligible,
    editable: hideEligible,
    state: healthy ? "ready" : "broken",
    reason: healthy ? (capabilityOk ? "ok" : (caps.valid ? "no-capability" : "malformed-capability")) : "broken-schema",
    filePath,
    albumPath,
    album,
    resolution,
    capabilityOk,
  };
}

function recordSheetClock(clock) {
  const now = clock instanceof Date
    ? clock
    : (clock && clock.now instanceof Date ? clock.now : new Date());
  let today = clock && typeof clock.today === "string" ? clock.today : "";
  if (!today && typeof albumLocalDate === "function") today = albumLocalDate(now);
  if (!today) {
    try {
      today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    } catch (_) {
      today = "";
    }
  }
  return { now, today };
}

function recordSheetCalendarDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    try {
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    } catch (_) {
      return "";
    }
  }
  if (typeof value !== "string") return "";
  const text = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/.exec(text);
  if (!match) return "";
  return typeof notebookCalendarDate === "function" ? notebookCalendarDate(match[1]) : match[1];
}

function recordSheetDateObject(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(`${text}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function recordSheetHasClockTime(value, date) {
  if (typeof value === "string" && /T\d{2}:\d{2}/.test(value.trim())) return true;
  if (!(date instanceof Date)) return false;
  return date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0;
}

function recordSheetDiffDays(from, to) {
  if (typeof freshDateDiffDays === "function") {
    try {
      const days = freshDateDiffDays(from, to);
      if (Number.isInteger(days)) return days;
    } catch (_) {}
  }
  const start = Date.parse(`${from}T00:00:00`);
  const end = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86400000);
}

function recordSheetFriendlyDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return "";
  const month = RECORD_SHEET_MONTHS[Number(match[2]) - 1];
  if (!month) return "";
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

function recordSheetAgePhrase(days) {
  if (!Number.isInteger(days) || days < 0) return "";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (days < 60) return `${weeks}w ago`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(days / 365.25)}y ago`;
}

function recordSheetDatePresentation(value, clock) {
  const iso = recordSheetCalendarDate(value);
  if (!iso) return null;
  const { today } = recordSheetClock(clock);
  const days = recordSheetDiffDays(iso, today);
  const age = recordSheetAgePhrase(days);
  if (age === "today" || age === "yesterday") {
    return { iso, text: age, age, friendly: recordSheetFriendlyDate(iso) };
  }
  const friendly = recordSheetFriendlyDate(iso);
  return { iso, text: age ? `${friendly} · ${age}` : friendly, age, friendly };
}

function recordSheetTimeLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const suffix = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function recordSheetCreatedFooter(value, clock) {
  const presented = recordSheetDatePresentation(value, clock);
  if (!presented) return null;
  const date = recordSheetDateObject(value);
  if (presented.age === "today") {
    const time = recordSheetHasClockTime(value, date) ? recordSheetTimeLabel(date) : "";
    return time ? `added today, ${time}` : "added today";
  }
  if (presented.age === "yesterday") return "added yesterday";
  return presented.friendly ? `added ${presented.friendly}` : null;
}

function recordSheetParseWikilink(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const inner = text.startsWith("[[") && text.endsWith("]]") ? text.slice(2, -2) : text;
  if (inner.includes("[[") || inner.includes("\n")) return null;
  const pipe = inner.indexOf("|");
  const targetPart = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : "";
  const hash = targetPart.indexOf("#");
  const pathPart = (hash >= 0 ? targetPart.slice(0, hash) : targetPart).replace(/\\/g, "/").replace(/\.md$/i, "").trim();
  if (!pathPart && hash < 0) return null;
  return {
    raw: text.startsWith("[[") ? text : `[[${inner}]]`,
    target: pathPart,
    href: targetPart.trim(),
    alias,
    complete: text.startsWith("[[") && text.endsWith("]]"),
  };
}

function recordSheetWikilinkSpans(text) {
  const source = String(text === null || text === undefined ? "" : text);
  const spans = [];
  RECORD_SHEET_WIKILINK_RE.lastIndex = 0;
  let last = 0;
  let match;
  while ((match = RECORD_SHEET_WIKILINK_RE.exec(source))) {
    if (match.index > last) spans.push({ kind: "text", text: source.slice(last, match.index) });
    const parsed = recordSheetParseWikilink(match[0]);
    if (parsed && parsed.complete) spans.push({ kind: "link", text: parsed.alias || parsed.target, link: parsed });
    else spans.push({ kind: "text", text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < source.length) spans.push({ kind: "text", text: source.slice(last) });
  return spans;
}

function recordSheetSafeUrl(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (!RECORD_SHEET_SAFE_URL_RE.test(text)) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch (_) {
    return null;
  }
}

function recordSheetMiddleTruncate(text, keep = 16) {
  const value = String(text || "");
  if (value.length <= keep * 2 + 1) return value;
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

function recordSheetIsEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function recordSheetRawText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return recordSheetCalendarDate(value) || String(value);
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function recordSheetChoiceByValue(field, value) {
  const key = String(value);
  const choices = Array.isArray(field?.choices) ? field.choices : [];
  return choices.find((choice) => String(choice.value) === key) || null;
}

function recordSheetIsChoiceField(field) {
  const kind = String(field?.kind || "").toLowerCase();
  if (kind === "choice" || kind === "choices") return true;
  return Array.isArray(field?.choices) && field.choices.length > 0 && kind !== "text";
}

function recordSheetLinkDisplay(raw, sourcePath, metadataCache, vault) {
  const parsed = recordSheetParseWikilink(raw) || recordSheetParseWikilink(`[[${String(raw || "").trim()}]]`);
  if (!parsed) return { text: recordSheetRawText(raw), link: null };
  if (parsed.alias) return { text: parsed.alias, link: parsed };
  let title = parsed.target;
  try {
    const resolved = typeof albumHeaderResolveFile === "function"
      ? albumHeaderResolveFile(parsed.target, sourcePath, metadataCache, vault)
      : null;
    if (resolved && resolved.path && typeof notebookHeaderNoteTitle === "function") {
      title = notebookHeaderNoteTitle(resolved.path, metadataCache, vault) || title;
    } else if (resolved && resolved.path) {
      title = String(resolved.path).split("/").pop().replace(/\.md$/i, "") || title;
    }
  } catch (_) {}
  return { text: title || parsed.target, link: parsed };
}

function recordSheetMoneyText(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents)) return null;
  return typeof bankSubscriptionMoney === "function" ? bankSubscriptionMoney(cents) : null;
}

function recordSheetInvalid(field, value, reason) {
  return {
    key: field.key,
    label: field.label || field.key,
    kind: field.kind || "text",
    list: field.list === true,
    required: field.required === true,
    state: "invalid",
    raw: recordSheetRawText(value),
    text: recordSheetRawText(value),
    spans: [{ kind: "mono", text: recordSheetRawText(value) }],
    chips: [],
    lint: reason,
    href: "",
  };
}

function recordSheetValid(field, parts) {
  return {
    key: field.key,
    label: field.label || field.key,
    kind: field.kind || "text",
    list: field.list === true,
    required: field.required === true,
    state: "valid",
    raw: parts.raw == null ? "" : String(parts.raw),
    text: parts.text || "",
    spans: Array.isArray(parts.spans) ? parts.spans : [{ kind: "text", text: parts.text || "" }],
    chips: Array.isArray(parts.chips) ? parts.chips : [],
    lint: "",
    href: parts.href || "",
    title: parts.title || "",
    numeric: parts.numeric === true,
  };
}

function recordSheetItemChip(item, field, options) {
  if (recordSheetIsChoiceField(field)) {
    const choice = recordSheetChoiceByValue(field, item);
    if (choice) {
      return { text: String(choice.label || choice.value), valid: true, value: String(choice.value) };
    }
    return { text: recordSheetRawText(item), valid: false, value: recordSheetRawText(item) };
  }
  if (String(field.kind || "") === "link" || (typeof item === "string" && /\[\[[^\]]+\]\]/.test(item))) {
    const display = recordSheetLinkDisplay(item, options.sourcePath, options.metadataCache, options.vault);
    return { text: display.text, valid: true, value: recordSheetRawText(item), link: display.link };
  }
  return { text: recordSheetRawText(item), valid: true, value: recordSheetRawText(item) };
}

function recordSheetValueModel(field, raw, options = {}) {
  const label = field.label || field.key || "Field";
  if (field.list === true) {
    if (recordSheetIsEmpty(raw)) {
      return field.required
        ? { ...recordSheetValid(field, { text: "", spans: [], chips: [] }), state: "missing", lint: "missing" }
        : { ...recordSheetValid(field, { text: "", spans: [], chips: [] }), state: "empty" };
    }
    if (!Array.isArray(raw)) {
      return recordSheetInvalid(field, raw, `expected a list of ${label} values`);
    }
    const chips = raw.map((item) => recordSheetItemChip(item, field, options));
    const invalid = chips.some((chip) => chip.valid === false);
    return {
      ...recordSheetValid(field, {
        raw: chips.map((chip) => chip.value).join(", "),
        text: chips.map((chip) => chip.text).join(", "),
        chips,
        spans: chips.map((chip) => ({ kind: chip.link ? "link" : "chip", text: chip.text, link: chip.link })),
      }),
      state: invalid ? "invalid" : "valid",
      lint: invalid ? `contains a value that is not a ${label} choice` : "",
    };
  }
  if (Array.isArray(raw) && !recordSheetIsEmpty(raw)) {
    return recordSheetInvalid(field, raw, `${label} is a single value, not a list`);
  }
  if (recordSheetIsEmpty(raw)) {
    return field.required
      ? { ...recordSheetValid(field, { text: "", spans: [], chips: [] }), state: "missing", lint: "missing" }
      : { ...recordSheetValid(field, { text: "", spans: [], chips: [] }), state: "empty" };
  }
  if (recordSheetIsChoiceField(field)) {
    const choice = recordSheetChoiceByValue(field, raw);
    if (!choice) {
      return recordSheetInvalid(field, raw, `not a ${label} choice`);
    }
    const text = String(choice.label || choice.value);
    return recordSheetValid(field, {
      raw: String(choice.value),
      text,
      chips: [{ text, valid: true, value: String(choice.value) }],
      spans: [{ kind: "chip", text }],
    });
  }
  const kind = String(field.kind || "text").toLowerCase();
  if (kind === "date") {
    const presented = recordSheetDatePresentation(raw, options.clock);
    if (!presented) return recordSheetInvalid(field, raw, "invalid date");
    return recordSheetValid(field, { raw: presented.iso, text: presented.text, spans: [{ kind: "date", text: presented.text }] });
  }
  if (kind === "url") {
    if (typeof raw !== "string") return recordSheetInvalid(field, raw, "invalid URL");
    const href = recordSheetSafeUrl(raw);
    if (!href) return recordSheetInvalid(field, raw, "invalid URL");
    const text = recordSheetMiddleTruncate(raw.trim());
    return recordSheetValid(field, {
      raw: raw.trim(),
      text,
      href,
      title: raw.trim(),
      spans: [{ kind: "url", text, href, title: raw.trim() }],
    });
  }
  if (kind === "link") {
    if (typeof raw !== "string" && typeof raw !== "object") return recordSheetInvalid(field, raw, "invalid link");
    const display = recordSheetLinkDisplay(raw, options.sourcePath, options.metadataCache, options.vault);
    if (!display.link) return recordSheetInvalid(field, raw, "invalid link");
    return recordSheetValid(field, {
      raw: display.link.raw,
      text: display.text,
      spans: [{ kind: "link", text: display.text, link: display.link }],
    });
  }
  if (kind === "number") {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return recordSheetInvalid(field, raw, "invalid number");
    }
    if (field.min != null && raw < field.min) return recordSheetInvalid(field, raw, `${label} is below ${field.min}`);
    if (field.max != null && raw > field.max) return recordSheetInvalid(field, raw, `${label} is above ${field.max}`);
    let text = String(raw);
    if (options.money === true) {
      const money = recordSheetMoneyText(raw);
      if (money) text = money;
    }
    return recordSheetValid(field, { raw: String(raw), text, numeric: true, spans: [{ kind: "number", text }] });
  }
  const text = typeof raw === "string" ? raw : recordSheetRawText(raw);
  return recordSheetValid(field, {
    raw: text,
    text,
    spans: recordSheetWikilinkSpans(text),
  });
}

function recordSheetMergeFrontmatter(frontmatter, overlay) {
  const base = frontmatter && typeof frontmatter === "object" ? { ...frontmatter } : {};
  if (!overlay || typeof overlay !== "object") return base;
  const properties = overlay.properties && typeof overlay.properties === "object" ? overlay.properties : null;
  const next = properties ? { ...base, ...properties } : base;
  if (properties) {
    for (const [key, value] of Object.entries(properties)) {
      if (value === null || value === undefined) delete next[key];
    }
  }
  if (Array.isArray(overlay.unsetKeys)) {
    for (const key of overlay.unsetKeys) {
      if (typeof key === "string" && key) delete next[key];
    }
  }
  return next;
}

function recordSheetCompactValue(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return recordSheetCalendarDate(value) || String(value);
  if (Array.isArray(value)) return value.map((item) => recordSheetCompactValue(item)).join(", ");
  return recordSheetRawText(value);
}

function recordSheetFirstHeading(sourceText) {
  const text = String(sourceText === null || sourceText === undefined ? "" : sourceText);
  if (!text) return "";
  const lines = text.split("\n");
  let index = 0;
  if (lines.length > 1 && lines[0].trim() === "---") {
    let end = -1;
    for (let cursor = 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].trim() === "---" || lines[cursor].trim() === "...") {
        end = cursor;
        break;
      }
    }
    index = end >= 0 ? end + 1 : 1;
  }
  let fence = null;
  const toggle = typeof notebookSourceFenceToggle === "function" ? notebookSourceFenceToggle : null;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (toggle) {
      const next = toggle(line, fence);
      if (next !== fence) {
        fence = next;
        continue;
      }
    }
    if (fence) continue;
    if (/^#\s+\S/.test(line.trim())) return line.trim().replace(/^#\s+/, "").trim();
  }
  return "";
}

function recordSheetHeadingFromCache(cache) {
  const headings = cache && Array.isArray(cache.headings) ? cache.headings : [];
  const h1 = headings.find((item) => item && item.level === 1);
  return h1 ? String(h1.heading || "").trim() : "";
}

function recordSheetYamlKeyLine(sourceText, key) {
  const text = String(sourceText || "");
  const lines = text.split("\n");
  if (!lines.length || lines[0].trim() !== "---") return 1;
  const escaped = String(key || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return 1;
  const pattern = new RegExp(`^(?:${escaped}|"${escaped}"|'${escaped}')\\s*:`);
  for (let index = 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed === "---" || trimmed === "...") return 1;
    if (pattern.test(lines[index])) return index + 1;
  }
  return 1;
}

function recordSheetCrumbs(album, options = {}) {
  const ancestry = typeof albumHeaderOwnerChain === "function"
    ? albumHeaderOwnerChain(album, options)
    : { crumbs: [] };
  const crumbs = Array.isArray(ancestry.crumbs) ? ancestry.crumbs.map((crumb) => ({ ...crumb, current: false })) : [];
  crumbs.push({
    stem: String(album?.stem || ""),
    path: recordSheetPath(album?.path),
    title: String(album?.title || album?.stem || ""),
    kind: "album",
    current: false,
  });
  return crumbs;
}

function recordSheetModel(input = {}) {
  const gate = input.gate || recordSheetGate(input);
  if (!gate || gate.mount !== true) return null;
  const album = gate.album;
  const overlay = input.overlay && typeof input.overlay === "object" ? input.overlay : null;
  const frontmatter = recordSheetMergeFrontmatter(input.frontmatter, overlay);
  const heading = String(input.heading == null ? "" : input.heading).trim();
  const clock = recordSheetClock(input.clock);
  const collapsed = input.collapsed === true;
  const foldOpen = input.foldOpen === true;
  const hue = input.hue == null ? "" : String(input.hue);
  const fields = (Array.isArray(album.fields) ? album.fields : []).map((field) => (
    typeof albumHeaderFieldModel === "function" ? albumHeaderFieldModel(field) : field
  ));
  const groupKey = String(album.group_field || album.index_by || "").trim();
  const legacy = (Array.isArray(album.legacy) ? album.legacy : []).map((item) => String(item || "")).filter(Boolean);
  const money = String(album.stem || "") === "subscriptions" || String(album.noun || "").toLowerCase() === "subscription";
  const coverage = {};
  coverage.parent = "breadcrumb";
  coverage.type = "identity";
  const title = frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, "title")
    ? frontmatter.title
    : undefined;
  const titleText = title == null ? "" : String(title).trim();
  if (titleText) coverage.title = "sheet";
  const createdPresent = frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, "created");
  const createdFooter = createdPresent ? recordSheetCreatedFooter(frontmatter.created, clock) : null;
  const createdInvalid = createdPresent && !recordSheetIsEmpty(frontmatter.created) && !createdFooter;
  if (createdPresent && createdFooter) coverage.created = "footer";
  else if (createdPresent) coverage.created = createdInvalid ? "fold" : "absent";

  const rows = [];
  const ghosts = [];
  const choiceChips = [];
  for (const field of fields) {
    if (!field || !field.key) continue;
    const value = Object.prototype.hasOwnProperty.call(frontmatter || {}, field.key)
      ? frontmatter[field.key]
      : undefined;
    const model = recordSheetValueModel(field, value, {
      clock,
      sourcePath: gate.filePath,
      metadataCache: input.metadataCache,
      vault: input.vault,
      money: money && field.key === "amount" && String(field.kind || "") === "number",
    });
    if (model.state === "empty") {
      ghosts.push({ key: field.key, label: field.label || field.key });
      coverage[field.key] = "ghost";
      continue;
    }
    if (overlay && Array.isArray(overlay.changedKeys) && overlay.changedKeys.includes(field.key)) {
      model.changed = true;
    }
    rows.push(model);
    coverage[field.key] = "row";
    if (recordSheetIsChoiceField(field) && model.state === "valid" && model.chips.length) {
      choiceChips.push({ key: field.key, group: field.key === groupKey, chips: model.chips });
    }
  }
  choiceChips.sort((left, right) => Number(right.group) - Number(left.group));

  const schemaKeys = new Set(fields.map((field) => field.key));
  const fold = [];
  if (createdInvalid) {
    fold.push({
      key: "created",
      label: "Created",
      text: recordSheetRawText(frontmatter.created),
      lint: "invalid date",
      spans: [{ kind: "mono", text: recordSheetRawText(frontmatter.created) }],
    });
  }
  for (const key of recordSheetAuthoredKeys(frontmatter)) {
    if (RECORD_SHEET_IDENTITY_KEYS.has(key) || schemaKeys.has(key)) continue;
    const compact = recordSheetCompactValue(frontmatter[key]);
    fold.push({
      key,
      label: (typeof albumHeaderHumanize === "function" ? albumHeaderHumanize(key) : key) || key,
      text: compact,
      lint: "",
      legacy: legacy.includes(key),
      spans: typeof frontmatter[key] === "string"
        ? recordSheetWikilinkSpans(frontmatter[key])
        : [{ kind: "text", text: compact }],
    });
    coverage[key] = "fold";
  }

  const broken = gate.state === "broken";
  const error = broken ? recordSheetAlbumError(album) : null;
  const noun = String(album.noun || album.singular || "record");
  const albumTitle = String(album.title || album.stem || "Album");
  const crumbs = recordSheetCrumbs(album, {
    sourcePath: album.path,
    metadataCache: input.metadataCache,
    vault: input.vault,
  });
  const subscription = input.subscription && input.subscription.kind === "header" ? input.subscription : null;
  const fieldCount = fields.length;
  const collapsedChips = choiceChips.flatMap((group) => group.chips);
  const stem = typeof notebookHeaderStem === "function"
    ? notebookHeaderStem(gate.filePath)
    : String(gate.filePath || "").split("/").pop().replace(/\.md$/i, "");
  return {
    path: gate.filePath,
    albumPath: gate.albumPath,
    albumStem: String(album.stem || ""),
    albumTitle,
    noun,
    title: titleText || heading || stem || albumTitle,
    heading,
    crumbs,
    emoji: album.emoji == null ? "" : String(album.emoji),
    hue,
    gate,
    state: gate.state,
    reason: gate.reason,
    hideEligible: gate.hideEligible === true,
    editable: gate.editable === true,
    broken,
    warning: error ? String(error.message || "The album schema is invalid.") : "",
    warningLine: Number.isInteger(error?.line) && error.line > 0 ? error.line : null,
    rows,
    ghosts,
    fold,
    foldOpen,
    collapsed,
    createdFooter,
    choiceChips: collapsedChips,
    fieldCount,
    coverage,
    overlay: overlay || null,
    subscription,
    schemaFingerprint: album.schema_fingerprint == null ? "" : String(album.schema_fingerprint),
  };
}

function recordSheetSignature(model, extra = {}) {
  if (!model) return "none";
  try {
    return JSON.stringify({
      path: model.path,
      state: model.state,
      reason: model.reason,
      heading: model.heading,
      title: model.title,
      crumbs: model.crumbs,
      rows: model.rows,
      ghosts: model.ghosts,
      fold: model.fold,
      createdFooter: model.createdFooter,
      warning: model.warning,
      warningLine: model.warningLine,
      hideEligible: model.hideEligible,
      editable: model.editable,
      collapsed: extra.collapsed === undefined ? model.collapsed === true : extra.collapsed === true,
      foldOpen: extra.foldOpen === undefined ? model.foldOpen === true : extra.foldOpen === true,
      hue: extra.hue === undefined ? model.hue : extra.hue,
      overlay: extra.overlay === undefined ? model.overlay : extra.overlay,
      subscription: extra.subscription === undefined
        ? (model.subscription && typeof bankSubscriptionHeaderSignature === "function"
          ? bankSubscriptionHeaderSignature(model.subscription)
          : model.subscription)
        : extra.subscription,
    });
  } catch (_) {
    return `${model.path}:${model.state}:${model.heading}`;
  }
}
