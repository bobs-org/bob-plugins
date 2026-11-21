// Local identity for the record card's title block: path, title, album
// kicker, and emoji from the metadata cache alone, so the title block paints
// at once without waiting for a bob report. Null unless the note is a
// canonical desktop record under one existing album parent in its folder.
function recordSheetPlainString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function recordSheetStemOf(path) {
  const normalized = recordSheetPath(path);
  return normalized ? normalized.split("/").pop().replace(/\.md$/i, "") : "";
}

// Report-free parent resolve: one unambiguous link to an existing note other
// than this record. Missing, ambiguous, cyclic, and unresolved parents are
// null. Album type and folder checks stay with the caller.
function recordSheetIdentityParentPath(filePath, frontmatter, metadataCache, vault) {
  const normalized = recordSheetPath(filePath);
  if (!normalized || !frontmatter || typeof frontmatter !== "object") return "";
  const rawParent = frontmatter.parent;
  if (rawParent === null || rawParent === undefined
    || (typeof rawParent === "string" && !rawParent.trim())
    || (Array.isArray(rawParent) && rawParent.length === 0)) {
    return "";
  }
  const target = typeof albumSchemaEntryParentTarget === "function"
    ? albumSchemaEntryParentTarget(rawParent) : "";
  if (!target) return "";
  let resolvedPath = "";
  try {
    const resolved = typeof albumHeaderResolveFile === "function"
      ? albumHeaderResolveFile(target, normalized, metadataCache, vault)
      : null;
    resolvedPath = resolved && resolved.path ? recordSheetPath(resolved.path) : "";
  } catch (_) {
    resolvedPath = "";
  }
  if (!resolvedPath) {
    try {
      const guessed = /\.md$/i.test(target) ? target : `${target}.md`;
      const file = vault && typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(guessed) : null;
      if (file && file.path) resolvedPath = recordSheetPath(file.path);
    } catch (_) {}
  }
  let exists = false;
  try {
    if (resolvedPath && vault && typeof vault.getAbstractFileByPath === "function") {
      exists = Boolean(vault.getAbstractFileByPath(resolvedPath));
    }
  } catch (_) {
    exists = false;
  }
  if (!exists && resolvedPath && metadataCache && typeof metadataCache.getFirstLinkpathDest === "function") {
    try {
      const found = metadataCache.getFirstLinkpathDest(target, normalized);
      if (found && found.path) {
        resolvedPath = recordSheetPath(found.path);
        exists = true;
      }
    } catch (_) {}
  }
  if (!exists || !resolvedPath) return "";
  if (resolvedPath.toLocaleLowerCase() === normalized.toLocaleLowerCase()) return "";
  return resolvedPath;
}

function recordSheetIdentityHeading(options = {}) {
  if (typeof options.heading === "string" && options.heading.trim()) return options.heading.trim();
  if (typeof options.sourceText === "string") {
    const fromSource = typeof recordSheetFirstHeading === "function"
      ? recordSheetFirstHeading(options.sourceText) : "";
    if (fromSource) return fromSource;
  }
  if (options.cache) {
    const fromCache = typeof recordSheetHeadingFromCache === "function"
      ? recordSheetHeadingFromCache(options.cache) : "";
    if (fromCache) return fromCache;
  }
  return "";
}

function recordSheetIdentityModel(path, options = {}) {
  try {
    if (options.desktop !== true) return null;
    const filePath = recordSheetPath(path);
    if (!filePath) return null;
    const frontmatter = options.frontmatter;
    if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) return null;
    if (!recordSheetIsCanonicalRecordType(frontmatter)) return null;
    const metadataCache = options.metadataCache || null;
    const vault = options.vault || null;
    const albumPath = recordSheetIdentityParentPath(filePath, frontmatter, metadataCache, vault);
    if (!albumPath) return null;
    if (!recordSheetParentIsAlbum(albumPath, metadataCache, vault)) return null;
    const albumStem = recordSheetStemOf(albumPath);
    if (recordSheetFolderKind(filePath, albumStem) !== "ok") return null;
    const stem = recordSheetStemOf(filePath);
    const title = recordSheetPlainString(frontmatter.title)
      || recordSheetIdentityHeading(options)
      || stem;
    if (!title) return null;
    const albumTitle = (typeof notebookHeaderNoteTitle === "function"
      ? String(notebookHeaderNoteTitle(albumPath, metadataCache, vault) || "").trim()
      : "") || albumStem;
    let emoji = "";
    try {
      const albumFile = vault && typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(albumPath) : null;
      const albumCache = albumFile && metadataCache && typeof metadataCache.getFileCache === "function"
        ? metadataCache.getFileCache(albumFile) : null;
      emoji = recordSheetPlainString(albumCache?.frontmatter?.emoji);
    } catch (_) {
      emoji = "";
    }
    return {
      kind: "record",
      path: filePath,
      stem,
      title,
      albumPath,
      albumStem,
      albumTitle,
      emoji,
    };
  } catch (_) {
    return null;
  }
}

// { identity, body }: identity is required and always supplies the title;
// body is today's report-backed record model, or null while the report is
// pending, failed, or has no entry. A title alone never enables editing.
function recordSheetCardModel(path, options = {}) {
  const identity = recordSheetIdentityModel(path, options);
  if (!identity) return null;
  let body = null;
  try {
    body = typeof options.body === "function" ? options.body() : (options.body == null ? null : options.body);
  } catch (_) {
    body = null;
  }
  return { identity, body, title: identity.title };
}

// A bare report model (older callers and previews) still builds: identity
// from itself. The title stays the body's title so existing tests keep it.
function recordSheetCardFrom(model) {
  if (!model) return null;
  if (model.identity) return model;
  const title = String(model.title || model.stem || "Record").trim() || "Record";
  const albumPath = recordSheetPath(model.albumPath);
  const albumStem = String(model.albumStem || recordSheetStemOf(albumPath));
  return {
    identity: {
      kind: "record",
      path: recordSheetPath(model.path),
      stem: String(model.stem || recordSheetStemOf(model.path)),
      title,
      albumPath,
      albumStem,
      albumTitle: String(model.albumTitle || albumStem || "Album"),
      emoji: recordSheetPlainString(model.emoji),
    },
    body: model,
    title,
  };
}

// Scalars only: stringifying the live walk model can include a new object
// graph on every CodeMirror update and force a slot remount loop.
function recordSheetWalkSignature(walk) {
  if (!walk) return null;
  return {
    state: walk.state || "",
    reason: walk.reason || "",
    lineState: walk.lineState || "",
    lineIndex: Number.isInteger(walk.lineIndex) ? walk.lineIndex : null,
    position: Number.isInteger(walk.position) ? walk.position : null,
    total: Number.isInteger(walk.total) ? walk.total : null,
    albumPath: walk.albumPath || "",
    prev: walk.prev && walk.prev.path ? walk.prev.path : "",
    next: walk.next && walk.next.path ? walk.next.path : "",
  };
}

function recordSheetCardSignature(card, extra = {}) {
  if (!card?.identity) return "none";
  const identity = card.identity;
  return JSON.stringify({
    path: identity.path,
    title: identity.title,
    albumPath: identity.albumPath,
    albumTitle: identity.albumTitle,
    emoji: identity.emoji,
    hue: extra.hue || "",
    body: card.body && typeof recordSheetSignature === "function"
      ? recordSheetSignature(card.body, extra) : null,
    walk: recordSheetWalkSignature(extra.walk || (card.body && card.body.walk) || null),
    collapsed: extra.collapsed === true,
    foldOpen: extra.foldOpen === true,
    overlay: extra.overlay || null,
    subscription: extra.subscription || null,
    desktop: extra.desktop !== false,
  });
}
