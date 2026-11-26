// Notebook Card model (bob-cli-qm notebook-card). The shell is local-first:
// title and summary come from the current note, crumbs reuse the notebook
// ancestry model when its shared report is ready, and a metadata-cache walk
// keeps the identity useful before that report arrives. No spawn or write.
const NOTEBOOK_CARD_KIND = "notebook";
const NOTEBOOK_CARD_MAX_CRUMBS = 4;
const NOTEBOOK_CARD_MAX_PARENT_HOPS = 8;
const NOTEBOOK_CARD_MANAGED_KEYS = Object.freeze({ template: true, generated_from_zorg: true });

function notebookCardPath(value) {
  const path = typeof value === "string"
    ? value
    : value && typeof value.path === "string" ? value.path : "";
  return String(path || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function notebookCardStem(path) {
  const normalized = notebookCardPath(path);
  const base = normalized.split("/").pop() || "";
  return base.replace(/\.md$/i, "");
}

function notebookCardHumanizeStem(stem) {
  try {
    if (typeof notebookHeaderHumanizeStem === "function") {
      return notebookHeaderHumanizeStem(stem);
    }
  } catch (_) {}
  return String(stem == null ? "" : stem).replace(/[^A-Za-z0-9]+/g, " ").trim();
}

function notebookCardOpeningHeadingTextRange(sourceText, headingRange) {
  if (typeof sourceText !== "string" || !headingRange || !Number.isInteger(headingRange.headingLine)) return null;
  const lines = [];
  const separator = /\r\n|\r|\n/g;
  let cursor = 0;
  let match;
  while ((match = separator.exec(sourceText))) {
    lines.push({ text: sourceText.slice(cursor, match.index), from: cursor });
    cursor = match.index + match[0].length;
  }
  lines.push({ text: sourceText.slice(cursor), from: cursor });
  const line = lines[headingRange.headingLine];
  if (!line) return null;
  const bomLength = line.text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const content = line.text.slice(bomLength);
  const prefix = /^ {0,3}#{1,6}[ \t]+/.exec(content);
  if (!prefix) return null;
  const rawTitle = content.slice(prefix[0].length);
  const closing = /[ \t]+#+[ \t]*$/.exec(rawTitle);
  let titleLength = closing ? closing.index : rawTitle.length;
  while (titleLength > 0 && /[ \t]/.test(rawTitle[titleLength - 1])) titleLength -= 1;
  return {
    from: line.from + bomLength + prefix[0].length,
    to: line.from + bomLength + prefix[0].length + titleLength,
  };
}

function notebookCardOpeningHeading(sourceText) {
  if (typeof sourceText !== "string" || typeof propertyCardTitleSourceRange !== "function") return null;
  try {
    const range = propertyCardTitleSourceRange(sourceText, {
      key: "notebook-opening-h1",
      requireHeading: true,
      heading: (cleaned) => Boolean(String(cleaned || "").trim()),
      follower: () => false,
    });
    return range && range.title
      ? { text: range.title, range: notebookCardOpeningHeadingTextRange(sourceText, range) || range }
      : null;
  } catch (_) {
    return null;
  }
}

function notebookCardTitleModel(sourceText, frontmatter, stem) {
  const heading = notebookCardOpeningHeading(sourceText);
  if (heading) return { text: heading.text, source: "h1", range: heading.range };
  let alias = "";
  try {
    alias = typeof propertyCardFirstAlias === "function"
      ? propertyCardFirstAlias(frontmatter && frontmatter.aliases)
      : "";
  } catch (_) {}
  if (!alias) {
    const aliases = frontmatter && frontmatter.aliases;
    alias = typeof aliases === "string" ? aliases.trim()
      : Array.isArray(aliases) && typeof aliases[0] === "string" ? aliases[0].trim() : "";
  }
  if (alias) return { text: alias, source: "alias", range: null };
  return { text: notebookCardHumanizeStem(stem) || String(stem || ""), source: "stem", range: null };
}

function notebookCardParentTarget(frontmatter) {
  try {
    if (typeof homeCardParentTarget === "function") return homeCardParentTarget(frontmatter && frontmatter.parent);
  } catch (_) {}
  const raw = frontmatter && frontmatter.parent;
  if (typeof raw !== "string") return "";
  const match = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/.exec(raw.trim());
  return match ? match[1].trim() : "";
}

function notebookCardLocalParent(target, fromPath, metadataCache, vault) {
  let file = null;
  try {
    if (typeof notebookResolveLinkFile === "function") {
      file = notebookResolveLinkFile(target, fromPath, metadataCache, vault) || null;
    }
  } catch (_) {}
  try {
    if (!file && metadataCache && typeof metadataCache.getFirstLinkpathDest === "function") {
      file = metadataCache.getFirstLinkpathDest(target, fromPath) || null;
    }
  } catch (_) {}
  const path = notebookCardPath(file && file.path);
  if (!path) return null;
  let cache = null;
  try { cache = metadataCache && typeof metadataCache.getFileCache === "function" ? metadataCache.getFileCache(file) : null; } catch (_) {}
  const frontmatter = cache && cache.frontmatter && typeof cache.frontmatter === "object" && !Array.isArray(cache.frontmatter)
    ? cache.frontmatter : {};
  const kinds = typeof noteCardTypeNames === "function" ? noteCardTypeNames(frontmatter.type) : [];
  const kind = kinds.length === 1 && ["notebook", "area", "project"].includes(kinds[0]) ? kinds[0] : "";
  if (!kind) return null;
  let title = notebookCardHumanizeStem(notebookCardStem(path)) || notebookCardStem(path);
  try {
    if (typeof notebookHeaderNoteTitle === "function") {
      title = notebookHeaderNoteTitle(path, metadataCache, vault) || title;
    }
  } catch (_) {}
  return { path, stem: notebookCardStem(path), title, kind, frontmatter };
}

function notebookCardLocalCrumbs(path, frontmatter, options = {}) {
  const metadataCache = options.metadataCache || null;
  const vault = options.vault || null;
  const chain = [];
  const seen = new Set([notebookCardPath(path).toLowerCase()]);
  let parent = notebookCardParentTarget(frontmatter);
  let fromPath = notebookCardPath(path);
  for (let hop = 0; hop < NOTEBOOK_CARD_MAX_PARENT_HOPS && parent; hop += 1) {
    const entry = notebookCardLocalParent(parent, fromPath, metadataCache, vault);
    if (!entry) break;
    const key = entry.path.toLowerCase();
    if (seen.has(key)) break;
    seen.add(key);
    chain.push({
      path: entry.path,
      stem: entry.stem,
      title: entry.title,
      kind: entry.kind === "area" || entry.kind === "project" ? "root" : "notebook",
    });
    if (entry.kind === "area" || entry.kind === "project") break;
    parent = notebookCardParentTarget(entry.frontmatter);
    fromPath = entry.path;
  }
  chain.reverse();
  return chain;
}

function notebookCardCrumbs(path, frontmatter, options = {}) {
  const reportModel = options.headerModel && typeof options.headerModel === "object" ? options.headerModel : null;
  let crumbs = reportModel && Array.isArray(reportModel.crumbs)
    ? reportModel.crumbs.filter((crumb) => crumb && crumb.kind !== "self")
    : notebookCardLocalCrumbs(path, frontmatter, options);
  try {
    if (typeof notebookHeaderCollapse === "function") {
      crumbs = notebookHeaderCollapse(crumbs, NOTEBOOK_CARD_MAX_CRUMBS);
    } else if (crumbs.length > NOTEBOOK_CARD_MAX_CRUMBS) {
      crumbs = [crumbs[0], { ellipsis: true, path: "", stem: "", title: "…" }, ...crumbs.slice(-(NOTEBOOK_CARD_MAX_CRUMBS - 2))];
    }
  } catch (_) {}
  const hue = String(options.hue || "").trim().toLowerCase();
  let pipAssigned = false;
  return crumbs.map((crumb) => {
    if (!crumb || crumb.ellipsis === true) return { ellipsis: true, text: "…", target: "" };
    const target = notebookCardPath(crumb.path || crumb.stem);
    const part = {
      text: String(crumb.title || crumb.stem || "").trim(),
      target,
      kind: String(crumb.kind || ""),
    };
    if (!pipAssigned && hue && crumb.kind === "root") {
      part.pip = hue === "gray" ? "grey" : hue;
      pipAssigned = true;
    }
    return part;
  }).filter((crumb) => crumb.text);
}

// Pure presentation input. The host makes species eligibility and takeover
// decisions; keeping those gates outside the model makes the local card easy
// to test with missing metadata and unopened report state.
function notebookCardModel(input = {}) {
  try {
    const path = notebookCardPath(input.path);
    if (!path || (typeof noteCardPathExcluded === "function" && noteCardPathExcluded(path))) return null;
    const frontmatter = input.frontmatter && typeof input.frontmatter === "object" && !Array.isArray(input.frontmatter)
      ? input.frontmatter : {};
    if (typeof noteCardIsNotebookKind === "function" && !noteCardIsNotebookKind(frontmatter)) return null;
    const stem = notebookCardStem(path);
    const title = notebookCardTitleModel(input.sourceText, frontmatter, stem);
    if (!String(title.text || "").trim()) return null;
    const rawSummary = frontmatter.summary;
    const summary = typeof rawSummary === "string" ? rawSummary.trim() : "";
    return {
      path,
      stem,
      kind: NOTEBOOK_CARD_KIND,
      title,
      summary,
      summaryMissing: !summary,
      route: stem ? `@${stem}` : "",
      hue: String(input.hue || "").trim().toLowerCase().replace(/^gray$/, "grey"),
      crumbs: notebookCardCrumbs(path, frontmatter, input),
      managed: NOTEBOOK_CARD_MANAGED_KEYS,
      where: {
        parent: "crumbs",
        summary: summary ? "scope" : "",
        created: Object.prototype.hasOwnProperty.call(frontmatter, "created") ? "created" : "",
      },
    };
  } catch (_) {
    return null;
  }
}
