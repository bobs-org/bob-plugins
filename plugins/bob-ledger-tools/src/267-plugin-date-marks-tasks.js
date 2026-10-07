// --- Task date marks in Tasks query results ---------------------------
// `BobLedgerToolsDateMarksTasksMixin` (see `310-install-methods.js`).
// Tasks 8.4.0 always renders query-result date components with its emoji
// serializer: each date component is a direct-child span of
// `li.plugin-tasks-list-item > .tasks-list-text` carrying one of the
// `task-created`, `task-scheduled`, `task-done`, or `task-cancelled`
// classes (plus a `data-task-…` attribute), wrapping a single inner span
// whose text is `" ⏳ 2026-10-09"` (full mode) or `" ⏳"` (short mode).
// CSS cannot split the emoji from the date, so unlike the priority mark
// (whose Tasks host is CSS-only), full mode needs this small, narrow JS
// pass. It is the narrowest JS that degrades to Tasks' native rendering:
// no global MutationObserver, and nothing Tasks owns is removed or
// rewritten — the pass only appends one listener-free mark per component
// and lets CSS visually hide Tasks' inner span. Short mode stays
// CSS-only (see `styles.css`). Synchronous throughout; never throws.

// Each Tasks date-component class with its date-mark field. `done` maps
// to `completion`; `due` and `start` are out of scope and never touched.
const TASKS_DATE_MARK_HOSTS = Object.freeze([
  Object.freeze({ cls: "task-created", field: "created" }),
  Object.freeze({ cls: "task-scheduled", field: "scheduled" }),
  Object.freeze({ cls: "task-done", field: "completion" }),
  Object.freeze({ cls: "task-cancelled", field: "cancelled" }),
]);

// The trailing ISO date in a Tasks component's inner text.
const TASKS_DATE_MARK_PATTERN = /(\d{4}-\d{2}-\d{2})\s*$/;
// A still-detached element is retried this many frames before the pass
// drops it silently (Tasks' native emoji dates stay).
const TASKS_DATE_MARK_DETACHED_RETRIES = 3;
// A row without `data-task` is re-queued this many frames: Tasks sets
// `data-task` at the end of `renderTaskLine`, so its absence means the
// row is not complete yet.
const TASKS_DATE_MARK_PENDING_RETRIES = 60;

function tasksDateMarkHasClass(node, name) {
  try {
    if (!node) {
      return false;
    }
    if (
      node.classList &&
      typeof node.classList.contains === "function"
    ) {
      try {
        return node.classList.contains(name);
      } catch (error) {
        // Fall through to the className parse.
      }
    }
    const text =
      typeof node.className === "string" ? node.className : "";
    return text.split(/\s+/).indexOf(name) !== -1;
  } catch (error) {
    return false;
  }
}

// The Tasks result row for `el`: `el` itself when it is the row, else
// its nearest `li.plugin-tasks-list-item` ancestor, else null. Never
// throws.
function tasksDateMarkClosestRow(el) {
  try {
    let current = el || null;
    let guard = 0;
    while (current && guard < 100) {
      guard += 1;
      try {
        const tag = String(
          current.tagName || current.nodeName || "",
        ).toUpperCase();
        if (
          tag === "LI" &&
          tasksDateMarkHasClass(current, "plugin-tasks-list-item")
        ) {
          return current;
        }
      } catch (error) {
        // Keep walking on per-ancestor failure.
      }
      current = current.parentNode || null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// The visible text under `node`, concatenating descendant text nodes in
// order. Used to read a Tasks component's inner text. Never throws.
function tasksDateMarkInnerText(node) {
  try {
    let out = "";
    const stack = [node];
    let guard = 0;
    while (stack.length > 0 && guard < 10000) {
      guard += 1;
      const current = stack.pop();
      if (!current) {
        continue;
      }
      if (current.nodeType === 3) {
        const value =
          typeof current.nodeValue === "string"
            ? current.nodeValue
            : typeof current.textContent === "string"
              ? current.textContent
              : "";
        out += value;
        continue;
      }
      const kids = current.childNodes || [];
      for (let index = kids.length - 1; index >= 0; index -= 1) {
        stack.push(kids[index]);
      }
    }
    return out;
  } catch (error) {
    return "";
  }
}

class BobLedgerToolsDateMarksTasksMixin {
  // One frame callback: `requestAnimationFrame`, falling back to a
  // 16ms timeout. A method (not a bare function) so tests can inject
  // a manual scheduler. Never throws.
  dateMarksRequestFrame(cb) {
    try {
      if (typeof cb !== "function") {
        return;
      }
      let raf = null;
      try {
        const scope =
          typeof window !== "undefined" && window
            ? window
            : typeof globalThis !== "undefined"
              ? globalThis
              : null;
        if (
          scope &&
          typeof scope.requestAnimationFrame === "function"
        ) {
          raf = scope.requestAnimationFrame;
        }
      } catch (error) {
        raf = null;
      }
      if (raf) {
        try {
          raf(cb);
        } catch (error) {
          // A throwing scheduler drops the frame silently.
        }
        return;
      }
      try {
        setTimeout(cb, 16);
      } catch (error) {
        // Timers unavailable: the frame is dropped silently.
      }
    } catch (error) {
      // Frame scheduling never throws.
    }
  }

  // Queue one rendered container for the Tasks-result date-mark frame
  // pass. Called at the end of `renderDateMarksIn` when marks are on:
  // Tasks renders every description through `MarkdownRenderer.render`,
  // so this fires once per result row. It queues `el` when `el` has a
  // `li.plugin-tasks-list-item` ancestor (or is the row itself) or is
  // still detached; a connected non-Tasks element schedules nothing.
  // At most one frame stays pending. Never throws.
  scheduleTasksResultDateMarks(el) {
    try {
      if (!this.dateMarksEnabled) {
        return;
      }
      if (!el || typeof el !== "object") {
        return;
      }
      let row = null;
      try {
        row = tasksDateMarkClosestRow(el);
      } catch (error) {
        row = null;
      }
      if (!row) {
        let detached = false;
        try {
          detached = el.isConnected === false;
        } catch (error) {
          detached = false;
        }
        if (!detached) {
          return;
        }
      }
      if (!Array.isArray(this.tasksDateMarksQueue)) {
        this.tasksDateMarksQueue = [];
      }
      this.tasksDateMarksQueue.push({ el, frames: 0, waits: 0 });
      if (this.tasksDateMarksPending) {
        return;
      }
      this.tasksDateMarksPending = true;
      const self = this;
      try {
        this.dateMarksRequestFrame(function tasksDateMarkFrame() {
          try {
            self.runTasksResultDateMarkFrame();
          } catch (error) {
            // The frame pass never throws.
          }
        });
      } catch (error) {
        this.tasksDateMarksPending = false;
      }
    } catch (error) {
      // Tasks-result scheduling never throws.
    }
  }

  // Drain one queued frame: resolve each entry to its row, retrying a
  // still-detached element for a few frames and a row without
  // `data-task` for longer. Complete rows go to
  // `decorateTasksResultDates` once each (a WeakSet dedup); exhausted
  // entries are dropped silently, leaving Tasks' native emoji dates.
  // In the common case this lands before the next paint, so the emoji
  // dates never flash. Never throws.
  runTasksResultDateMarkFrame() {
    try {
      this.tasksDateMarksPending = false;
      const queued = Array.isArray(this.tasksDateMarksQueue)
        ? this.tasksDateMarksQueue
        : [];
      this.tasksDateMarksQueue = [];
      if (queued.length === 0) {
        return;
      }
      let today = null;
      try {
        today = this.dateMarksToday();
      } catch (error) {
        today = null;
      }
      if (
        !this.tasksDateMarksDoneSet &&
        typeof WeakSet === "function"
      ) {
        try {
          this.tasksDateMarksDoneSet = new WeakSet();
        } catch (error) {
          this.tasksDateMarksDoneSet = null;
        }
      }
      let again = false;
      for (const entry of queued) {
        try {
          if (!entry || !entry.el) {
            continue;
          }
          let row = null;
          try {
            row = tasksDateMarkClosestRow(entry.el);
          } catch (error) {
            row = null;
          }
          if (!row) {
            const frames =
              (typeof entry.frames === "number" ? entry.frames : 0) + 1;
            if (frames <= TASKS_DATE_MARK_DETACHED_RETRIES) {
              this.tasksDateMarksQueue.push({
                el: entry.el,
                frames,
                waits:
                  typeof entry.waits === "number" ? entry.waits : 0,
              });
              again = true;
            }
            continue;
          }
          let marker = null;
          try {
            marker =
              row && typeof row.getAttribute === "function"
                ? row.getAttribute("data-task")
                : null;
          } catch (error) {
            marker = null;
          }
          if (marker === null || marker === undefined) {
            const waits =
              (typeof entry.waits === "number" ? entry.waits : 0) + 1;
            if (waits <= TASKS_DATE_MARK_PENDING_RETRIES) {
              this.tasksDateMarksQueue.push({
                el: entry.el,
                frames:
                  typeof entry.frames === "number" ? entry.frames : 0,
                waits,
              });
              again = true;
            }
            continue;
          }
          if (
            this.tasksDateMarksDoneSet &&
            this.tasksDateMarksDoneSet.has(row)
          ) {
            continue;
          }
          if (today) {
            try {
              this.decorateTasksResultDates(row, today);
            } catch (error) {
              // One bad row never breaks the frame.
            }
          }
          if (this.tasksDateMarksDoneSet) {
            try {
              this.tasksDateMarksDoneSet.add(row);
            } catch (error) {
              // Dedup is best-effort; the pass is idempotent anyway.
            }
          }
        } catch (error) {
          continue;
        }
      }
      if (again && this.tasksDateMarksQueue.length > 0) {
        this.tasksDateMarksPending = true;
        const self = this;
        try {
          this.dateMarksRequestFrame(function tasksDateMarkRetry() {
            try {
              self.runTasksResultDateMarkFrame();
            } catch (error) {
              // The frame pass never throws.
            }
          });
        } catch (error) {
          this.tasksDateMarksPending = false;
        }
      }
    } catch (error) {
      // The frame pass never throws.
    }
  }

  // Append one date mark to each undecorated Tasks date component in a
  // complete row. Each `task-created`, `task-scheduled`, `task-done`,
  // and `task-cancelled` span without `data-bob-date-mark` whose inner
  // text ends in a canonical ISO date gets
  // `buildDateMarkElement(…, { foldSpace: true, rendered: true })`
  // with `data-host="tasks"` appended inside the span; the span is then
  // flagged `data-bob-date-mark="true"`. Spans with no date (short
  // mode), an invalid date, or an unknown shape are left untouched, as
  // are `task-due` and `task-start`. The pass is idempotent, and the
  // appended mark keeps Tasks' click (date editor) and contextmenu
  // (postpone) listeners working, because the click bubbles to Tasks'
  // span. Returns the decorated count. Never throws.
  decorateTasksResultDates(li, todayText) {
    try {
      if (!li || typeof li !== "object") {
        return 0;
      }
      let today = null;
      try {
        today =
          parseFreshDateStrict(String(todayText || "")) ||
          freshnessNormalizeDateText(todayText);
      } catch (error) {
        today = null;
      }
      if (!today) {
        return 0;
      }
      const docNode =
        li.ownerDocument ||
        (typeof document !== "undefined" ? document : null);
      if (!docNode) {
        return 0;
      }
      const hosts = [];
      try {
        const stack = (li.childNodes || []).slice();
        let guard = 0;
        while (stack.length > 0 && guard < 10000) {
          guard += 1;
          const node = stack.pop();
          if (!node || node === li) {
            continue;
          }
          if (node.nodeType === 1) {
            try {
              const tag = String(
                node.tagName || node.nodeName || "",
              ).toUpperCase();
              if (tag === "SPAN") {
                for (const host of TASKS_DATE_MARK_HOSTS) {
                  if (tasksDateMarkHasClass(node, host.cls)) {
                    hosts.push({ node, field: host.field });
                    break;
                  }
                }
              }
            } catch (error) {
              // One unreadable node never breaks the walk.
            }
            const kids = node.childNodes || [];
            for (let index = kids.length - 1; index >= 0; index -= 1) {
              stack.push(kids[index]);
            }
          }
        }
      } catch (error) {
        return 0;
      }
      let count = 0;
      for (const host of hosts) {
        try {
          let flagged = false;
          try {
            flagged =
              host.node &&
              typeof host.node.getAttribute === "function" &&
              host.node.getAttribute("data-bob-date-mark") === "true";
          } catch (error) {
            flagged = false;
          }
          if (flagged) {
            continue;
          }
          const inner = tasksDateMarkInnerText(host.node);
          const match = TASKS_DATE_MARK_PATTERN.exec(inner);
          if (!match) {
            continue;
          }
          const date = match[1];
          if (parseFreshDateStrict(date) === null) {
            continue;
          }
          const model = dateMarkModel(host.field, date, today);
          if (!model) {
            continue;
          }
          const markEl = buildDateMarkElement(docNode, model, {
            foldSpace: true,
            rendered: true,
          });
          if (!markEl) {
            continue;
          }
          try {
            if (typeof markEl.setAttribute === "function") {
              markEl.setAttribute("data-host", "tasks");
            }
          } catch (error) {
            // The host flag is best-effort.
          }
          host.node.appendChild(markEl);
          try {
            if (typeof host.node.setAttribute === "function") {
              host.node.setAttribute("data-bob-date-mark", "true");
            }
          } catch (error) {
            // The flag is best-effort.
          }
          count += 1;
        } catch (error) {
          continue;
        }
      }
      return count;
    } catch (error) {
      return 0;
    }
  }
}
