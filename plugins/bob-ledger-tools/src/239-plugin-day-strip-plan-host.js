// Day strip plan host: host the strip as the first child of the rendered
// `bob-plan` block of canonical daily notes, above the badges, in Live
// Preview and Reading view. Replaces the deleted CodeMirror end-of-note mount.
function dayStripPlanHostAddClass(el, name) {
  try {
    if (!el || !name) return;
    if (el.classList && typeof el.classList.add === "function") {
      el.classList.add(name);
      return;
    }
    if (typeof el.addClass === "function") {
      el.addClass(name);
      return;
    }
    const current = typeof el.getAttribute === "function"
      ? el.getAttribute("class")
      : (el.attrs instanceof Map ? el.attrs.get("class") : null) || el.cls || "";
    const parts = String(current || "").split(/\s+/).filter(Boolean);
    if (!parts.includes(name)) {
      parts.push(name);
      const next = parts.join(" ");
      if (typeof el.setAttribute === "function") el.setAttribute("class", next);
      else if (el.attrs instanceof Map) el.attrs.set("class", next);
      else el.cls = next;
    }
  } catch (error) {
    // Class assignment is cosmetic.
  }
}

function dayStripPlanHostRemoveClass(el, name) {
  try {
    if (!el || !name) return;
    if (el.classList && typeof el.classList.remove === "function") {
      el.classList.remove(name);
      return;
    }
    if (typeof el.removeClass === "function") {
      el.removeClass(name);
      return;
    }
    const current = typeof el.getAttribute === "function"
      ? el.getAttribute("class")
      : (el.attrs instanceof Map ? el.attrs.get("class") : null) || el.cls || "";
    const parts = String(current || "").split(/\s+/).filter(Boolean).filter((part) => part !== name);
    const next = parts.join(" ");
    if (typeof el.setAttribute === "function") {
      if (next) el.setAttribute("class", next);
      else if (typeof el.removeAttribute === "function") el.removeAttribute("class");
    } else if (el.attrs instanceof Map) {
      if (next) el.attrs.set("class", next);
      else el.attrs.delete("class");
    } else {
      el.cls = next;
    }
  } catch (error) {
    // Class removal is best-effort.
  }
}

function dayStripPlanHostHasClass(el, name) {
  try {
    if (!el || !name) return false;
    if (el.classList && typeof el.classList.contains === "function") {
      return el.classList.contains(name);
    }
    const current = typeof el.getAttribute === "function"
      ? el.getAttribute("class")
      : (el.attrs instanceof Map ? el.attrs.get("class") : null) || el.cls || "";
    return String(current || "").split(/\s+/).includes(name);
  } catch (error) {
    return false;
  }
}

function dayStripPlanHostHasObserver() {
  try {
    return typeof IntersectionObserver === "function";
  } catch (error) {
    return false;
  }
}

function dayStripPlanHostIsConnected(el) {
  try {
    if (!el) return false;
    let node = el;
    while (node) {
      try {
        if (node.isConnected === false) return false;
      } catch (error) {
        // Treat an unreadable flag as connected.
      }
      node = node.parentNode || null;
    }
    return true;
  } catch (error) {
    return true;
  }
}

function dayStripPlanHostExcluded(el) {
  try {
    if (!el) return false;
    const selector = ".hover-popover, .markdown-embed, .canvas-node";
    let node = el;
    while (node) {
      try {
        if (typeof node.closest === "function") {
          let found = null;
          try {
            found = node.closest(selector);
          } catch (error) {
            found = null;
          }
          if (found) return true;
        }
      } catch (error) {
        // One unreadable ancestor never excludes.
      }
      node = node.parentNode || null;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function dayStripPlanHostRemoveNode(node) {
  try {
    if (!node) return;
    if (typeof node.remove === "function") {
      node.remove();
      return;
    }
    const parent = node.parentNode;
    if (parent && typeof parent.removeChild === "function") {
      parent.removeChild(node);
      return;
    }
    if (parent && Array.isArray(parent.children)) {
      const index = parent.children.indexOf(node);
      if (index >= 0) parent.children.splice(index, 1);
      node.parentNode = null;
    }
  } catch (error) {
    // Removal is best-effort.
  }
}

class BobLedgerToolsDayStripPlanHostMixin {
  setupDayStripPlanHost() {
    try {
      if (typeof this.dayStripSessionEnabled !== "boolean") {
        this.dayStripSessionEnabled = true;
      }
      if (this.dayStripPlanHostSetup === true) return;
      this.dayStripPlanHostSetup = true;
      this.dayStripConfigLastEnabled = this.dayStripConfigEnabled();
      if (typeof this.addCommand === "function") {
        this.addCommand({
          id: "toggle-day-stats",
          name: "Toggle Day stats",
          callback: () => this.toggleDayStripPlanHost(),
        });
        this.addCommand({
          id: "cycle-day-stats-bars",
          name: "Cycle Day stats bars",
          callback: () => this.cycleDayStripBarsCommand(),
        });
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
        // Config polling is best-effort.
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

  // The last `stats.day_strip` value read at setup, by the 60 s poll, or
  // before a strip re-check cycle. Renders never read the config file.
  dayStripConfigCached() {
    if (typeof this.dayStripConfigLastEnabled !== "boolean") {
      this.dayStripConfigLastEnabled = this.dayStripConfigEnabled();
    }
    return this.dayStripConfigLastEnabled;
  }

  dayStripCheckConfig() {
    try {
      const enabled = this.dayStripConfigEnabled();
      if (enabled === this.dayStripConfigLastEnabled) return false;
      this.dayStripConfigLastEnabled = enabled;
      this.refreshDayStripPlanHosts();
      return true;
    } catch (error) {
      return false;
    }
  }

  toggleDayStripPlanHost() {
    try {
      this.dayStripSessionEnabled = this.dayStripSessionEnabled === false;
      const enabled = this.dayStripSessionEnabled;
      this.refreshDayStripPlanHosts();
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

  cycleDayStripBarsCommand() {
    try {
      let view = "both";
      try {
        if (typeof this.dayStripCycleLaneView === "function") {
          view = this.dayStripCycleLaneView() || "both";
        } else if (typeof this.dayStripLaneViewCurrent === "function") {
          view = this.dayStripLaneViewCurrent();
        }
      } catch (error) {
        view = "both";
      }
      const message = view === "roots"
        ? "Day stats bars: root parents only"
        : view === "themes"
          ? "Day stats bars: themes only"
          : "Day stats bars: root parents and themes";
      try {
        new Notice(message);
      } catch (error) {
        // Notice is best-effort.
      }
      return view;
    } catch (error) {
      return "both";
    }
  }

  dayStripPlanHostViewFor(el) {
    try {
      if (!el || !(this.planBlockViews instanceof Set)) return null;
      for (const view of this.planBlockViews) {
        if (view && view.el === el) return view;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  // Idempotent attach and detach for one plan-block view
  // `{ el, sourcePath }`, following the Where-it-renders conditions.
  dayStripSyncPlanHost(view) {
    try {
      const el = view && view.el ? view.el : null;
      const sourcePath = view && typeof view.sourcePath === "string" ? view.sourcePath : "";
      const detach = () => {
        try {
          this.dayStripReleasePlanHost(view);
        } catch (error) {
          // Detach is best-effort.
        }
      };
      if (!el) {
        return;
      }
      let day = null;
      try {
        day = dayStripDayForPath(sourcePath);
      } catch (error) {
        day = null;
      }
      let localToday = "";
      try {
        localToday = this.dayStripLocalNow();
      } catch (error) {
        localToday = "";
      }
      const shouldHost = Boolean(
        day &&
        localToday &&
        day <= localToday &&
        this.dayStripCanSpawn() &&
        this.dayStripSessionEnabled !== false &&
        this.dayStripConfigCached(),
      );
      if (!shouldHost) {
        detach();
        return;
      }
      // Obsidian calls code-block processors with a detached element
      // that is inserted afterward, so connectivity must never gate
      // attachment. The observer callback is the authority once the
      // block is in the document.
      if (dayStripPlanHostExcluded(el)) {
        detach();
        return;
      }
      try {
        const processorContainer = view && view.containerEl ? view.containerEl : null;
        let isElement = false;
        try {
          isElement =
            (processorContainer !== null &&
              typeof processorContainer === "object" &&
              (processorContainer.nodeType === 1 ||
                typeof processorContainer.closest === "function" ||
                (typeof processorContainer.tagName === "string" &&
                  typeof processorContainer.querySelector === "function")));
        } catch (error) {
          isElement = false;
        }
        if (isElement) {
          if (
            dayStripPlanHostIsConnected(processorContainer) &&
            dayStripPlanHostExcluded(processorContainer)
          ) {
            detach();
            return;
          }
        }
      } catch (error) {
        // Processor-container exclusion is best-effort early detection.
      }
      let existing = view.dayStripRecord || null;
      try {
        if (existing && !(this.dayStripViewsStore().has(existing))) {
          existing = null;
          view.dayStripRecord = null;
          view.dayStripHost = null;
        }
      } catch (error) {
        existing = view.dayStripRecord || null;
      }
      if (existing && existing.el && existing.el.parentNode !== el) {
        // The plan repaint must never detach the host; a host found
        // outside its block is stale.
        try {
          this.dayStripReleaseRecord(existing);
        } catch (error) {
          // Release is best-effort.
        }
        existing = null;
        view.dayStripRecord = null;
        view.dayStripHost = null;
      }
      if (existing) {
        existing.day = day;
        existing.path = sourcePath;
        try {
          this.dayStripPaint(existing);
        } catch (error) {
          // Paint is best-effort.
        }
        try {
          this.dayStripCheck(existing);
        } catch (error) {
          // Check is best-effort.
        }
        return;
      }
      let host = null;
      try {
        const doc = statsDocFor(el);
        host = statsEl(doc, "div", { class: "bob-day-strip-plan-host" });
        if (!host && doc && typeof doc.createElement === "function") {
          host = doc.createElement("div");
        }
      } catch (error) {
        host = null;
      }
      if (!host) {
        return;
      }
      try {
        let attached = false;
        try {
          if (typeof el.insertBefore === "function") {
            const first = el.firstChild || (Array.isArray(el.children) ? el.children[0] : null) || null;
            el.insertBefore(host, first);
            attached = host.parentNode === el || true;
          }
        } catch (error) {
          attached = false;
        }
        if (!attached && typeof el.prepend === "function") {
          try {
            el.prepend(host);
            attached = true;
          } catch (error) {
            attached = false;
          }
        }
        if (!attached && typeof el.createDiv === "function" && typeof el.insertBefore !== "function") {
          const placed = el.createDiv({ cls: "bob-day-strip-plan-host" });
          host = placed || host;
          if (placed !== host && host.parentNode !== el && typeof el.appendChild === "function") {
            el.appendChild(host);
          }
          attached = true;
        }
        if (!attached && typeof el.appendChild === "function") {
          // Fake-DOM harnesses without insertBefore: prepend via children array.
          if (Array.isArray(el.children)) {
            if (el.children.includes(host)) {
              el.children = el.children.filter((child) => child !== host);
            }
            host.parentNode = el;
            el.children.unshift(host);
          } else {
            el.appendChild(host);
          }
        } else if (!attached && Array.isArray(el.children)) {
          if (el.children.includes(host)) {
            el.children = el.children.filter((child) => child !== host);
          }
          host.parentNode = el;
          el.children.unshift(host);
        } else if (!attached) {
          return;
        }
      } catch (error) {
        return;
      }
      // Recheck exclusion after attachment: processors can receive
      // detached elements whose ancestors only resolve now. Connectivity
      // is never rechecked here; the observer decides once the block is
      // in the document.
      if (dayStripPlanHostExcluded(el) || dayStripPlanHostExcluded(host)) {
        dayStripPlanHostRemoveNode(host);
        detach();
        return;
      }
      dayStripPlanHostAddClass(el, "bob-plan-has-day-strip");
      const record = {
        el: host,
        day,
        path: sourcePath,
        kind: "plan",
        observer: null,
        visible: false,
        planView: view,
      };
      try {
        this.dayStripViewsStore().add(record);
      } catch (error) {
        // Store init is best-effort.
      }
      view.dayStripHost = host;
      view.dayStripRecord = record;
      try {
        this.dayStripObservePlanHost(record, view);
      } catch (error) {
        // Observation is best-effort.
      }
      try {
        this.dayStripPaint(record);
      } catch (error) {
        // Paint is best-effort.
      }
      try {
        this.dayStripCheck(record);
      } catch (error) {
        // Check is best-effort.
      }
    } catch (error) {
      // Sync never breaks the plan block.
    }
  }

  // Observe a plan host: paint happens immediately from cache, but the
  // first fetch waits for the observer's first visibility notification.
  // The shared registry callback drives visibility and re-checks the
  // popover/embed/canvas exclusion. Never depends on a test-only
  // `trigger` method or a selector-less `closest()` call.
  dayStripObservePlanHost(record, view) {
    try {
      if (!record) return;
      if (!dayStripPlanHostHasObserver()) {
        // No-observer fallback: a plan host is shown only while its block
        // and host are connected and not excluded. Visibility is decided
        // at check time so a detached-then-attached block still fetches;
        // a connected excluded host is released.
        try {
          const blockEl = (view && view.el) || null;
          const hostEl = record.el || null;
          const target = blockEl || hostEl;
          const connected =
            dayStripPlanHostIsConnected(target) && dayStripPlanHostIsConnected(hostEl);
          const excluded =
            dayStripPlanHostExcluded(target) || dayStripPlanHostExcluded(hostEl);
          if (connected && excluded) {
            try {
              if (typeof this.dayStripReleasePlanHost === "function" && view) {
                this.dayStripReleasePlanHost(view);
              } else if (typeof this.dayStripReleaseRecord === "function") {
                this.dayStripReleaseRecord(record);
              }
            } catch (error) {
              // Release is best-effort.
            }
            return;
          }
          if (!connected || excluded) {
            record.visible = false;
            return;
          }
          record.visible = true;
        } catch (error) {
          record.visible = true;
        }
        return;
      }
      // Observer path: visibility is unknown until the first callback.
      try {
        record.visible = false;
      } catch (error) {
        // Visibility flag is best-effort.
      }
      if (typeof this.dayStripObserve === "function") {
        this.dayStripObserve(record);
      }
    } catch (error) {
      try {
        if (record) record.visible = false;
      } catch (inner) {
        // Visibility is best-effort.
      }
    }
  }

  refreshDayStripPlanHosts() {
    try {
      if (!(this.planBlockViews instanceof Set)) return;
      for (const view of Array.from(this.planBlockViews)) {
        try {
          // A rollover can turn a future block into today (attach) or
          // today into a past day (repaint as past).
          if (view && view.dayStripRecord) {
            view.dayStripRecord.paintedKey = null;
          }
          this.dayStripSyncPlanHost(view);
        } catch (error) {
          // One stale block never breaks the others.
        }
      }
      try {
        this.dayStripCheckAll();
      } catch (error) {
        // Checking is best-effort.
      }
    } catch (error) {
      // Refresh is best-effort.
    }
  }

  dayStripReleasePlanHost(view) {
    try {
      const record = view && view.dayStripRecord ? view.dayStripRecord : null;
      const host = (view && view.dayStripHost) || (record && record.el) || null;
      const blockEl = view && view.el ? view.el : (host && host.parentNode) || null;
      if (record) {
        try {
          this.dayStripReleaseRecord(record);
        } catch (error) {
          // Release is best-effort.
        }
      }
      if (view) {
        view.dayStripRecord = null;
        view.dayStripHost = null;
      }
      if (host) {
        // Only remove a host that still belongs to this block.
        const belongs = !blockEl || host.parentNode === blockEl || (Array.isArray(blockEl.children) && blockEl.children.includes(host));
        if (belongs) {
          dayStripPlanHostRemoveNode(host);
        }
      }
      if (blockEl) {
        // Drop the spacing class when no plan host remains in the block.
        let remaining = false;
        try {
          if (typeof this.dayStripViewsStore === "function") {
            for (const entry of Array.from(this.dayStripViewsStore())) {
              if (entry && entry.kind === "plan" && entry.el && entry.el.parentNode === blockEl) {
                remaining = true;
                break;
              }
            }
          }
        } catch (error) {
          remaining = false;
        }
        if (!remaining) {
          dayStripPlanHostRemoveClass(blockEl, "bob-plan-has-day-strip");
        }
      }
    } catch (error) {
      // Release never breaks the plan block.
    }
  }

  // Reserve one chip row synchronously so the badges never jump when
  // they land. Finds the `.bob-plan` container by class, never by index.
  // Never throws.
  dayStripPlanHostEnsurePlaceholder(el) {
    try {
      if (!el) return null;
      try {
        if (el.querySelector && typeof el.querySelector === "function") {
          const found = el.querySelector(".bob-plan");
          if (found) return found;
        }
      } catch (error) {
        // Fall through to the children scan.
      }
      try {
        const children = Array.isArray(el.children) ? el.children : (el.childNodes ? Array.from(el.childNodes) : []);
        for (const child of children) {
          try {
            const cls = (typeof child.getAttribute === "function" ? child.getAttribute("class") : child.cls) || "";
            if (String(cls).split(/\s+/).includes("bob-plan")) return child;
          } catch (error) {
            continue;
          }
        }
      } catch (error) {
        // Fall through to creation.
      }
      if (typeof el.createDiv === "function") {
        try {
          return el.createDiv({ cls: "bob-plan" });
        } catch (error) {
          // Fall through to the document path.
        }
      }
      try {
        const doc = statsDocFor(el);
        const container = statsEl(doc, "div", { class: "bob-plan" });
        if (!container) return null;
        if (typeof el.appendChild === "function") {
          el.appendChild(container);
        } else if (Array.isArray(el.children)) {
          container.parentNode = el;
          el.children.push(container);
        } else {
          return null;
        }
        return container;
      } catch (error) {
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  // Preserve the strip host across the plan block's repaint: remove every
  // child except the host and return it (or null when there is none).
  // Never detaches the host. Never throws.
  dayStripPlanHostForRepaint(el) {
    try {
      if (!el) return null;
      let host = null;
      try {
        const view = this.dayStripPlanHostViewFor(el);
        host = (view && (view.dayStripHost || (view.dayStripRecord && view.dayStripRecord.el))) || null;
      } catch (error) {
        host = null;
      }
      if (!host) {
        try {
          if (this.dayStripViewsStore instanceof Set) {
            for (const entry of Array.from(this.dayStripViewsStore())) {
              if (entry && entry.kind === "plan" && entry.el && entry.el.parentNode === el) {
                host = entry.el;
                break;
              }
            }
          } else if (typeof this.dayStripViewsStore === "function") {
            for (const entry of Array.from(this.dayStripViewsStore())) {
              if (entry && entry.kind === "plan" && entry.el && entry.el.parentNode === el) {
                host = entry.el;
                break;
              }
            }
          }
        } catch (error) {
          // Store scan is best-effort.
        }
      }
      if (!host && Array.isArray(el.children)) {
        for (const child of el.children) {
          try {
            const cls = (typeof child.getAttribute === "function" ? child.getAttribute("class") : child.cls) || "";
            if (String(cls).split(/\s+/).includes("bob-day-strip")) {
              host = child;
              break;
            }
          } catch (error) {
            continue;
          }
        }
      }
      if (!host) {
        try {
          if (typeof el.empty === "function") el.empty();
          else if (Array.isArray(el.children)) {
            for (const child of el.children) child.parentNode = null;
            el.children.length = 0;
            el.textContent = "";
          } else if (typeof el.replaceChildren === "function") el.replaceChildren();
          else el.textContent = "";
        } catch (error) {
          // Empty is best-effort.
        }
        return null;
      }
      try {
        const children = Array.isArray(el.children) ? Array.from(el.children) : Array.from(el.childNodes || []);
        for (const child of children) {
          if (child === host) continue;
          try {
            if (typeof el.removeChild === "function") el.removeChild(child);
            else dayStripPlanHostRemoveNode(child);
          } catch (error) {
            continue;
          }
        }
        // FakeNode-style children arrays need an explicit sweep when
        // removeChild is unavailable.
        if (Array.isArray(el.children) && !el.children.includes(host)) {
          host.parentNode = el;
          el.children.push(host);
        }
        if (Array.isArray(el.children)) {
          el.children = el.children.filter((child) => child === host);
          if (el.children[0] !== host) {
            el.children.unshift(host);
          }
        }
      } catch (error) {
        // Preservation is best-effort.
      }
      return host;
    } catch (error) {
      return null;
    }
  }

  // Keep the strip host first with `.bob-plan` directly after it.
  // Never throws.
  dayStripPlanHostPlacePlanAfter(el, container, host) {
    try {
      if (!el || !container) return;
      if (!host) return;
      try {
        if (typeof el.insertBefore === "function") {
          const next = host.nextSibling || null;
          // Fake-DOM harnesses may lack nextSibling; fall back to index.
          if (next || host.parentNode === el) {
            el.insertBefore(container, next);
            return;
          }
          if (Array.isArray(el.children)) {
            const hostIndex = el.children.indexOf(host);
            if (hostIndex >= 0) {
              el.children = el.children.filter((child) => child !== container);
              el.children.splice(hostIndex + 1, 0, container);
              container.parentNode = el;
              return;
            }
          }
          el.insertBefore(container, next);
          return;
        }
      } catch (error) {
        // Fall through to the children-array path.
      }
      try {
        if (Array.isArray(el.children)) {
          el.children = el.children.filter((child) => child !== container);
          const index = el.children.indexOf(host);
          if (index < 0) {
            el.children.unshift(host);
            el.children.splice(1, 0, container);
          } else {
            el.children.splice(index + 1, 0, container);
          }
          container.parentNode = el;
        }
      } catch (error) {
        // Ordering is best-effort.
      }
    } catch (error) {
      // Ordering never breaks the plan block.
    }
  }

  // Legacy alias: the host used to sit after the badges.
  dayStripPlanHostPlacePlanFirst(el, container, host) {
    return this.dayStripPlanHostPlacePlanAfter(el, container, host);
  }
}
