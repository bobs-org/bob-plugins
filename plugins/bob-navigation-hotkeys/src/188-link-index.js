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
  const allPaths =
    typeof vault.getFiles === "function"
      ? vault.getFiles().map((file) => String(file && file.path))
      : markdownFiles.map((file) => String(file && file.path));
  const pdfPaths = new Set(
    allPaths.filter((path) => path.endsWith(".pdf")),
  );
  const resolvedLinks =
    (metadataCache && metadataCache.resolvedLinks) || {};
  const notes = [];
  for (const file of markdownFiles) {
    const path = String((file && file.path) || "");
    if (!path || linkIsExcludedNotePath(path)) continue;
    const cache =
      typeof metadataCache.getFileCache === "function"
        ? metadataCache.getFileCache(file)
        : null;
    const stem = linkIndexStem(path, file);
    const relative = path.replace(/\\/g, "/");
    notes.push({
      path,
      tier: classifyLinkTier(relative, {
        libraryRoots: state.libraryRoots,
        hasPdfSibling: (sibling) => pdfPaths.has(sibling),
      }),
      insertTarget: relative.endsWith(".md")
        ? relative.slice(0, -3)
        : relative,
      stem,
      aliases: linkIndexAliases(cache),
      headings: linkIndexHeadings(cache),
      blocks: linkIndexBlocks(cache),
      inbound: 0,
    });
  }
  notes.sort((left, right) =>
    linkCompareNormalized(left.path, right.path),
  );
  const byPath = new Map(notes.map((note) => [note.path, note]));
  for (const note of notes) {
    note.inbound = countLinkInbound(resolvedLinks, note.path);
  }
  return { notes, byPath };
}

function linkIndexStem(path, file) {
  if (file && typeof file.basename === "string" && file.basename) {
    return file.basename;
  }
  const base = String(path).replace(/\\/g, "/").split("/").pop() || "";
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

function linkIndexAliases(cache) {
  const clean = (aliases) =>
    (Array.isArray(aliases) ? aliases : [aliases])
      .filter((alias) => typeof alias === "string")
      .map((alias) => alias.trim())
      .filter(Boolean)
      .filter((alias, index, list) => list.indexOf(alias) === index);
  try {
    if (
      typeof parseFrontMatterAliases === "function" &&
      cache &&
      cache.frontmatter
    ) {
      const aliases = parseFrontMatterAliases(cache.frontmatter);
      if (aliases != null) return clean(aliases);
    }
  } catch (_error) {}
  // The metadata cache already parsed the frontmatter: read the alias
  // keys directly when the Obsidian helper is unavailable (tests).
  try {
    const frontmatter = (cache && cache.frontmatter) || {};
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
function countLinkInbound(resolvedLinks, path) {
  let count = 0;
  for (const source of Object.keys(resolvedLinks || {})) {
    if (source === path) continue;
    const targets = resolvedLinks[source] || {};
    if (Object.prototype.hasOwnProperty.call(targets, path)) {
      count += 1;
    }
  }
  return count;
}
