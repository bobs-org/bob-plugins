// Bob Command Mode: outcome toast cards and their action strip.

const CM_TOAST_META = {
  completed: { glyph: "✓", label: "Completed", duration: 5000 },
  attention: { glyph: "◐", label: "Needs attention", duration: 8000 },
  failed: { glyph: "✗", label: "Failed", duration: 0 },
  unknown: { glyph: "?", label: "Unknown · log preserved", duration: 0 },
  stopped: { glyph: "■", label: "Stopped", duration: 5000 },
};

function cmToastRun(outcome = {}) {
  return outcome.record && typeof outcome.record === "object" ? outcome.record : {};
}

function cmToastDuration(outcome = {}) {
  const state = CM_TOAST_META[outcome.outcome] ? outcome.outcome : "unknown";
  return CM_TOAST_META[state].duration;
}

function cmToastSummary(outcome = {}) {
  const record = cmToastRun(outcome);
  const source = outcome.reason || record.summary || outcome.summary || "Done";
  const lines = cmStripAnsi(source).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 2) return lines.join(" · ") || "Done";
  return lines.slice(0, 2).join(" · ") + " …";
}

function cmToastTitle(outcome = {}) {
  const record = cmToastRun(outcome);
  return String(record.title || outcome.title || record.entry_id || outcome.entryId || "bob");
}

function cmToastArgv(outcome = {}) {
  const record = cmToastRun(outcome);
  const argv = Array.isArray(record.argv) ? [...record.argv] : [];
  if (argv.length && (argv[0] === "bob" || /(?:^|\/)bob$/.test(String(argv[0])))) argv.shift();
  return cmFormatArgv(["bob", ...argv]);
}

function cmToastActions(outcome = {}) {
  const actions = Array.isArray(outcome.actions) ? outcome.actions.filter((action) => action && action.label) : [];
  actions.push({ id: "output", label: "Output" });
  actions.push({ id: "retry", label: "Retry" });
  actions.push({ id: "copy", label: "Copy" });
  return actions;
}

function cmToastNode(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function cmCreateToastFragment(outcome = {}, onAction = () => {}, onOutput = () => {}) {
  if (typeof document === "undefined" || !document.createDocumentFragment) return null;
  const state = CM_TOAST_META[outcome.outcome] ? outcome.outcome : "unknown";
  const meta = CM_TOAST_META[state];
  const fragment = document.createDocumentFragment();
  const card = cmToastNode("section", "bob-cmd-toast is-" + state);
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", state === "failed" || state === "unknown" ? "assertive" : "polite");

  const header = cmToastNode("div", "bob-cmd-toast-header");
  const mark = cmToastNode("span", "bob-cmd-toast-mark", meta.glyph);
  mark.setAttribute("aria-hidden", "true");
  const title = cmToastNode("span", "bob-cmd-toast-title", cmToastTitle(outcome));
  const duration = cmToastNode("span", "bob-cmd-toast-duration", cmFormatDuration(cmToastRun(outcome).duration_ms));
  header.append(mark, title, duration);
  card.appendChild(header);

  const body = cmToastNode("div", "bob-cmd-toast-body");
  const summary = cmToastNode("div", "bob-cmd-toast-summary", cmToastSummary(outcome));
  const argv = cmToastNode("code", "bob-cmd-toast-argv", cmToastArgv(outcome));
  body.append(summary, argv);
  body.addEventListener("click", (event) => {
    if (event && event.defaultPrevented) return;
    onOutput(cmToastRun(outcome).id || outcome.runId);
  });
  card.appendChild(body);

  const actions = cmToastNode("div", "bob-cmd-toast-actions");
  for (const action of cmToastActions(outcome)) {
    const button = cmToastNode("button", "bob-cmd-toast-action", action.label);
    button.type = "button";
    button.setAttribute("data-action-id", action.id || "");
    button.addEventListener("click", (event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      onAction(action, outcome);
    });
    actions.appendChild(button);
  }
  card.appendChild(actions);
  fragment.appendChild(card);
  return fragment;
}
