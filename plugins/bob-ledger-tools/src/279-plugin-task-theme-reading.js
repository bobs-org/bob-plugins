// --- Task theme marks: Reading view ---------------------------------------
// `BobLedgerToolsTaskThemeReadingMixin` (see `310-install-methods.js`).
// Reuses the canonical explicit-field model in `279-plugin-task-theme-marks.js`
// and never invents a second parser. Synchronous throughout; never throws.
//
// Reading view, Tasks rows, and Dataview task rows share this pass: only an
// explicit `[theme:: NAME]` / `(theme:: NAME)` field or a native Dataview
// inline-field whose key is `theme` on a task row becomes a PT6 pill. Prose,
// code, embeds, nested-row children, existing Bob pills, and unrelated fields
// stay untouched. Surrounding links, emphasis, tags, and text are preserved
// byte-for-byte by wrapping the field range instead of rewriting innerHTML.
// Page-default `task.theme` is not evidence: a Dataview chip is replaced only
// when it is an explicit task-line field. Origin comes from supported renderer
// metadata; a dashboard `ctx.sourcePath` is never used as a substitute.

class BobLedgerToolsTaskThemeReadingMixin {
  taskThemeEnsureHoverForDocuments() {
    try {
      const docs =
        typeof this.markGateDocuments === "function"
          ? this.markGateDocuments()
          : typeof document !== "undefined" && document
            ? [document]
            : [];
      const list = Array.isArray(docs) ? docs : [];
      for (let index = 0; index < list.length; index += 1) {
        try {
          const doc = list[index];
          const root =
            (doc && doc.body) ||
            (doc && doc.documentElement) ||
            doc;
          this.taskThemeEnsureHoverForRoot(root);
        } catch (error) {
          continue;
        }
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  // Delegated hover/focus on one document or root host. One pair of
  // listeners per root (guarded by a marker property) so Dataview clones
  // and popouts reuse the same model without a listener per row. Never
  // throws.
  taskThemeEnsureHoverForRoot(root) {
    try {
      if (!root || typeof root.addEventListener !== "function") {
        return false;
      }
      if (root.__bobTaskThemeHover) {
        return true;
      }
      const plugin = this;
      const onHover = (event) => {
        try {
          plugin.taskThemeEnrichFromEvent(null, event);
        } catch (error) {
          // Enrichment is best-effort.
        }
      };
      try {
        root.addEventListener("mouseover", onHover);
      } catch (error) {
        return false;
      }
      try {
        root.addEventListener("focusin", onHover);
      } catch (error) {
        // Mouse hover alone still enriches.
      }
      try {
        root.__bobTaskThemeHover = true;
      } catch (error) {
        // The marker is best-effort; duplicate listeners stay harmless.
      }
      if (!Array.isArray(this.taskThemeHoverRoots)) {
        this.taskThemeHoverRoots = [];
      }
      try {
        this.taskThemeHoverRoots.push({ root, onHover });
      } catch (error) {
        // Tracking is best-effort.
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  taskThemeTeardownHover() {
    try {
      const tracked = Array.isArray(this.taskThemeHoverRoots)
        ? this.taskThemeHoverRoots
        : [];
      this.taskThemeHoverRoots = [];
      for (let index = 0; index < tracked.length; index += 1) {
        try {
          const entry = tracked[index];
          const root = entry && entry.root;
          const onHover = entry && entry.onHover;
          if (
            root &&
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
            if (root) {
              root.__bobTaskThemeHover = false;
            }
          } catch (error) {
            // Marker cleanup is best-effort.
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Hover teardown never throws.
    }
  }

  taskThemeReasonForMarkOrigin(mark) {
    try {
      if (!mark || typeof this.pomodoroThemeSuggestFor !== "function") {
        return undefined;
      }
      const path =
        taskThemeAttr(mark, "data-task-theme-path") ||
        (mark.parentNode
          ? taskThemeAttr(mark.parentNode, "data-task-theme-path")
          : null);
      if (!path) {
        return undefined;
      }
      const rawLine =
        taskThemeAttr(mark, "data-task-theme-line") ||
        (mark.parentNode
          ? taskThemeAttr(mark.parentNode, "data-task-theme-line")
          : null);
      let line = Number(rawLine);
      if (!Number.isInteger(line) || line < 1) {
        line = null;
      }
      let noteText = null;
      try {
        noteText =
          typeof this.taskThemeSourceTextFor === "function"
            ? this.taskThemeSourceTextFor(path)
            : null;
      } catch (error) {
        noteText = null;
      }
      let fallback = null;
      try {
        const row = taskThemeClosestRow(mark);
        if (row) {
          fallback = String(taskThemeNodeText(row) || "");
        }
      } catch (error) {
        fallback = null;
      }
      if (typeof noteText === "string" && line) {
        // Prefer live/cached source at the known line.
      } else if (typeof fallback === "string" && fallback) {
        line = line || 1;
        noteText =
          typeof this.taskThemePaddedNoteText === "function"
            ? this.taskThemePaddedNoteText(line, fallback)
            : fallback;
      } else {
        try {
          this.taskThemeRequestSourceText(path);
        } catch (error) {
          // Cache fill is best-effort.
        }
        return undefined;
      }
      const suggestion = this.pomodoroThemeSuggestFor({
        path,
        line,
        text: noteText,
      });
      if (!suggestion || typeof suggestion !== "object") {
        return null;
      }
      const inherited =
        suggestion.inherited && typeof suggestion.inherited === "object"
          ? suggestion.inherited
          : suggestion.source === "task"
            ? null
            : suggestion;
      if (!inherited) {
        return null;
      }
      if (typeof taskThemeReasonFor === "function") {
        return taskThemeReasonFor(inherited);
      }
      return null;
    } catch (error) {
      return undefined;
    }
  }

  taskThemeOriginFor(li, el, ctx) {
    try {
      const metadataCache = this.app && this.app.metadataCache;
      return taskThemeOriginFromContext(li, el, ctx, metadataCache);
    } catch (error) {
      return null;
    }
  }

  taskThemeApplyOrigin(host, origin) {
    try {
      if (!host || typeof host.setAttribute !== "function") {
        return;
      }
      if (!origin || typeof origin !== "object") {
        return;
      }
      if (typeof origin.path === "string" && origin.path) {
        host.setAttribute("data-task-theme-path", origin.path);
      }
      if (Number.isInteger(origin.line) && origin.line >= 1) {
        host.setAttribute("data-task-theme-line", String(origin.line));
      }
    } catch (error) {
      // Origin attributes are best-effort.
    }
  }

  taskThemeBuildHost(doc, model, nativeNodes, origin) {
    try {
      if (!doc || typeof doc.createElement !== "function") {
        return null;
      }
      const markEl = buildTaskThemeMarkElement(doc, model, {
        foldSpace: false,
      });
      if (!markEl) {
        return null;
      }
      const host = doc.createElement("span");
      try {
        host.setAttribute("class", "bob-task-theme-host");
        host.setAttribute("data-task-theme-host", "true");
      } catch (error) {
        // Host flags are best-effort.
      }
      this.taskThemeApplyOrigin(host, origin);
      this.taskThemeApplyOrigin(markEl, origin);
      const native = doc.createElement("span");
      try {
        native.setAttribute("class", "bob-task-theme-native");
        if (this.taskThemeMarksEnabled) {
          native.setAttribute("aria-hidden", "true");
        }
      } catch (error) {
        // Native wrapper flags are best-effort.
      }
      try {
        if (!this.taskThemeMarksEnabled && markEl) {
          markEl.setAttribute("aria-hidden", "true");
        }
      } catch (error) {
        // Pill aria is best-effort.
      }
      const nodes = Array.isArray(nativeNodes) ? nativeNodes : [];
      for (let index = 0; index < nodes.length; index += 1) {
        try {
          if (nodes[index] && typeof native.appendChild === "function") {
            native.appendChild(nodes[index]);
          }
        } catch (error) {
          continue;
        }
      }
      try {
        host.appendChild(native);
        host.appendChild(markEl);
      } catch (error) {
        return null;
      }
      return host;
    } catch (error) {
      return null;
    }
  }

  taskThemeReplaceElement(node, model, origin) {
    try {
      if (!node || !node.parentNode) {
        return false;
      }
      const parent = node.parentNode;
      const docNode =
        node.ownerDocument ||
        (typeof document !== "undefined" ? document : null);
      if (!docNode) {
        return false;
      }
      const host = this.taskThemeBuildHost(docNode, model, [], origin);
      if (!host) {
        return false;
      }
      parent.insertBefore(host, node);
      const native = taskThemeChildList(host)[0];
      try {
        if (native && typeof native.appendChild === "function") {
          native.appendChild(node);
        }
      } catch (error) {
        try {
          parent.removeChild(host);
        } catch (inner) {
          // Rollback is best-effort.
        }
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  taskThemeReplaceTextRange(spans, source, origin) {
    try {
      if (!source || !Array.isArray(spans) || spans.length === 0) {
        return false;
      }
      const fieldStart = source.fieldStart;
      const fieldEnd = source.fieldEnd;
      const covering = [];
      for (let index = 0; index < spans.length; index += 1) {
        const span = spans[index];
        if (!span || !span.node) {
          continue;
        }
        if (span.end > fieldStart && span.start < fieldEnd) {
          covering.push(span);
        }
      }
      if (covering.length === 0) {
        return false;
      }
      const first = covering[0];
      const last = covering[covering.length - 1];
      const docNode =
        first.node.ownerDocument ||
        (typeof document !== "undefined" ? document : null);
      if (!docNode || typeof docNode.createTextNode !== "function") {
        return false;
      }
      const model = this.taskThemeResolveModel(source, null);
      if (!model) {
        return false;
      }
      if (first.node === last.node) {
        const node = first.node;
        const parent = node.parentNode;
        if (!parent) {
          return false;
        }
        const value = taskThemeNodeText(node);
        const localStart = fieldStart - first.start;
        const localEnd = fieldEnd - first.start;
        if (!(localEnd > localStart) || localStart < 0 || localEnd > value.length) {
          return false;
        }
        const nativeText = docNode.createTextNode(
          value.slice(localStart, localEnd),
        );
        const host = this.taskThemeBuildHost(
          docNode,
          model,
          [nativeText],
          origin,
        );
        if (!host) {
          return false;
        }
        if (localStart > 0) {
          parent.insertBefore(
            docNode.createTextNode(value.slice(0, localStart)),
            node,
          );
        }
        parent.insertBefore(host, node);
        if (localEnd < value.length) {
          parent.insertBefore(
            docNode.createTextNode(value.slice(localEnd)),
            node,
          );
        }
        parent.removeChild(node);
        return true;
      }
      let parent = first.node.parentNode;
      if (!parent) {
        return false;
      }
      for (let index = 0; index < covering.length; index += 1) {
        if (covering[index].node.parentNode !== parent) {
          parent = null;
          break;
        }
      }
      if (!parent) {
        return false;
      }
      const firstValue = taskThemeNodeText(first.node);
      const lastValue = taskThemeNodeText(last.node);
      const localStart = fieldStart - first.start;
      const localEnd = fieldEnd - last.start;
      if (localStart > 0) {
        parent.insertBefore(
          docNode.createTextNode(firstValue.slice(0, localStart)),
          first.node,
        );
        try {
          first.node.nodeValue = firstValue.slice(localStart);
          if (first.node.textContent !== undefined) {
            first.node.textContent = firstValue.slice(localStart);
          }
        } catch (error) {
          return false;
        }
      }
      if (localEnd < lastValue.length) {
        const after = docNode.createTextNode(lastValue.slice(localEnd));
        try {
          last.node.nodeValue = lastValue.slice(0, localEnd);
          if (last.node.textContent !== undefined) {
            last.node.textContent = lastValue.slice(0, localEnd);
          }
        } catch (error) {
          return false;
        }
        if (last.node.nextSibling) {
          parent.insertBefore(after, last.node.nextSibling);
        } else {
          parent.appendChild(after);
        }
      }
      const nativeNodes = [];
      let cursor = first.node;
      let guard = 0;
      while (cursor && guard < 100) {
        guard += 1;
        const next = cursor.nextSibling;
        nativeNodes.push(cursor);
        if (cursor === last.node) {
          break;
        }
        cursor = next;
      }
      const host = this.taskThemeBuildHost(
        docNode,
        model,
        [],
        origin,
      );
      if (!host) {
        return false;
      }
      parent.insertBefore(host, first.node);
      const native = taskThemeChildList(host)[0];
      for (let index = 0; index < nativeNodes.length; index += 1) {
        try {
          if (native && typeof native.appendChild === "function") {
            native.appendChild(nativeNodes[index]);
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

  decorateTaskThemeRow(row, origin, root) {
    try {
      if (!row || row.nodeType !== 1) {
        return 0;
      }
      if (!taskThemeLiIsTask(row) && row !== root) {
        return 0;
      }
      const inQuery = taskThemeRowIsQuery(row, root);
      if (inQuery && !(origin && origin.path)) {
        return 0;
      }
      const docNode =
        row.ownerDocument ||
        (typeof document !== "undefined" ? document : null);
      if (!docNode) {
        return 0;
      }
      let sourceState = null;
      let sourceLine = null;
      try {
        if (origin && origin.path) {
          sourceLine = this.taskThemeLineTextFor(
            origin.path,
            origin.line,
            null,
          );
          if (typeof sourceLine !== "string" && origin.path) {
            this.taskThemeRequestSourceText(origin.path);
          }
        }
      } catch (error) {
        sourceLine = null;
      }
      if (typeof sourceLine === "string") {
        try {
          sourceState = pomodoroThemeTaskFieldState(sourceLine);
        } catch (error) {
          sourceState = null;
        }
      }
      let count = 0;
      const fields = [];
      try {
        const stack = taskThemeChildList(row);
        let guard = 0;
        while (stack.length > 0 && guard < 10000) {
          guard += 1;
          const node = stack.pop();
          if (!node || node.nodeType !== 1) {
            continue;
          }
          const tag = taskThemeTagOf(node);
          if (tag === "UL" || tag === "OL" || (tag === "LI" && node !== row)) {
            continue;
          }
          if (tag === "CODE" || tag === "PRE") {
            continue;
          }
          if (taskThemeIsHost(node) || taskThemeIsPill(node)) {
            continue;
          }
          if (taskThemeIsThemeInlineField(node)) {
            const owner = taskThemeNearestLi(node, row) || row;
            if (!owner || owner === row) {
              fields.push(node);
            }
            continue;
          }
          const kids = taskThemeChildList(node);
          for (let index = 0; index < kids.length; index += 1) {
            stack.push(kids[index]);
          }
        }
      } catch (error) {
        // Element scan is best-effort.
      }
      const spans = taskThemeCollectTextSpans(row, row);
      const concatenated = spans
        .map((span) => (span && typeof span.value === "string" ? span.value : ""))
        .join("");
      const rawSources = taskThemeMarkSourcesInText(concatenated);
      const explicitCount =
        sourceState &&
        (sourceState.state === "set" || sourceState.state === "repair")
          ? (Array.isArray(sourceState.fields) ? sourceState.fields.length : 1)
          : fields.length + rawSources.length;
      const combinedRepair =
        (sourceState && sourceState.state === "repair"
          ? sourceState.repair
          : null) ||
        (explicitCount > 1 ? "duplicate" : null);
      const nativeVerified =
        !inQuery ||
        (sourceState &&
          (sourceState.state === "set" || sourceState.state === "repair")) ||
        rawSources.length > 0;
      if (nativeVerified) {
        for (let index = 0; index < fields.length; index += 1) {
          try {
            const node = fields[index];
            if (!node || !node.parentNode) {
              continue;
            }
            if (taskThemeIsHost(node.parentNode)) {
              continue;
            }
            const raw = taskThemeInlineFieldValue(node);
            const synthetic =
              raw && raw.length > 0
                ? "[theme:: " + raw + "]"
                : "[theme:: ]";
            let source =
              taskThemeMarkSourcesInText(synthetic)[0] || {
                state: "repair",
                repair: "invalid",
                value: null,
                key: null,
                rawValue: raw || "",
                fieldStart: 0,
                fieldEnd: synthetic.length,
              };
            if (combinedRepair) {
              source = {
                ...source,
                state: "repair",
                repair: combinedRepair,
                value: null,
                key: null,
                rawValue:
                  source.rawValue ||
                  (typeof raw === "string" ? raw : ""),
              };
            } else if (sourceState && sourceState.state === "set") {
              source = {
                ...source,
                state: "set",
                value: sourceState.value,
                key: sourceState.key,
                repair: null,
              };
            }
            const model = this.taskThemeResolveModel(source, synthetic);
            if (!model) {
              continue;
            }
            if (this.taskThemeReplaceElement(node, model, origin)) {
              count += 1;
            }
          } catch (error) {
            continue;
          }
        }
      }
      const textSources = combinedRepair
        ? rawSources.map((source) => ({
            ...source,
            state: "repair",
            repair: combinedRepair,
            value: null,
            key: null,
          }))
        : rawSources;
      for (let index = textSources.length - 1; index >= 0; index -= 1) {
        try {
          const source = textSources[index];
          const fresh = taskThemeCollectTextSpans(row, row);
          if (this.taskThemeReplaceTextRange(fresh, source, origin)) {
            count += 1;
          }
        } catch (error) {
          continue;
        }
      }
      return count;
    } catch (error) {
      return 0;
    }
  }

  decorateTaskThemeRenderedRoot(el, ctx) {
    try {
      if (!this.taskThemeMarksEnabled) {
        return 0;
      }
      if (!el) {
        return 0;
      }
      this.taskThemeEnsureHoverForRoot(
        (el.ownerDocument && (el.ownerDocument.body || el.ownerDocument)) ||
          el,
      );
      let count = 0;
      const row = taskThemeClosestRow(el);
      if (row) {
        const origin = this.taskThemeOriginFor(row, el, ctx);
        count += this.decorateTaskThemeRow(row, origin, el);
        return count;
      }
      const items = [];
      try {
        const stack = [el];
        let guard = 0;
        while (stack.length > 0 && guard < 10000) {
          guard += 1;
          const node = stack.pop();
          if (!node) {
            continue;
          }
          if (node.nodeType === 1) {
            const tag = taskThemeTagOf(node);
            if (tag === "LI" && taskThemeLiIsTask(node)) {
              items.push(node);
            }
            if (tag === "CODE" || tag === "PRE") {
              continue;
            }
            if (taskThemeIsHost(node)) {
              continue;
            }
            const kids = taskThemeChildList(node);
            for (let index = 0; index < kids.length; index += 1) {
              stack.push(kids[index]);
            }
          }
        }
      } catch (error) {
        return count;
      }
      for (let index = 0; index < items.length; index += 1) {
        try {
          const item = items[index];
          const origin = this.taskThemeOriginFor(item, el, ctx);
          count += this.decorateTaskThemeRow(item, origin, el);
        } catch (error) {
          continue;
        }
      }
      return count;
    } catch (error) {
      return 0;
    }
  }

  renderTaskThemeMarksIn(el, ctx) {
    try {
      if (!this.taskThemeMarksEnabled) {
        return;
      }
      if (!el || !ctx) {
        return;
      }
      try {
        this.decorateTaskThemeRenderedRoot(el, ctx);
      } catch (error) {
        // The synchronous pass never throws.
      }
      try {
        if (typeof this.scheduleTasksResultTaskThemeMarks === "function") {
          this.scheduleTasksResultTaskThemeMarks(el, ctx);
        }
      } catch (error) {
        // Tasks-result scheduling is best-effort.
      }
    } catch (error) {
      // Rendered-view marks never throw.
    }
  }

  refreshTaskThemeRenderedMarks() {
    try {
      const docs =
        typeof this.markGateDocuments === "function"
          ? this.markGateDocuments()
          : typeof document !== "undefined" && document
            ? [document]
            : [];
      const list = Array.isArray(docs) ? docs : [];
      let count = 0;
      for (let index = 0; index < list.length; index += 1) {
        try {
          const doc = list[index];
          const root = (doc && doc.body) || doc;
          if (!root) {
            continue;
          }
          const marks = [];
          const stack = taskThemeChildList(root);
          let guard = 0;
          while (stack.length > 0 && guard < 20000) {
            guard += 1;
            const node = stack.pop();
            if (!node) {
              continue;
            }
            if (node.nodeType === 1) {
              if (taskThemeIsPill(node)) {
                marks.push(node);
              }
              const kids = taskThemeChildList(node);
              for (let child = 0; child < kids.length; child += 1) {
                stack.push(kids[child]);
              }
            }
          }
          for (let markIndex = 0; markIndex < marks.length; markIndex += 1) {
            try {
              const mark = marks[markIndex];
              const kind = taskThemeAttr(mark, "data-task-theme-kind");
              if (kind === "repair") {
                continue;
              }
              const key = taskThemeAttr(mark, "data-theme-key");
              const value = String(taskThemeNodeText(mark) || "").trim() || key;
              if (!key && !value) {
                continue;
              }
              const model = this.taskThemeResolveModel(
                {
                  state: "set",
                  key: key || null,
                  value: value || null,
                },
                null,
              );
              if (!model) {
                continue;
              }
              if (typeof mark.setAttribute === "function") {
                if (model.kind) {
                  mark.setAttribute("data-task-theme-kind", model.kind);
                }
                if (model.key) {
                  mark.setAttribute("data-theme-key", model.key);
                }
                if (model.kind === "pill" && model.hue) {
                  mark.setAttribute("data-theme-hue", model.hue);
                } else if (typeof mark.removeAttribute === "function") {
                  try {
                    mark.removeAttribute("data-theme-hue");
                  } catch (error) {
                    // Hue clear is best-effort.
                  }
                }
                try {
                  mark.setAttribute("class", mark.getAttribute("class") || "bob-pomo-theme");
                  let classes = "bob-pomo-theme";
                  if (model.kind === "unknown") {
                    classes += " bob-pomo-theme-unknown";
                  } else if (model.kind === "repair") {
                    classes += " bob-pomo-theme-repair";
                  } else if (model.kind === "pill") {
                    if (
                      model.hueSource === "exempt" ||
                      model.hueSource === "unconfigured"
                    ) {
                      classes += " bob-pomo-theme-muted";
                    }
                    if (model.hueSource === "unconfigured") {
                      classes += " bob-pomo-theme-unconfigured";
                    }
                  }
                  mark.setAttribute("class", classes);
                } catch (error) {
                  // Class refresh is best-effort.
                }
                try {
                  if (typeof mark.removeAttribute === "function") {
                    mark.removeAttribute("data-task-theme-enriched");
                  }
                  const tooltip = taskThemeTooltipText(
                    model.label || value,
                    model.kind,
                    model.kind === "pill" ? undefined : null,
                  );
                  mark.setAttribute("aria-label", tooltip);
                  mark.setAttribute("title", tooltip);
                } catch (error) {
                  // Enrichment reset is best-effort.
                }
              }
              count += 1;
            } catch (error) {
              continue;
            }
          }
        } catch (error) {
          continue;
        }
      }
      return count;
    } catch (error) {
      return 0;
    }
  }

  taskThemeRestoreRenderedHosts(root) {
    try {
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
      let count = 0;
      for (let index = 0; index < docs.length; index += 1) {
        try {
          const scope = docs[index];
          if (!scope) {
            continue;
          }
          const hosts = [];
          const stack = [scope];
          let guard = 0;
          while (stack.length > 0 && guard < 20000) {
            guard += 1;
            const node = stack.pop();
            if (!node) {
              continue;
            }
            if (node.nodeType === 1) {
              if (taskThemeIsHost(node)) {
                hosts.push(node);
                continue;
              }
              const kids = taskThemeChildList(node);
              for (let child = 0; child < kids.length; child += 1) {
                stack.push(kids[child]);
              }
            }
          }
          for (let hostIndex = 0; hostIndex < hosts.length; hostIndex += 1) {
            try {
              const host = hosts[hostIndex];
              const parent = host.parentNode;
              if (!parent) {
                continue;
              }
              const children = taskThemeChildList(host);
              let native = null;
              for (let child = 0; child < children.length; child += 1) {
                if (taskThemeHasClass(children[child], "bob-task-theme-native")) {
                  native = children[child];
                  break;
                }
              }
              const restored = native ? taskThemeChildList(native) : [];
              for (let child = 0; child < restored.length; child += 1) {
                try {
                  parent.insertBefore(restored[child], host);
                } catch (error) {
                  continue;
                }
              }
              try {
                parent.removeChild(host);
              } catch (error) {
                // Host removal is best-effort.
              }
              count += 1;
            } catch (error) {
              continue;
            }
          }
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
