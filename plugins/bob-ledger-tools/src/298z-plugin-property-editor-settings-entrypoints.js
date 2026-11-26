// Settings entry points: area/project registry kinds, setting-focus
// requests, and project-task handoffs. `==` on an area/project note and the
// card Settings control open the Property Editor on the settings group; a
// policy chip selects its own setting. Project Goal/Starts/Depends-on rows
// navigate to the current ^prj task through the navigation-hotkeys Task
// Card, falling back to the cursor when that plugin is unavailable. Painting
// and navigation cause no writes.
const PROPERTY_EDITOR_SETTING_KEY_ALIASES = Object.freeze({
  theme: "task_type",
  offclock: "clock",
  offclock_types: "clock",
});

function propertyEditorSettingKnownIds() {
  try {
    const ids = new Set();
    for (const order of Object.values(PROPERTY_EDITOR_SETTING_ORDER || {})) {
      for (const id of Array.isArray(order) ? order : []) ids.add(id);
    }
    return ids;
  } catch (_) {
    return new Set();
  }
}

// Map a caller key onto its logical setting id: legacy aliases (theme,
// offclock, offclock_types) resolve to their setting, and a real setting id
// passes through unchanged. Anything else is not a setting.
function propertyEditorSettingIdForKey(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (Object.hasOwn(PROPERTY_EDITOR_SETTING_KEY_ALIASES, text)) {
    return PROPERTY_EDITOR_SETTING_KEY_ALIASES[text];
  }
  try {
    if (propertyEditorSettingKnownIds().has(text)) return text;
  } catch (_) {}
  return "";
}

// Select a settings entry by id. Uses visible entries so a filtered-out row
// is never selected from a hidden group.
function propertyEditorSettingsFocusEntry(modal, settingId) {
  if (!modal || modal.closed || !settingId) return false;
  try {
    if (typeof propertyEditorSettingsSupported === "function"
      && !propertyEditorSettingsSupported(modal.report)) return false;
    const entries = typeof propertyEditorSettingsVisibleEntries === "function"
      ? propertyEditorSettingsVisibleEntries(modal)
      : [];
    const match = entries.find((entry) => entry && entry.id === `setting::${settingId}`);
    if (!match) return false;
    modal.selectedId = match.id;
    modal.announce = "";
    modal.paintPropertyEditor();
    return true;
  } catch (_) {
    return false;
  }
}

// Select the first visible settings row. `==` and the card Settings control
// land here; a policy chip selects its own setting instead.
function propertyEditorSettingsFocusFirst(modal) {
  if (!modal || modal.closed) return false;
  try {
    if (typeof propertyEditorSettingsSupported === "function"
      && !propertyEditorSettingsSupported(modal.report)) return false;
    const entries = typeof propertyEditorSettingsVisibleEntries === "function"
      ? propertyEditorSettingsVisibleEntries(modal)
      : [];
    const match = entries.find((entry) => entry && entry.entryType === "setting");
    if (!match) return false;
    modal.selectedId = match.id;
    modal.announce = "";
    modal.paintPropertyEditor();
    return true;
  } catch (_) {
    return false;
  }
}

// Consume the one-shot settings focus request exactly once, on the first
// report that arrives after open. A requested setting selects its row even
// when it is a ghost; a bare first-settings request selects the first
// settings row. On a degraded report the request selects the corresponding
// real property when present and otherwise leaves the safe first row.
function propertyEditorSettingsConsumeFocus(modal) {
  if (!modal || modal.closed || modal.propertyEditorSettingFocusDone === true) return false;
  modal.propertyEditorSettingFocusDone = true;
  const wanted = typeof modal.requestedSetting === "string" ? modal.requestedSetting : "";
  try {
    if (typeof propertyEditorSettingsSupported === "function"
      && propertyEditorSettingsSupported(modal.report)) {
      if (wanted) return propertyEditorSettingsFocusEntry(modal, wanted);
      if (modal.focusSettings === true) return propertyEditorSettingsFocusFirst(modal);
      return false;
    }
  } catch (_) {
    return false;
  }
  if (!wanted) return false;
  try {
    const keys = (typeof PROPERTY_EDITOR_SETTING_KEYS === "object" && PROPERTY_EDITOR_SETTING_KEYS
      && Array.isArray(PROPERTY_EDITOR_SETTING_KEYS[wanted]))
      ? PROPERTY_EDITOR_SETTING_KEYS[wanted]
      : [];
    if (!keys.length) return false;
    const rows = Array.isArray(modal.report && modal.report.properties) && modal.report.properties.length
      ? modal.report.properties
      : (Array.isArray(modal.properties) && modal.properties.length ? modal.properties : modal.cacheRows || []);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row && typeof row.key === "string" && keys.includes(row.key)
        && typeof propertyEditorRowId === "function") {
        modal.selectedId = propertyEditorRowId(row, index);
        modal.paintPropertyEditor();
        return true;
      }
    }
    // Focus-or-add for notes without a settings contract (bob-cli-qm kit
    // T2): on a writable report a missing loose key opens Add with the key
    // prefilled and the value focused, instead of stranding focus on the
    // safe first row. Area/project notes keep the safe row until their
    // typed contract arrives.
    const contractKind = typeof modal.noteKind === "string" ? modal.noteKind : "";
    if (contractKind !== "area" && contractKind !== "project") {
      const first = keys[0] || "";
      if (first && typeof modal.propertyEditorCanAdd === "function"
        && modal.propertyEditorCanAdd() === true
        && typeof modal.propertyEditorStartAdd === "function"
        && modal.propertyEditorStartAdd("end") === true) {
        try {
          if (typeof modal.propertyEditorSetAddName === "function") modal.propertyEditorSetAddName(first);
        } catch (_) {}
        try {
          if (typeof modal.propertyEditorCommitAddName === "function") modal.propertyEditorCommitAddName();
        } catch (_) {}
        return true;
      }
    }
  } catch (_) {}
  return false;
}

// Navigate to the note holding the current ^prj task, validate its source
// line, and hand off to the navigation-hotkeys Task Card at that line. The
// contract line is text, never a numeric index: a stale line that no longer
// matches current source refuses instead of landing on another task. When
// the Task Card is unavailable the cursor still lands on the validated line.
// Nothing here writes task fields or frontmatter dates.
async function propertyEditorProjectTaskHandoff(modal, line, taskLine) {
  const plugin = modal && modal.propertyPlugin;
  const app = (plugin && plugin.app) || (modal && modal.app);
  const filePath = modal && modal.filePath;
  if (!app || !filePath) return { ok: false, message: "Project task navigation is unavailable." };
  const workspace = app.workspace;
  // Only a leaf that shows this project counts: the shared leaf lookup falls
  // back to the most recent pane for other callers, and validating the ^prj
  // line against an unrelated note would refuse instead of navigating.
  const showingLeaf = () => {
    let found = null;
    try {
      if (typeof propertyEditorEntryLeafFor === "function") {
        found = propertyEditorEntryLeafFor(plugin || { app }, filePath);
      }
    } catch (_) {
      found = null;
    }
    try {
      const target = typeof propertyEditorEntryNormalizePath === "function"
        ? propertyEditorEntryNormalizePath(filePath)
        : filePath;
      if (found && typeof propertyEditorEntryLeafShows === "function") {
        return propertyEditorEntryLeafShows(found, target) ? found : null;
      }
      return found && found.view && found.view.file && found.view.file.path === filePath ? found : null;
    } catch (_) {
      return null;
    }
  };
  let leaf = showingLeaf();
  if (!leaf) {
    try {
      if (workspace && typeof workspace.openLinkText === "function") {
        await workspace.openLinkText(filePath.replace(/\.md$/i, ""), filePath, false);
      }
    } catch (_) {}
    leaf = showingLeaf();
  }
  if (!leaf) return { ok: false, message: "The current ^prj task could not be opened." };
  const editor = leaf.view && leaf.view.editor;
  try {
    if (editor && typeof editor.getValue === "function") {
      const lines = String(editor.getValue()).split("\n");
      const actual = String(lines[line - 1] || "").replace(/\r$/, "");
      if (actual !== taskLine) {
        return { ok: false, message: "The current ^prj task could not be found in this note." };
      }
    }
  } catch (_) {}
  try {
    if (editor && typeof editor.setCursor === "function") editor.setCursor({ line: line - 1, ch: 0 });
  } catch (_) {}
  try {
    if (editor && typeof editor.scrollIntoView === "function") {
      editor.scrollIntoView({ from: { line: line - 1, ch: 0 }, to: { line: line - 1, ch: 0 } }, true);
    }
  } catch (_) {}
  let picker = null;
  try {
    const plugins = app.plugins && app.plugins.plugins;
    picker = plugins && plugins["bob-navigation-hotkeys"];
  } catch (_) {
    picker = null;
  }
  if (picker && typeof picker.openBulletPropertyPicker === "function" && editor) {
    try {
      await picker.openBulletPropertyPicker(editor, {});
    } catch (_) {}
    try {
      if (typeof editor.focus === "function") editor.focus();
    } catch (_) {}
    return { ok: true, line };
  }
  try {
    if (workspace && typeof workspace.setActiveLeaf === "function") workspace.setActiveLeaf(leaf, { focus: true });
  } catch (_) {}
  try {
    if (editor && typeof editor.focus === "function") editor.focus();
  } catch (_) {}
  return { ok: true, line, fallback: "cursor" };
}

function propertyEditorHomeKindMatch(kind) {
  return ({ path, frontmatter } = {}) => {
    try {
      if (typeof homeCardEligible !== "function") return false;
      const eligible = homeCardEligible(path, frontmatter);
      return Boolean(eligible) && eligible.kind === kind;
    } catch (_) {
      return false;
    }
  };
}

class BobLedgerToolsPropertyEditorSettingsEntrypointsMixin {
  setupPropertyEditorSettingsEntrypoints() {
    if (this.propertyEditorSettingsEntrypointsActive === true) return;
    this.propertyEditorSettingsEntrypointsActive = true;
    try {
      if (typeof this.ensurePropertyCardBuiltins === "function") this.ensurePropertyCardBuiltins();
    } catch (_) {}
    try {
      if (typeof this.registerPropertyCard === "function") {
        this.registerPropertyCard({
          kind: "area",
          match: propertyEditorHomeKindMatch("area"),
          open: ({ path } = {}) => {
            if (typeof this.openPropertyEditor === "function") {
              void this.openPropertyEditor({ filePath: path, focusSettings: true });
            }
          },
        });
        this.registerPropertyCard({
          kind: "project",
          match: propertyEditorHomeKindMatch("project"),
          open: ({ path } = {}) => {
            if (typeof this.openPropertyEditor === "function") {
              void this.openPropertyEditor({ filePath: path, focusSettings: true });
            }
          },
        });
      }
    } catch (_) {}
  }

  teardownPropertyEditorSettingsEntrypoints() {
    this.propertyEditorSettingsEntrypointsActive = false;
    try {
      if (typeof this.unregisterPropertyCard === "function") this.unregisterPropertyCard("area");
    } catch (_) {}
    try {
      if (typeof this.unregisterPropertyCard === "function") this.unregisterPropertyCard("project");
    } catch (_) {}
  }
}
