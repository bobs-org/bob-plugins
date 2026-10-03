// Small DOM and Obsidian Modal stand-ins for tests that need to exercise the
// production onOpen → renderAll → renderFooter/renderResults lifecycle.
class ElementStub {
  constructor(options = {}) {
    this.children = [];
    this.attributes = { ...(options.attr || {}) };
    this.listeners = {};
    this.classes = String(options.cls || "").split(/\s+/).filter(Boolean);
    this.classList = {
      add: (...names) => {
        this.classes.push(...names);
      },
      remove: (...names) => {
        this.classes = this.classes.filter((name) => !names.includes(name));
      },
      contains: (name) => this.classes.includes(name),
      toggle: (name, force) => {
        const has = this.classes.includes(name);
        const shouldHave = force === undefined ? !has : Boolean(force);
        if (shouldHave && !has) {
          this.classes.push(name);
        } else if (!shouldHave && has) {
          this.classes = this.classes.filter((item) => item !== name);
        }
        return shouldHave;
      },
    };
    this.tagName = String(options.tag || "div").toUpperCase();
    this.style = {};
    this.focused = false;
    this.textContent = options.text || "";
    this.value = "";
  }

  empty() {
    this.children = [];
    this.textContent = "";
  }

  createDiv(options = {}) {
    const child = new ElementStub(options);
    this.children.push(child);
    return child;
  }

  createSpan(options = {}) {
    return this.createDiv(options);
  }

  appendText(value) {
    this.children.push(new ElementStub({ text: String(value) }));
  }

  setText(value) {
    this.textContent = String(value);
  }

  createEl(tag, options = {}) {
    return this.createDiv({ ...options, tag: tag || "div" });
  }

  addClass(name) {
    this.classes.push(name);
  }

  removeClass(name) {
    this.classes = this.classes.filter((item) => item !== name);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }

  focus() {
    this.focused = true;
  }
  scrollIntoView() {}
}

class ModalStub {
  constructor(app) {
    this.app = app;
    this.isOpen = false;
    this.modalEl = new ElementStub();
    this.contentEl = new ElementStub();
  }

  open() {
    this.isOpen = true;
    this.onOpen();
    return this;
  }

  close() {
    if (this.isOpen) {
      this.isOpen = false;
      this.onClose();
    }
    return this;
  }

  dispatchKey(event) {
    if (event && event.key === "Escape") {
      this.close();
      return;
    }
    if (typeof this.handleKeydown === "function") {
      this.handleKeydown(event);
    }
  }
}

module.exports = { ElementStub, ModalStub };
