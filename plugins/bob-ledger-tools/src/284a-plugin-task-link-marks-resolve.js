// --- Task link marks: the target resolver --------------------------------
// `BobLedgerToolsTaskLinkMarksResolveMixin`, installed in
// `310-install-methods.js`. Owned by the `docs/task-link-marks.md`
// display contract in bob-cli (bob-cli-f5 phase `live_preview`). One
// resolver with three sources, in this order: the live editor document
// (same-note targets in Live Preview), the Tasks memo through
// `dependencyTasksIndex()` (with duplicate keys neutral), and the
// metadata cache. It never reads a file from disk, never throws, and is
// truthful or neutral: any doubt resolves to null (no ring).

// Per-cache-object line indexes for the metadata fallback, so a target
// note with hundreds of list items is scanned once per cache object.
const TASK_LINK_MARK_CACHE_INDEX = new WeakMap();

function taskLinkMarkCacheLineIndex(cache) {
  try {
    if (!cache || typeof cache !== "object") {
      return null;
    }
    const known = TASK_LINK_MARK_CACHE_INDEX.get(cache);
    if (known) {
      return known;
    }
    const items = new Map();
    for (const item of Array.isArray(cache.listItems) ? cache.listItems : []) {
      try {
        const start = item && item.position && item.position.start;
        if (start && Number.isInteger(start.line) && !items.has(start.line)) {
          items.set(start.line, item);
        }
      } catch (error) {
        continue;
      }
    }
    const tags = new Map();
    for (const entry of Array.isArray(cache.tags) ? cache.tags : []) {
      try {
        const start = entry && entry.position && entry.position.start;
        if (!start || !Number.isInteger(start.line) || typeof entry.tag !== "string") {
          continue;
        }
        const seen = tags.get(start.line);
        if (seen) {
          seen.add(entry.tag);
        } else {
          tags.set(start.line, new Set([entry.tag]));
        }
      } catch (error) {
        continue;
      }
    }
    const built = { items, tags };
    try {
      TASK_LINK_MARK_CACHE_INDEX.set(cache, built);
    } catch (error) {
      // An unkeyable cache object still returns a correct index.
    }
    return built;
  } catch (error) {
    return null;
  }
}

// The start line of block `id` in a metadata-cache entry, matched the
// way `relationIndexHasCachedBlock` does (the exact id, `^id`, the
// lower-cased id, then any block whose own `id` equals it), or null.
function taskLinkMarkCachedBlockLine(cache, id) {
  try {
    const blocks = cache && cache.blocks;
    if (!blocks || typeof blocks !== "object") {
      return null;
    }
    let block = null;
    for (const name of [id, "^" + id, id.toLowerCase()]) {
      if (Object.prototype.hasOwnProperty.call(blocks, name)) {
        block = blocks[name];
        break;
      }
    }
    if (!block) {
      block = Object.values(blocks).find(
        (item) => item && String(item.id || "").replace(/^\^/u, "") === id,
      );
    }
    const start = block && block.position && block.position.start;
    return start && Number.isInteger(start.line) ? start.line : null;
  } catch (error) {
    return null;
  }
}

class BobLedgerToolsTaskLinkMarksResolveMixin {
  // The vault path `linkpath` resolves to from `sourcePath` (an empty
  // linkpath is the source note), or null when it does not resolve to a
  // Markdown file. Never throws.
  taskLinkMarkResolvePath(linkpath, sourcePath) {
    try {
      const source = String(sourcePath || "");
      const target = String(linkpath || "").trim();
      if (target === "") {
        return source !== "" && /\.md$/iu.test(source) ? source : null;
      }
      const metadataCache = this.app && this.app.metadataCache;
      if (!metadataCache || typeof metadataCache.getFirstLinkpathDest !== "function") {
        return null;
      }
      const dest = metadataCache.getFirstLinkpathDest(target, source);
      if (!dest || typeof dest.path !== "string" || dest.path === "") {
        return null;
      }
      if (typeof dest.extension === "string" && dest.extension.toLowerCase() !== "md") {
        return null;
      }
      return /\.md$/iu.test(dest.path) ? dest.path : null;
    } catch (error) {
      return null;
    }
  }

  // The Tasks status type (`DONE`, `CANCELLED`, ...) of the first memo
  // task carrying checkbox `symbol`, for symbols outside ` *\/?xX-`.
  // Memoised per Tasks snapshot. Never throws.
  taskLinkMarkStatusTypeFor(symbol) {
    try {
      const memo = this.freshnessEnsureMemo();
      const tasks = memo && Array.isArray(memo.tasks) ? memo.tasks : [];
      let cache = this.taskLinkMarkStatusTypes;
      if (!cache || cache.tasks !== tasks) {
        cache = { tasks, types: new Map() };
        this.taskLinkMarkStatusTypes = cache;
      }
      if (cache.types.has(symbol)) {
        return cache.types.get(symbol);
      }
      let type = null;
      for (const task of tasks) {
        try {
          if (planTaskStatusSymbol(task) === symbol) {
            type = task.status && typeof task.status.type === "string" ? task.status.type : null;
            break;
          }
        } catch (error) {
          continue;
        }
      }
      cache.types.set(symbol, type);
      return type;
    } catch (error) {
      return null;
    }
  }

  // Source 2: the Tasks memo. A hit is a `#task` line (the Tasks global
  // filter), re-checked against the row's own markdown so a `#task` in
  // inline code never rings. Returns `{state, title}`, null for a
  // neutral verdict, or undefined for a miss.
  taskLinkMarkFromMemo(key) {
    try {
      const index = this.dependencyTasksIndex();
      if (!(index instanceof Map) || !index.has(key)) {
        return undefined;
      }
      if (this.dependencyTasksDuplicateKeys().has(key)) {
        return null;
      }
      const task = index.get(key);
      const markdown = task && typeof task.originalMarkdown === "string" ? task.originalMarkdown : null;
      if (markdown !== null) {
        const parsed = taskLinkMarkParseTaskLine(markdown);
        if (!parsed || !parsed.hasTask) {
          return null;
        }
      }
      const type = task && task.status && typeof task.status.type === "string" ? task.status.type : null;
      const state = taskLinkMarkStateFromSymbol(planTaskStatusSymbol(task), type);
      if (!state) {
        return null;
      }
      const description = planTaskDescription(task);
      const title = markdown !== null ? markdown : description;
      return { state, title: typeof title === "string" && title.trim() !== "" ? title : null };
    } catch (error) {
      return undefined;
    }
  }

  // Source 3: the metadata cache. `blocks[id]` gives the line,
  // `listItems` the checkbox char on it, and `tags` must hold `#task` on
  // that line. There is no title text here. Returns `{state, title}` or
  // null. Never reads from disk.
  taskLinkMarkFromCache(path, id) {
    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (!metadataCache || typeof metadataCache.getCache !== "function") {
        return null;
      }
      const cache = metadataCache.getCache(path);
      const line = taskLinkMarkCachedBlockLine(cache, id);
      if (line === null) {
        return null;
      }
      const index = taskLinkMarkCacheLineIndex(cache);
      const item = index && index.items.get(line);
      const symbol = item && typeof item.task === "string" && item.task !== "" ? item.task[0] : null;
      if (symbol === null) {
        return null;
      }
      const tags = index.tags.get(line);
      if (!tags || !tags.has("#task")) {
        return null;
      }
      const state = taskLinkMarkStateFromSymbol(
        symbol,
        /^[ *\/?xX-]$/.test(symbol) ? null : this.taskLinkMarkStatusTypeFor(symbol),
      );
      return state ? { state, title: null } : null;
    } catch (error) {
      return null;
    }
  }

  // `taskLinkMarkResolve({linkpath, blockId, sourcePath, liveDoc})`
  // returns a frozen `{key, state, title, targetPath}` when the link
  // provably targets exactly one `#task` line, else null. `liveDoc` is a
  // `taskLinkMarkLiveDocModel` of the editor's own document; when the
  // link targets that same file it is authoritative (a same-note status
  // change shows before any save). `title` is the target's raw task text
  // or null. Never throws.
  taskLinkMarkResolve(input) {
    try {
      const options = input && typeof input === "object" ? input : {};
      const id = String(options.blockId || "");
      if (id === "" || !/^[A-Za-z0-9-]+$/u.test(id)) {
        return null;
      }
      const sourcePath = String(options.sourcePath || "");
      const targetPath = this.taskLinkMarkResolvePath(options.linkpath, sourcePath);
      if (!targetPath) {
        return null;
      }
      const key = targetPath + "\u0000" + id;
      const done = (hit) =>
        hit ? Object.freeze({ key, state: hit.state, title: hit.title, targetPath }) : null;
      if (options.liveDoc && sourcePath !== "" && sameVaultPath(targetPath, sourcePath)) {
        return done(
          taskLinkMarkLiveLookup(options.liveDoc, id, (symbol) =>
            this.taskLinkMarkStatusTypeFor(symbol),
          ),
        );
      }
      const memo = this.taskLinkMarkFromMemo(key);
      if (memo !== undefined) {
        return done(memo);
      }
      return done(this.taskLinkMarkFromCache(targetPath, id));
    } catch (error) {
      return null;
    }
  }
}
