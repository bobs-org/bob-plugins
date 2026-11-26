// Prose Card model (bob-cli-qm prose-card): local identity only. Measures
// and findings arrive later through Bob Prose's read-only outline seam.
const PROSE_NOTE_CARD_KIND = "prose";

function proseNoteCardStem(path) {
  try {
    const text = String(path === null || path === undefined ? "" : path).replace(/\\/g, "/");
    const base = text.split("/").pop() || "";
    return base.replace(/\.md$/i, "");
  } catch (_) {
    return "";
  }
}

function proseNoteCardPath(value) {
  try {
    const raw = value && typeof value.path === "string" ? value.path : value;
    return typeof raw === "string" ? raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "") : "";
  } catch (_) {
    return "";
  }
}

function proseNoteCardOneLine(value) {
  if (value === null || value === undefined) return "";
  try {
    const line = String(value).split(/\r?\n/, 1)[0].trim();
    return typeof propertyCardCleanInlineText === "function" ? propertyCardCleanInlineText(line) : line;
  } catch (_) {
    return "";
  }
}

function proseNoteCardTitleParts(frontmatter, path) {
  const fm = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter) ? frontmatter : {};
  const explicit = proseNoteCardOneLine(fm.title);
  if (explicit) return { text: explicit, source: "title", fromStem: false };
  let alias = "";
  try {
    alias = typeof propertyCardFirstAlias === "function"
      ? propertyCardFirstAlias(fm.aliases)
      : proseNoteCardOneLine(Array.isArray(fm.aliases) ? fm.aliases[0] : fm.aliases);
  } catch (_) {}
  if (alias) return { text: alias, source: "alias", fromStem: false };
  return { text: proseNoteCardStem(path), source: "stem", fromStem: true };
}

function proseNoteCardInitial(title) {
  try {
    const first = Array.from(String(title || "").trim())[0] || "";
    return /[\p{L}\p{N}]/u.test(first) ? first.toUpperCase() : "";
  } catch (_) {
    return "";
  }
}

function proseNoteCardNumbering(frontmatter) {
  const fm = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter) ? frontmatter : {};
  if (!Object.prototype.hasOwnProperty.call(fm, "section_numbers") || fm.section_numbers === true) {
    return Object.freeze({ state: "numbered", numbered: true });
  }
  if (fm.section_numbers === false) return Object.freeze({ state: "unnumbered", numbered: false });
  return Object.freeze({ state: "invalid", numbered: null });
}

function proseNoteCardModel(input = {}) {
  try {
    const options = input && typeof input === "object" ? input : {};
    const path = proseNoteCardPath(options.path);
    const frontmatter = options.frontmatter && typeof options.frontmatter === "object" && !Array.isArray(options.frontmatter)
      ? options.frontmatter : {};
    if (!path || typeof propertyCardNoteSpecies !== "function"
      || propertyCardNoteSpecies({ path, frontmatter }) !== PROSE_NOTE_CARD_KIND) return null;

    const title = proseNoteCardTitleParts(frontmatter, path);
    if (!title.text) return null;
    const ancestry = typeof homeCardWalkAncestry === "function"
      ? homeCardWalkAncestry(path, frontmatter, { resolveParent: options.resolveParent })
      : { crumbs: [] };
    const crumbs = typeof homeCardCrumbParts === "function"
      ? homeCardCrumbParts(ancestry?.crumbs, {})
      : [];
    const hue = crumbs.find((part) => part && part.pip)?.pip || "";
    const summary = proseNoteCardOneLine(frontmatter.summary);
    const hasCreated = Object.prototype.hasOwnProperty.call(frontmatter, "created");
    const numbering = proseNoteCardNumbering(frontmatter);
    return Object.freeze({
      path,
      kind: PROSE_NOTE_CARD_KIND,
      frontmatter,
      title: Object.freeze({ ...title, initial: proseNoteCardInitial(title.text) }),
      initial: proseNoteCardInitial(title.text),
      dek: summary,
      summary,
      numbering,
      created: hasCreated ? frontmatter.created : null,
      createdPresent: hasCreated,
      crumbs: Object.freeze(Array.isArray(crumbs) ? crumbs.slice() : []),
      hue,
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
