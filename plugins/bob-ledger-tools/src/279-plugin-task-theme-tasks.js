// --- Task theme marks in Tasks and Dataview query rows -------------------
// `BobLedgerToolsTaskThemeTasksMixin` (see `310-install-methods.js`).
// Tasks and Dataview attach or finalize rows after Markdown postprocessing,
// so this mixin schedules a bounded frame pass the way
// `267-plugin-date-marks-tasks.js` does. No global MutationObserver. A
// still-detached element is retried a few frames; a row without `data-task`
// is re-queued until Tasks finishes `renderTaskLine`. Disabling or unloading
// drops the queue. Repeated render, cloning, and reattachment are
// idempotent because hosts already in the row are skipped. Never throws.

const TASKS_THEME_MARK_DETACHED_RETRIES = 3;
const TASKS_THEME_MARK_PENDING_RETRIES = 60;

class BobLedgerToolsTaskThemeTasksMixin {
  // One frame callback: `requestAnimationFrame`, falling back to a 16ms
  // timeout. A method so tests can inject a manual scheduler. Never throws.
  taskThemeRequestFrame(cb) {
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
        if (scope && typeof scope.requestAnimationFrame === "function") {
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

  taskThemeCancelScheduledWork() {
    try {
      this.tasksTaskThemeMarksPending = false;
      this.tasksTaskThemeMarksQueue = [];
      this.tasksTaskThemeMarksDoneSet = null;
    } catch (error) {
      // Queue drop never throws.
    }
  }

  // Queue one rendered container for the Tasks/Dataview theme-mark frame
  // pass. Called at the end of `renderTaskThemeMarksIn`. It queues `el`
  // when `el` has a Tasks or Dataview task-row ancestor (or is the row)
  // or is still detached; a connected non-query element schedules nothing
  // extra. At most one frame stays pending. Never throws.
  scheduleTasksResultTaskThemeMarks(el, ctx) {
    try {
      if (!this.taskThemeMarksEnabled) {
        return;
      }
      if (!el || typeof el !== "object") {
        return;
      }
      let row = null;
      try {
        row = taskThemeClosestRow(el);
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
      } else {
        let inQuery = false;
        try {
          inQuery = Boolean(
            taskThemeHasClass(row, "plugin-tasks-list-item") ||
              taskThemeQueryAncestor(row, null),
          );
        } catch (error) {
          inQuery = false;
        }
        if (!inQuery) {
          return;
        }
      }
      if (!Array.isArray(this.tasksTaskThemeMarksQueue)) {
        this.tasksTaskThemeMarksQueue = [];
      }
      this.tasksTaskThemeMarksQueue.push({
        el,
        ctx: ctx || null,
        frames: 0,
        waits: 0,
      });
      if (this.tasksTaskThemeMarksPending) {
        return;
      }
      this.tasksTaskThemeMarksPending = true;
      const self = this;
      try {
        this.taskThemeRequestFrame(function tasksThemeMarkFrame() {
          try {
            self.runTasksResultTaskThemeMarkFrame();
          } catch (error) {
            // The frame pass never throws.
          }
        });
      } catch (error) {
        this.tasksTaskThemeMarksPending = false;
      }
    } catch (error) {
      // Tasks-result scheduling never throws.
    }
  }

  // Drain one queued frame: resolve each entry to its row, retrying a
  // still-detached element for a few frames and a row without `data-task`
  // for longer. Complete rows go to `decorateTaskThemeRow` once each (a
  // WeakSet dedup); exhausted entries are dropped silently. A frame that
  // runs after marks are disabled drops its queue untouched. Never throws.
  runTasksResultTaskThemeMarkFrame() {
    try {
      this.tasksTaskThemeMarksPending = false;
      if (!this.taskThemeMarksEnabled) {
        this.tasksTaskThemeMarksQueue = [];
        return;
      }
      const queued = Array.isArray(this.tasksTaskThemeMarksQueue)
        ? this.tasksTaskThemeMarksQueue
        : [];
      this.tasksTaskThemeMarksQueue = [];
      if (queued.length === 0) {
        return;
      }
      if (
        !this.tasksTaskThemeMarksDoneSet &&
        typeof WeakSet === "function"
      ) {
        try {
          this.tasksTaskThemeMarksDoneSet = new WeakSet();
        } catch (error) {
          this.tasksTaskThemeMarksDoneSet = null;
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
            row = taskThemeClosestRow(entry.el);
          } catch (error) {
            row = null;
          }
          if (!row) {
            const frames =
              (typeof entry.frames === "number" ? entry.frames : 0) + 1;
            if (frames <= TASKS_THEME_MARK_DETACHED_RETRIES) {
              this.tasksTaskThemeMarksQueue.push({
                el: entry.el,
                ctx: entry.ctx || null,
                frames,
                waits: typeof entry.waits === "number" ? entry.waits : 0,
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
            if (waits <= TASKS_THEME_MARK_PENDING_RETRIES) {
              this.tasksTaskThemeMarksQueue.push({
                el: entry.el,
                ctx: entry.ctx || null,
                frames: typeof entry.frames === "number" ? entry.frames : 0,
                waits,
              });
              again = true;
            }
            continue;
          }
          if (
            this.tasksTaskThemeMarksDoneSet &&
            this.tasksTaskThemeMarksDoneSet.has(row)
          ) {
            continue;
          }
          try {
            const origin = this.taskThemeOriginFor(row, entry.el, entry.ctx);
            this.decorateTaskThemeRow(row, origin, row);
          } catch (error) {
            // One bad row never breaks the frame.
          }
          if (this.tasksTaskThemeMarksDoneSet) {
            try {
              this.tasksTaskThemeMarksDoneSet.add(row);
            } catch (error) {
              // Dedup is best-effort; the pass is idempotent anyway.
            }
          }
        } catch (error) {
          continue;
        }
      }
      if (again && this.tasksTaskThemeMarksQueue.length > 0) {
        this.tasksTaskThemeMarksPending = true;
        const self = this;
        try {
          this.taskThemeRequestFrame(function tasksThemeMarkRetry() {
            try {
              self.runTasksResultTaskThemeMarkFrame();
            } catch (error) {
              // The frame pass never throws.
            }
          });
        } catch (error) {
          this.tasksTaskThemeMarksPending = false;
        }
      }
    } catch (error) {
      // The frame pass never throws.
    }
  }
}
