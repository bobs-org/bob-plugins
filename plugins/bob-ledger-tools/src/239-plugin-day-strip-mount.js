// Day strip Live Preview mount: one block widget at the canonical
// daily note's document end. The StateField and refresh effect are
// created lazily so loading the plugin keeps the existing eager
// StateEffect.define() count unchanged.
let dayStripMountRefresh = null;
const DAY_STRIP_MOUNT_FENCE_MEMO =
  typeof WeakMap === "function" ? new WeakMap() : null;

function ensureDayStripMountRefresh() {
  if (dayStripMountRefresh) return dayStripMountRefresh;
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      dayStripMountRefresh = StateEffect.define();
    }
  } catch (error) {
    dayStripMountRefresh = null;
  }
  return dayStripMountRefresh;
}

function dayStripMountDocLine(doc, number) {
  try {
    if (!doc || typeof doc.line !== "function") return "";
    const line = doc.line(number);
    return line && typeof line.text === "string" ? line.text : "";
  } catch (error) {
    return "";
  }
}

// Only scan on a new CodeMirror document. Refresh effects, path changes,
// and Live Preview flips reuse the fence result for the same doc/day.
function dayStripMountOwnFence(doc, day) {
  if (!doc || typeof doc !== "object") {
    return dayStripMountScanOwnFence(doc, day);
  }
  try {
    let byDay = DAY_STRIP_MOUNT_FENCE_MEMO
      ? DAY_STRIP_MOUNT_FENCE_MEMO.get(doc)
      : null;
    if (!byDay) {
      byDay = new Map();
      if (DAY_STRIP_MOUNT_FENCE_MEMO) DAY_STRIP_MOUNT_FENCE_MEMO.set(doc, byDay);
    }
    if (byDay.has(day)) return byDay.get(day);
    const result = dayStripMountScanOwnFence(doc, day);
    byDay.set(day, result);
    return result;
  } catch (error) {
    return dayStripMountScanOwnFence(doc, day);
  }
}

function dayStripMountScanOwnFence(doc, day) {
  try {
    const lines = doc && Number.isInteger(doc.lines) ? doc.lines : 0;
    if (!lines || typeof doc.line !== "function") return false;
    for (let number = 1; number <= lines; number += 1) {
      const opener = /^ {0,3}(\x60{3,})bob-day-stats(?:[ \t]+.*)?$/.exec(
        dayStripMountDocLine(doc, number),
      );
      if (!opener) continue;
      const ticks = opener[1].length;
      const body = [];
      for (number += 1; number <= lines; number += 1) {
        const text = dayStripMountDocLine(doc, number);
        if (new RegExp("^ {0,3}\\x60{" + ticks + ",}[ \\t]*$").test(text)) break;
        body.push(text);
      }
      const bodyText = body.join("\n");
      const declaresDay = /(?:^|\n)\s*day\s*:/i.test(bodyText);
      if (!declaresDay || dayStripParseFenceDay(bodyText) === day) return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function dayStripMountPathForState(state) {
  try {
    const info = state && typeof state.field === "function"
      ? state.field(editorInfoField)
      : null;
    const path = info && info.file && typeof info.file.path === "string"
      ? info.file.path
      : "";
    return path || null;
  } catch (error) {
    return null;
  }
}

function dayStripMountLiveForState(state) {
  try {
    return Boolean(
      state && typeof state.field === "function" &&
      state.field(editorLivePreviewField) === true,
    );
  } catch (error) {
    return false;
  }
}

function dayStripMountDecorationEnd(decorations) {
  try {
    if (!decorations || typeof decorations.iter !== "function") return null;
    const cursor = decorations.iter();
    let end = null;
    let guard = 0;
    while (cursor && cursor.value && guard < 10000) {
      guard += 1;
      end = cursor.from;
      cursor.next();
    }
    return end;
  } catch (error) {
    return null;
  }
}

function dayStripMountIsExcludedView(view) {
  try {
    const dom = view && view.dom;
    if (!dom || typeof dom.closest !== "function") return false;
    return Boolean(
      dom.closest(".hover-popover, .markdown-embed, .canvas-node, .canvas-node-content"),
    );
  } catch (error) {
    return false;
  }
}

class DayStripWidget extends WidgetType {
  constructor(plugin, path, day) {
    super();
    this.plugin = plugin;
    this.path = path;
    this.day = day;
    this.record = null;
  }

  eq(other) {
    const same = Boolean(
      other instanceof DayStripWidget &&
      other.path === this.path &&
      other.day === this.day,
    );
    if (same) this.record = other.record;
    return same;
  }

  get estimatedHeight() {
    try {
      return this.plugin.dayStripIsCollapsed() ? 26 : 100;
    } catch (error) {
      return 100;
    }
  }

  ignoreEvent() {
    return true;
  }

  toDOM(view) {
    let doc = null;
    try {
      doc = view && view.dom && view.dom.ownerDocument
        ? view.dom.ownerDocument
        : typeof document !== "undefined"
          ? document
          : null;
    } catch (error) {
      doc = null;
    }
    let host = null;
    try {
      host = doc && typeof doc.createElement === "function"
        ? doc.createElement("div")
        : null;
    } catch (error) {
      host = null;
    }
    if (!host) return host;
    try {
      host.className = "bob-day-strip-live-host";
    } catch (error) {
      // Class assignment is cosmetic.
    }
    if (dayStripMountIsExcludedView(view)) {
      try {
        host.hidden = true;
        host.setAttribute("aria-hidden", "true");
      } catch (error) {
        // A hidden empty host is the safest fallback in unsupported DOMs.
      }
      return host;
    }
    try {
      const record = {
        el: host,
        day: this.day,
        path: this.path,
        kind: "live",
        editorView: view || null,
        observer: null,
        visible: true,
      };
      this.record = record;
      this.plugin.dayStripViewsStore().add(record);
      this.plugin.dayStripObserve(record);
      // The synchronous paint uses the shared cache and never spawns.
      this.plugin.dayStripPaint(record);
      // Any required fetch is still behind the registry's visibility,
      // dirty, and aged gates.
      this.plugin.dayStripCheck(record);
    } catch (error) {
      // A failing strip never breaks the editor.
    }
    return host;
  }

  destroy() {
    try {
      if (this.record && typeof this.plugin.dayStripReleaseRecord === "function") {
        this.plugin.dayStripReleaseRecord(this.record);
      }
    } catch (error) {
      // Widget cleanup is best-effort.
    }
    this.record = null;
  }
}

class BobLedgerToolsDayStripMountMixin {
  setupDayStripMount() {
    try {
      if (typeof this.dayStripSessionEnabled !== "boolean") {
        this.dayStripSessionEnabled = true;
      }
      if (this.dayStripMountSetup === true) return;
      this.dayStripMountSetup = true;
      this.dayStripConfigLastEnabled = this.dayStripConfigEnabled();
      if (typeof this.addCommand === "function") {
        this.addCommand({
          id: "toggle-day-stats",
          name: "Toggle Day stats",
          callback: () => this.toggleDayStripMount(),
        });
      }
      const extension = this.createDayStripMountExtension();
      if (extension && typeof this.registerEditorExtension === "function") {
        this.registerEditorExtension(extension);
      }
      try {
        if (
          typeof window !== "undefined" &&
          window &&
          typeof window.setInterval === "function" &&
          typeof this.registerInterval === "function"
        ) {
          this.registerInterval(
            window.setInterval(() => this.dayStripCheckConfig(), 60 * 1000),
          );
        }
      } catch (error) {
        // Config polling is best-effort; editor transactions still read the key.
      }
    } catch (error) {
      // Setup never breaks plugin startup.
    }
  }

  dayStripConfigEnabled() {
    try {
      return statsReadConfigValue("day_strip") !== false;
    } catch (error) {
      return true;
    }
  }

  dayStripCheckConfig() {
    try {
      const enabled = this.dayStripConfigEnabled();
      if (enabled === this.dayStripConfigLastEnabled) return false;
      this.dayStripConfigLastEnabled = enabled;
      this.refreshDayStripMountEditors();
      return true;
    } catch (error) {
      return false;
    }
  }

  createDayStripMountExtension() {
    try {
      if (
        !StateField ||
        typeof StateField.define !== "function" ||
        !Decoration ||
        typeof Decoration.widget !== "function" ||
        typeof Decoration.set !== "function" ||
        !WidgetType ||
        !EditorView ||
        !EditorView.decorations ||
        typeof EditorView.decorations.from !== "function" ||
        !editorInfoField ||
        !editorLivePreviewField
      ) {
        return null;
      }
      if (this.dayStripMountField) return this.dayStripMountField;
      const plugin = this;
      this.dayStripMountField = StateField.define({
        create(state) {
          return plugin.dayStripMountFieldValue(null, state, null, false);
        },
        update(value, transaction) {
          return plugin.dayStripMountFieldUpdate(value, transaction);
        },
        provide: (field) => EditorView.decorations.from(field),
      });
      return this.dayStripMountField;
    } catch (error) {
      return null;
    }
  }

  dayStripMountFieldValue(previous, state, mapped, docChanged) {
    const doc = state && state.doc ? state.doc : null;
    const path = dayStripMountPathForState(state);
    const day = path ? dayStripDayForPath(path) : null;
    let active = false;
    try {
      const localToday = this.dayStripLocalNow();
      active = Boolean(
        day &&
        localToday &&
        day <= localToday &&
        dayStripMountLiveForState(state) &&
        this.dayStripCanSpawn() &&
        this.dayStripSessionEnabled !== false &&
        this.dayStripConfigEnabled() &&
        !dayStripMountOwnFence(doc, day),
      );
    } catch (error) {
      active = false;
    }
    let decorations = Decoration && Decoration.none ? Decoration.none : null;
    if (active) {
      const sameIdentity = Boolean(
        previous && previous.path === path && previous.day === day,
      );
      const oldEnd = dayStripMountDecorationEnd(mapped);
      if (sameIdentity && oldEnd === (doc ? doc.length : 0)) {
        decorations = mapped;
      } else {
        decorations = this.dayStripMountDecoration(path, day, doc);
      }
    }
    return { path, day, decorations };
  }

  dayStripMountDecoration(path, day, doc) {
    try {
      const widget = new DayStripWidget(this, path, day);
      const decoration = Decoration.widget({
        widget,
        block: true,
        side: 1,
      });
      const position = doc && Number.isInteger(doc.length) ? doc.length : 0;
      return Decoration.set([decoration.range(position)], true);
    } catch (error) {
      return Decoration && Decoration.none ? Decoration.none : null;
    }
  }

  dayStripMountFieldUpdate(value, transaction) {
    try {
      const tr = transaction && typeof transaction === "object" ? transaction : {};
      const state = tr.state || null;
      const startState = tr.startState || null;
      const docChanged = tr.docChanged === true;
      const nextPath = dayStripMountPathForState(state);
      const nextDay = nextPath ? dayStripDayForPath(nextPath) : null;
      let liveChanged = false;
      try {
        liveChanged =
          dayStripMountLiveForState(startState) !==
          dayStripMountLiveForState(state);
      } catch (error) {
        liveChanged = false;
      }
      const pathChanged = !value || value.path !== nextPath || value.day !== nextDay;
      const refresh = this.dayStripMountHasRefresh(tr);
      if (!docChanged && !liveChanged && !pathChanged && !refresh) return value;
      let mapped = value && value.decorations;
      if (docChanged && mapped && tr.changes && typeof mapped.map === "function") {
        try {
          mapped = mapped.map(tr.changes);
        } catch (error) {
          mapped = null;
        }
      }
      return this.dayStripMountFieldValue(value, state, mapped, docChanged);
    } catch (error) {
      return value || {
        path: null,
        day: null,
        decorations: Decoration && Decoration.none ? Decoration.none : null,
      };
    }
  }

  dayStripMountHasRefresh(transaction) {
    try {
      if (!dayStripMountRefresh) return false;
      const effects = transaction && transaction.effects;
      const list = Array.isArray(effects) ? effects : effects ? [effects] : [];
      return list.some((effect) => {
        try {
          return effect && typeof effect.is === "function" && effect.is(dayStripMountRefresh);
        } catch (error) {
          return false;
        }
      });
    } catch (error) {
      return false;
    }
  }

  toggleDayStripMount() {
    try {
      this.dayStripSessionEnabled = this.dayStripSessionEnabled === false;
      const enabled = this.dayStripSessionEnabled;
      this.refreshDayStripMountEditors();
      try {
        new Notice(enabled ? "Day stats on" : "Day stats off");
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return this.dayStripSessionEnabled !== false;
    }
  }

  refreshDayStripMountEditors() {
    try {
      const refresh = ensureDayStripMountRefresh();
      const workspace = this.app && this.app.workspace;
      if (
        !refresh ||
        !workspace ||
        typeof workspace.getLeavesOfType !== "function"
      ) {
        return;
      }
      const leaves = workspace.getLeavesOfType("markdown") || [];
      for (const leaf of leaves) {
        try {
          const cm =
            leaf && leaf.view && leaf.view.editor
              ? leaf.view.editor.cm
              : null;
          if (cm && typeof cm.dispatch === "function") {
            cm.dispatch({ effects: refresh.of(null) });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh is best-effort.
    }
  }
}
