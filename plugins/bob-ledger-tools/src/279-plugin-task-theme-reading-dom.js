// --- Task theme marks: Reading/query DOM helpers --------------------------
// Pure helpers shared by the Reading-view mixin and the Tasks/Dataview
// frame pass. Never throws; bad input yields false/null/empty.

const TASK_THEME_QUERY_HOST_RE =
  /(?:^|\s)(?:block-language-dataview|dataview-result-list|dataview-result-table|block-language-tasks|plugin-tasks-query-result)(?:\s|$)/;

function taskThemeHasClass(node, name) {
  try {
    if (!node || !name) {
      return false;
    }
    if (
      node.classList &&
      typeof node.classList.contains === "function"
    ) {
      try {
        if (node.classList.contains(name)) {
          return true;
        }
      } catch (error) {
        // Fall through to the className parse.
      }
    }
    const text =
      typeof node.className === "string"
        ? node.className
        : node && typeof node.getAttribute === "function"
          ? node.getAttribute("class") || ""
          : "";
    return String(text || "")
      .split(/\s+/)
      .indexOf(name) !== -1;
  } catch (error) {
    return false;
  }
}

function taskThemeTagOf(node) {
  try {
    return String((node && (node.tagName || node.nodeName)) || "").toUpperCase();
  } catch (error) {
    return "";
  }
}

function taskThemeAttr(node, name) {
  try {
    if (!node || typeof node.getAttribute !== "function") {
      return null;
    }
    const value = node.getAttribute(name);
    return typeof value === "string" ? value : null;
  } catch (error) {
    return null;
  }
}

function taskThemeChildList(node) {
  try {
    const kids = (node && node.childNodes) || [];
    const out = [];
    const length = typeof kids.length === "number" ? kids.length : 0;
    for (let index = 0; index < length; index += 1) {
      let child = null;
      try {
        child =
          kids[index] !== undefined
            ? kids[index]
            : typeof kids.item === "function"
              ? kids.item(index)
              : null;
      } catch (error) {
        child = null;
      }
      if (child) {
        out.push(child);
      }
    }
    return out;
  } catch (error) {
    return [];
  }
}

function taskThemeNodeText(node) {
  try {
    if (!node) {
      return "";
    }
    if (typeof node.nodeValue === "string") {
      return node.nodeValue;
    }
    if (typeof node.textContent === "string") {
      return node.textContent;
    }
    return "";
  } catch (error) {
    return "";
  }
}

function taskThemeIsHost(node) {
  try {
    if (!node || node.nodeType !== 1) {
      return false;
    }
    if (taskThemeHasClass(node, "bob-task-theme-host")) {
      return true;
    }
    return taskThemeAttr(node, "data-task-theme-host") === "true";
  } catch (error) {
    return false;
  }
}

function taskThemeIsPill(node) {
  try {
    if (!node || node.nodeType !== 1) {
      return false;
    }
    if (!taskThemeHasClass(node, "bob-pomo-theme")) {
      return false;
    }
    const kind = taskThemeAttr(node, "data-task-theme-kind");
    return Boolean(kind);
  } catch (error) {
    return false;
  }
}

function taskThemeIsThemeInlineField(node) {
  try {
    if (!node || node.nodeType !== 1) {
      return false;
    }
    if (
      !taskThemeHasClass(node, "dataview") ||
      !taskThemeHasClass(node, "inline-field")
    ) {
      return false;
    }
    const stack = taskThemeChildList(node);
    let guard = 0;
    while (stack.length > 0 && guard < 1000) {
      guard += 1;
      const current = stack.pop();
      if (!current || current.nodeType !== 1) {
        continue;
      }
      const key = String(
        taskThemeAttr(current, "data-dv-norm-key") ||
          taskThemeAttr(current, "data-dv-key") ||
          "",
      ).toLowerCase();
      if (key === "theme" || key === "type") {
        return true;
      }
      const kids = taskThemeChildList(current);
      for (let index = 0; index < kids.length; index += 1) {
        stack.push(kids[index]);
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

function taskThemeQueryAncestor(node, root) {
  try {
    let current = node || null;
    let guard = 0;
    while (current && current !== root && guard < 100) {
      guard += 1;
      try {
        const classes =
          typeof current.className === "string"
            ? current.className
            : taskThemeAttr(current, "class") || "";
        if (TASK_THEME_QUERY_HOST_RE.test(String(classes || ""))) {
          return current;
        }
        if (taskThemeHasClass(current, "plugin-tasks-list-item")) {
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

function taskThemeClosestRow(el) {
  try {
    let current = el || null;
    let guard = 0;
    while (current && guard < 100) {
      guard += 1;
      try {
        if (taskThemeTagOf(current) === "LI" && taskThemeLiIsTask(current)) {
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

function taskThemeLiIsTask(li) {
  try {
    if (!li) {
      return false;
    }
    if (taskThemeHasClass(li, "task-list-item")) {
      return true;
    }
    if (taskThemeHasClass(li, "plugin-tasks-list-item")) {
      return true;
    }
    const marker = taskThemeAttr(li, "data-task");
    return typeof marker === "string";
  } catch (error) {
    return false;
  }
}

function taskThemeNearestLi(node, root) {
  try {
    let current = node && node.parentNode ? node.parentNode : node;
    let guard = 0;
    while (current && current !== root && guard < 100) {
      guard += 1;
      try {
        if (taskThemeTagOf(current) === "LI") {
          return current;
        }
      } catch (error) {
        // Keep walking on per-ancestor failure.
      }
      current = current.parentNode || null;
    }
    if (current && taskThemeTagOf(current) === "LI") {
      return current;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function taskThemeExcludedAncestor(node, root) {
  try {
    let current = node && node.parentNode ? node.parentNode : null;
    let guard = 0;
    while (current && current !== root && guard < 100) {
      guard += 1;
      try {
        const tag = taskThemeTagOf(current);
        if (tag === "CODE" || tag === "PRE") {
          return true;
        }
        if (tag === "TD" || tag === "TH") {
          return true;
        }
        if (taskThemeIsHost(current) || taskThemeIsPill(current)) {
          return true;
        }
        if (
          taskThemeHasClass(current, "internal-embed") ||
          taskThemeHasClass(current, "markdown-embed")
        ) {
          return true;
        }
        if (taskThemeIsThemeInlineField(current)) {
          return true;
        }
      } catch (error) {
        // Keep walking on per-ancestor failure.
      }
      current = current.parentNode || null;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function taskThemeMarkSourcesInText(text) {
  try {
    if (typeof text !== "string" || text === "") {
      return [];
    }
    const state =
      typeof pomodoroThemeTaskFieldState === "function"
        ? pomodoroThemeTaskFieldState(text)
        : null;
    if (!state || typeof state !== "object") {
      return [];
    }
    if (state.state !== "set" && state.state !== "repair") {
      return [];
    }
    const fields = Array.isArray(state.fields) ? state.fields : [];
    const sources = [];
    for (let index = 0; index < fields.length; index += 1) {
      try {
        const field = fields[index];
        const fieldStart =
          field && Number.isFinite(Number(field.start))
            ? Number(field.start)
            : null;
        const fieldEnd =
          field && Number.isFinite(Number(field.end))
            ? Number(field.end)
            : null;
        if (
          fieldStart === null ||
          fieldEnd === null ||
          !(fieldEnd > fieldStart)
        ) {
          continue;
        }
        sources.push({
          state: state.state,
          repair: state.state === "repair" ? state.repair || "invalid" : null,
          value:
            state.state === "set" && typeof state.value === "string"
              ? state.value
              : null,
          key:
            state.state === "set" && typeof state.key === "string"
              ? state.key
              : null,
          rawValue:
            field && typeof field.value === "string" ? field.value : null,
          fieldStart,
          fieldEnd,
        });
      } catch (error) {
        continue;
      }
    }
    return sources;
  } catch (error) {
    return [];
  }
}

function taskThemeParseLineAttr(raw) {
  try {
    if (raw === null || raw === undefined) {
      return null;
    }
    const text = String(raw);
    if (text === "") {
      return null;
    }
    const parsed = Number(text);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return null;
    }
    return parsed + 1;
  } catch (error) {
    return null;
  }
}

function taskThemeRowIsQuery(row, el) {
  try {
    return Boolean(
      taskThemeQueryAncestor(row || el, null) ||
        (row && taskThemeHasClass(row, "plugin-tasks-list-item")),
    );
  } catch (error) {
    return false;
  }
}

function taskThemeNormalizeOriginPath(raw, sourcePath, metadataCache) {
  try {
    const text = String(raw || "").trim();
    if (!text || text.indexOf("://") !== -1) {
      return null;
    }
    const withoutHash = text.split("#")[0];
    let resolved = null;
    try {
      if (
        metadataCache &&
        typeof metadataCache.getFirstLinkpathDest === "function"
      ) {
        const dest = metadataCache.getFirstLinkpathDest(
          withoutHash,
          sourcePath || "",
        );
        if (dest && typeof dest.path === "string" && dest.path) {
          resolved = dest.path;
        }
      }
    } catch (error) {
      resolved = null;
    }
    if (resolved) {
      return typeof normalizeVaultPath === "function"
        ? normalizeVaultPath(resolved)
        : resolved;
    }
    const withExt =
      typeof ensureMarkdownExtension === "function"
        ? ensureMarkdownExtension(withoutHash)
        : /\.md$/i.test(withoutHash)
          ? withoutHash
          : withoutHash + ".md";
    return typeof normalizeVaultPath === "function"
      ? normalizeVaultPath(withExt)
      : withExt;
  } catch (error) {
    return null;
  }
}

function taskThemeOriginFromContext(row, el, ctx, metadataCache) {
  try {
    const host = row || taskThemeClosestRow(el) || null;
    let path = null;
    let line = null;
    if (host) {
      try {
        const rawPath =
          taskThemeAttr(host, "data-task-path") ||
          taskThemeAttr(host, "data-path") ||
          null;
        if (rawPath) {
          path = taskThemeNormalizeOriginPath(
            rawPath,
            ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "",
            metadataCache,
          );
        }
      } catch (error) {
        path = null;
      }
      try {
        line =
          taskThemeParseLineAttr(taskThemeAttr(host, "data-line")) ||
          taskThemeParseLineAttr(taskThemeAttr(host, "data-task-line"));
      } catch (error) {
        line = null;
      }
      if (!path) {
        try {
          const stack = taskThemeChildList(host);
          let guard = 0;
          while (stack.length > 0 && guard < 1000) {
            guard += 1;
            const node = stack.pop();
            if (!node || node.nodeType !== 1) {
              continue;
            }
            const tag = taskThemeTagOf(node);
            if (tag === "UL" || tag === "OL" || tag === "LI") {
              continue;
            }
            if (
              tag === "A" &&
              (taskThemeHasClass(node, "internal-link") ||
                taskThemeHasClass(node, "task-link"))
            ) {
              const inExtras =
                taskThemeHasClass(node, "task-extras") ||
                taskThemeHasClass(node.parentNode, "task-extras") ||
                taskThemeHasClass(node.parentNode, "tasks-backlink") ||
                taskThemeHasClass(node, "tasks-backlink");
              const href =
                taskThemeAttr(node, "data-href") ||
                taskThemeAttr(node, "href");
              if (inExtras && href && href.indexOf("://") === -1) {
                path = taskThemeNormalizeOriginPath(
                  href,
                  ctx && typeof ctx.sourcePath === "string"
                    ? ctx.sourcePath
                    : "",
                  metadataCache,
                );
                if (path) {
                  break;
                }
              }
            }
            const kids = taskThemeChildList(node);
            for (let index = 0; index < kids.length; index += 1) {
              stack.push(kids[index]);
            }
          }
        } catch (error) {
          // Backlink recovery is best-effort.
        }
      }
    }
    const inQuery = taskThemeRowIsQuery(host, el);
    if (!path && !inQuery && ctx && typeof ctx.sourcePath === "string") {
      path =
        typeof normalizeVaultPath === "function"
          ? normalizeVaultPath(ctx.sourcePath)
          : ctx.sourcePath;
    }
    if (
      line === null &&
      !inQuery &&
      host &&
      ctx &&
      typeof ctx.getSectionInfo === "function"
    ) {
      try {
        const info = ctx.getSectionInfo(host) || null;
        if (
          info &&
          Number.isInteger(info.lineStart) &&
          info.lineStart >= 0 &&
          (info.lineEnd === undefined ||
            info.lineEnd === info.lineStart ||
            (Number.isInteger(info.lineEnd) &&
              info.lineEnd === info.lineStart))
        ) {
          line = info.lineStart + 1;
        }
      } catch (error) {
        // Section mapping is best-effort.
      }
    }
    if (!path) {
      return null;
    }
    return { path, line, inQuery };
  } catch (error) {
    return null;
  }
}

function taskThemeLineHasExplicitField(lineText) {
  try {
    if (typeof pomodoroThemeTaskFieldState !== "function") {
      return false;
    }
    const state = pomodoroThemeTaskFieldState(lineText);
    return Boolean(
      state && (state.state === "set" || state.state === "repair"),
    );
  } catch (error) {
    return false;
  }
}

function taskThemeInlineFieldValue(node) {
  try {
    const stack = taskThemeChildList(node);
    let guard = 0;
    while (stack.length > 0 && guard < 1000) {
      guard += 1;
      const current = stack.pop();
      if (!current || current.nodeType !== 1) {
        continue;
      }
      const key = String(
        taskThemeAttr(current, "data-dv-norm-key") ||
          taskThemeAttr(current, "data-dv-key") ||
          "",
      ).toLowerCase();
      if (key === "theme") {
        if (
          taskThemeHasClass(current, "inline-field-value") ||
          taskThemeHasClass(current, "inline-field-standalone-value") ||
          /value/i.test(String(current.className || ""))
        ) {
          return String(taskThemeNodeText(current) || "").trim();
        }
      }
      if (
        taskThemeHasClass(current, "inline-field-value") ||
        taskThemeHasClass(current, "inline-field-standalone-value")
      ) {
        return String(taskThemeNodeText(current) || "").trim();
      }
      const kids = taskThemeChildList(current);
      for (let index = 0; index < kids.length; index += 1) {
        stack.push(kids[index]);
      }
    }
    const raw = String(taskThemeNodeText(node) || "").trim();
    const pipe = raw.indexOf("|");
    if (pipe !== -1) {
      return raw.slice(pipe + 1).trim();
    }
    return raw;
  } catch (error) {
    return "";
  }
}

function taskThemeCollectTextSpans(root, row) {
  const spans = [];
  try {
    let offset = 0;
    const stack = [];
    const initial = taskThemeChildList(root);
    for (let index = initial.length - 1; index >= 0; index -= 1) {
      stack.push(initial[index]);
    }
    let guard = 0;
    while (stack.length > 0 && guard < 10000) {
      guard += 1;
      const node = stack.pop();
      if (!node) {
        continue;
      }
      try {
        if (node.nodeType === 3) {
          if (taskThemeExcludedAncestor(node, root)) {
            continue;
          }
          const owner = taskThemeNearestLi(node, root) || row;
          if (row && owner && owner !== row) {
            continue;
          }
          const value = taskThemeNodeText(node);
          spans.push({
            node,
            start: offset,
            end: offset + value.length,
            value,
          });
          offset += value.length;
          continue;
        }
        if (node.nodeType !== 1) {
          continue;
        }
        const tag = taskThemeTagOf(node);
        if (tag === "UL" || tag === "OL") {
          continue;
        }
        if (tag === "LI" && node !== row && node !== root) {
          continue;
        }
        if (tag === "CODE" || tag === "PRE") {
          continue;
        }
        if (taskThemeIsHost(node) || taskThemeIsPill(node)) {
          continue;
        }
        if (taskThemeIsThemeInlineField(node)) {
          continue;
        }
        if (
          taskThemeHasClass(node, "internal-embed") ||
          taskThemeHasClass(node, "markdown-embed")
        ) {
          continue;
        }
        const kids = taskThemeChildList(node);
        for (let index = kids.length - 1; index >= 0; index -= 1) {
          stack.push(kids[index]);
        }
      } catch (error) {
        continue;
      }
    }
  } catch (error) {
    return [];
  }
  return spans;
}

