// Ref Card identity is local-first: note frontmatter and the opening body H1
// define the shell. The shared bob ref report patches reading state later.
// This model is pure and never reads, spawns, or writes.
const REF_NOTE_CARD_KIND = "ref";
const REF_NOTE_CARD_MANAGED_KEYS = Object.freeze({
  id: true,
  ref_type: true,
  status: true,
  parent: true,
  source_markdown: true,
  source_pdf: true,
  source_pdf_sha256: true,
  pipeline_version: true,
  audio: true,
  return_links: true,
  earlier: true,
  recaptured: true,
  legacy_status: true,
});

function refNoteCardPath(value) {
  try {
    const raw = value && typeof value.path === "string" ? value.path : value;
    return typeof raw === "string" ? raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "") : "";
  } catch (_) {
    return "";
  }
}

function refNoteCardStem(path) {
  try {
    const normalized = refNoteCardPath(path);
    const base = normalized.split("/").pop() || "";
    return base.replace(/\.md$/i, "");
  } catch (_) {
    return "";
  }
}

function refNoteCardOneLine(value) {
  if (value === null || value === undefined) return "";
  try {
    const line = String(value).split(/\r?\n/, 1)[0].trim();
    return typeof propertyCardCleanInlineText === "function" ? propertyCardCleanInlineText(line) : line;
  } catch (_) {
    return "";
  }
}

function refNoteCardHumanizeStem(stem) {
  const raw = String(stem || "").trim();
  if (!raw) return "";
  try {
    if (typeof notebookHeaderHumanizeStem === "function") {
      const humanized = notebookHeaderHumanizeStem(raw);
      if (typeof humanized === "string" && humanized.trim()) return humanized.trim();
    }
  } catch (_) {}
  return raw.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
}

function refNoteCardFirstHeading(sourceText) {
  if (typeof sourceText !== "string" || typeof propertyCardTitleSourceRange !== "function") return null;
  try {
    const range = propertyCardTitleSourceRange(sourceText, {
      key: "ref-opening-h1",
      requireHeading: true,
      heading: (cleaned) => Boolean(String(cleaned || "").trim()),
      follower: () => false,
    });
    return range && range.title ? { text: range.title, range } : null;
  } catch (_) {
    return null;
  }
}

function refNoteCardTitleParts(frontmatter, path, sourceText) {
  try {
    const fm = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter) ? frontmatter : {};
    const explicit = refNoteCardOneLine(fm.title);
    const heading = refNoteCardFirstHeading(sourceText);
    if (explicit) {
      const range = heading && typeof propertyCardHomeTitleRecognizer === "function"
        ? propertyCardTitleSourceRange(sourceText, propertyCardHomeTitleRecognizer(explicit))
        : null;
      return Object.freeze({ text: explicit, source: "title", fromStem: false, range: range || null });
    }
    if (heading) return Object.freeze({ text: heading.text, source: "h1", fromStem: false, range: heading.range });
    return Object.freeze({
      text: refNoteCardHumanizeStem(refNoteCardStem(path)),
      source: "stem",
      fromStem: true,
      range: null,
    });
  } catch (_) {
    return Object.freeze({ text: refNoteCardHumanizeStem(refNoteCardStem(path)), source: "stem", fromStem: true, range: null });
  }
}

function refNoteCardManagedMap(frontmatter) {
  const managed = { ...REF_NOTE_CARD_MANAGED_KEYS };
  const fm = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter) ? frontmatter : {};
  for (const key of Object.keys(fm)) {
    if (/^highlights_/i.test(key) || /^zorg_/i.test(key) || /^generated_from_zorg/i.test(key)) managed[key] = true;
    if (/^source_(?:note|block|id|path|line_start|line_end)$/i.test(key)) managed[key] = true;
  }
  return Object.freeze(managed);
}

function refNoteCardPublishedScalar(sourceText) {
  try {
    if (typeof sourceText !== "string" || typeof propertyCardScanFrontmatter !== "function") return "";
    const scan = propertyCardScanFrontmatter(sourceText);
    if (scan?.state !== "closed" || !Array.isArray(scan.entries)) return "";
    const entry = [...scan.entries].reverse().find((row) => row?.key === "published");
    return typeof entry?.rawScalar === "string" ? entry.rawScalar.trim() : "";
  } catch (_) {
    return "";
  }
}

function refNoteCardScalarText(value) {
  const raw = String(value === null || value === undefined ? "" : value).trim();
  try {
    if (typeof propertyCardUnquoteYamlScalar === "function") return String(propertyCardUnquoteYamlScalar(raw) || "").trim();
  } catch (_) {}
  if (raw.length >= 2 && raw[0] === "\"" && raw[raw.length - 1] === "\"") {
    try { return JSON.parse(raw); } catch (_) { return raw.slice(1, -1); }
  }
  if (raw.length >= 2 && raw[0] === "'" && raw[raw.length - 1] === "'") return raw.slice(1, -1).replace(/''/g, "'");
  return raw.replace(/\s+#.*$/, "").trim();
}

function refNoteCardPublished(value, sourceScalar = "") {
  try {
    let text = refNoteCardScalarText(sourceScalar || value);
    if (!text && value instanceof Date && !Number.isNaN(value.getTime())) text = value.toISOString().slice(0, 10);
    const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text);
    if (!match) return null;
    const year = Number(match[1]);
    const month = match[2] ? Number(match[2]) : null;
    const day = match[3] ? Number(match[3]) : null;
    if (month !== null && (month < 1 || month > 12)) return null;
    if (day !== null) {
      const probe = new Date(Date.UTC(year, month - 1, day));
      if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
    }
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const label = day !== null ? `${months[month - 1]} ${day}, ${year}`
      : month !== null ? `${months[month - 1]} ${year}` : String(year);
    return Object.freeze({ label, precision: day !== null ? "day" : month !== null ? "month" : "year", value: text });
  } catch (_) {
    return null;
  }
}

function refNoteCardSourceUrl(value) {
  try {
    const raw = refNoteCardOneLine(value);
    if (!raw) return null;
    const parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) return null;
    const host = parsed.hostname.replace(/^www\./i, "");
    return Object.freeze({ href: parsed.href, host });
  } catch (_) {
    return null;
  }
}

function refNoteCardVaultPath(value, extension = "") {
  try {
    if (typeof value !== "string" || /[\r\n\0]/.test(value)) return "";
    const raw = value.trim().replace(/\\/g, "/");
    if (!raw || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) return "";
    const parts = raw.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) return "";
    if (extension && !raw.toLowerCase().endsWith(extension.toLowerCase())) return "";
    return raw;
  } catch (_) {
    return "";
  }
}

function refNoteCardAuthor(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map(refNoteCardOneLine).filter(Boolean).join(", ");
}

function refNoteCardModel(input = {}) {
  try {
    const options = input && typeof input === "object" ? input : {};
    const path = refNoteCardPath(options.path);
    const frontmatter = options.frontmatter && typeof options.frontmatter === "object" && !Array.isArray(options.frontmatter)
      ? options.frontmatter : {};
    if (!path || (typeof noteCardPathExcluded === "function" && noteCardPathExcluded(path))
      || typeof propertyCardNoteSpecies !== "function"
      || propertyCardNoteSpecies({ path, frontmatter }) !== REF_NOTE_CARD_KIND) return null;

    const title = refNoteCardTitleParts(frontmatter, path, options.sourceText);
    if (!title.text) return null;
    const ancestry = typeof homeCardWalkAncestry === "function"
      ? homeCardWalkAncestry(path, frontmatter, { resolveParent: options.resolveParent })
      : { crumbs: [] };
    const crumbs = typeof homeCardCrumbParts === "function"
      ? homeCardCrumbParts(ancestry?.crumbs, {}) : [];
    const refType = refNoteCardOneLine(frontmatter.ref_type).toLowerCase();
    const vocabulary = typeof refCardKindEntry === "function" ? refCardKindEntry(refType) : { word: "Ref", icon: "bookmark" };
    const published = refNoteCardPublished(frontmatter.published, refNoteCardPublishedScalar(options.sourceText));
    const source = refNoteCardSourceUrl(frontmatter.source_url) || refNoteCardSourceUrl(frontmatter.url);
    const author = refNoteCardAuthor(frontmatter.author);
    const agent = refNoteCardOneLine(frontmatter.agent);
    const byline = [];
    if (author) byline.push(Object.freeze({ kind: "author", text: author }));
    if (source) byline.push(Object.freeze({ kind: "source", text: source.host, href: source.href }));
    if (published) byline.push(Object.freeze({ kind: "published", text: published.label, precision: published.precision }));
    if (agent) byline.push(Object.freeze({ kind: "agent", text: `agent report · ${agent}` }));
    const dek = refNoteCardOneLine(frontmatter.summary);
    const sourcePdf = refNoteCardVaultPath(frontmatter.source_pdf, ".pdf");
    const audio = refNoteCardVaultPath(frontmatter.audio);
    const hue = crumbs.find((part) => part && part.pip)?.pip || "";
    const captured = Object.prototype.hasOwnProperty.call(frontmatter, "captured") ? frontmatter.captured : null;
    const created = Object.prototype.hasOwnProperty.call(frontmatter, "created") ? frontmatter.created : null;
    const legacy = Object.prototype.hasOwnProperty.call(frontmatter, "legacy_status") || refType === "zorg";
    return Object.freeze({
      path,
      stem: refNoteCardStem(path),
      kind: REF_NOTE_CARD_KIND,
      refType,
      kindWord: vocabulary.word || "Ref",
      icon: vocabulary.icon || "bookmark",
      title,
      dek,
      summary: dek,
      byline: Object.freeze(byline),
      sourcePdf,
      audio,
      hasAccess: Boolean(sourcePdf || audio),
      crumbs: Object.freeze(Array.isArray(crumbs) ? crumbs.slice() : []),
      hue,
      created,
      captured,
      legacy,
      tone: legacy ? "legacy" : "quiet",
      managed: refNoteCardManagedMap(frontmatter),
      frontmatter,
      ancestry: Object.freeze({
        broken: ancestry?.broken === true,
        cyclic: ancestry?.cyclic === true,
        truncated: ancestry?.truncated === true,
      }),
    });
  } catch (_) {
    return null;
  }
}
