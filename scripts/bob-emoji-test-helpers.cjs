const path = require("node:path");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") {
    return {
      Plugin: class {
        constructor(app) { this.app = app; }
      },
      EditorSuggest: class {
        constructor(app, plugin) { this.app = app; this.plugin = plugin; }
        close() {}
      },
    };
  }
  if (request === "@codemirror/language") {
    return {
      syntaxTree() {
        if (global.__bobEmojiSyntaxTreeError) throw new Error("syntax tree unavailable");
        return global.__bobEmojiSyntaxTree || {
          resolveInner() { return { type: { name: "Paragraph" }, parent: null }; },
        };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pluginPath = path.join(__dirname, "..", "plugins", "bob-emoji", "main.js");
const BobEmojiPlugin = require(pluginPath);
Module._load = originalLoad;

function makeEditor(lines, options = {}) {
  const rows = Array.isArray(lines) ? lines : [String(lines || "")];
  return {
    getLine(line) { return rows[line] || ""; },
    offsetAt(position) {
      let offset = 0;
      for (let line = 0; line < position.line; line += 1) offset += (rows[line] || "").length + 1;
      return offset + position.ch;
    },
    cm: options.noCodeMirror ? null : { state: {} },
  };
}

function syntaxNode(name, parent = null) {
  return { type: { name }, parent };
}

class ElementStub {
  constructor() {
    this.classes = new Set();
    this.children = [];
    this.text = "";
  }
  addClass(name) { this.classes.add(name); }
  appendText(value) { this.text += String(value); }
  createSpan(options = {}) { return this.createChild(options); }
  createDiv(options = {}) { return this.createChild(options); }
  createChild(options = {}) {
    const child = new ElementStub();
    if (options.cls) {
      for (const name of String(options.cls).split(/\s+/)) if (name) child.addClass(name);
    }
    if (options.text !== undefined) child.appendText(options.text);
    this.children.push(child);
    return child;
  }
  all() {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
  textContent() {
    return this.text + this.children.map((child) => child.textContent()).join("");
  }
}

module.exports = { BobEmojiPlugin, helpers: BobEmojiPlugin.helpers, makeEditor, syntaxNode, ElementStub };
