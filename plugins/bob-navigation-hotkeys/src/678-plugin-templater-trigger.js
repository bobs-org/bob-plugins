const TEMPLATER_PLUGIN_ID = "templater-obsidian";
const TEMPLATER_LOCAL_SETTINGS_KEY = "templater-local-settings";
const TEMPLATER_LOCAL_TRIGGER_KEY = "trigger_on_file_creation";
const TEMPLATER_TRIGGER_ENABLE_NOTICE =
  'Templater: turned on "Trigger on file creation" for this device, so new notes use the vault\'s folder templates';
const TEMPLATER_TRIGGER_WRITE_FAILURE_NOTICE =
  "Could not turn on Templater's new-note trigger for this device";

function skipTemplaterLocalTrigger(reason) {
  return Object.freeze({ action: "skip", reason });
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function templaterTemplateListHasEntry(entries) {
  if (!Array.isArray(entries)) {
    return false;
  }
  return entries.some((entry) => {
    if (!isPlainObject(entry)) {
      return false;
    }
    const template = entry.template;
    return typeof template === "string" && template.trim() !== "";
  });
}

function templaterHasCreationTemplates(templaterSettings) {
  const mode = templaterSettings.trigger_on_file_creation_mode;
  if (mode === "folder") {
    return templaterTemplateListHasEntry(templaterSettings.folder_templates);
  }
  if (mode === "regex") {
    return templaterTemplateListHasEntry(templaterSettings.file_templates);
  }
  return false;
}

function planTemplaterLocalTrigger(templaterSettings, storedLocal) {
  if (
    templaterSettings === null ||
    typeof templaterSettings !== "object" ||
    Array.isArray(templaterSettings)
  ) {
    return skipTemplaterLocalTrigger("no-templater");
  }
  if (typeof templaterSettings.trigger_on_file_creation_mode !== "string") {
    return skipTemplaterLocalTrigger("legacy-templater");
  }
  if (!templaterHasCreationTemplates(templaterSettings)) {
    return skipTemplaterLocalTrigger("no-creation-templates");
  }
  if (storedLocal != null && !isPlainObject(storedLocal)) {
    return skipTemplaterLocalTrigger("unknown-local-shape");
  }
  if (
    storedLocal &&
    Object.prototype.hasOwnProperty.call(
      storedLocal,
      TEMPLATER_LOCAL_TRIGGER_KEY,
    )
  ) {
    if (storedLocal[TEMPLATER_LOCAL_TRIGGER_KEY] === true) {
      return skipTemplaterLocalTrigger("already-enabled");
    }
    return skipTemplaterLocalTrigger("device-opt-out");
  }
  const next = Object.freeze({
    ...(storedLocal || {}),
    [TEMPLATER_LOCAL_TRIGGER_KEY]: true,
  });
  return Object.freeze({ action: "enable", next });
}

class BobNavigationHotkeysTemplaterTriggerMixin {
  ensureTemplaterNewNoteTrigger() {
    if (
      !this.app ||
      typeof this.app.loadLocalStorage !== "function" ||
      typeof this.app.saveLocalStorage !== "function"
    ) {
      return;
    }

    try {
      const templaterSettings =
        this.app.plugins?.plugins?.[TEMPLATER_PLUGIN_ID]?.settings;
      const storedLocal = this.app.loadLocalStorage(
        TEMPLATER_LOCAL_SETTINGS_KEY,
      );
      const plan = planTemplaterLocalTrigger(templaterSettings, storedLocal);
      if (plan.action === "enable") {
        try {
          this.app.saveLocalStorage(TEMPLATER_LOCAL_SETTINGS_KEY, plan.next);
        } catch (_error) {
          new Notice(TEMPLATER_TRIGGER_WRITE_FAILURE_NOTICE);
          return plan;
        }
        new Notice(TEMPLATER_TRIGGER_ENABLE_NOTICE);
      }
      return plan;
    } catch (_error) {
      return;
    }
  }
}
