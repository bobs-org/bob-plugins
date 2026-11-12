// Album and record entry points for the Schema Card (schema-entrypoints).
// One shared resolver: direct album paths resolve through the report;
// record notes resolve their actual parent link through Obsidian metadata
// and then a report album identity. Scalar/list/wikilink forms and legacy
// record types reuse the existing helpers; missing, cyclic, ambiguous, or
// non-album parents teach instead of guessing. Header and palette share
// `openAlbumSchemaEntry`; no extra subprocess service. Opening an invalid
// album still shows lint and the YAML path.
const ALBUM_SCHEMA_ENTRY_NON_RECORD_TYPES = new Set([
  "area",
  "project",
  "notebook",
  "ref",
  "article",
  "mail",
  "day",
  "done",
  "type",
]);

function albumSchemaEntryKindOf(frontmatter) {
  const names = typeof albumTypeNames === "function"
    ? albumTypeNames(frontmatter && typeof frontmatter === "object" ? frontmatter.type : undefined)
    : [];
  if (names.includes("album")) return "album";
  if (
    names.includes("area") ||
    names.includes("project") ||
    names.includes("notebook") ||
    names.includes("ref")
  ) {
    return "other";
  }
  if (names.includes("record")) return "record";
  if (names.some((name) => !ALBUM_SCHEMA_ENTRY_NON_RECORD_TYPES.has(name))) return "record";
  return "other";
}

function albumSchemaEntryParentTarget(rawParent) {
  if (rawParent === null || rawParent === undefined) return "";
  try {
    if (typeof pomodoroHomeParentTarget === "function") return pomodoroHomeParentTarget(rawParent);
  } catch (_) {}
  if (typeof rawParent !== "string") return "";
  const text = rawParent.trim();
  const match = /^\[\[([^\]]*)\]\]$/.exec(text);
  if (!match) return "";
  return String(match[1] || "").split("|")[0].split("#")[0].trim().replace(/\.md$/i, "").trim();
}

function albumSchemaEntryReportAlbum(report, albumPath) {
  const path = typeof albumHeaderPath === "function" ? albumHeaderPath(albumPath) : String(albumPath || "");
  if (!report || !path) return null;
  if (report.albumsByPath instanceof Map) return report.albumsByPath.get(path) || null;
  return (Array.isArray(report.albums) ? report.albums : []).find((entry) => {
    try {
      return (typeof albumHeaderPath === "function" ? albumHeaderPath(entry?.path) : entry?.path) === path;
    } catch (_) {
      return false;
    }
  }) || null;
}

function albumResolveSchemaTargetForFile(filePath, context = {}) {
  const normalized = typeof albumHeaderPath === "function" ? albumHeaderPath(filePath) : String(filePath || "").replace(/\\/g, "/");
  if (!normalized) return { ok: false, reason: "missing-path", message: "No active note to resolve." };
  const frontmatter = context.frontmatter && typeof context.frontmatter === "object" ? context.frontmatter : {};
  const kind = albumSchemaEntryKindOf(frontmatter);
  const report = context.report || null;
  const stem = normalized.split("/").pop().replace(/\.md$/i, "");
  if (kind === "album") {
    const entry = albumSchemaEntryReportAlbum(report, normalized);
    if (!entry) {
      return {
        ok: false, reason: "not-in-report", kind,
        filePath: normalized,
        message: `${stem || "This note"} is not in the album report — run Sync albums and retry.`,
      };
    }
    return { ok: true, kind: "album", albumPath: normalized, filePath: normalized };
  }
  if (kind === "record") {
    const rawParent = frontmatter.parent;
    if (rawParent === null || rawParent === undefined || (typeof rawParent === "string" && !rawParent.trim()) || (Array.isArray(rawParent) && rawParent.length === 0)) {
      return {
        ok: false, reason: "missing-parent", kind,
        filePath: normalized,
        message: `${stem || "This record"} has no parent link — set parent: [[album]] to edit its album schema.`,
      };
    }
    const target = albumSchemaEntryParentTarget(rawParent);
    if (!target) {
      return {
        ok: false, reason: "ambiguous-parent", kind,
        filePath: normalized,
        message: `${stem || "This record"}'s parent link is ambiguous — use a single [[album]] wikilink.`,
      };
    }
    let resolvedPath = "";
    try {
      const resolved = typeof albumHeaderResolveFile === "function"
        ? albumHeaderResolveFile(target, normalized, context.metadataCache, context.vault)
        : null;
      resolvedPath = resolved && resolved.path
        ? (typeof albumHeaderPath === "function" ? albumHeaderPath(resolved.path) : String(resolved.path))
        : "";
    } catch (_) {
      resolvedPath = "";
    }
    if (!resolvedPath) {
      try {
        const guessed = /\.md$/i.test(target) ? target : `${target}.md`;
        const file = context.vault?.getAbstractFileByPath?.(guessed);
        if (file && file.path) {
          resolvedPath = typeof albumHeaderPath === "function" ? albumHeaderPath(file.path) : String(file.path);
        }
      } catch (_) {}
    }
    try {
      const vault = context.vault;
      const metadataCache = context.metadataCache;
      let exists = false;
      if (resolvedPath && vault && typeof vault.getAbstractFileByPath === "function") {
        try { exists = Boolean(vault.getAbstractFileByPath(resolvedPath)); } catch (_) { exists = false; }
      }
      if (!exists && resolvedPath && metadataCache && typeof metadataCache.getFirstLinkpathDest === "function") {
        try {
          const found = metadataCache.getFirstLinkpathDest(target, filePath);
          if (found && found.path) {
            resolvedPath = typeof albumHeaderPath === "function" ? albumHeaderPath(found.path) : String(found.path);
            exists = true;
          }
        } catch (_) {}
      }
      if (!exists) resolvedPath = "";
    } catch (_) { resolvedPath = ""; }
    if (!resolvedPath) {
      return {
        ok: false, reason: "missing-parent", kind,
        filePath: normalized, parentTarget: target,
        message: `${stem || "This record"}'s parent [[${target}]] could not be found — check the parent link.`,
      };
    }
    if (resolvedPath.toLocaleLowerCase() === normalized.toLocaleLowerCase()) {
      return {
        ok: false, reason: "cyclic-parent", kind,
        filePath: normalized, albumPath: resolvedPath,
        message: `${stem || "This record"} links to itself as its parent — fix parent to an album.`,
      };
    }
    const entry = albumSchemaEntryReportAlbum(report, resolvedPath);
    if (!entry) {
      const parentStem = resolvedPath.split("/").pop().replace(/\.md$/i, "");
      return {
        ok: false, reason: "non-album-parent", kind,
        filePath: normalized, albumPath: resolvedPath,
        message: `${stem || "This record"}'s parent ${parentStem || resolvedPath} is not an album — records hang under an album.`,
      };
    }
    return { ok: true, kind: "record-parent", albumPath: resolvedPath, filePath: normalized };
  }
  return {
    ok: false, reason: "not-album-or-record", kind,
    filePath: normalized,
    message: `${stem || "This note"} is not an album or record note — open an album or its record.`,
  };
}

function albumSchemaEntryTeach(resolution) {
  if (resolution && typeof resolution.message === "string" && resolution.message) return resolution.message;
  return "Open an album or its record to edit the album schema.";
}

class BobLedgerToolsAlbumEntryMixin {
  setupAlbumSchemaEntrypoints() {
    if (this.albumSchemaEntrypointsActive) return;
    this.albumSchemaEntrypointsActive = true;
    try {
      this.addCommand({
        id: "edit-album-schema",
        name: "Edit album schema",
        callback: () => {
          void this.openAlbumSchemaEntry();
        },
      });
    } catch (_) {}
  }

  teardownAlbumSchemaEntrypoints() {
    this.albumSchemaEntrypointsActive = false;
  }

  albumSchemaEntryActiveFilePath(overridePath = "") {
    if (overridePath) {
      try {
        return typeof albumHeaderPath === "function" ? albumHeaderPath(overridePath) : String(overridePath);
      } catch (_) {
        return String(overridePath);
      }
    }
    try {
      const view = typeof this.getActiveMarkdownView === "function"
        ? this.getActiveMarkdownView()
        : this.app?.workspace?.getActiveViewOfType?.(MarkdownView);
      if (view && view.file && view.file.path) return view.file.path;
    } catch (_) {}
    try {
      const leaf = this.app?.workspace?.activeLeaf;
      const file = leaf?.view?.file;
      if (file && file.path) return file.path;
    } catch (_) {}
    return "";
  }

  albumSchemaEntryTargetForFile(filePath) {
    const normalized = typeof albumHeaderPath === "function" ? albumHeaderPath(filePath) : String(filePath || "");
    let frontmatter = {};
    try {
      const file = this.app?.vault?.getAbstractFileByPath?.(normalized);
      const cache = file ? this.app?.metadataCache?.getFileCache?.(file) : null;
      if (cache && cache.frontmatter && typeof cache.frontmatter === "object") frontmatter = cache.frontmatter;
    } catch (_) {}
    let report = null;
    try {
      const state = typeof this.albumReportState === "function" ? this.albumReportState() : null;
      report = (state && state.report) || this.albumReport || null;
    } catch (_) {
      report = this.albumReport || null;
    }
    return albumResolveSchemaTargetForFile(normalized, {
      frontmatter,
      metadataCache: this.app?.metadataCache,
      vault: this.app?.vault,
      report,
    });
  }

  async openAlbumSchemaEntry(options = {}) {
    if (typeof this.albumHeaderDesktop === "function" && !this.albumHeaderDesktop()) {
      try { new Notice("Schema editing needs desktop Obsidian."); } catch (_) {}
      return { ok: false, reason: "mobile" };
    }
    const filePath = this.albumSchemaEntryActiveFilePath(options.filePath || options.albumPath || "");
    if (!filePath) {
      try { new Notice("No active markdown note."); } catch (_) {}
      return { ok: false, reason: "missing-path" };
    }
    const target = this.albumSchemaEntryTargetForFile(filePath);
    if (!target.ok) {
      try { new Notice(albumSchemaEntryTeach(target)); } catch (_) {}
      return target;
    }
    let reportState = null;
    try {
      reportState = typeof this.albumReportState === "function" ? this.albumReportState() : null;
    } catch (_) {}
    if (!reportState || !reportState.report || reportState.unavailable) {
      try { new Notice("Album data is unavailable — run Sync albums and retry."); } catch (_) {}
      return { ok: false, reason: "unavailable", albumPath: target.albumPath };
    }
    let model = null;
    try {
      model = typeof this.albumHeaderModelFor === "function" ? this.albumHeaderModelFor(target.albumPath) : null;
    } catch (_) {
      model = null;
    }
    if (!model) {
      try { new Notice("That album is no longer available — it may have been deleted or retyped."); } catch (_) {}
      return { ok: false, reason: "unavailable", albumPath: target.albumPath };
    }
    try {
      return this.openAlbumSchemaCard(model, target.albumPath);
    } catch (error) {
      try { new Notice("Could not open the Schema Card."); } catch (_) {}
      return { ok: false, reason: "open-failed", albumPath: target.albumPath };
    }
  }
}
