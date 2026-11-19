// Keep the plugin inert if an optional Obsidian API is missing.
let CopyChipsPluginBase = class {};

try {
  const obsidian = require("obsidian");
  if (obsidian && typeof obsidian.Plugin === "function") {
    CopyChipsPluginBase = obsidian.Plugin;
  }
} catch (error) {
  CopyChipsPluginBase = class {};
}
