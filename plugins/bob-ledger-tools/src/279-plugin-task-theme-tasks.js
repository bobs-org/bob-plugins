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
      if (this.taskThemeRefreshTimer) {
        try {
          clearTimeout(this.taskThemeRefreshTimer);
        } catch (error) {
          // Timer clear is best-effort.
        }
        this.taskThemeRefreshTimer = null;
      }
    } catch (error) {
      // Queue drop never throws.
    }
  }

  refreshTaskThemeMarkEditors() {
    try {
      const refresh = ensureTaskThemeMarksRefresh();
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return;
      }
      let leaves = [];
      try {
        leaves = workspace.getLeavesOfType("markdown") || [];
      } catch (error) {
        leaves = [];
      }
      for (const leaf of leaves) {
        try {
          const cm =
            leaf && leaf.view && leaf.view.editor
              ? leaf.view.editor.cm
              : null;
          if (cm && typeof cm.dispatch === "function" && refresh) {
            cm.dispatch({ effects: refresh.of(null) });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh never throws.
    }
  }

  refreshTaskThemeMarksForCache() {
    try {
      this.taskThemeMarksGeneration =
        (this.taskThemeMarksGeneration || 0) + 1;
      this.refreshTaskThemeMarkEditors();
      try {
        this.refreshTaskThemeRenderedMarks();
      } catch (error) {
        // Rendered-view hue refresh is best-effort.
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  scheduleTaskThemeMarksRefresh() {
    try {
      if (this.taskThemeRefreshTimer) {
        return;
      }
      const self = this;
      const later = () => {
        self.taskThemeRefreshTimer = null;
        try {
          if (self.taskThemeMarksEnabled === false) {
            return;
          }
          self.refreshTaskThemeMarksForCache();
        } catch (error) {
          // Coalesced refresh is best-effort.
        }
      };
      try {
        this.taskThemeRefreshTimer = setTimeout(later, 50);
      } catch (error) {
        later();
      }
    } catch (error) {
      // Scheduling never throws.
    }
  }

  taskThemeWireRefreshEvents() {
    try {
      if (this.taskThemeRefreshEventsWired) {
        return true;
      }
      this.taskThemeRefreshEventsWired = true;
      const metadataCache = this.app && this.app.metadataCache;
      if (
        metadataCache &&
        typeof metadataCache.on === "function" &&
        typeof this.registerEvent === "function"
      ) {
        try {
          this.registerEvent(
            metadataCache.on("changed", () => this.scheduleTaskThemeMarksRefresh()),
          );
        } catch (error) {
          // Metadata refresh is best-effort.
        }
        try {
          this.registerEvent(
            metadataCache.on("resolved", () => this.scheduleTaskThemeMarksRefresh()),
          );
        } catch (error) {
          // Metadata refresh is best-effort.
        }
      }
      const workspace = this.app && this.app.workspace;
      if (
        workspace &&
        typeof workspace.on === "function" &&
        typeof this.registerEvent === "function"
      ) {
        try {
          this.registerEvent(
            workspace.on(TODAY_RELOAD_EVENT, () =>
              this.scheduleTaskThemeMarksRefresh(),
            ),
          );
        } catch (error) {
          // Today refresh is best-effort.
        }
        try {
          this.registerEvent(
            workspace.on("layout-change", () => {
              try {
                this.taskThemeEnsureHoverForDocuments();
              } catch (inner) {
                // Popout hover hosts are best-effort.
              }
            }),
          );
        } catch (error) {
          // Layout hover hosts are best-effort.
        }
      }
      return true;
    } catch (error) {
      return false;
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

  taskThemeUntrackHoverRoot(root) {
    try {
      if (!root) {
        return;
      }
      const tracked = Array.isArray(this.taskThemeHoverRoots)
        ? this.taskThemeHoverRoots
        : [];
      const remaining = [];
      for (let index = 0; index < tracked.length; index += 1) {
        try {
          const entry = tracked[index];
          if (!entry || entry.root !== root) {
            if (entry) {
              remaining.push(entry);
            }
            continue;
          }
          const onHover = entry.onHover;
          if (
            typeof root.removeEventListener === "function" &&
            typeof onHover === "function"
          ) {
            try {
              root.removeEventListener("mouseover", onHover);
            } catch (error) {
              // Listener removal is best-effort.
            }
            try {
              root.removeEventListener("focusin", onHover);
            } catch (error) {
              // Listener removal is best-effort.
            }
          }
          try {
            root.__bobTaskThemeHover = false;
          } catch (error) {
            // Marker cleanup is best-effort.
          }
        } catch (error) {
          continue;
        }
      }
      this.taskThemeHoverRoots = remaining;
    } catch (error) {
      // Untrack never throws.
    }
  }

  taskThemeSyncNativeAccessibility(root) {
    try {
      const enabled = this.taskThemeMarksEnabled !== false;
      const docs = [];
      if (root) {
        docs.push(root);
      } else if (typeof this.markGateDocuments === "function") {
        const list = this.markGateDocuments();
        if (Array.isArray(list)) {
          for (let index = 0; index < list.length; index += 1) {
            const doc = list[index];
            docs.push((doc && doc.body) || doc);
          }
        }
      } else if (typeof document !== "undefined" && document) {
        docs.push(document.body || document);
      }
      for (let index = 0; index < docs.length; index += 1) {
        try {
          const scope = docs[index];
          if (!scope) {
            continue;
          }
          const stack = [scope];
          let guard = 0;
          while (stack.length > 0 && guard < 20000) {
            guard += 1;
            const node = stack.pop();
            if (!node || node.nodeType !== 1) {
              continue;
            }
            if (taskThemeHasClass(node, "bob-task-theme-native")) {
              try {
                if (enabled) {
                  node.setAttribute("aria-hidden", "true");
                } else if (typeof node.removeAttribute === "function") {
                  node.removeAttribute("aria-hidden");
                }
              } catch (error) {
                // Native aria is best-effort.
              }
            }
            if (taskThemeIsPill(node)) {
              try {
                if (enabled) {
                  if (typeof node.removeAttribute === "function") {
                    node.removeAttribute("aria-hidden");
                  }
                } else {
                  node.setAttribute("aria-hidden", "true");
                }
              } catch (error) {
                // Pill aria is best-effort.
              }
            }
            const kids = taskThemeChildList(node);
            for (let child = 0; child < kids.length; child += 1) {
              stack.push(kids[child]);
            }
          }
        } catch (error) {
          continue;
        }
      }
      return true;
    } catch (error) {
      return false;
    }
  }
}
