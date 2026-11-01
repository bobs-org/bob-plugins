// --- Today roots: pure model + paint for the bob-plan roots line ----------
// JavaScript mirror of `docs/plan.md` §Today roots and bob-cli
// `plan_budget/roots.rs`. Groups Today's open tasks by root parent, with
// the same link and home resolution the Pomodoro home chips use. A view,
// never a budget: no cap, no lint, no vault write. Never throws.

let planTodayRootsKeymap = null;
try {
  const obsidianMod = require("obsidian");
  planTodayRootsKeymap = (obsidianMod && obsidianMod.Keymap) || null;
} catch (error) {
  planTodayRootsKeymap = null;
}

function planTodayRootTaskWord(count) {
  return Number(count) === 1 ? "task" : "tasks";
}

function planTodayRootTitle(root) {
  const label = root && typeof root.label === "string" ? root.label : "";
  const tasks = root && Number.isInteger(root.tasks) ? root.tasks : 0;
  const first = `${label} · ${tasks} scheduled ${planTodayRootTaskWord(tasks)}`;
  if (root && root.key === "@unfiled") {
    return `${first}\nFile the task in an area or project, or give it a root field`;
  }
  return `${first}\nOpen ${label}`;
}

function planTodayRootsAriaLabel(roots) {
  const parts = (Array.isArray(roots) ? roots : []).map((root) => {
    const label = root && typeof root.label === "string" ? root.label : "";
    const tasks = root && Number.isInteger(root.tasks) ? root.tasks : 0;
    return `${label}, ${tasks} ${planTodayRootTaskWord(tasks)}`;
  });
  return `Root parents scheduled: ${parts.join("; ")}`;
}

function planTodayRootTaskPath(task) {
  if (!task || typeof task !== "object") {
    return "";
  }
  if (typeof task.path === "string") {
    return task.path;
  }
  if (task.file && typeof task.file.path === "string") {
    return task.file.path;
  }
  return "";
}

function planTodayRootTaskIsOpen(task) {
  if (!task || typeof task !== "object") {
    return false;
  }
  const symbol = planTaskStatusSymbol(task);
  if (symbol === "x" || symbol === "X" || symbol === "-") {
    return false;
  }
  if (task.done === true) {
    return false;
  }
  const type = task.status && task.status.type;
  if (type === "DONE" || type === "CANCELLED" || type === "NON_TASK") {
    return false;
  }
  return true;
}

function planTodayRootOpenKeys(tasks) {
  const keys = new Set();
  const list = Array.isArray(tasks) ? tasks : [];
  for (const task of list) {
    if (!planTodayRootTaskIsOpen(task)) {
      continue;
    }
    const path = planTodayRootTaskPath(task);
    const blockId = planTaskBlockId(task);
    if (!path || !blockId) {
      continue;
    }
    const withMd = /\.md$/i.test(path) ? path : `${path}.md`;
    keys.add(`${withMd}#${blockId}`);
  }
  return keys;
}

function planTodayRootNormalizeKey(path) {
  const text = String(path || "");
  if (!text || text.startsWith("@")) {
    return "@unfiled";
  }
  return /\.md$/i.test(text) ? text : `${text}.md`;
}

function planTodayRootLabel(key) {
  const text = String(key || "");
  if (text.startsWith("@")) {
    return text.slice(1).toLowerCase() || "unfiled";
  }
  return pomodoroHomeStem(text).toLowerCase();
}

function planTodayRootFile(path, vault) {
  try {
    if (vault && typeof vault.getAbstractFileByPath === "function") {
      const file = vault.getAbstractFileByPath(path);
      if (file && typeof file.path === "string") {
        return file;
      }
    }
  } catch (error) {
    // Fall through to a path-only stand-in.
  }
  return path ? { path } : null;
}

function planTodayRootFromHome(home) {
  if (!home || typeof home !== "object") {
    return { key: "@unfiled", label: "unfiled", hue: null };
  }
  const key = planTodayRootNormalizeKey(home.root);
  if (key.startsWith("@")) {
    return { key: "@unfiled", label: "unfiled", hue: null };
  }
  const hue = typeof home.hue === "string" && home.hue ? home.hue : null;
  return { key, label: planTodayRootLabel(key), hue };
}

function planTodayRootForLink(item, dailyPath, metadataCache, vault, taskLineForBlock) {
  const key = item && typeof item.key === "string" ? item.key : "";
  const parts = todayKeyParts(key);
  if (!parts.path || !parts.blockId) {
    return planTodayRootFromHome(null);
  }
  const file = planTodayRootFile(parts.path, vault);
  if (!file) {
    return planTodayRootFromHome(null);
  }
  let home = null;
  try {
    home = pomodoroHomeTaskHome(
      { target: pomodoroHomeStem(parts.path), blockId: parts.blockId },
      file,
      dailyPath,
      metadataCache,
      vault,
      [],
      new Set(),
      taskLineForBlock,
      null,
      new Set(),
    );
  } catch (error) {
    home = null;
  }
  return planTodayRootFromHome(home);
}

// `null` when Tasks is unavailable; otherwise the ordered roots (possibly
// empty). Empty when there is no Pomodoros section or no open Today task.
function planTodayRoots({
  content,
  dailyPath,
  metadataCache,
  vault,
  tasks,
  taskLineForBlock,
} = {}) {
  try {
    if (!Array.isArray(tasks)) {
      return null;
    }
    const links = computeTodayLinks(content, dailyPath);
    const resolved = resolveTodayLinkKeys(links, dailyPath, (target, daily) => {
      try {
        return pomodoroHomeResolveFile(
          target,
          daily,
          daily,
          metadataCache,
          vault,
        );
      } catch (error) {
        return null;
      }
    });
    const openKeys = planTodayRootOpenKeys(tasks);
    const seen = new Set();
    const roots = [];
    const index = new Map();
    for (const item of resolved) {
      if (!item || typeof item.key !== "string" || !item.key) {
        continue;
      }
      if (seen.has(item.key)) {
        continue;
      }
      seen.add(item.key);
      if (!openKeys.has(item.key)) {
        continue;
      }
      const root = planTodayRootForLink(
        item,
        dailyPath,
        metadataCache,
        vault,
        taskLineForBlock,
      );
      const existing = index.get(root.key);
      if (existing !== undefined) {
        roots[existing].tasks += 1;
        continue;
      }
      index.set(root.key, roots.length);
      roots.push({
        key: root.key,
        label: root.label,
        hue: root.hue,
        tasks: 1,
      });
    }
    roots.sort((left, right) => {
      const leftBucket = String(left.key || "").startsWith("@") ? 1 : 0;
      const rightBucket = String(right.key || "").startsWith("@") ? 1 : 0;
      if (leftBucket !== rightBucket) {
        return leftBucket - rightBucket;
      }
      return right.tasks - left.tasks;
    });
    return roots;
  } catch (error) {
    return [];
  }
}

function planBlockTodayRoots(
  budget,
  content,
  dailyPath,
  app,
  tasks,
  taskLineForBlock,
) {
  try {
    if (!budget || !budget.hasSection) {
      return [];
    }
    return planTodayRoots({
      content,
      dailyPath,
      metadataCache: app && app.metadataCache,
      vault: app && app.vault,
      tasks,
      taskLineForBlock,
    });
  } catch (error) {
    return [];
  }
}

function planTodayRootsIsModEvent(evt) {
  try {
    if (
      planTodayRootsKeymap &&
      typeof planTodayRootsKeymap.isModEvent === "function"
    ) {
      return Boolean(planTodayRootsKeymap.isModEvent(evt));
    }
  } catch (error) {
    // Fall through to the modifier-key check.
  }
  return Boolean(evt && (evt.metaKey || evt.ctrlKey));
}

function planTodayRootBindOpen(item, stem, sourcePath, openLink) {
  if (!item || typeof item.addEventListener !== "function") {
    return;
  }
  const open = (evt) => {
    try {
      if (evt && typeof evt.preventDefault === "function") {
        evt.preventDefault();
      }
    } catch (error) {
      // Navigation still proceeds.
    }
    if (typeof openLink !== "function") {
      return;
    }
    try {
      openLink(stem, planTodayRootsIsModEvent(evt), evt);
    } catch (error) {
      // Opening is best-effort.
    }
  };
  item.addEventListener("mousedown", (evt) => {
    try {
      if (evt && typeof evt.preventDefault === "function") {
        evt.preventDefault();
      }
    } catch (error) {
      // Swallow is best-effort so Live Preview does not move the cursor.
    }
  });
  item.addEventListener("click", open);
  item.addEventListener("keydown", (evt) => {
    if (evt && evt.key === "Enter") {
      open(evt);
    }
  });
}

function paintPlanTodayRootItem(group, root, sourcePath, openLink) {
  const unfiled = Boolean(root && root.key === "@unfiled");
  const hue = root && typeof root.hue === "string" && root.hue ? root.hue : "";
  const label = root && typeof root.label === "string" ? root.label : "";
  const tasks = root && Number.isInteger(root.tasks) ? root.tasks : 0;
  const cls = unfiled ? "bob-plan-root bob-plan-root-unfiled" : "bob-plan-root";
  const item = group.createEl(unfiled ? "span" : "a", unfiled
    ? { cls, title: planTodayRootTitle(root) }
    : { cls, title: planTodayRootTitle(root), href: "#" });
  if (item && typeof item.setAttribute === "function") {
    if (hue) {
      item.setAttribute("data-root-hue", hue);
    }
    if (!unfiled) {
      item.setAttribute("role", "link");
      if (
        typeof item.hasAttribute !== "function" ||
        !item.hasAttribute("tabindex")
      ) {
        item.setAttribute("tabindex", "0");
      }
    }
  }
  const ring = item.createEl("span", { cls: "bob-plan-root-ring" });
  if (ring && typeof ring.setAttribute === "function") {
    ring.setAttribute("aria-hidden", "true");
    if (hue) {
      ring.setAttribute("data-root-hue", hue);
    }
  }
  item.createEl("span", { cls: "bob-plan-root-label", text: label });
  item.createEl("span", {
    cls: "bob-plan-root-count",
    text: `\u00a0${tasks}`,
  });
  if (!unfiled) {
    planTodayRootBindOpen(
      item,
      pomodoroHomeStem(root && root.key).toLowerCase() || label,
      sourcePath,
      openLink,
    );
  }
  return item;
}

function paintPlanTodayRoots(container, roots, sourcePath, openLink) {
  try {
    if (!container || typeof container.createEl !== "function") {
      return null;
    }
    const list = Array.isArray(roots) ? roots : [];
    if (list.length === 0) {
      return null;
    }
    const group = container.createEl("span", { cls: "bob-plan-roots" });
    if (group && typeof group.setAttribute === "function") {
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", planTodayRootsAriaLabel(list));
    }
    for (const root of list) {
      try {
        paintPlanTodayRootItem(group, root, sourcePath, openLink);
      } catch (error) {
        // One bad root never drops the line.
      }
    }
    return group;
  } catch (error) {
    return null;
  }
}
