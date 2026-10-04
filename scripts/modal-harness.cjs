// Small DOM and Obsidian Modal stand-ins for tests that need to exercise the
// production onOpen → renderAll → renderFooter/renderResults lifecycle.
let activeElement = null;
const deferred = [];

class ElementStub {
  constructor(options = {}) {
    this.children = [];
    this.parent = null;
    this.attributes = { ...(options.attr || {}) };
    this._listeners = {};
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
    this.disabled = false;
  }

  empty() {
    const hadFocusedDescendant = isWithin(activeElement, this) && activeElement !== this;
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.textContent = "";
    if (hadFocusedDescendant && body) body.focus();
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  createDiv(options = {}) {
    return this.appendChild(new ElementStub(options));
  }

  createSpan(options = {}) {
    return this.createDiv(options);
  }

  appendText(value) {
    this.appendChild(new ElementStub({ text: String(value) }));
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

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, callback) {
    if (typeof callback !== "function") return;
    const handlers = (this._listeners[type] ||= []);
    handlers.push(callback);
    this.listeners[type] = (event) => {
      for (const handler of [...handlers]) handler.call(this, event);
    };
  }

  focus() {
    if (activeElement && activeElement !== this) activeElement.focused = false;
    activeElement = this;
    this.focused = true;
  }

  blur() {
    if (activeElement === this) body.focus();
    this.focused = false;
  }

  scrollIntoView() {}
}

const body = new ElementStub({ tag: "body" });
activeElement = body;

function isWithin(element, ancestor) {
  for (let current = element; current; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

function isFocusable(element, includeTabindexMinusOne = true) {
  if (!element || element.disabled || element.getAttribute("disabled") !== undefined) {
    return false;
  }
  const tag = element.tagName;
  const hasHref = element.getAttribute("href") !== undefined;
  const hasContentEditable = element.getAttribute("contenteditable") !== undefined;
  const tabindex = element.getAttribute("tabindex");
  const matches =
    ((tag === "A" || tag === "AREA") && hasHref) ||
    ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(tag) ||
    hasContentEditable ||
    tabindex !== undefined;
  return matches && (includeTabindexMinusOne || tabindex !== "-1");
}

function firstFocusableDescendant(element) {
  for (const child of element.children) {
    if (isFocusable(child, false)) return child;
    const nested = firstFocusableDescendant(child);
    if (nested) return nested;
  }
  return null;
}

function focusForClick(element) {
  for (let current = element; current; current = current.parent) {
    if (isFocusable(current, true)) {
      current.focus();
      return;
    }
  }
  body.focus();
}

function makeEvent(key, target, modifiers = {}) {
  const event = {
    key,
    target,
    ...modifiers,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
  };
  return event;
}

function dispatchBubbling(type, target, event) {
  for (let current = target; current && !event.propagationStopped; current = current.parent) {
    const handlers = current._listeners && current._listeners[type];
    for (const handler of handlers ? [...handlers] : []) {
      handler.call(current, event);
      if (event.propagationStopped) break;
    }
  }
}

function defer(callback) {
  const id = deferred.length + 1;
  deferred.push({ id, callback });
  return id;
}

function flushDeferred() {
  let guard = 0;
  while (deferred.length) {
    if (++guard > 1000) throw new Error("deferred callback queue did not settle");
    const next = deferred.shift();
    next.callback();
  }
}

function click(element) {
  if (!element) return null;
  focusForClick(element);
  const event = makeEvent("click", element);
  dispatchBubbling("click", element, event);
  flushDeferred();
  return event;
}

function pressKey(modal, key, modifiers = {}) {
  const target = isWithin(activeElement, modal && modal.modalEl)
    ? activeElement
    : modal && modal.contentEl;
  const event = makeEvent(key, target || body, modifiers);
  dispatchBubbling("keydown", event.target, event);

  if (
    !event.defaultPrevented &&
    target &&
    target.tagName === "BUTTON" &&
    (key === "Enter" || key === " ")
  ) {
    click(target);
  }
  if (key === "Escape" && !event.defaultPrevented && modal && modal.attached) {
    modal.close();
  }
  flushDeferred();
  return event;
}

class ModalStub {
  constructor(app) {
    this.app = app;
    this.attached = false;
    this.modalEl = new ElementStub();
    this.contentEl = new ElementStub();
    this.modalEl.appendChild(this.contentEl);
  }

  open() {
    if (this.attached) return this;
    this.attached = true;
    body.appendChild(this.modalEl);
    this.onOpen();
    const initialFocus = firstFocusableDescendant(this.modalEl);
    if (initialFocus) initialFocus.focus();
    flushDeferred();
    return this;
  }

  close() {
    const parent = this.modalEl.parent;
    if (parent) parent.children = parent.children.filter((child) => child !== this.modalEl);
    this.modalEl.parent = null;
    if (isWithin(activeElement, this.modalEl)) body.focus();
    this.attached = false;
    this.onClose();
    return this;
  }

  onOpen() {}
  onClose() {}

  dispatchKey(event) {
    if (event && event.key === "Escape" && !event.defaultPrevented) {
      this.close();
      return;
    }
    if (typeof this.handleKeydown === "function") this.handleKeydown(event);
  }
}

const harness = { ElementStub, ModalStub, body, click, defer, flushDeferred, pressKey };
Object.defineProperty(harness, "activeElement", {
  enumerable: true,
  get: () => activeElement,
});

module.exports = harness;
