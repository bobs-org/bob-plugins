// Root parents Stats panel. The report owns attribution and labels; this
// mixin only groups supplied parts and routes links back into Obsidian.
class BobLedgerToolsStatsHomesMixin {
  statsPanelHomeToggle(doc, view, report, metric) {
    const available = statsPanelHasHomes(metric);
    const hasRoots = typeof statsPanelHasRootParents === "function"
      ? statsPanelHasRootParents(metric)
      : false;
    const state = this.statsViewStateFor(view && view.sourcePath);
    if (state.homesView === "areas") {
      // Stale pre-roots view maps to the Root parents default.
      state.homesView = hasRoots ? "roots" : "areas";
    }
    if (state.homesView !== "roots" && state.homesView !== "themes" && state.homesView !== "areas") {
      if (hasRoots) {
        state.homesView = "roots";
      } else {
        state.homesView = available ? "areas" : "themes";
      }
    }
    if (hasRoots && state.homesView === "areas") {
      state.homesView = "roots";
    }
    if (!hasRoots && state.homesView === "roots") {
      state.homesView = available ? "areas" : "themes";
    }
    const point = statsPanelSelectedHomePoint(metric, report, state);
    const total = point && typeof point.display === "string"
      ? point.display
      : statsPanelTotalDisplay(metric);
    const title = "Where the time went · " + statsPanelHomeSpan(point, report) + " · " + (total || "–");
    const header = statsEl(doc, "div", { class: "bob-stats-home-header" });
    header.appendChild(this.statsPanelTitle(doc, title));
    const controls = statsEl(doc, "div", {
      class: "bob-stats-home-toggle",
      role: "group",
      "aria-label": "Pomodoro context view",
    });
    const choices = hasRoots
      ? [
        { id: "roots", label: "Root parents", disabled: false },
        { id: "themes", label: "Themes", disabled: false },
      ]
      : [
        { id: "areas", label: "Areas & projects", disabled: !available },
        { id: "themes", label: "Themes", disabled: false },
      ];
    for (const choice of choices) {
      const button = statsEl(doc, "button", {
        class: "bob-stats-toggle" + (state.homesView === choice.id ? " bob-stats-toggle-on" : ""),
        type: "button",
        disabled: choice.disabled,
        "aria-pressed": state.homesView === choice.id ? "true" : "false",
        "data-stats-focus-key": "panel-home-view-" + choice.id,
      }, choice.label);
      button.addEventListener("click", () => {
        state.homesView = choice.id;
        this.statsRenderLocally(view, "panel-home-view-" + choice.id);
      });
      controls.appendChild(button);
    }
    header.appendChild(controls);
    return { header, available, hasRoots, state };
  }

  statsPanelHomeFixCopy(key) {
    if (key === "@unlinked") return "link the task to attribute it";
    if (key === "@unfiled") return "file the task in an area or project";
    if (typeof key === "string" && key.startsWith("@review:")) {
      return "GTD review stays grouped here; name mixed work to attribute it separately.";
    }
    return "This is a reserved Stats bucket.";
  }

  statsPanelOpenHome(path, view, event) {
    const workspace = this.app && this.app.workspace;
    if (!path || !workspace || typeof workspace.openLinkText !== "function") return false;
    workspace.openLinkText(path, view && view.sourcePath || "", Boolean(event && (event.ctrlKey || event.metaKey)));
    return true;
  }

  statsPanelOpenSession(session, view) {
    if (!session || typeof session.path !== "string") return false;
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.openLinkText !== "function") return false;
    const openResult = workspace.openLinkText(session.path, view && view.sourcePath || "", false);
    const jump = () => {
      try {
        const leaf = workspace.activeLeaf || (typeof workspace.getMostRecentLeaf === "function" && workspace.getMostRecentLeaf());
        const editor = leaf && leaf.view && leaf.view.editor;
        const line = Math.max(0, (Number(session.line) || 1) - 1);
        if (editor && typeof editor.setCursor === "function") {
          editor.setCursor({ line, ch: 0 });
          if (typeof editor.scrollIntoView === "function") {
            editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
          }
        }
      } catch (error) {
        // Opening the daily note is still useful if the editor cannot jump.
      }
    };
    if (openResult && typeof openResult.then === "function") openResult.then(jump, () => {});
    else if (typeof window !== "undefined" && typeof window.setTimeout === "function") window.setTimeout(jump, 0);
    else jump();
    return true;
  }

  statsPanelHomeLink(doc, view, row, dimension) {
    if (!row.path) return statsEl(doc, "span", { class: "bob-stats-home-label" }, row.label);
    const button = statsEl(doc, "button", {
      class: "bob-stats-home-link",
      type: "button",
      "aria-label": "Open " + row.label,
    }, row.label);
    button.addEventListener("click", (event) => this.statsPanelOpenHome(row.path, view, event));
    return button;
  }

  statsPanelHomeSessionButton(doc, view, report, metric, dimension, row, point) {
    const sessions = statsPanelHomeSessions(report, dimension, row.key, point);
    if (!Array.isArray(report && report.sessions) || sessions.length === 0) return null;
    const state = this.statsViewStateFor(view && view.sourcePath);
    const id = dimension + ":" + row.key;
    if (!state.homeSessionsExpanded || typeof state.homeSessionsExpanded !== "object") state.homeSessionsExpanded = {};
    if (!state.homeSessionsAll || typeof state.homeSessionsAll !== "object") state.homeSessionsAll = {};
    const expanded = state.homeSessionsExpanded[id] === true;
    const button = statsEl(doc, "button", {
      class: "bob-stats-home-sessions-toggle",
      type: "button",
      "aria-expanded": expanded ? "true" : "false",
      "data-stats-focus-key": "panel-home-sessions-" + id,
    }, "sessions " + sessions.length);
    button.addEventListener("click", () => {
      state.homeSessionsExpanded[id] = !expanded;
      this.statsRenderLocally(view, "panel-home-sessions-" + id);
    });
    const result = { button, list: null };
    if (!expanded) return result;
    const list = statsEl(doc, "ul", { class: "bob-stats-home-sessions", "aria-label": "Sessions for " + row.label });
    const all = state.homeSessionsAll[id] === true;
    const visible = all ? sessions : sessions.slice(0, 20);
    for (const [index, session] of visible.entries()) {
      const parts = session.homes && Array.isArray(session.homes.parts) ? session.homes.parts : [];
      const shares = parts.map((part) => {
        const label = statsPanelHomeLabel(report, "project", part.key, part);
        return label + " " + (typeof part.share === "number" ? part.share : 0) + "%";
      }).join(" · ");
      const name = session.name || (session.homes && session.homes.label) || "(unnamed)";
      const range = session.time_range || "time unavailable";
      const text = [session.date || "date unavailable", range, session.minutes_display || "–", name, shares]
        .filter(Boolean).join(" · ");
      const item = statsEl(doc, "li", { class: "bob-stats-home-session-item" });
      const open = statsEl(doc, "button", {
        class: "bob-stats-home-session-link",
        type: "button",
        "aria-label": "Open " + name + " on " + (session.date || "unknown date") + " at line " + (session.line || 1),
        "data-stats-focus-key": "panel-home-session-" + id + "-" + index,
      }, text);
      open.addEventListener("click", () => this.statsPanelOpenSession(session, view));
      item.appendChild(open);
      list.appendChild(item);
    }
    if (!all && sessions.length > 20) {
      const item = statsEl(doc, "li", { class: "bob-stats-home-session-more" });
      const more = statsEl(doc, "button", {
        class: "bob-stats-home-sessions-toggle",
        type: "button",
        "data-stats-focus-key": "panel-home-session-more-" + id,
      }, "Show all " + sessions.length + " sessions");
      more.addEventListener("click", () => {
        state.homeSessionsAll[id] = true;
        this.statsRenderLocally(view, "panel-home-session-more-" + id);
      });
      item.appendChild(more);
      list.appendChild(item);
    }
    result.list = list;
    return result;
  }

  statsPanelHomeGroupRow(doc, view, report, metric, row, dimension, point, tint) {
    const isBucket = row.key.startsWith("@");
    const hue = row.hue || "gray";
    const group = statsEl(doc, "div", {
      class: "bob-stats-home-row " + (dimension === "area" ? "bob-stats-home-area-row" : "bob-stats-home-project-row") +
        (isBucket ? " bob-stats-home-bucket" : "") + " bob-stats-home-" + hue,
    });
    const dot = statsEl(doc, "span", { class: "bob-stats-home-dot", "aria-hidden": "true" });
    group.appendChild(dot);
    group.appendChild(this.statsPanelHomeLink(doc, view, row, dimension));
    const amount = row.display + (row.share ? " · " + row.share : "");
    group.appendChild(statsEl(doc, "span", { class: "bob-stats-home-value" }, amount));
    const sessions = metric.kind === "pomodoro"
      ? this.statsPanelHomeSessionButton(doc, view, report, metric, dimension, row, point)
      : null;
    if (sessions) {
      group.appendChild(sessions.button);
      if (sessions.list) {
        const wrap = statsEl(doc, "div", { class: "bob-stats-home-sessions-wrap" });
        wrap.appendChild(sessions.list);
        group.appendChild(wrap);
      }
    }
    if (dimension === "project" && isBucket) {
      group.appendChild(statsEl(doc, "div", { class: "bob-stats-home-fix" }, this.statsPanelHomeFixCopy(row.key)));
    }
    return group;
  }

  statsPanelHomeMiniBar(doc, row, maxValue, metric, tint) {
    const width = maxValue > 0 ? Math.max(0, Math.min(100, (row.value / maxValue) * 100)) : 0;
    const apportioned = tint ? Math.max(0, Math.min(row.value, row.apportioned || 0)) : 0;
    const directShare = row.value > 0 ? ((row.value - apportioned) / row.value) * 100 : 0;
    const apportionedShare = row.value > 0 ? (apportioned / row.value) * 100 : 0;
    const outer = statsEl(doc, "span", {
      class: "bob-stats-home-mini-track bob-stats-home-" + (row.hue || "gray"),
      "aria-hidden": "true",
    });
    const bar = statsEl(doc, "span", { class: "bob-stats-home-mini-fill", style: "width: " + width + "%" });
    bar.appendChild(statsEl(doc, "span", { class: "bob-stats-home-mini-direct", style: "width: " + directShare + "%" }));
    if (apportioned > 0) {
      bar.appendChild(statsEl(doc, "span", {
        class: "bob-stats-home-mini-apportioned",
        style: "width: " + apportionedShare + "%",
      }));
    }
    outer.appendChild(bar);
    return outer;
  }

  statsPanelHomeProjectRow(doc, view, report, metric, row, point, maxValue, tint) {
    const item = statsEl(doc, "div", { class: "bob-stats-home-project" + (row.key.startsWith("@") ? " bob-stats-home-bucket" : "") });
    const top = statsEl(doc, "div", { class: "bob-stats-home-project-top bob-stats-home-" + (row.hue || "gray") });
    top.appendChild(this.statsPanelHomeLink(doc, view, row, "project"));
    top.appendChild(statsEl(doc, "span", { class: "bob-stats-home-value" }, row.display + (row.share ? " · " + row.share : "")));
    const sessions = metric.kind === "pomodoro"
      ? this.statsPanelHomeSessionButton(doc, view, report, metric, "project", row, point)
      : null;
    if (sessions) {
      top.appendChild(sessions.button);
      if (sessions.list) {
        const wrap = statsEl(doc, "div", { class: "bob-stats-home-sessions-wrap" });
        wrap.appendChild(sessions.list);
        top.appendChild(wrap);
      }
    }
    item.appendChild(top);
    const bar = this.statsPanelHomeMiniBar(doc, row, maxValue, metric, tint);
    if (bar) item.appendChild(bar);
    if (row.key.startsWith("@")) {
      item.appendChild(statsEl(doc, "div", { class: "bob-stats-home-fix" }, this.statsPanelHomeFixCopy(row.key)));
    }
    return item;
  }

  statsPanelHomeAreaBar(doc, view, metric, report, rows, ariaLabel) {
    const ordered = statsPanelHomeAreaRows(rows, report);
    const total = ordered.reduce((sum, row) => sum + Math.max(0, row.value || 0), 0);
    const wrap = statsEl(doc, "div", { class: "bob-stats-home-area-bar-wrap" });
    const summary = ordered.map((row) => row.label + " " + row.display + (row.share ? " (" + row.share + ")" : ""));
    const bar = statsEl(doc, "div", {
      class: "bob-stats-home-area-bar",
      role: "img",
      "aria-label": (ariaLabel || "Area split") + ": " + (summary.join(", ") || "no area data"),
    });
    const width = this.statsPanelWidth(view);
    for (const [index, row] of ordered.entries()) {
      const hue = row.hue || "gray";
      const percent = total > 0 ? Math.max(0, row.value / total) * 100 : 0;
      const segment = statsEl(doc, "span", {
        class: "bob-stats-home-area-segment bob-stats-home-" + hue,
        style: "flex-basis: " + percent + "%",
        title: row.label + " · " + row.display + (row.share ? " · " + row.share : ""),
      });
      const estimatedTextWidth = row.label.length * 6.5 + row.display.length * 5.5 + 22;
      if (width * (percent / 100) >= estimatedTextWidth) {
        segment.appendChild(statsEl(doc, "span", { class: "bob-stats-home-area-segment-label" }, row.label + " · " + row.display));
      }
      segment.setAttribute("data-order", String(index));
      bar.appendChild(segment);
    }
    wrap.appendChild(bar);
    return wrap;
  }

  statsPanelRootRow(doc, view, report, metric, row, point, maxValue, tint) {
    const isBucket = row.key.startsWith("@");
    const item = statsEl(doc, "div", { class: "bob-stats-home-project" + (isBucket ? " bob-stats-home-bucket" : "") });
    const top = statsEl(doc, "div", { class: "bob-stats-home-project-top bob-stats-home-" + (row.hue || "gray") });
    top.appendChild(this.statsPanelHomeLink(doc, view, row, "root_parent"));
    top.appendChild(statsEl(doc, "span", { class: "bob-stats-home-value" }, row.display + (row.share ? " · " + row.share : "")));
    const sessions = metric.kind === "pomodoro"
      ? this.statsPanelHomeSessionButton(doc, view, report, metric, "root_parent", row, point)
      : null;
    if (sessions) {
      top.appendChild(sessions.button);
      if (sessions.list) {
        const wrap = statsEl(doc, "div", { class: "bob-stats-home-sessions-wrap" });
        wrap.appendChild(sessions.list);
        top.appendChild(wrap);
      }
    }
    item.appendChild(top);
    const bar = this.statsPanelHomeMiniBar(doc, row, maxValue, metric, tint);
    if (bar) item.appendChild(bar);
    if (isBucket) {
      item.appendChild(statsEl(doc, "div", { class: "bob-stats-home-fix" }, this.statsPanelHomeFixCopy(row.key)));
    }
    return item;
  }

  statsPanelRootSubs(doc, view, report, metric, root, point, tint) {
    const catalog = statsPanelHomeCatalog(report);
    const entry = catalog[root.key] && typeof catalog[root.key] === "object" ? catalog[root.key] : null;
    if (!entry || entry.kind !== "project") return null;
    const leaves = typeof statsPanelRootSubRows === "function"
      ? statsPanelRootSubRows(metric, report, root.key, point)
      : [];
    const others = leaves.filter((leaf) => leaf.key !== root.key);
    if (!others.length) return null;
    const state = this.statsViewStateFor(view && view.sourcePath);
    if (!state.homeSubsExpanded || typeof state.homeSubsExpanded !== "object") state.homeSubsExpanded = {};
    const expanded = state.homeSubsExpanded[root.key] === true;
    const toggle = statsEl(doc, "button", {
      class: "bob-stats-home-subs-toggle",
      type: "button",
      "aria-expanded": expanded ? "true" : "false",
      "data-stats-focus-key": "panel-home-subs-" + root.key,
    }, (expanded ? "▾ " : "▸ ") + others.length + " sub-project" + (others.length === 1 ? "" : "s"));
    toggle.addEventListener("click", () => {
      state.homeSubsExpanded[root.key] = !expanded;
      this.statsRenderLocally(view, "panel-home-subs-" + root.key);
    });
    const wrap = statsEl(doc, "div", { class: "bob-stats-home-subs" });
    wrap.appendChild(toggle);
    if (!expanded) return wrap;
    const list = statsEl(doc, "div", { class: "bob-stats-home-subs-list", "aria-label": "Sub-projects of " + root.label });
    const maxValue = Math.max(0, root.value || 0);
    const rootHue = root.hue || "gray";
    for (const leaf of leaves) {
      leaf.hue = rootHue;
      const row = statsEl(doc, "div", { class: "bob-stats-home-sub-leaf" + (leaf.key.startsWith("@") ? " bob-stats-home-bucket" : "") });
      const top = statsEl(doc, "div", { class: "bob-stats-home-sub-top bob-stats-home-" + rootHue });
      top.appendChild(this.statsPanelHomeLink(doc, view, leaf, "project"));
      top.appendChild(statsEl(doc, "span", { class: "bob-stats-home-value" }, leaf.display + (leaf.share ? " · " + leaf.share : "")));
      row.appendChild(top);
      const bar = this.statsPanelHomeMiniBar(doc, leaf, maxValue, metric, false);
      if (bar) row.appendChild(bar);
      list.appendChild(row);
    }
    wrap.appendChild(list);
    return wrap;
  }

  statsPanelRootTable(doc, view, report, metric, section, options = {}) {
    const state = this.statsViewStateFor(view && view.sourcePath);
    const point = statsPanelSelectedHomePoint(metric, report, state);
    const areaRows = statsPanelHomeRows(metric, report, "area", point);
    const rootRows = statsPanelHomeRows(metric, report, "root_parent", point);
    const distinctHues = typeof statsPanelDistinctHues === "function"
      ? statsPanelDistinctHues(rootRows, report)
      : new Map();
    for (const row of rootRows) {
      if (distinctHues.has(row.key)) row.hue = distinctHues.get(row.key);
    }
    const tint = metric.unit === "minutes";
    if (options.title) {
      section.appendChild(this.statsPanelTitle(doc, (metric.label || metric.id) + " by root parent"));
    }
    if (options.rootBar !== false && !options.title) {
      section.appendChild(this.statsPanelHomeAreaBar(doc, view, metric, report, rootRows, "Root parent split"));
    }
    if (!areaRows.length && !rootRows.length) {
      section.appendChild(this.statsPanelNote(doc, "No root parent parts are in this span."));
    } else {
      const wrap = statsEl(doc, "div", { class: "bob-stats-home-groups", "aria-label": "Root parents" });
      const rankedAreas = areaRows.slice().sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
      const rootsByArea = new Map();
      for (const root of rootRows) {
        const areaKey = root.area || root.key;
        if (!rootsByArea.has(areaKey)) rootsByArea.set(areaKey, []);
        rootsByArea.get(areaKey).push(root);
      }
      for (const list of rootsByArea.values()) {
        list.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
      }
      const maxRoot = Math.max(0, ...rootRows.map((row) => row.value));
      for (const area of rankedAreas) {
        const group = statsEl(doc, "section", { class: "bob-stats-home-group" });
        group.appendChild(this.statsPanelHomeGroupRow(doc, view, report, metric, area, "area", point, tint));
        if (area.key === "@unlinked" || area.key === "@unfiled") {
          group.appendChild(statsEl(doc, "div", { class: "bob-stats-home-fix" }, this.statsPanelHomeFixCopy(area.key)));
          wrap.appendChild(group);
          continue;
        }
        const roots = rootsByArea.get(area.key) || [];
        const id = "roots:" + area.key;
        if (!state.homeRowsExpanded || typeof state.homeRowsExpanded !== "object") state.homeRowsExpanded = {};
        const expanded = state.homeRowsExpanded[id] === true;
        const visible = expanded ? roots : roots.slice(0, 3);
        for (const root of visible) {
          group.appendChild(this.statsPanelRootRow(doc, view, report, metric, root, point, maxRoot, tint));
          const subs = this.statsPanelRootSubs(doc, view, report, metric, root, point, tint);
          if (subs) group.appendChild(subs);
        }
        if (!expanded && roots.length > 3) {
          const more = statsEl(doc, "button", {
            class: "bob-stats-home-more",
            type: "button",
            "aria-expanded": "false",
            "data-stats-focus-key": "panel-home-more-" + area.key,
          }, (roots.length - 3) + " more");
          more.addEventListener("click", () => {
            state.homeRowsExpanded[id] = true;
            this.statsRenderLocally(view, "panel-home-more-" + area.key);
          });
          group.appendChild(more);
        } else if (expanded && roots.length > 3) {
          const less = statsEl(doc, "button", {
            class: "bob-stats-home-more",
            type: "button",
            "aria-expanded": "true",
            "data-stats-focus-key": "panel-home-more-" + area.key,
          }, "Show fewer");
          less.addEventListener("click", () => {
            state.homeRowsExpanded[id] = false;
            this.statsRenderLocally(view, "panel-home-more-" + area.key);
          });
          group.appendChild(less);
        }
        wrap.appendChild(group);
      }
      // Buckets whose area row is missing still get a group so fix-it copy shows.
      for (const root of rootRows) {
        if (root.area && rankedAreas.some((area) => area.key === root.area)) continue;
        const group = statsEl(doc, "section", { class: "bob-stats-home-group" });
        group.appendChild(this.statsPanelHomeGroupRow(doc, view, report, metric, root, "root_parent", point, tint));
        if (root.key === "@unlinked" || root.key === "@unfiled") {
          group.appendChild(statsEl(doc, "div", { class: "bob-stats-home-fix" }, this.statsPanelHomeFixCopy(root.key)));
        } else {
          group.appendChild(this.statsPanelRootRow(doc, view, report, metric, root, point, maxRoot, tint));
        }
        wrap.appendChild(group);
      }
      section.appendChild(wrap);
    }
    if (options.sessions) {
      section.appendChild(this.statsPanelNote(doc, "▒ split from sessions with several root parents · grouped by today's note tree · from Task Links"));
    } else {
      section.appendChild(this.statsPanelNote(doc, "Grouped by today's note tree."));
    }
    return true;
  }

  statsPanelHomeTable(doc, view, report, metric, section, options = {}) {
    const hasRoots = typeof statsPanelHasRootParents === "function"
      ? statsPanelHasRootParents(metric)
      : false;
    if (hasRoots) {
      return this.statsPanelRootTable(doc, view, report, metric, section, options);
    }
    const state = this.statsViewStateFor(view && view.sourcePath);
    const point = statsPanelSelectedHomePoint(metric, report, state);
    const areaRows = statsPanelHomeRows(metric, report, "area", point);
    const projectRows = statsPanelHomeRows(metric, report, "project", point);
    const tint = metric.unit === "minutes";
    if (options.title) {
      section.appendChild(this.statsPanelTitle(doc, (metric.label || metric.id) + " by area & project"));
    }
    if (options.areaBar) {
      section.appendChild(this.statsPanelHomeAreaBar(doc, view, metric, report, areaRows));
    }
    if (!areaRows.length && !projectRows.length) {
      section.appendChild(this.statsPanelNote(doc, "No area or project parts are in this span."));
    } else {
      const wrap = statsEl(doc, "div", { class: "bob-stats-home-groups", "aria-label": "Areas and projects" });
      const rankedAreas = areaRows.slice().sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
      const maxProject = Math.max(0, ...projectRows.map((row) => row.value));
      for (const area of rankedAreas) {
        const group = statsEl(doc, "section", { class: "bob-stats-home-group" });
        group.appendChild(this.statsPanelHomeGroupRow(doc, view, report, metric, area, "area", point, tint));
        const projects = projectRows.filter((row) => row.area === area.key);
        const id = "area:" + area.key;
        if (!state.homeRowsExpanded || typeof state.homeRowsExpanded !== "object") state.homeRowsExpanded = {};
        const expanded = state.homeRowsExpanded[id] === true;
        const visible = expanded ? projects : projects.slice(0, 3);
        for (const project of visible) {
          group.appendChild(this.statsPanelHomeProjectRow(doc, view, report, metric, project, point, maxProject, tint));
        }
        if (!expanded && projects.length > 3) {
          const more = statsEl(doc, "button", {
            class: "bob-stats-home-more",
            type: "button",
            "aria-expanded": "false",
            "data-stats-focus-key": "panel-home-more-" + area.key,
          }, (projects.length - 3) + " more");
          more.addEventListener("click", () => {
            state.homeRowsExpanded[id] = true;
            this.statsRenderLocally(view, "panel-home-more-" + area.key);
          });
          group.appendChild(more);
        } else if (expanded && projects.length > 3) {
          const less = statsEl(doc, "button", {
            class: "bob-stats-home-more",
            type: "button",
            "aria-expanded": "true",
            "data-stats-focus-key": "panel-home-more-" + area.key,
          }, "Show fewer");
          less.addEventListener("click", () => {
            state.homeRowsExpanded[id] = false;
            this.statsRenderLocally(view, "panel-home-more-" + area.key);
          });
          group.appendChild(less);
        }
        wrap.appendChild(group);
      }
      section.appendChild(wrap);
    }
    if (options.sessions) {
      section.appendChild(this.statsPanelNote(doc, "▒ split from sessions with several homes · grouped by today's note tree · from Task Links"));
    } else {
      section.appendChild(this.statsPanelNote(doc, "Grouped by today's note tree."));
    }
    return true;
  }
}
