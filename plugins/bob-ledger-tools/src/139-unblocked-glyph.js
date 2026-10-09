// --- Unblocked hand-off glyph: pure mark-core ---------------------------
// Owned by the epic plan `plan:202610/successor_links.md`
// (bob-cli-5w phase `ledger_glyph`). Pure helpers only: the read-time
// model that finds live Task Links under today's open Pomodoros whose
// task had a prerequisite completed today, the tooltip, a
// listener-free DOM builder, and the Live Preview widget. Every helper
// is synchronous and never throws; bad input yields null (or an empty
// list). The model is derived from the Tasks cache and never stored.
// It reuses `progressMarkLinks` for the live-link definition (open
// entry, dedicated plain link at the entry's first child indent),
// `planTaskBlockId` / `planTaskPath` / `planTaskDescription` for the
// Tasks-cache identity, `planDayNumber` for the done-date comparison,
// and `dependencyCleanTaskText` for the tooltip text.

// The glyph drawn after the link. It is text (not a mask) so the
// read-time decoration stays legible without new assets.
const UNBLOCKED_GLYPH_TEXT = "🔓";

// The hover tooltip for `names` prerequisite texts. One name is named
// in full; several name the first and carry `+N more`. Never throws.
function unblockedGlyphTooltip(names) {
  try {
    const list = Array.isArray(names)
      ? names.filter(
          (name) => typeof name === "string" && name.trim() !== "",
        )
      : [];
    if (list.length === 0) {
      return "Unblocked today";
    }
    const first = list[0].trim();
    if (list.length === 1) {
      return "Unblocked today by ✓ " + first;
    }
    return (
      "Unblocked today by ✓ " + first + " +" + (list.length - 1) + " more"
    );
  } catch (error) {
    return "Unblocked today";
  }
}

// The Tasks-cache identity of `task` (the `[id::]` value Tasks exposes
// as `id`), or null. Never throws.
function unblockedGlyphTaskId(task) {
  try {
    if (!task || typeof task !== "object") {
      return null;
    }
    for (const key of ["id", "taskId"]) {
      try {
        const value = task[key];
        if (typeof value === "string" && value.trim() !== "") {
          return value.trim();
        }
      } catch (error) {
        continue;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

// The `dependsOn` ids of `task` (the prerequisite `[id::]` values), or
// `[]`. Never throws.
function unblockedGlyphTaskDependsOn(task) {
  try {
    if (!task || typeof task !== "object") {
      return [];
    }
    const raw =
      task.dependsOn !== undefined && task.dependsOn !== null
        ? task.dependsOn
        : task.depends_on;
    if (!Array.isArray(raw)) {
      return [];
    }
    const out = [];
    for (const entry of raw) {
      try {
        if (typeof entry === "string" && entry.trim() !== "") {
          out.push(entry.trim());
        }
      } catch (error) {
        continue;
      }
    }
    return out;
  } catch (error) {
    return [];
  }
}

// Whether Tasks-cache `task` is Done with a done date of `todayDay` (a
// `planDayNumber` day number). Cancelled tasks never qualify: only the
// DONE status (or an explicit done flag) with a done date of today
// counts as "completed today". Never throws.
function unblockedGlyphDoneToday(task, todayDay) {
  try {
    if (!task || typeof task !== "object") {
      return false;
    }
    if (!Number.isInteger(todayDay)) {
      return false;
    }
    let doneStatus = false;
    try {
      const status =
        task.status && typeof task.status === "object" ? task.status : null;
      if (status && status.type === "DONE") {
        doneStatus = true;
      } else if (task.done === true) {
        doneStatus = true;
      } else if (
        status &&
        typeof status.name === "string" &&
        /^\s*done\s*$/i.test(status.name)
      ) {
        doneStatus = true;
      }
    } catch (error) {
      doneStatus = false;
    }
    if (!doneStatus) {
      return false;
    }
    let raw = null;
    try {
      if (task.doneDate !== undefined && task.doneDate !== null) {
        raw = task.doneDate;
      } else if (task.done_date !== undefined && task.done_date !== null) {
        raw = task.done_date;
      }
    } catch (error) {
      raw = null;
    }
    if (raw === null || raw === undefined) {
      return false;
    }
    let day = null;
    try {
      day = planDayNumber(raw);
    } catch (error) {
      day = null;
    }
    return day !== null && day === todayDay;
  } catch (error) {
    return false;
  }
}

// An index over Tasks-cache tasks: `byBlock` (blockId → tasks in vault
// order) and `byId` (`[id::]` → task). Never throws.
function unblockedGlyphIndex(tasks) {
  const empty = { byBlock: new Map(), byId: new Map() };
  try {
    const list = Array.isArray(tasks) ? tasks : [];
    for (const task of list) {
      try {
        if (!task || typeof task !== "object") {
          continue;
        }
        let blockId = null;
        try {
          blockId = planTaskBlockId(task);
        } catch (error) {
          blockId = null;
        }
        if (typeof blockId === "string" && blockId !== "") {
          try {
            const bucket = empty.byBlock.get(blockId);
            if (Array.isArray(bucket)) {
              bucket.push(task);
            } else {
              empty.byBlock.set(blockId, [task]);
            }
          } catch (error) {
            // One bad identity never breaks the index.
          }
        }
        let id = null;
        try {
          id = unblockedGlyphTaskId(task);
        } catch (error) {
          id = null;
        }
        if (id && !empty.byId.has(id)) {
          try {
            empty.byId.set(id, task);
          } catch (error) {
            // One bad identity never breaks the index.
          }
        }
      } catch (error) {
        continue;
      }
    }
    return empty;
  } catch (error) {
    return empty;
  }
}

// Whether vault `path` matches link `target` (a linkpath without `.md`
// and without alias). An empty target is the daily note itself, which
// only matches when `dailyPath` names it. Never throws.
function unblockedGlyphTargetMatches(path, target, dailyPath) {
  try {
    const name = String(target || "");
    const candidate = String(path || "");
    if (candidate === "") {
      return false;
    }
    if (name === "") {
      if (typeof dailyPath !== "string" || dailyPath === "") {
        return true;
      }
      try {
        return sameVaultPath(candidate, dailyPath);
      } catch (error) {
        return candidate === dailyPath;
      }
    }
    const withMd = /\.md$/i.test(name) ? name : name + ".md";
    if (candidate === name || candidate === withMd) {
      return true;
    }
    if (
      candidate.endsWith("/" + name) ||
      candidate.endsWith("/" + withMd)
    ) {
      return true;
    }
    let base = candidate;
    try {
      const parts = candidate.split("/");
      base = parts.length > 0 ? parts[parts.length - 1] : candidate;
    } catch (error) {
      base = candidate;
    }
    return base === name || base === withMd;
  } catch (error) {
    return false;
  }
}

// The Tasks-cache task a live link points at, or null: the first
// block-id match whose path matches the link target (exact paths win
// over suffix matches). Never throws.
function unblockedGlyphLinkedTask(index, target, blockId, dailyPath) {
  try {
    const id = String(blockId || "");
    if (id === "") {
      return null;
    }
    const bucket =
      index && index.byBlock instanceof Map ? index.byBlock.get(id) : null;
    if (!Array.isArray(bucket) || bucket.length === 0) {
      return null;
    }
    let fallback = null;
    for (const task of bucket) {
      try {
        if (!task || typeof task !== "object") {
          continue;
        }
        let path = "";
        try {
          path = planTaskPath(task) || "";
        } catch (error) {
          path = "";
        }
        if (!unblockedGlyphTargetMatches(path, target, dailyPath)) {
          continue;
        }
        const name = String(target || "");
        const withMd = /\.md$/i.test(name) ? name : name + ".md";
        if (name !== "" && (path === name || path === withMd)) {
          return task;
        }
        if (fallback === null) {
          fallback = task;
        }
      } catch (error) {
        continue;
      }
    }
    return fallback;
  } catch (error) {
    return null;
  }
}

// The display texts of the linked task's prerequisites completed today,
// in `dependsOn` order. Never throws.
function unblockedGlyphDoneTodayNames(linked, index, todayDay) {
  try {
    if (!linked || typeof linked !== "object") {
      return [];
    }
    const ids = unblockedGlyphTaskDependsOn(linked);
    if (ids.length === 0) {
      return [];
    }
    const names = [];
    for (const id of ids) {
      try {
        const prereq =
          index && index.byId instanceof Map ? index.byId.get(id) : null;
        if (!prereq) {
          continue;
        }
        if (!unblockedGlyphDoneToday(prereq, todayDay)) {
          continue;
        }
        let text = "";
        try {
          text = planTaskDescription(prereq) || "";
        } catch (error) {
          text = "";
        }
        try {
          text = dependencyCleanTaskText(text) || "";
        } catch (error) {
          text = String(text || "");
        }
        names.push(String(text || "").trim() === "" ? id : text.trim());
      } catch (error) {
        continue;
      }
    }
    return names;
  } catch (error) {
    return [];
  }
}

// Every live Task Link under today's open Pomodoro entries whose task
// is open and had a prerequisite completed today, in ledger order:
// `[{ line, ch, target, blockId, unblockedBy }]`, with 0-based `line`,
// `ch` the line-relative offset of `[[`, and `unblockedBy` the
// done-today prerequisite texts. `lines` is the day-file text split on
// newline (a single string is split); `tasks` is the Tasks cache (a
// cold cache draws nothing); `today` defaults to now;
// `options.dailyPath` resolves empty (same-note) targets. Never throws.
function unblockedTodayLinks(lines, tasks, today, options) {
  try {
    let list = [];
    if (typeof lines === "string") {
      list = String(lines).replace(/\r\n/g, "\n").split("\n");
    } else if (Array.isArray(lines)) {
      list = lines;
    } else {
      return [];
    }
    const todayDay = planDayNumber(today === undefined ? new Date() : today);
    if (!Number.isInteger(todayDay)) {
      return [];
    }
    const taskList = Array.isArray(tasks) ? tasks : [];
    if (taskList.length === 0) {
      return [];
    }
    let dailyPath = null;
    try {
      if (options && typeof options.dailyPath === "string") {
        dailyPath = options.dailyPath;
      }
    } catch (error) {
      dailyPath = null;
    }
    let content = "";
    try {
      content = list.map((line) => String(line || "")).join("\n");
    } catch (error) {
      return [];
    }
    let links = [];
    try {
      links = progressMarkLinks(content);
    } catch (error) {
      links = [];
    }
    if (!Array.isArray(links) || links.length === 0) {
      return [];
    }
    let index = null;
    try {
      index = unblockedGlyphIndex(taskList);
    } catch (error) {
      return [];
    }
    const out = [];
    for (const link of links) {
      try {
        if (!link || typeof link.blockId !== "string") {
          continue;
        }
        const linked = unblockedGlyphLinkedTask(
          index,
          link.target,
          link.blockId,
          dailyPath,
        );
        if (!linked) {
          continue;
        }
        let open = false;
        try {
          open = !planTaskIsDone(linked);
        } catch (error) {
          open = false;
        }
        if (!open) {
          continue;
        }
        const names = unblockedGlyphDoneTodayNames(linked, index, todayDay);
        if (names.length === 0) {
          continue;
        }
        out.push({
          line: link.line,
          ch: link.ch,
          target: link.target,
          blockId: link.blockId,
          unblockedBy: names,
        });
      } catch (error) {
        continue;
      }
    }
    return out;
  } catch (error) {
    return [];
  }
}

// Listener-free glyph element, so it survives Dataview's innerHTML
// round-trip. Produces
// `span.bob-unblocked-glyph[role=img][aria-label][title][data-tooltip-position=top]`.
// `doc` provides `createElement` so tests can pass a fake document.
// Never throws: bad input yields null.
function buildUnblockedGlyphElement(doc, tooltip) {
  try {
    if (!doc || typeof doc.createElement !== "function") {
      return null;
    }
    const raw = String(tooltip || "").trim();
    const text = raw === "" ? "Unblocked today" : raw;
    const span = doc.createElement("span");
    span.setAttribute("class", "bob-unblocked-glyph");
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", text);
    span.setAttribute("title", text);
    span.setAttribute("data-tooltip-position", "top");
    try {
      span.textContent = UNBLOCKED_GLYPH_TEXT;
    } catch (error) {
      return null;
    }
    return span;
  } catch (error) {
    return null;
  }
}

// Live Preview widget for one hand-off glyph. `eq` compares the
// tooltip, so unchanged glyphs never flicker. `toDOM` builds the
// listener-free element and adds the place-cursor-on-mousedown
// listener only: the glyph never writes. Defined only when
// `WidgetType` exists; otherwise null and the extension is not
// registered.
let UnblockedGlyphWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  UnblockedGlyphWidget = class extends WidgetType {
    constructor(tooltip) {
      super();
      this.tooltip = String(tooltip || "Unblocked today");
      this.key = this.tooltip;
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof UnblockedGlyphWidget &&
        other.key === this.key
      );
    }

    toDOM(view) {
      const dom = buildUnblockedGlyphElement(
        typeof document !== "undefined" ? document : null,
        this.tooltip,
      );
      // In tests `document` is undefined and the caller passes a fake
      // doc via `buildUnblockedGlyphElement` directly; never throw here.
      if (!dom) {
        const fallback =
          typeof document !== "undefined" && document
            ? document.createElement("span")
            : null;
        return fallback;
      }
      try {
        dom.addEventListener("mousedown", (event) => {
          try {
            if (event && typeof event.preventDefault === "function") {
              event.preventDefault();
            }
            let anchor = null;
            try {
              anchor =
                view && typeof view.posAtDOM === "function"
                  ? view.posAtDOM(dom)
                  : null;
            } catch (error) {
              anchor = null;
            }
            // The widget sits at `side: 1` on the link end, so the
            // widget position is just past the link.
            if (typeof anchor === "number") {
              view.dispatch({ selection: { anchor } });
            }
            if (view && typeof view.focus === "function") {
              view.focus();
            }
          } catch (error) {
            // Placing the cursor is best-effort; the glyph renders.
          }
        });
      } catch (error) {
        // A listener-free glyph still renders.
      }
      return dom;
    }
  };
}
