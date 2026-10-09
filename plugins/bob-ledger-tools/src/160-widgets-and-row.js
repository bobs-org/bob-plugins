// Live Preview chip widget for one Depends-On line. `eq` compares a key
// built from `JSON.stringify(model)` so an unchanged line never flickers.
// Defined only when `WidgetType` exists; otherwise null and the extension
// is not registered.
let DependencyChipWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  DependencyChipWidget = class extends WidgetType {
    constructor(model, meta) {
      super();
      this.model = model;
      this.meta = meta && typeof meta === "object" ? meta : {};
      // The key covers the model plus the placement meta: a reused DOM node
      // must never keep a stale lineNumber (lines inserted above) or a stale
      // interactive flag (nav's api loading later). Click handlers also
      // re-check the api live at click time.
      let key = "";
      try {
        key = JSON.stringify([
          model,
          this.meta.lineNumber === undefined ? null : this.meta.lineNumber,
          Boolean(this.meta.interactive),
        ]);
      } catch (error) {
        key = String((model && model.summary) || "");
      }
      this.key = key;
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof DependencyChipWidget &&
        other.key === this.key
      );
    }

    toDOM(view) {
      let docNode = null;
      try {
        docNode = typeof document !== "undefined" ? document : null;
      } catch (error) {
        docNode = null;
      }
      if (!docNode) {
        try {
          const fallback = typeof document !== "undefined" && document
            ? document.createElement("span")
            : null;
          return fallback;
        } catch (error) {
          return null;
        }
      }
      const plugin = this.meta && this.meta.plugin ? this.meta.plugin : null;
      const sourcePath = (this.meta && this.meta.sourcePath) || "";
      const interactive = Boolean(this.meta && this.meta.interactive);
      const dom = buildDependencyChipElement(docNode, this.model, {
        sourcePath,
        interactive,
        onOpen: (linktext, event) => {
          try {
            if (plugin && typeof plugin.dependencyOpenTarget === "function") {
              plugin.dependencyOpenTarget(linktext, sourcePath, event);
            }
          } catch (error) {
            // Best-effort only.
          }
        },
        onHover: (linktext, event, chipEl) => {
          try {
            if (plugin && typeof plugin.dependencyHoverTarget === "function") {
              plugin.dependencyHoverTarget(linktext, sourcePath, event, chipEl || dom, dom);
            }
          } catch (error) {
            // Best-effort only.
          }
        },
        onRemove: (chip) => {
          try {
            if (plugin && typeof plugin.dependencyRemoveChip === "function") {
              plugin.dependencyRemoveChip(chip, sourcePath, this.meta);
            }
          } catch (error) {
            // Best-effort only.
          }
        },
        onAdd: () => {
          try {
            if (plugin && typeof plugin.dependencyOpenStage === "function") {
              plugin.dependencyOpenStage(sourcePath, this.meta);
            }
          } catch (error) {
            // Best-effort only.
          }
        },
      });
      if (!dom) {
        const fallback = docNode.createElement("span");
        return fallback;
      }
      try {
        const self = this;
        dom.addEventListener("mousedown", (event) => {
          try {
            const target = event && event.target ? event.target : null;
            let interactiveTarget = false;
            try {
              if (target && typeof target.closest === "function") {
                interactiveTarget = Boolean(target.closest(".bob-dep-chip,.bob-dep-add,.bob-dep-chip-remove"));
              } else {
                let node = target;
                let guard = 0;
                while (node && node !== dom && guard < 6) {
                  guard += 1;
                  const cls = node.className || "";
                  if (typeof cls === "string" && (cls.indexOf("bob-dep-chip") !== -1 || cls.indexOf("bob-dep-add") !== -1)) {
                    interactiveTarget = true;
                    break;
                  }
                  node = node.parentNode || null;
                }
              }
            } catch (error) {
              interactiveTarget = false;
            }
            if (interactiveTarget) {
              return;
            }
            if (event && typeof event.preventDefault === "function") {
              event.preventDefault();
            }
            let anchor = null;
            try {
              anchor = view && typeof view.posAtDOM === "function" ? view.posAtDOM(dom) : null;
            } catch (error) {
              anchor = null;
            }
            if (typeof anchor === "number") {
              view.dispatch({ selection: { anchor } });
            }
            if (view && typeof view.focus === "function") {
              view.focus();
            }
            void self;
          } catch (error) {
            // Reveal is best-effort.
          }
        });
      } catch (error) {
        // A listener-free row still renders.
      }
      return dom;
    }
  };
}

// Whether a CodeMirror position sits inside code: the syntax node at
// the position, or any ancestor, is a codeblock (mirroring Dataview's
// `HyperMD-codeblock` check) or inline code. Missing trees never throw
// and never match. Pure helper for the Live Preview decoration.
function freshnessMarkPosInCode(tree, pos) {
  try {
    if (!tree || typeof tree.resolveInner !== "function") {
      return false;
    }
    let node = tree.resolveInner(pos, -1);
    while (node) {
      const name = node.name || "";
      if (
        name === "HyperMD-codeblock" ||
        name.indexOf("inline-code") !== -1
      ) {
        return true;
      }
      node = node.parent;
    }
    return false;
  } catch (error) {
    return false;
  }
}

// Live Preview click widget for one freshness mark. `eq` compares a key
// built from `JSON.stringify(model)` plus `foldSpace`, so an unchanged
// mark never flickers. `toDOM` builds the listener-free element and adds
// the reveal-on-click listener only. Defined only when `WidgetType`
// exists; otherwise null and the extension is not registered.
let FreshnessMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  FreshnessMarkWidget = class extends WidgetType {
    constructor(model, foldSpace) {
      super();
      this.model = model;
      this.foldSpace = Boolean(foldSpace);
      let key = "";
      try {
        key = JSON.stringify(model) + "|" + (this.foldSpace ? "1" : "0");
      } catch (error) {
        key = String(model && model.text) + "|" + (this.foldSpace ? "1" : "0");
      }
      this.key = key;
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof FreshnessMarkWidget &&
        other.key === this.key
      );
    }

    toDOM(view) {
      const dom = buildFreshnessMarkElement(
        typeof document !== "undefined" ? document : null,
        this.model,
        { foldSpace: this.foldSpace },
      );
      // In tests `document` is undefined and the caller passes a fake
      // doc via `buildFreshnessMarkElement` directly; never throw here.
      if (!dom) {
        const fallback =
          typeof document !== "undefined" && document
            ? document.createElement("span")
            : null;
        return fallback;
      }
      try {
        const self = this;
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
            if (typeof anchor === "number") {
              view.dispatch({
                selection: { anchor: anchor + (self.foldSpace ? 1 : 0) },
              });
            }
            if (view && typeof view.focus === "function") {
              view.focus();
            }
          } catch (error) {
            // Reveal is best-effort; the mark itself still renders.
          }
        });
      } catch (error) {
        // A listener-free mark still renders.
      }
      return dom;
    }
  };
}

// Adapt one Tasks-plugin task to a freshness evaluation row. `context`
// is `{ list, todayDay, noteRefreshRawFor(path), isToday(task) }`.
// Carries exact `checklist` tier tags and the status symbol as written
// on the line (null when the line cannot provide one), plus `created`
// (canonical `YYYY-MM-DD` from `createdDate`/`created`,
// else the inline `created` field, else null) for the tiered walk,
// and `due`/`start` (canonical `YYYY-MM-DD` from the Tasks
// `dueDate`/`startDate` fields with the same key variants as
// `scheduled`, else the inline `[due::]`/`[start::]` field, else
// null) for the RECURRING occurrence date.
// Never throws: missing fields degrade to an out-of-scope row.
function freshnessRowFromTask(task, index, context) {
  const safeContext = context || {};
  const list = Array.isArray(safeContext.list) ? safeContext.list : [];
  const fallbackLine =
    Number.isInteger(index) && index >= 0 ? index + 1 : 1;
  try {
    if (!task || typeof task !== "object") {
      return {
        path: "",
        line: fallbackLine,
        lineNumber: fallbackLine - 1,
        text: "",
        originalMarkdown: "",
        blockId: null,
        tracker: null,
        checklist: null,
        statusSymbol: null,
        isTodo: false,
        recurring: false,
        laneVisible: false,
        isDailyNote: false,
        isToday: false,
        scheduled: null,
        due: null,
        start: null,
        created: null,
        rawLine: "",
        noteRefreshRaw: undefined,
      };
    }
    const path = planTaskPath(task) || "";
    const lineNumber = Number.isInteger(task.lineNumber)
      ? task.lineNumber
      : fallbackLine - 1;
    const description = planTaskDescription(task);
    const rawLine =
      typeof task.originalMarkdown === "string"
        ? task.originalMarkdown
        : typeof description === "string"
          ? description
          : "";
    const statusType =
      task.status && typeof task.status === "object"
        ? task.status.type
        : undefined;
    const isTodo =
      typeof statusType === "string"
        ? statusType === "TODO"
        : planTaskStatusSymbol(task) === " ";
    const recurring =
      Boolean(task.recurrence) ||
      task.isRecurring === true ||
      task.recurring === true ||
      freshnessHasRepeatField(rawLine);
    const blockId = planTaskBlockId(task);
    const tracker = freshnessTrackerFromRow({
      blockId,
      tags: Array.isArray(task.tags) ? task.tags : [],
      rawLine,
    });
    let laneVisible = false;
    try {
      laneVisible = Boolean(
        planLaneVisible(task, list, safeContext.todayDay ?? null),
      );
      // Freshness-specific review eligibility: only exact `^ref`
      // trackers bypass the conventional `#hide` tag (the
      // transitional v1 bypass). A hand-written `#hide` on a
      // tag-only `#ref` line hides it like any task. Re-run the same
      // lane predicate on a shallow clone with hide-matching tags
      // removed (never mutating the cached Tasks object); every other
      // exclusion still applies, and ordinary hidden tasks — and
      // hidden `^prj` rows — stay out. Recurring rows keep ordinary
      // visibility (including `#hide` exclusion) even on trackers, so
      // a hidden recurring `^ref` never walks in RECURRING.
      if (!laneVisible && blockId === "ref" && !recurring) {
        try {
          const tags = Array.isArray(task.tags) ? task.tags : [];
          const stripped = tags.filter(
            (tag) =>
              typeof tag !== "string" ||
              !tag.toLowerCase().includes("#hide"),
          );
          if (stripped.length !== tags.length) {
            const clone = { ...task, tags: stripped };
            laneVisible = Boolean(
              planLaneVisible(clone, list, safeContext.todayDay ?? null),
            );
          }
        } catch (error) {
          // Keep the unmodified predicate result.
        }
      }
    } catch (error) {
      laneVisible = false;
    }
    const isDailyNote = PLAN_DAILY_PATH_RE.test(path);
    let isToday = false;
    try {
      isToday =
        typeof safeContext.isToday === "function"
          ? Boolean(safeContext.isToday(task))
          : false;
    } catch (error) {
      isToday = false;
    }
    let scheduled = null;
    try {
      for (const key of ["scheduledDate", "scheduled", "scheduledDay"]) {
        if (task[key] === undefined || task[key] === null) {
          continue;
        }
        const day = planDayNumber(task[key]);
        if (day === null) {
          continue;
        }
        const coerced = planCoerceDate(task[key]);
        if (coerced) {
          scheduled = formatLocalDate(coerced);
          break;
        }
      }
      if (scheduled === null) {
        const fields = freshnessInlineFields(rawLine, "scheduled");
        for (const field of fields) {
          const parsed = parseFreshDateStrict(field.value.trim());
          if (parsed !== null) {
            scheduled = parsed;
            break;
          }
        }
      }
    } catch (error) {
      scheduled = null;
    }
    let due = null;
    try {
      for (const key of ["dueDate", "due", "dueDay"]) {
        if (task[key] === undefined || task[key] === null) {
          continue;
        }
        const day = planDayNumber(task[key]);
        if (day === null) {
          continue;
        }
        const coerced = planCoerceDate(task[key]);
        if (coerced) {
          due = formatLocalDate(coerced);
          break;
        }
      }
      if (due === null) {
        const fields = freshnessInlineFields(rawLine, "due");
        for (const field of fields) {
          const parsed = parseFreshDateStrict(field.value.trim());
          if (parsed !== null) {
            due = parsed;
            break;
          }
        }
      }
    } catch (error) {
      due = null;
    }
    let start = null;
    try {
      for (const key of ["startDate", "start", "startDay"]) {
        if (task[key] === undefined || task[key] === null) {
          continue;
        }
        const day = planDayNumber(task[key]);
        if (day === null) {
          continue;
        }
        const coerced = planCoerceDate(task[key]);
        if (coerced) {
          start = formatLocalDate(coerced);
          break;
        }
      }
      if (start === null) {
        const fields = freshnessInlineFields(rawLine, "start");
        for (const field of fields) {
          const parsed = parseFreshDateStrict(field.value.trim());
          if (parsed !== null) {
            start = parsed;
            break;
          }
        }
      }
    } catch (error) {
      start = null;
    }
    // Tasks normally supplies the scheduled date on the task object,
    // which `planLaneVisible` already checks. Preserve that exclusion
    // when adapting cached Markdown rows whose object omitted it.
    try {
      const todayDay = safeContext.todayDay;
      const scheduledDay = freshnessDayNumberForDateText(scheduled);
      if (
        Number.isInteger(todayDay) &&
        scheduledDay !== null &&
        scheduledDay > todayDay
      ) {
        laneVisible = false;
      }
    } catch (error) {
      // Keep the existing visibility result on malformed dates.
    }
    let noteRefreshRaw = undefined;
    try {
      noteRefreshRaw =
        typeof safeContext.noteRefreshRawFor === "function"
          ? safeContext.noteRefreshRawFor(path)
          : undefined;
    } catch (error) {
      noteRefreshRaw = undefined;
    }
    const checklist = freshnessChecklistForTags(task.tags);
    let statusSymbol = null;
    try {
      statusSymbol = freshnessTaskStatus(rawLine);
    } catch (error) {
      statusSymbol = null;
    }
    let created = null;
    try {
      for (const key of ["createdDate", "created", "createdDay"]) {
        if (task[key] === undefined || task[key] === null) {
          continue;
        }
        const coerced = planCoerceDate(task[key]);
        if (coerced) {
          created = formatLocalDate(coerced);
          break;
        }
        if (typeof task[key] === "string") {
          const parsed = parseFreshDateStrict(task[key].trim());
          if (parsed !== null) {
            created = parsed;
            break;
          }
        }
      }
      if (created === null) {
        const fields = freshnessInlineFields(rawLine, "created");
        for (const field of fields) {
          const parsed = parseFreshDateStrict(field.value.trim());
          if (parsed !== null) {
            created = parsed;
            break;
          }
        }
      }
    } catch (error) {
      created = null;
    }
    return {
      path,
      line: lineNumber + 1,
      lineNumber,
      text: typeof description === "string" ? description : "",
      originalMarkdown: rawLine,
      blockId,
      tracker,
      checklist,
      statusSymbol,
      isTodo,
      recurring,
      laneVisible,
      isDailyNote,
      isToday,
      scheduled,
      due,
      start,
      created,
      rawLine,
      noteRefreshRaw,
    };
  } catch (error) {
    return {
      path: "",
      line: fallbackLine,
      lineNumber: fallbackLine - 1,
      text: "",
      originalMarkdown: "",
      blockId: null,
      tracker: null,
      checklist: null,
      statusSymbol: null,
      isTodo: false,
      recurring: false,
      laneVisible: false,
      isDailyNote: false,
      isToday: false,
      scheduled: null,
      due: null,
      start: null,
      created: null,
      rawLine: "",
      noteRefreshRaw: undefined,
    };
  }
}

// True when the review-relevant snapshot changed: queue order/keys,
// any row's state/tier, or any row's bucket. A lane task coming due at
// midnight changes `dueKeys` (the tiered queue gains a row) and
// triggers the existing refresh fan-out without a vault write. Never
// throws.
function freshnessMemoReviewChanged(
  previousDueKeys,
  previousEvaluated,
  next,
) {
  try {
    const dueKeys = (next && Array.isArray(next.dueKeys)) ? next.dueKeys : [];
    const previous = Array.isArray(previousDueKeys) ? previousDueKeys : [];
    if (previous.length !== dueKeys.length) {
      return true;
    }
    if (previous.some((key, index) => key !== dueKeys[index])) {
      return true;
    }
    const current =
      next && next.evaluatedByKey instanceof Map
        ? next.evaluatedByKey
        : null;
    if (!(previousEvaluated instanceof Map) || current === null) {
      return true;
    }
    if (previousEvaluated.size !== current.size) {
      return true;
    }
    for (const [key, value] of current) {
      const before = previousEvaluated.get(key);
      if (
        !before ||
        before.state !== value.state ||
        before.tier !== value.tier ||
        before.bucket !== value.bucket
      ) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return true;
  }
}

// __FRESHNESS_A2_END__
// __FRESHNESS_A1_END__
