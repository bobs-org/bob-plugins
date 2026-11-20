// Live Preview command chips: the run widget the one copy-chip decoration
// pass emits for `run:` spans. Run state lives in the plugin store, so a
// rebuilt or reused widget paints the current run immediately.

// The note this editor shows, from the widget's own editor info, never the
// globally active leaf. Null when the editor has no file.
function commandChipLiveSourcePath(view) {
  try {
    if (!CopyChipsEditorInfoField || !view || !view.state || typeof view.state.field !== "function") return null;
    const info = view.state.field(CopyChipsEditorInfoField, false);
    const file = info && info.file;
    return file && typeof file.path === "string" ? file.path : null;
  } catch (error) {
    return null;
  }
}

// Ask the decoration pass to rebuild (a stale span after a rewrite).
function commandChipLiveRefresh(view) {
  try {
    const effect = copyChipEnsureLiveRefresh();
    if (effect && view && typeof view.dispatch === "function" && typeof effect.of === "function") {
      view.dispatch({ effects: effect.of(null) });
    }
  } catch (error) {
    // The next decoration pass repaints anyway.
  }
}

// The chipAt-coordinate chip for a Live Preview span: zero-based `line`,
// line-relative `from` / `to` with delimiters.
function commandChipLiveChipOf(widget) {
  return {
    form: "inline",
    label: widget.label,
    text: widget.text,
    line: widget.line,
    from: widget.spanFrom - widget.lineFrom,
    to: widget.spanTo - widget.lineFrom,
  };
}

// Fresh Live Preview activation evidence: the editor's file, the zero-based
// line, and the exact absolute document slice, delimiters included.
function commandChipLiveContext(view, target) {
  return () => ({
    origin: "live",
    view,
    resolveSourcePath: () => commandChipLiveSourcePath(view),
    line: target.line,
    range: { from: target.spanFrom, to: target.spanTo, raw: target.raw },
    refresh: () => commandChipLiveRefresh(view),
  });
}

const commandChipLiveTargets = new WeakMap();

let CommandChipLiveWidgetClass = null;
function commandChipEnsureLiveWidget() {
  if (CommandChipLiveWidgetClass) return CommandChipLiveWidgetClass;
  try {
    if (!CopyChipsWidgetType || typeof CopyChipsWidgetType !== "function") return null;
    CommandChipLiveWidgetClass = class extends CopyChipsWidgetType {
      constructor(model) {
        super();
        const m = model && typeof model === "object" ? model : {};
        this.label = m.label !== undefined ? m.label : null;
        this.text = String(m.text || "");
        this.raw = String(m.raw || "");
        this.spanFrom = Number(m.from);
        this.spanTo = Number(m.to);
        this.lineFrom = Number(m.lineFrom);
        this.line = Number.isInteger(m.line) ? m.line : null;
        this.plugin = m.plugin || null;
      }

      eq(other) {
        return Boolean(
          other instanceof CommandChipLiveWidgetClass &&
            other.label === this.label &&
            other.text === this.text &&
            other.raw === this.raw &&
            other.spanFrom === this.spanFrom &&
            other.spanTo === this.spanTo &&
            other.line === this.line &&
            other.plugin === this.plugin,
        );
      }

      // An edit that only moved the span keeps the DOM, its listeners, and a
      // spinning glyph; the mount follows the span's new place.
      updateDOM(dom) {
        try {
          const target = commandChipLiveTargets.get(dom);
          const mount = commandChipMountOf(dom);
          if (!target || !mount || mount.plugin !== this.plugin) return false;
          if (target.label !== this.label || target.text !== this.text || target.raw !== this.raw) return false;
          target.spanFrom = this.spanFrom;
          target.spanTo = this.spanTo;
          target.lineFrom = this.lineFrom;
          target.line = this.line;
          return commandChipMountRetarget(dom, commandChipLiveChipOf(target));
        } catch (error) {
          return false;
        }
      }

      ignoreEvent() {
        return true;
      }

      toDOM(view) {
        const ownerDoc = (view && view.dom && view.dom.ownerDocument) || (typeof document !== "undefined" ? document : null);
        const host = commandChipBuildInline(ownerDoc, { label: this.label, text: this.text }, { interactive: false });
        if (!host) {
          const fallback = ownerDoc.createElement("span");
          fallback.textContent = this.raw || this.text;
          return fallback;
        }
        const target = {
          label: this.label,
          text: this.text,
          raw: this.raw,
          spanFrom: this.spanFrom,
          spanTo: this.spanTo,
          lineFrom: this.lineFrom,
          line: this.line,
        };
        commandChipLiveTargets.set(host, target);
        commandChipMount(this.plugin, host, commandChipLiveChipOf(target), {
          context: commandChipLiveContext(view, target),
        });
        return host;
      }

      destroy(dom) {
        try {
          commandChipUnmount(dom);
          commandChipLiveTargets.delete(dom);
        } catch (error) {
          // Widget teardown never throws.
        }
      }
    };
    return CommandChipLiveWidgetClass;
  } catch (error) {
    return null;
  }
}
