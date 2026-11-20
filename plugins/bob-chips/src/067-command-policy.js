// Command-chip run eligibility: which source notes, hosts, and engines may
// run a chip, plus fresh source checks for activation. Decisions read the
// chip's actual source note, never the active leaf. Nothing here spawns,
// copies, or writes.

// Root folders whose notes hold text Bryan did not author. A chip in one of
// them only copies. Compared case-insensitively, because the vault also
// lives on a case-insensitive macOS file system.
const COMMAND_CHIP_NO_RUN_ROOTS = copyChipFreeze(["mail", "ref", "ref_history", ".bob", "_conflicts"]);
const COMMAND_CHIP_SOURCE_UNKNOWN = "source note unknown";
const COMMAND_CHIP_MOBILE_REASON = "commands run only on desktop";
const COMMAND_CHIP_ENGINE_ID = "bob-command-mode";
const COMMAND_CHIP_ENGINE_MISSING = "Command Mode is not enabled";
const COMMAND_CHIP_ENGINE_OLD = "Command Mode is too old for command chips";
const COMMAND_CHIP_SOURCE_CHANGED = "source changed";

let CommandChipsPlatform = null;
try {
  const obsidian = require("obsidian");
  CommandChipsPlatform = (obsidian && obsidian.Platform) || null;
} catch (error) {
  CommandChipsPlatform = null;
}

// A vault-relative note path, or why it is not one. Absolute paths, drive
// letters, backslashes, control characters, and empty, `.`, or `..`
// components are refused rather than normalized: an odd path is unknown.
function commandChipNormalizeSourcePath(path) {
  try {
    if (typeof path !== "string" || path === "") {
      return copyChipFreeze({ ok: false, path: null, reason: COMMAND_CHIP_SOURCE_UNKNOWN });
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f\\]/.test(path) || path[0] === "/" || /^[A-Za-z]:/.test(path)) {
      return copyChipFreeze({ ok: false, path: null, reason: COMMAND_CHIP_SOURCE_UNKNOWN });
    }
    const parts = path.split("/");
    if (parts.some((part) => part === "" || part === "." || part === "..")) {
      return copyChipFreeze({ ok: false, path: null, reason: COMMAND_CHIP_SOURCE_UNKNOWN });
    }
    return copyChipFreeze({ ok: true, path, reason: null });
  } catch (error) {
    return copyChipFreeze({ ok: false, path: null, reason: COMMAND_CHIP_SOURCE_UNKNOWN });
  }
}

// The no-run root a normalized path sits under (its canonical spelling), or
// null. Only the first component counts: `notes/ref/x.md` may run.
function commandChipNoRunRoot(path) {
  try {
    const normalized = commandChipNormalizeSourcePath(path);
    if (!normalized.ok) return null;
    const root = normalized.path.split("/")[0].toLowerCase();
    for (const candidate of COMMAND_CHIP_NO_RUN_ROOTS) {
      if (root === candidate) return candidate;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Pure source-path verdict: frozen `{ mode: "run" | "copy", reason, path }`.
function commandChipSourcePolicy(path) {
  try {
    const normalized = commandChipNormalizeSourcePath(path);
    if (!normalized.ok) {
      return copyChipFreeze({ mode: "copy", reason: normalized.reason, path: null });
    }
    const root = commandChipNoRunRoot(normalized.path);
    if (root) {
      return copyChipFreeze({
        mode: "copy",
        reason: "notes under " + root + "/ never run commands",
        path: normalized.path,
      });
    }
    return copyChipFreeze({ mode: "run", reason: null, path: normalized.path });
  } catch (error) {
    return copyChipFreeze({ mode: "copy", reason: COMMAND_CHIP_SOURCE_UNKNOWN, path: null });
  }
}

function commandChipIsMobile(app) {
  try {
    if (app && app.isMobile === true) return true;
    const platform = CommandChipsPlatform;
    return Boolean(platform && (platform.isMobile === true || platform.isMobileApp === true));
  } catch (error) {
    return false;
  }
}

// The live Command Mode namespace, looked up fresh on every call so a
// disabled, reloaded, or replaced engine is never used by mistake. Frozen
// `{ engine, reason }`; `engine` is null when chips cannot run.
function commandChipEngineOf(app) {
  try {
    const registry = app && app.plugins;
    const enabled = registry && registry.enabledPlugins;
    if (enabled && typeof enabled.has === "function" && !enabled.has(COMMAND_CHIP_ENGINE_ID)) {
      return copyChipFreeze({ engine: null, reason: COMMAND_CHIP_ENGINE_MISSING });
    }
    const plugin = registry && registry.plugins ? registry.plugins[COMMAND_CHIP_ENGINE_ID] : null;
    const api = plugin && plugin.api;
    const engine = api && api.commandMode;
    if (!engine) return copyChipFreeze({ engine: null, reason: COMMAND_CHIP_ENGINE_MISSING });
    if (
      !(Number(engine.version) >= 1) ||
      typeof engine.resolve !== "function" ||
      typeof engine.runText !== "function" ||
      typeof engine.openText !== "function"
    ) {
      return copyChipFreeze({ engine: null, reason: COMMAND_CHIP_ENGINE_OLD });
    }
    return copyChipFreeze({ engine, reason: null });
  } catch (error) {
    return copyChipFreeze({ engine: null, reason: COMMAND_CHIP_ENGINE_MISSING });
  }
}

// A link or path resolved through the vault, never guessed: the target
// file's path, or null when the vault cannot resolve it to one note.
function commandChipResolveSourceLink(app, linktext, fromPath) {
  try {
    if (typeof linktext !== "string" || linktext.trim() === "") return null;
    const cache = app && app.metadataCache;
    if (!cache || typeof cache.getFirstLinkpathDest !== "function") return null;
    // `Note#Heading|Alias` and `Note#^block` name the note `Note`.
    const linkpath = linktext.trim().replace(/\|.*$/, "").replace(/#.*$/, "").trim();
    if (linkpath === "") return null;
    const file = cache.getFirstLinkpathDest(linkpath, typeof fromPath === "string" ? fromPath : "");
    return file && typeof file.path === "string" ? file.path : null;
  } catch (error) {
    return null;
  }
}

// True when the vault knows `path` as a note (not a folder). Without a vault
// lookup API the path is taken as given; the source policy still applies.
function commandChipSourceExists(app, path) {
  try {
    const vault = app && app.vault;
    if (!vault || typeof vault.getAbstractFileByPath !== "function") return true;
    const file = vault.getAbstractFileByPath(path);
    if (!file) return false;
    return !Array.isArray(file.children);
  } catch (error) {
    return false;
  }
}

// The source path an activation context names right now: a renderer's
// fresh reader (for example the editor's current file) wins over the path
// captured at render time.
function commandChipContextSourcePath(ctx) {
  try {
    if (!ctx || typeof ctx !== "object") return null;
    if (typeof ctx.resolveSourcePath === "function") {
      const fresh = ctx.resolveSourcePath();
      return typeof fresh === "string" ? fresh : null;
    }
    return typeof ctx.sourcePath === "string" ? ctx.sourcePath : null;
  } catch (error) {
    return null;
  }
}

// Everything that decides run versus copy for one activation context:
// frozen `{ mode: "run" | "copy", reason, sourcePath, engine }`. A query
// result runs only when its renderer verified the owning note
// (`ctx.sourceVerified === true`), so a dashboard's own path never
// authorizes text rendered from another note.
function commandChipEligibility(app, ctx) {
  try {
    const c = ctx && typeof ctx === "object" ? ctx : {};
    const copy = (reason, sourcePath) => copyChipFreeze({
      mode: "copy",
      reason: String(reason || COMMAND_CHIP_SOURCE_UNKNOWN),
      sourcePath: sourcePath || null,
      engine: null,
    });
    if (c.origin === "query" && c.sourceVerified !== true) return copy(COMMAND_CHIP_SOURCE_UNKNOWN, null);
    const source = commandChipSourcePolicy(commandChipContextSourcePath(c));
    if (source.mode !== "run") return copy(source.reason, source.path);
    if (!commandChipSourceExists(app, source.path)) return copy(COMMAND_CHIP_SOURCE_UNKNOWN, null);
    if (commandChipIsMobile(app)) return copy(COMMAND_CHIP_MOBILE_REASON, source.path);
    const found = commandChipEngineOf(app);
    if (!found.engine) return copy(found.reason, source.path);
    return copyChipFreeze({ mode: "run", reason: null, sourcePath: source.path, engine: found.engine });
  } catch (error) {
    return copyChipFreeze({ mode: "copy", reason: COMMAND_CHIP_SOURCE_UNKNOWN, sourcePath: null, engine: null });
  }
}

function commandChipSourceVerdict(ok, reason) {
  return copyChipFreeze({ ok: Boolean(ok), reason: ok ? null : String(reason || COMMAND_CHIP_SOURCE_CHANGED) });
}

// Live Preview: the exact document slice `[from, to)`, delimiters included,
// must still equal `raw`. Identical text elsewhere never counts.
function commandChipLiveSourceCheck(view, range) {
  try {
    const r = range && typeof range === "object" ? range : null;
    if (!r || !Number.isInteger(r.from) || !Number.isInteger(r.to) || typeof r.raw !== "string") {
      return commandChipSourceVerdict(false);
    }
    const state = view && view.state;
    if (!state) return commandChipSourceVerdict(false);
    const length = state.doc && Number.isInteger(state.doc.length) ? state.doc.length : null;
    if (r.from < 0 || r.to < r.from || (length !== null && r.to > length)) return commandChipSourceVerdict(false);
    let slice = null;
    if (typeof state.sliceDoc === "function") slice = state.sliceDoc(r.from, r.to);
    else if (state.doc && typeof state.doc.sliceString === "function") slice = state.doc.sliceString(r.from, r.to);
    return commandChipSourceVerdict(slice === r.raw);
  } catch (error) {
    return commandChipSourceVerdict(false);
  }
}

// Reading view and other text sources: line `line` (zero-based) of `text`
// must still hold `raw` at the line-relative `[from, to)`.
function commandChipTextSourceCheck(text, snapshot) {
  try {
    const s = snapshot && typeof snapshot === "object" ? snapshot : null;
    if (typeof text !== "string" || !s || typeof s.raw !== "string") return commandChipSourceVerdict(false);
    if (!Number.isInteger(s.line) || !Number.isInteger(s.from) || !Number.isInteger(s.to)) {
      return commandChipSourceVerdict(false);
    }
    const lines = text.split("\n");
    if (s.line < 0 || s.line >= lines.length) return commandChipSourceVerdict(false, "source disappeared");
    const lineText = lines[s.line].replace(/\r$/, "");
    if (s.from < 0 || s.to < s.from || s.to > lineText.length) return commandChipSourceVerdict(false);
    return commandChipSourceVerdict(lineText.slice(s.from, s.to) === s.raw);
  } catch (error) {
    return commandChipSourceVerdict(false);
  }
}

function commandChipNormalizeSourceResult(value) {
  if (value === true) return commandChipSourceVerdict(true);
  if (value && typeof value === "object" && typeof value.ok === "boolean") {
    return commandChipSourceVerdict(value.ok, value.reason);
  }
  return commandChipSourceVerdict(false);
}

// Run the context's freshest source check. Precedence: the renderer's
// `checkSource()`; Live Preview's `view` plus absolute `range`; a
// `readSource()` text reader plus line-relative `snapshot`; otherwise no
// evidence exists and the span is accepted as rendered. Returns a verdict or
// a Promise of one; a throwing or rejecting checker reads as changed.
function commandChipCheckSource(ctx) {
  try {
    const c = ctx && typeof ctx === "object" ? ctx : {};
    if (typeof c.checkSource === "function") {
      const value = c.checkSource();
      if (value && typeof value.then === "function") {
        return Promise.resolve(value).then(commandChipNormalizeSourceResult, () => commandChipSourceVerdict(false));
      }
      return commandChipNormalizeSourceResult(value);
    }
    if (c.view && c.range) return commandChipLiveSourceCheck(c.view, c.range);
    if (typeof c.readSource === "function" && c.snapshot) {
      const text = c.readSource();
      if (text && typeof text.then === "function") {
        return Promise.resolve(text).then(
          (value) => commandChipTextSourceCheck(value, c.snapshot),
          () => commandChipSourceVerdict(false),
        );
      }
      return commandChipTextSourceCheck(text, c.snapshot);
    }
    return commandChipSourceVerdict(true);
  } catch (error) {
    return commandChipSourceVerdict(false);
  }
}
