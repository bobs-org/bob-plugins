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
      if (key === "theme") {
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

