// BLOCKS line grammar (`docs/task-dependencies.md` §14 in bob-cli is
// authoritative; this fragment is its navigation-hotkeys mirror). The writer
// form is `🧱 **BLOCKS:** [[...]] • [[...]]`: plain, never transcluded links
// in canonical sort order on a direct child line. Readers tolerate a missing
// emoji, `🚧` / `⛓️` / `⛓`, the `BLOCKING` label, `·` / `,` / whitespace
// separators, and aliased / struck / `!`-embedded links; writers canonicalise
// all of them. A BLOCKS line is never dependency input: no engine reads it
// back, and hand edits of it never change edges (Rule 1, Rule 8).
//
// Vectors: BK1–BK21 (§14). Each test cites its id.
const BLOCKS_NAVIGATION_LABEL = "BLOCKS";
const BLOCKS_NAVIGATION_EMOJI = "🧱";
const BLOCKS_NAVIGATION_SEPARATOR = " • ";
const LEGACY_BLOCKS_NAVIGATION_LABELS = Object.freeze(new Set(["BLOCKING"]));
// Emoji the reader accepts before the label: the writer brick, the WIP
// barricade, the chain with and without VS16. A missing emoji is accepted.
// (BK4–BK6.)
const BLOCKS_LINE_EMOJIS = Object.freeze(["🧱", "🚧", "⛓️", "⛓"]);
// Managed BLOCKS line shape, e.g. `  - 🧱 **BLOCKS:** [[#^a]] • [[cash#^b]]`.
// Recognizes the current label, the legacy BLOCKING label, and emoji-less
// lines. Named groups mirror the Depends-On bullet regex: `indent`, `marker`,
// `emoji`, `label`, `linkSpan`. Never split `linkSpan` on separators: an
// alias can contain one (BK3).
const BLOCKS_NAVIGATION_BULLET_RE = new RegExp(
  `^(?<indent>\\s*)(?<marker>(?:[-*+]|\\d+[.)]))[ \\t]+(?:(?<emoji>🧱|🚧|⛓️|⛓)[ \\t]+)?\\*\\*(?<label>${[
    BLOCKS_NAVIGATION_LABEL,
    ...LEGACY_BLOCKS_NAVIGATION_LABELS,
  ]
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")}):\\*\\*[ \\t]*(?<linkSpan>.*)$`,
);
// Notice shown once per burst when a hand edit is confined to a BLOCKS line,
// and when a gesture targets one (Rule 8).
const BLOCKS_GENERATED_LINE_NOTICE =
  "🧱 BLOCKS is generated from DEPENDS ON lines · change it on the dependent (Ctrl+Shift+P)";
// Annotation machine BLOCKS writes carry so the hand-edit mirror listener
// skips them (Rule 7: writers compare canonical output; machine writes are
// annotated so nav's listeners ignore them).
const BLOCKS_MACHINE_WRITE_ANNOTATION = "bob-blocks-machine-write";

// Compare two strings by Unicode code point (never UTF-16 units), so nav,
// ledger, and Rust emit identical bytes (Rule 5, BK21).
function compareBlocksStringsByCodePoint(left, right) {
  const leftPoints = Array.from(String(left || ""));
  const rightPoints = Array.from(String(right || ""));
  const shared = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < shared; index += 1) {
    const leftCode = leftPoints[index].codePointAt(0);
    const rightCode = rightPoints[index].codePointAt(0);
    if (leftCode !== rightCode) {
      return leftCode - rightCode;
    }
  }
  return leftPoints.length - rightPoints.length;
}

// ASCII case-fold for sorting: fold A–Z only, leaving non-ASCII untouched.
function foldBlocksAsciiCase(text) {
  return String(text || "").replace(/[A-Z]/g, (letter) =>
    letter.toLowerCase(),
  );
}

function compareBlocksLinksByCodePoint(left, right) {
  const folded = compareBlocksStringsByCodePoint(
    foldBlocksAsciiCase(left),
    foldBlocksAsciiCase(right),
  );
  if (folded !== 0) {
    return folded;
  }
  return compareBlocksStringsByCodePoint(left, right);
}

// Sort canonical link texts per BK21: same-note `[[#^…]]` first, then
// cross-note grouped by note (a consequence of code-point order).
function sortBlocksLinks(linkTexts) {
  return (Array.isArray(linkTexts) ? linkTexts.slice() : []).sort(
    compareBlocksLinksByCodePoint,
  );
}

function formatBlocksLinkRef(target) {
  if (typeof target === "string") {
    return target;
  }
  const blockId = normalizeBulletPropertyValue(
    target && typeof target === "object" ? target.blockId : target,
  );
  const note =
    target && typeof target === "object"
      ? String(target.note || target.target || "").trim()
      : "";
  return note ? `[[${note}#^${blockId}]]` : `[[#^${blockId}]]`;
}

// Writer form: `🧱 **BLOCKS:**` plus canonical links joined by ` • `.
function formatBlocksLine(indent, linkTexts) {
  const indentText = typeof indent === "string" ? indent : "";
  const links = (Array.isArray(linkTexts) ? linkTexts : [])
    .map(formatBlocksLinkRef)
    .filter(Boolean);
  if (links.length === 0) {
    return "";
  }
  return (
    `${indentText}- ${BLOCKS_NAVIGATION_EMOJI} ` +
    `**${BLOCKS_NAVIGATION_LABEL}:** ` +
    sortBlocksLinks(links).join(BLOCKS_NAVIGATION_SEPARATOR)
  );
}

// Parse a BLOCKS line into its parts. Mirrors `parseDependencyLine` verdicts:
// `accept` / `empty` / `malformed` / `not-a-line`. `canonical` is true only
// for the exact writer form. BK1–BK20.
function parseBlocksLine(lineText, options = {}) {
  const text = String(lineText || "");
  // BK18: a blockquoted line is never a BLOCKS line.
  if (/^[ \t]*>/.test(text)) {
    return Object.freeze({ verdict: "not-a-line", links: Object.freeze([]) });
  }
  const match = BLOCKS_NAVIGATION_BULLET_RE.exec(text);
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
  const hasEmoji = Boolean(emoji);
  const links = extractDependencyLineLinks(linkSpan);
  if (links.length === 0) {
    if (String(linkSpan || "").trim() === "") {
      // BK12: label only.
      return Object.freeze({
        ...base,
        verdict: "empty",
        links: Object.freeze([]),
        hasEmoji,
        canonical: false,
      });
    }
    // BK13–BK15: half-typed, prose, bare/heading links, separators only.
    return Object.freeze({
      ...base,
      verdict: "malformed",
      links: Object.freeze([]),
      hasEmoji,
      canonical: false,
    });
  }
  if (!isDependencyLineLinkRemainderClean(linkSpan)) {
    // BK13–BK14: trailing prose or half-typed residue.
    return Object.freeze({
      ...base,
      verdict: "malformed",
      links: Object.freeze([]),
      hasEmoji,
      canonical: false,
    });
  }
  // Canonical also requires sorted, duplicate-free entries (Rule 5, BK10,
  // BK11): the projection order is independent of document order.
  const linkTexts = links.map(formatBlocksLinkRef);
  const sortedTexts = sortBlocksLinks(linkTexts);
  const sortedAndUnique =
    linkTexts.length > 0 &&
    linkTexts.every((entry, index) => entry === sortedTexts[index]) &&
    new Set(linkTexts).size === linkTexts.length;
  const canonical =
    emoji === BLOCKS_NAVIGATION_EMOJI &&
    label === BLOCKS_NAVIGATION_LABEL &&
    isDependencyLineWriterSeparators(linkSpan) &&
    isDependencyLineWriterTokens(linkSpan) &&
    sortedAndUnique;
  return Object.freeze({
    ...base,
    verdict: "accept",
    links: Object.freeze(links),
    hasEmoji,
    canonical,
  });
}

// True for accept, empty, and malformed BLOCKS lines (every verdict but
// not-a-line). BK16 (lowercase), BK17 (BLOCKED BY), and BK18
// (fenced/grandchild/Work-Log/blockquoted/marker-less) stay false. BK20:
// a Depends-On line is never a BLOCKS line.
function isTaskBlocksLine(lineText) {
  return parseBlocksLine(String(lineText || ""), {}).verdict !== "not-a-line";
}

// True for either managed dependency line (Depends-On or BLOCKS, any verdict
// but not-a-line). Neither line is ever a Task Link (Rule 11, MC1/MC2).
function isManagedDependencyLine(lineText) {
  const text = String(lineText || "");
  return (
    parseDependencyLine(text, {}).verdict !== "not-a-line" ||
    parseBlocksLine(text, {}).verdict !== "not-a-line"
  );
}

// Every direct-child BLOCKS line of a task, in document order.
function findBlocksChildren(lines, taskLine) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const parentIndex = Math.floor(Number(taskLine));
  if (!Number.isFinite(parentIndex) || parentIndex < 0) {
    return Object.freeze([]);
  }
  const block = findCurrentBulletChildBlock(sourceLines, parentIndex);
  const found = [];
  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    if (findNearestParentListItem(sourceLines, index) !== parentIndex) {
      continue;
    }
    const parsed = parseBlocksLine(String(sourceLines[index] || ""), {
      isDirectChildOfTask: true,
    });
    if (parsed.verdict !== "not-a-line") {
      found.push(index);
    }
  }
  return Object.freeze(found);
}

// Insert slot for a new BLOCKS line: after the Depends-On subtree when there
// is one, else the Depends-On slot (Rule 5). Reuses the Depends-On insert
// line, which already skips a first-child Cancel Log.
function blocksInsertLine(lines, parentLine) {
  return getDependencyInsertLine(lines, parentLine);
}
