// Reading-view command chips: `run:` code spans that the one Markdown
// post-processor (060-reading.js) turns into real buttons, in Reading view,
// embeds, hover previews, and Tasks/Dataview output. Provenance is resolved
// apart from the payload:
//
// - Ordinary Reading sections, embeds, and hover previews render their own
//   note, so the render context's `sourcePath` names the chip's note.
// - Query output renders through `MarkdownRenderer.render` with whatever
//   path the query plugin passes. Tasks 8.6 renders each row's description
//   with the task's own path, and Dataview 0.5.68 renders each TASK or list
//   item with the item's own path. Those two row hooks are verified.
//   Everything else in a query block (Tasks group headings, Dataview tables,
//   lists, group headers, inline queries, dataviewjs output, other plugins'
//   `block-language-*` output) renders with the dashboard's path, so it is
//   "source note unknown" and only copies.
//
// Origin is read from the button's ancestors at every paint and activation,
// never cached from render time, because Tasks and Dataview attach rows
// after postprocessing. A detached button without section info paints
// copy-only until it is attached. Nothing here runs, copies, or writes.
const COMMAND_CHIP_READING_SOURCE_GONE = "source disappeared";
const COMMAND_CHIP_READING_DETACHED_FRAMES = 30;
const COMMAND_CHIP_READING_MAX_DEPTH = 200;
const commandChipReadingRecords = new WeakMap();

function commandChipReadingParentOf(node) {
  try {
    return (node && (node.parentElement || node.parentNode)) || null;
  } catch (error) {
    return null;
  }
}

function commandChipReadingClassList(node) {
  try {
    const value = node && typeof node.getAttribute === "function" ? node.getAttribute("class") : null;
    const text = typeof value === "string" ? value : node && typeof node.className === "string" ? node.className : "";
    return text.split(/\s+/).filter(Boolean);
  } catch (error) {
    return [];
  }
}

// Which query plugin owns `classes`' element, or null. `block-language-*`
// is any code-block processor's output: another plugin rendered it.
function commandChipReadingQueryAdapter(classes) {
  if (classes.includes("plugin-tasks-query-result") || classes.includes("block-language-tasks")) return "tasks";
  for (const name of ["dataview", "dataview-container", "block-language-dataview", "block-language-dataviewjs"]) {
    if (classes.includes(name)) return "dataview";
  }
  return classes.some((name) => name.startsWith("block-language-")) ? "plugin" : null;
}

function commandChipReadingInPopover(node) {
  let current = node;
  for (let depth = 0; current && depth < COMMAND_CHIP_READING_MAX_DEPTH; depth += 1) {
    const classes = commandChipReadingClassList(current);
    if (classes.includes("hover-popover") || classes.includes("popover")) return true;
    current = commandChipReadingParentOf(current);
  }
  return false;
}

// Where a rendered chip sits, read from its ancestors right now, innermost
// boundary first: frozen `{ origin, adapter, verified, embed, attached }`.
// `origin` is "reading" | "embed" | "hover" | "query"; `verified` is true
// only for the Tasks description and Dataview item hooks.
function commandChipReadingOrigin(host) {
  const done = (fields) => copyChipFreeze({
    origin: "reading",
    adapter: null,
    verified: false,
    embed: null,
    attached: Boolean(host) && host.isConnected !== false,
    ...fields,
  });
  try {
    let node = commandChipReadingParentOf(host);
    let description = false;
    for (let depth = 0; node && depth < COMMAND_CHIP_READING_MAX_DEPTH; depth += 1) {
      const classes = commandChipReadingClassList(node);
      const tag = copyChipReadingTagName(node);
      if (classes.includes("task-description")) description = true;
      if (tag === "LI" && classes.includes("plugin-tasks-list-item")) {
        return done({ origin: "query", adapter: "tasks", verified: description });
      }
      if (tag === "LI" && classes.includes("dataview") &&
        (classes.includes("task-list-item") || classes.includes("task-list-basic-item"))) {
        return done({ origin: "query", adapter: "dataview", verified: true });
      }
      if (classes.includes("internal-embed") || classes.includes("markdown-embed")) {
        return done({ origin: commandChipReadingInPopover(node) ? "hover" : "embed", embed: node });
      }
      if (classes.includes("hover-popover") || classes.includes("popover")) return done({ origin: "hover" });
      const adapter = commandChipReadingQueryAdapter(classes);
      if (adapter) return done({ origin: "query", adapter, verified: false });
      node = commandChipReadingParentOf(node);
    }
    return done({});
  } catch (error) {
    return done({ origin: "query", verified: false });
  }
}

// True when a code element sits inside a nested render (an embed, hover
// preview, or query block) below `root`: that render's own post-processor
// pass owns it, with its own source path.
function commandChipReadingInNestedRender(codeEl, root) {
  try {
    let node = commandChipReadingParentOf(codeEl);
    for (let depth = 0; node && node !== root && depth < COMMAND_CHIP_READING_MAX_DEPTH; depth += 1) {
      const classes = commandChipReadingClassList(node);
      if (
        classes.includes("internal-embed") ||
        classes.includes("markdown-embed") ||
        classes.includes("hover-popover") ||
        commandChipReadingQueryAdapter(classes)
      ) {
        return true;
      }
      node = commandChipReadingParentOf(node);
    }
    return false;
  } catch (error) {
    return true;
  }
}

function commandChipReadingFileAt(app, path) {
  try {
    const vault = app && app.vault;
    if (typeof path !== "string" || !vault || typeof vault.getAbstractFileByPath !== "function") return null;
    const file = vault.getAbstractFileByPath(path);
    return file && typeof file.path === "string" && !Array.isArray(file.children) ? file : null;
  } catch (error) {
    return null;
  }
}

// The chip's note path now: the file captured at render follows renames,
// so a note moved under `ref/` turns copy-only without a re-render.
function commandChipReadingSourcePath(render) {
  try {
    if (render.file && typeof render.file.path === "string") return render.file.path;
    return typeof render.path === "string" ? render.path : null;
  } catch (error) {
    return null;
  }
}

// An embed whose `src` resolves to a different note than the one its
// content was rendered from is a known mismatch.
function commandChipReadingEmbedMismatch(app, embed, renderPath) {
  try {
    let node = embed;
    let src = null;
    for (let depth = 0; node && depth < 4 && src === null; depth += 1) {
      const value = typeof node.getAttribute === "function" ? node.getAttribute("src") : null;
      if (typeof value === "string" && value.trim()) src = value;
      node = commandChipReadingParentOf(node);
    }
    if (src === null) return false;
    const target = commandChipResolveSourceLink(app, src, renderPath || "");
    return Boolean(target) && target !== renderPath;
  } catch (error) {
    return true;
  }
}

function commandChipReadingSection(ctx, el) {
  try {
    if (!ctx || typeof ctx.getSectionInfo !== "function") return null;
    const info = ctx.getSectionInfo(el);
    if (!info || typeof info.text !== "string") return null;
    if (!Number.isInteger(info.lineStart) || !Number.isInteger(info.lineEnd) || info.lineEnd < info.lineStart) return null;
    return info;
  } catch (error) {
    return null;
  }
}

// Everything one post-processor pass knows about its source, shared by the
// command chips it renders.
function commandChipReadingRenderState(plugin, el, ctx) {
  const app = (plugin && plugin.app) || null;
  const path = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : null;
  return {
    plugin,
    app,
    el,
    ctx,
    path,
    file: commandChipReadingFileAt(app, path),
    section: commandChipReadingSection(ctx, el),
    scans: new Map(),
    counts: new Map(),
    seen: new Map(),
    hosts: [],
  };
}

function commandChipReadingKey(chip) {
  return (chip.label === null || chip.label === undefined ? "\u0001" : String(chip.label)) + "\u0000" + String(chip.text);
}

function commandChipReadingLineChips(text, table, lineFrom, lineTo) {
  const lines = String(text).split("\n");
  const out = [];
  const last = Math.min(lineTo, lines.length - 1);
  for (let line = Math.max(0, lineFrom); line <= last; line += 1) {
    const lineText = lines[line].replace(/\r$/, "");
    if (lineText.indexOf("`") === -1) continue;
    for (const chip of chipScanLine(lineText, { table })) {
      if (chip.kind !== "run") continue;
      out.push(copyChipFreeze({ line, from: chip.from, to: chip.to, raw: chip.raw, label: chip.label, text: chip.text }));
    }
  }
  return out;
}

// Count one rendered run chip before any is mounted, so exact evidence is
// attached only when the section holds exactly as many matching spans as
// the renderer produced.
function commandChipReadingCount(render, parsed) {
  const key = commandChipReadingKey(parsed);
  render.counts.set(key, (render.counts.get(key) || 0) + 1);
}

// Exact `{ line, from, to, raw }` for the next rendered chip with this
// payload: the k-th rendered match is the k-th source match in the section.
// Null (no evidence) without section info or when the counts disagree.
function commandChipReadingSnapshotFor(render, parsed) {
  try {
    const key = commandChipReadingKey(parsed);
    const index = render.seen.get(key) || 0;
    render.seen.set(key, index + 1);
    const section = render.section;
    if (!section) return null;
    const scanKey = parsed.table ? "table" : "plain";
    if (!render.scans.has(scanKey)) {
      render.scans.set(scanKey, commandChipReadingLineChips(section.text, Boolean(parsed.table), section.lineStart, section.lineEnd));
    }
    const matches = render.scans.get(scanKey).filter((chip) => commandChipReadingKey(chip) === key);
    if (matches.length !== render.counts.get(key) || !matches[index]) return null;
    const hit = matches[index];
    return copyChipFreeze({ line: hit.line, from: hit.from, to: hit.to, raw: hit.raw });
  } catch (error) {
    return null;
  }
}

// The note's current text, null when the note is gone, or undefined when
// the vault offers no way to tell (no evidence).
async function commandChipReadingReadText(app, path) {
  const vault = app && app.vault;
  if (!vault || typeof vault.getAbstractFileByPath !== "function") return undefined;
  const file = commandChipReadingFileAt(app, path);
  if (!file) return null;
  if (typeof vault.cachedRead === "function") return vault.cachedRead(file);
  if (typeof vault.read === "function") return vault.read(file);
  return undefined;
}

// Fresh activation evidence. Exact evidence compares the source slice; a
// query row or an ambiguous section still needs its chip somewhere in the
// note, so vanished content never runs.
async function commandChipReadingCheckSource(render, record) {
  let text;
  try {
    text = await commandChipReadingReadText(render.app, commandChipReadingSourcePath(render));
  } catch (error) {
    return commandChipSourceVerdict(false);
  }
  if (text === undefined) return commandChipSourceVerdict(true);
  if (typeof text !== "string") return commandChipSourceVerdict(false, COMMAND_CHIP_READING_SOURCE_GONE);
  if (record.snapshot) return commandChipTextSourceCheck(text, record.snapshot);
  const key = commandChipReadingKey(record.parsed);
  const found = commandChipReadingLineChips(text, Boolean(record.parsed.table), 0, Infinity)
    .some((chip) => commandChipReadingKey(chip) === key);
  return commandChipSourceVerdict(found, COMMAND_CHIP_READING_SOURCE_GONE);
}

// Repaint, then ask the Reading view that shows this chip to re-render.
function commandChipReadingRefresh(host, record) {
  try {
    const mount = commandChipMountOf(host);
    if (mount) commandChipMountRepaint(mount, false);
    const workspace = record.render.app && record.render.app.workspace;
    if (!workspace || typeof workspace.getLeavesOfType !== "function") return;
    for (const leaf of workspace.getLeavesOfType("markdown") || []) {
      const view = leaf && leaf.view;
      const container = view && view.containerEl;
      if (!container || typeof container.contains !== "function" || !container.contains(host)) continue;
      const preview = view.previewMode;
      const mode = typeof view.getMode === "function" ? view.getMode() : "preview";
      if (mode === "preview" && preview && typeof preview.rerender === "function") preview.rerender(true);
      return;
    }
  } catch (error) {
    // The next render repaints anyway.
  }
}

// The renderer's fresh activation context for one Reading button.
function commandChipReadingContext(host, record) {
  const render = record.render;
  const where = commandChipReadingOrigin(host);
  record.attached = where.attached;
  const ctx = { origin: where.origin, refresh: () => commandChipReadingRefresh(host, record) };
  const unknown = () => ({ ...ctx, resolveSourcePath: () => null });
  if (where.origin === "query") {
    ctx.sourceVerified = where.verified === true;
    if (!ctx.sourceVerified) return ctx;
  } else if (!where.attached && !render.section) {
    // Probably query output that is not attached yet: unknown until it is.
    return unknown();
  }
  if (where.embed && commandChipReadingEmbedMismatch(render.app, where.embed, render.path)) return unknown();
  ctx.resolveSourcePath = () => commandChipReadingSourcePath(render);
  if (record.snapshot) {
    ctx.line = record.snapshot.line;
    ctx.snapshot = record.snapshot;
  }
  ctx.checkSource = () => commandChipReadingCheckSource(render, record);
  return ctx;
}

function commandChipReadingFrame(callback) {
  try {
    const scope = typeof window !== "undefined" && window ? window : globalThis;
    if (scope && typeof scope.requestAnimationFrame === "function") {
      scope.requestAnimationFrame(callback);
      return;
    }
    setTimeout(callback, 16);
  } catch (error) {
    // A dropped frame leaves the next attach or hover to repaint.
  }
}

// Repaint when the button is attached (Obsidian's `onNodeInserted`, which
// also fires on re-attachment after the Reading view recycles a section),
// for a few frames while it is detached, and on hover or focus after a
// detached paint. Never a MutationObserver.
function commandChipReadingWatchAttach(host, record) {
  const repaint = () => {
    if (record.disposed) return;
    const mount = commandChipMountOf(host);
    if (mount) commandChipMountRepaint(mount, false);
  };
  try {
    if (typeof host.onNodeInserted === "function") {
      const off = host.onNodeInserted(repaint);
      if (typeof off === "function") record.cleanups.push(off);
    }
  } catch (error) {
    // Frames and hover still repaint.
  }
  const onEnter = () => {
    if (record.attached === false) repaint();
  };
  for (const type of ["mouseenter", "focusin"]) {
    try {
      host.addEventListener(type, onEnter);
      record.cleanups.push(() => host.removeEventListener(type, onEnter));
    } catch (error) {
      // Listener wiring is best-effort.
    }
  }
  if (host.isConnected !== false) return;
  let frames = 0;
  const tick = () => {
    if (record.disposed) return;
    frames += 1;
    if (host.isConnected !== false) {
      repaint();
      return;
    }
    if (frames < COMMAND_CHIP_READING_DETACHED_FRAMES) commandChipReadingFrame(tick);
  };
  commandChipReadingFrame(tick);
}

function commandChipReadingUnmount(host) {
  try {
    const record = commandChipReadingRecords.get(host);
    if (record) {
      record.disposed = true;
      for (const cleanup of record.cleanups.splice(0)) {
        try {
          cleanup();
        } catch (error) {
          // Cleanup is best-effort.
        }
      }
      commandChipReadingRecords.delete(host);
    }
    return commandChipUnmount(host);
  } catch (error) {
    return false;
  }
}

// Replace one `run:` code element with a mounted button. `parsed` is
// `{ kind: "run", label, text, table }` from the renderer's textContent.
function commandChipReadingReplaceCode(plugin, codeEl, root, parsed, render) {
  try {
    const ownerDoc = (codeEl && codeEl.ownerDocument) || (root && root.ownerDocument) ||
      (typeof document !== "undefined" ? document : null);
    const host = commandChipBuildInline(ownerDoc, { label: parsed.label, text: parsed.text }, { interactive: true });
    const parent = commandChipReadingParentOf(codeEl);
    if (!host || !parent || typeof parent.replaceChild !== "function") {
      copyChipReadingMarkProcessed(codeEl);
      return false;
    }
    copyChipReadingMarkProcessed(host);
    parent.replaceChild(host, codeEl);
    copyChipReadingMarkProcessed(codeEl);
    const snapshot = commandChipReadingSnapshotFor(render, parsed);
    const record = { render, parsed, snapshot, attached: null, disposed: false, cleanups: [] };
    commandChipReadingRecords.set(host, record);
    render.hosts.push(host);
    commandChipMount(plugin, host, {
      form: "inline",
      label: parsed.label,
      text: parsed.text,
      line: snapshot ? snapshot.line : null,
      from: snapshot ? snapshot.from : null,
      to: snapshot ? snapshot.to : null,
    }, { context: () => commandChipReadingContext(host, record) });
    commandChipReadingWatchAttach(host, record);
    return true;
  } catch (error) {
    copyChipReadingMarkProcessed(codeEl);
    return false;
  }
}

// One render child per post-processor pass owns its buttons' mounts, so an
// embed, hover preview, or query re-render drops its subscriptions.
function commandChipReadingFinish(render) {
  try {
    if (!render || !render.hosts.length) return;
    const hosts = render.hosts;
    const cleanup = () => {
      for (const host of hosts.splice(0)) commandChipReadingUnmount(host);
    };
    const ctx = render.ctx;
    if (CopyChipsMarkdownRenderChild && ctx && typeof ctx.addChild === "function") {
      const child = new CopyChipsMarkdownRenderChild(render.el);
      if (typeof child.register === "function") {
        child.register(cleanup);
      } else {
        const previous = child.onunload;
        child.onunload = function onunload() {
          cleanup();
          return typeof previous === "function" ? previous.call(this) : undefined;
        };
      }
      ctx.addChild(child);
    } else if (render.plugin && typeof render.plugin.register === "function") {
      render.plugin.register(cleanup);
    }
  } catch (error) {
    // Lifecycle scoping is best-effort.
  }
}
