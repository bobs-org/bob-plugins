// Lazy prose-link index (phase bob-cli-om.2 link-engine).
//
// `createLinkIndex` builds the note entries fragment 187 ranks from
// Obsidian's in-memory metadata: `vault.getMarkdownFiles()` for the file
// list, `metadataCache.getFileCache()` for aliases, headings, and block
// IDs, and `metadataCache.resolvedLinks` for inbound counts. Nothing
// spawns a subprocess per keystroke; unsaved buffers stay visible
// because the metadata cache already tracks them.
//
// The index builds lazily on the first `ensure()` and registers its
// `metadataCache` / `vault` listeners only then, cleaned up through
// `plugin.registerEvent`. Any vault or cache change only marks the
// index dirty; the next `ensure()` rebuilds. No UI: the LINK band
// (phase bob-cli-om.3) reads `getNotes()` / `getByPath()`.

function createLinkIndex(app, plugin, options) {
  const settings = options || {};
  const state = {
    app,
    plugin,
    libraryRoots: settings.libraryRoots || ["lib", "xlib"],
    built: false,
    dirty: true,
    listenersInstalled: false,
    notes: [],
    byPath: new Map(),
  };
  const markDirty = () => {
    state.dirty = true;
  };
  const installListeners = () => {
    if (state.listenersInstalled) return;
    state.listenersInstalled = true;
    try {
      const events = [];
      if (
        state.app &&
        state.app.metadataCache &&
        typeof state.app.metadataCache.on === "function"
      ) {
        events.push(
          state.app.metadataCache.on("changed", markDirty),
          state.app.metadataCache.on("resolved", markDirty),
        );
      }
      if (
        state.app &&
        state.app.vault &&
        typeof state.app.vault.on === "function"
      ) {
        events.push(
          state.app.vault.on("create", markDirty),
          state.app.vault.on("rename", markDirty),
          state.app.vault.on("delete", markDirty),
        );
      }
      if (
        state.plugin &&
        typeof state.plugin.registerEvent === "function"
      ) {
        for (const event of events) {
          state.plugin.registerEvent(event);
        }
      }
    } catch (_error) {
      // A host without an event API still gets a working snapshot.
    }
  };
  return {
    ensure() {
      installListeners();
      if (state.built && !state.dirty) return state.notes;
      const built = buildLinkIndexEntries(state);
      state.notes = built.notes;
      state.byPath = built.byPath;
      state.built = true;
      state.dirty = false;
      return state.notes;
    },
    refresh() {
      state.dirty = true;
      return this.ensure();
    },
    getNotes() {
      return this.ensure();
    },
    getByPath(path) {
      this.ensure();
      return state.byPath.get(String(path)) || null;
    },
    getInbound(path) {
      const note = this.getByPath(path);
      return note ? note.inbound : 0;
    },
    isBuilt() {
      return state.built && !state.dirty;
    },
  };
}

function buildLinkIndexEntries(state) {
  const app = state.app || {};
  const vault = app.vault || {};
  const metadataCache = app.metadataCache || {};
  const markdownFiles =
    typeof vault.getMarkdownFiles === "function"
      ? vault.getMarkdownFiles()
      : [];
  const pdfPaths = collectLinkPdfPaths(vault, markdownFiles);
  const hasPdfSibling =
    pdfPaths.size === 0 ? null : (sibling) => pdfPaths.has(sibling);
  const resolvedLinks =
    (metadataCache && metadataCache.resolvedLinks) || {};
  const getFileCache =
    typeof metadataCache.getFileCache === "function"
      ? metadataCache.getFileCache.bind(metadataCache)
      : null;
  const notes = [];
  for (let index = 0; index < markdownFiles.length; index += 1) {
    const file = markdownFiles[index];
    const path = String((file && file.path) || "");
    if (!path || linkIsExcludedNotePath(path)) continue;
    const cache = getFileCache ? getFileCache(file) : null;
    const relative = path.includes("\\") ? path.replace(/\\/g, "/") : path;
    notes.push(
      new LinkIndexNote(
        path,
        classifyLinkTier(relative, {
          libraryRoots: state.libraryRoots,
          hasPdfSibling,
        }),
        relative.endsWith(".md") ? relative.slice(0, -3) : relative,
        linkIndexStem(path, file),
        linkIndexAliases(cache),
        cache,
      ),
    );
  }
  const sorted = sortLinkIndexNotes(notes);
  const byPath = new Map();
  for (let index = 0; index < sorted.length; index += 1) {
    byPath.set(sorted[index].path, sorted[index]);
  }
  const inboundByPath = countAllLinkInbound(resolvedLinks);
  for (let index = 0; index < sorted.length; index += 1) {
    sorted[index].inbound = inboundByPath.get(sorted[index].path) || 0;
  }
  return { notes: sorted, byPath };
}

function collectLinkPdfPaths(vault, markdownFiles) {
  const pdfPaths = new Set();
  const files =
    typeof vault.getFiles === "function" ? vault.getFiles() : markdownFiles;
  for (let index = 0; index < files.length; index += 1) {
    const path = files[index] && files[index].path;
    if (typeof path === "string" && path.endsWith(".pdf")) pdfPaths.add(path);
  }
  return pdfPaths;
}

function sortLinkIndexNotes(notes) {
  const count = notes.length;
  if (count < 2) return notes;
  const keys = new Array(count);
  const order = new Array(count);
  for (let index = 0; index < count; index += 1) {
    keys[index] = linkAsciiLower(notes[index].path);
    order[index] = index;
  }
  order.sort((left, right) => {
    if (keys[left] < keys[right]) return -1;
    if (keys[left] > keys[right]) return 1;
    const leftPath = notes[left].path;
    const rightPath = notes[right].path;
    if (leftPath < rightPath) return -1;
    if (leftPath > rightPath) return 1;
    return 0;
  });
  const sorted = new Array(count);
  for (let index = 0; index < count; index += 1) {
    sorted[index] = notes[order[index]];
  }
  return sorted;
}

function LinkIndexNote(path, tier, insertTarget, stem, aliases, cache) {
  this.path = path;
  this.tier = tier;
  this.insertTarget = insertTarget;
  this.stem = stem;
  this.aliases = aliases;
  this.inbound = 0;
  this._cache = cache;
}

Object.defineProperty(LinkIndexNote.prototype, "headings", {
  enumerable: true,
  get() {
    if (this._headings === undefined) {
      this._headings = linkIndexHeadings(this._cache);
    }
    return this._headings;
  },
});

Object.defineProperty(LinkIndexNote.prototype, "blocks", {
  enumerable: true,
  get() {
    if (this._blocks === undefined) {
      this._blocks = linkIndexBlocks(this._cache);
    }
    return this._blocks;
  },
});

function linkIndexStem(path, file) {
  if (file && typeof file.basename === "string" && file.basename) {
    return file.basename;
  }
  const base = String(path).replace(/\\/g, "/").split("/").pop() || "";
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

function linkIndexAliases(cache) {
  const frontmatter = cache && cache.frontmatter;
  if (
    !frontmatter ||
    (frontmatter.aliases == null && frontmatter.alias == null)
  ) {
    return [];
  }
  const clean = (aliases) =>
    (Array.isArray(aliases) ? aliases : [aliases])
      .filter((alias) => typeof alias === "string")
      .map((alias) => alias.trim())
      .filter(Boolean)
      .filter((alias, index, list) => list.indexOf(alias) === index);
  try {
    if (typeof parseFrontMatterAliases === "function") {
      const aliases = parseFrontMatterAliases(frontmatter);
      if (aliases != null) return clean(aliases);
    }
  } catch (_error) {}
  // The metadata cache already parsed the frontmatter: read the alias
  // keys directly when the Obsidian helper is unavailable (tests).
  try {
    const aliases = clean(frontmatter.aliases).concat(
      clean(frontmatter.alias),
    );
    return aliases.filter(
      (alias, index, list) => list.indexOf(alias) === index,
    );
  } catch (_error) {
    return [];
  }
}

function linkIndexHeadings(cache) {
  const headings =
    (cache && Array.isArray(cache.headings) && cache.headings) || [];
  return headings
    .filter(
      (heading) =>
        heading &&
        typeof heading.heading === "string" &&
        heading.heading !== "",
    )
    .map((heading, ordinal) => ({
      title: heading.heading,
      level: Number(heading.level) || 1,
      ordinal,
    }));
}

function linkIndexBlocks(cache) {
  const blocks = (cache && cache.blocks) || {};
  return Object.keys(blocks).map((id, ordinal) => ({ id, ordinal }));
}

// Distinct other notes linking to `path`, mirroring bob's
// `count_inbound_links` (self-links excluded).
function countAllLinkInbound(resolvedLinks) {
  const inbound = new Map();
  if (!resolvedLinks) return inbound;
  for (const source in resolvedLinks) {
    const targets = resolvedLinks[source];
    if (!targets) continue;
    for (const target in targets) {
      if (target === source) continue;
      inbound.set(target, (inbound.get(target) || 0) + 1);
    }
  }
  return inbound;
}

function countLinkInbound(resolvedLinks, path) {
  return countAllLinkInbound(resolvedLinks).get(path) || 0;
}
