const path = require("node:path");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function loadCopyChipsStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      Plugin: class Plugin {
        constructor(app) {
          this.app = app;
        }
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pluginPath = path.join(__dirname, "..", "plugins", "bob-copy-chips", "main.js");
const BobCopyChipsPlugin = require(pluginPath);
Module._load = originalLoad;

module.exports = {
  BobCopyChipsPlugin,
  helpers: BobCopyChipsPlugin.helpers,
};
