// Concise date input and inline scheduling reasons (bob-cli-42.5).
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const { ElementStub, ModalStub, defer, pressKey } = require("./modal-harness.cjs");

global.window = { setTimeout: defer };

const openedModals = [];
const originalLoad = Module._load;
function parseTestYaml(text) {
  const result = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#") || /^\s/.test(line)) {
      continue;
    }
    const match = /^([^:]+):(.*)$/.exec(line);
    if (!match) {
      throw new Error("malformed yaml");
    }
    result[match[1].trim()] = match[2].trim() || null;
  }
  return result;
}

Module._load = function loadWithModalHarness(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Modal: class extends ModalStub {
        constructor(app) {
          super(app);
          openedModals.push(this);
        }
      },
      Notice: class {},
      Plugin: class {},
      parseYaml: parseTestYaml,
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const {
  BulletPropertyPickerModal,
  validateBulletPropertyConfig,
  parseBulletPropertyTypedDate,
  resolveTypedSchedule,
  formatBulletPropertyDate,
} = helpers;

const BASE_DATE = new Date(2026, 9, 3);

function iso(date) {
  return formatBulletPropertyDate(date);
}

function resolved(query, baseDate = BASE_DATE) {
  return resolveTypedSchedule(query, baseDate);
}

function validDate(query, expected, baseDate = BASE_DATE) {
  const result = resolved(query, baseDate);
  assert.equal(result.valid, true, query);
  assert.equal(result.error, null, query);
  assert.equal(iso(result.date), expected, query);
  return result;
}

function sequence(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function flattenText(element) {
  return [element.textContent, ...element.children.map(flattenText)]
    .filter(Boolean)
    .join(" ");
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

function byClass(element, className) {
  return descendants(element).filter(
    (item) => item.classes && item.classes.includes(className),
  );
}

function buildConfig() {
  const config = validateBulletPropertyConfig({
    properties: [
      { name: "scheduled", values: "date" },
      {
        name: "priority",
        values: "priority",
        schedules: "scheduled",
        levels: [
          { label: "P1", value: "high", min_days: 2, max_days: 7 },
          { label: "P2", value: "medium", min_days: 8, max_days: 30 },
          { label: "P3", value: "low", min_days: 31, max_days: 90 },
          { label: "P4", value: "lowest", min_days: 91, max_days: 365 },
        ],
      },
    ],
  });
  assert.ok(config);
  return config;
}

function freshnessApi() {
  return {
    setRefreshLine() {},
    config() {
      return { interval: 7 };
    },
  };
}

function makeEditor(content) {
  const lines = () => String(content || "").split(/\n/);
  return {
    getValue: () => content,
    getLine: (line) => {
      const all = lines();
      return line >= 0 && line < all.length ? all[line] : null;
    },
    setValue(next) {
      content = String(next);
    },
    replaceRange() {},
    transaction(transaction) {
      const changes = [...(transaction.changes || [])].sort(
        (left, right) =>
          right.from.line - left.from.line || right.from.ch - left.from.ch,
      );
      let nextLines = lines();
      for (const change of changes) {
        const fromLine = change.from.line;
        const toLine = (change.to || change.from).line;
        const fromCh = change.from.ch;
        const toCh = (change.to || change.from).ch;
        const start = nextLines[fromLine].slice(0, fromCh);
        const end = nextLines[toLine].slice(toCh);
        const inserted = String(change.text || "").split(/\n/);
        nextLines = [
          ...nextLines.slice(0, fromLine),
          start + inserted[0],
          ...inserted.slice(1, -1),
          inserted.length > 1
            ? inserted[inserted.length - 1] + end
            : start + inserted[0] + end,
          ...nextLines.slice(toLine + 1),
        ];
      }
      content = nextLines.join("\n");
    },
  };
}

function dispatchCardKey(modal, key, modifiers = {}) {
  pressKey(modal, key, modifiers);
}

function typeQuery(modal, text) {
  modal.inputEl.value = text;
  if (modal.inputEl.listeners.input) {
    modal.inputEl.listeners.input();
  }
}

function pressInputKey(modal, key, modifiers = {}) {
  const event = {
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...modifiers,
    preventDefault() {},
    stopPropagation() {},
  };
  modal.inputEl.listeners.keydown(event);
  return event;
}

function openPropertyPicker(options = {}) {
  openedModals.length = 0;
  const content =
    options.content ||
    "- [ ] #task Write the onboarding guide [priority:: medium] [scheduled:: 2026-10-06] ^guide";
  const editor = options.editor || makeEditor(content);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = options.app || {};
  plugin.getFreshnessApi = () =>
    Object.prototype.hasOwnProperty.call(options, "freshnessApi")
      ? options.freshnessApi
      : freshnessApi();
  const modal = new BulletPropertyPickerModal(
    plugin.app,
    plugin,
    editor,
    { line: 0, ch: 0 },
    content.split(/\n/)[0],
    options.config || buildConfig(),
    {
      filePath: options.filePath || "Areas/Work_ship.md",
      propertyContext: { isObsidianTask: true },
      baseDate: options.baseDate || BASE_DATE,
      random: sequence([0.1, 0.35, 0.6, 0.8, 0.95, 0.2, 0.45, 0.7]),
      taskSession: options.taskSession || null,
      linkSession: options.linkSession || null,
      ...options.context,
    },
  );
  modal.open();
  return { modal, editor, plugin, content };
}

function openScheduleStage(options = {}) {
  const opened = openPropertyPicker(options);
  dispatchCardKey(opened.modal, "Enter");
  assert.equal(opened.modal.stage, "value");
  assert.equal(opened.modal.selectedPropertyItem.property.name, "scheduled");
  return opened;
}

test("classic parser keeps ISO, M/D, and signed units and ignores concise forms", () => {
  assert.equal(iso(parseBulletPropertyTypedDate("2026-10-06", BASE_DATE)), "2026-10-06");
  assert.equal(iso(parseBulletPropertyTypedDate("10/6", BASE_DATE)), "2026-10-06");
  assert.equal(iso(parseBulletPropertyTypedDate("+3d", BASE_DATE)), "2026-10-06");
  assert.equal(iso(parseBulletPropertyTypedDate("+1w", BASE_DATE)), "2026-10-10");
  assert.equal(iso(parseBulletPropertyTypedDate("+1m", BASE_DATE)), "2026-11-03");
  assert.equal(parseBulletPropertyTypedDate("3", BASE_DATE), null);
  assert.equal(parseBulletPropertyTypedDate("3d", BASE_DATE), null);
  assert.equal(parseBulletPropertyTypedDate("mon", BASE_DATE), null);
  assert.equal(parseBulletPropertyTypedDate("3 waiting", BASE_DATE), null);
});

test("typed schedule resolver covers bare days, units, weekdays, and inline reasons", () => {
  validDate("0", "2026-10-03");
  validDate("1", "2026-10-04");
  const withReason = validDate("3 waiting on API", "2026-10-06");
  assert.equal(withReason.reason, "waiting on API");
  validDate("3d", "2026-10-06");
  validDate("+3d", "2026-10-06");
  validDate("3w", "2026-10-24");
  validDate("+2w", "2026-10-17");
  validDate("1m", "2026-11-03");
  validDate("+1m", "2026-11-03");
  validDate("sat", "2026-10-10");
  validDate("sunday", "2026-10-04");
  validDate("mon", "2026-10-05");
  validDate("Tue", "2026-10-06");
  const preserved = validDate(
    "3 waiting on API :: still blocked",
    "2026-10-06",
  );
  assert.equal(preserved.reason, "waiting on API :: still blocked");
});

test("weekdays resolve to the next occurrence strictly after today", () => {
  const saturday = new Date(2026, 9, 3);
  assert.equal(iso(resolved("sat", saturday).date), "2026-10-10");
  const wednesday = new Date(2026, 9, 7);
  assert.equal(iso(resolved("wed", wednesday).date), "2026-10-14");
  assert.equal(iso(resolved("thu", wednesday).date), "2026-10-08");
});

test("invalid leap dates, end-of-month offsets, and December rollover", () => {
  assert.equal(resolved("2024-02-29", new Date(2024, 1, 1)).valid, true);
  assert.equal(iso(resolved("2024-02-29", new Date(2024, 1, 1)).date), "2024-02-29");
  assert.equal(resolved("2026-02-29").valid, false);
  assert.equal(resolved("2026-02-29").error, "invalid date");
  assert.equal(resolved("2/29", BASE_DATE).valid, false);
  assert.equal(resolved("2/30", BASE_DATE).valid, false);
  assert.equal(resolved("2026-13-01").error, "invalid date");

  assert.equal(iso(resolved("1m", new Date(2026, 0, 31)).date), "2026-02-28");
  assert.equal(iso(resolved("1m", new Date(2024, 0, 31)).date), "2024-02-29");
  assert.equal(iso(resolved("1m", new Date(2026, 11, 20)).date), "2027-01-20");
  const nextYear = validDate("1/5", "2027-01-05");
  assert.equal(nextYear.valid, true);
  assert.equal(iso(resolved("12/15", new Date(2026, 11, 20)).date), "2027-12-15");
  assert.equal(iso(resolved("12/25", new Date(2026, 11, 20)).date), "2026-12-25");
});

test("negative, overflow, malformed, and preset-filter queries are rejected without dates", () => {
  assert.equal(resolved("-3").error, "negative offset");
  assert.equal(resolved("-3d").error, "negative offset");
  assert.equal(resolved("100000d").error, "overflow offset");
  assert.equal(resolved("3d4").error, "ambiguous input");
  assert.equal(resolved("+3").error, "ambiguous input");
  assert.equal(resolved("tomorrow").valid, false);
  assert.equal(resolved("tomorrow").error, null);
  assert.equal(resolved("in 3 days").valid, false);
  assert.equal(resolved("in 3 days").error, null);
});

test("DST local-calendar arithmetic stays on calendar days in America/New_York", () => {
  const script = [
    "const Module=require('node:module');",
    "const original=Module._load;",
    "Module._load=function(request,parent,isMain){",
    "  if(request==='obsidian')return{MarkdownView:class{},Modal:class{},Notice:class{},Plugin:class{},parseYaml:()=>({})};",
    "  if(request==='@codemirror/view')return{EditorView:class{}};",
    "  if(request==='@codemirror/state')return{Prec:{highest:(value)=>value}};",
    "  return original.call(this,request,parent,isMain);",
    "};",
    `const {helpers}=require(${JSON.stringify(
      path.join(__dirname, "../plugins/bob-navigation-hotkeys/main.js"),
    )});`,
    "const spring=new Date(2026,2,8);",
    "const fall=new Date(2026,10,1);",
    "const one=helpers.resolveTypedSchedule('1', spring);",
    "const unit=helpers.resolveTypedSchedule('1d', spring);",
    "const afterFall=helpers.resolveTypedSchedule('1', fall);",
    "if(helpers.formatBulletPropertyDate(one.date)!=='2026-03-09') process.exit(2);",
    "if(helpers.formatBulletPropertyDate(unit.date)!=='2026-03-09') process.exit(3);",
    "if(helpers.formatBulletPropertyDate(afterFall.date)!=='2026-11-02') process.exit(4);",
    "if(spring.getTimezoneOffset()===new Date(2026,2,9).getTimezoneOffset() && spring.getTimezoneOffset()===new Date(2026,0,15).getTimezoneOffset()) process.exit(5);",
  ].join("\n");
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, TZ: "America/New_York" },
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(result.error, undefined, result.stderr);
  assert.equal(result.status, 0, `child exit ${result.status}: ${result.stderr}`);
});

test("Task Card date stage previews weekday, ISO, relative distance, and rollover year", () => {
  const { modal } = openScheduleStage();
  typeQuery(modal, "3");
  const typed = modal.visibleItems[0];
  assert.equal(typed.typedSchedule, true);
  assert.equal(typed.valid, true);
  assert.equal(typed.value, "2026-10-06");
  assert.equal(typed.weekday, "Tue");
  assert.equal(typed.relative, "in 3 days");
  assert.match(typed.label, /Tue 2026-10-06/);
  assert.match(typed.detail, /in 3 days/);
  assert.match(flattenText(modal.resultsEl), /Tue 2026-10-06/);
  assert.match(flattenText(modal.resultsEl), /in\s+3\s+days/);

  typeQuery(modal, "1/5");
  const rollover = modal.visibleItems[0];
  assert.equal(rollover.value, "2027-01-05");
  assert.equal(rollover.yearRollover, true);
  assert.match(rollover.detail, /2027/);
  assert.match(flattenText(modal.resultsEl), /2027-01-05/);
});

test("inline reason is preserved on the preview and skips the reason stage", async () => {
  const captured = [];
  const { modal, plugin } = openScheduleStage({
    content: "- [ ] #task Ready work ^ready",
  });
  plugin.setBulletPropertyValue = async (_editor, _cursor, name, value, options) => {
    captured.push({ name, value, scheduleLog: options.scheduleLog });
    return true;
  };
  typeQuery(modal, "3 waiting on API");
  const typed = modal.visibleItems[0];
  assert.equal(typed.inlineReason, "waiting on API");
  assert.match(typed.detail, /waiting on API/);
  pressInputKey(modal, "Enter");
  await nextTurn();
  assert.equal(modal.stage, "value");
  assert.notEqual(modal.stage, "reason");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].value, "2026-10-06");
  assert.equal(captured[0].scheduleLog.reason, "waiting on API");
  assert.equal(modal.isOpen, false);
});

test("Shift+Enter skips the reason by the blank-reason rule and still offers Work Log", async () => {
  const captured = [];
  const { modal, plugin } = openScheduleStage({
    content: "- [/] #task Pending work ^pending",
  });
  plugin.setBulletPropertyValue = async (_editor, _cursor, name, value, options) => {
    captured.push({ name, value, scheduleLog: options.scheduleLog, work: options.schedulingWorkLog });
    return true;
  };
  typeQuery(modal, "3");
  pressInputKey(modal, "Enter", { shiftKey: true });
  await nextTurn();
  assert.equal(modal.stage, "schedule-review");
  assert.equal(modal.isOpen, true);
  assert.equal(captured.length, 0);
  assert.equal(modal.scheduleReviewReasonEl.value, "");
  assert.ok(modal.scheduleReviewSummaryEl);
  modal.scheduleReviewSummaryEl.value = "Did the thing";
  modal.visibleItems = modal.getFilteredItems();
  await modal.openItemAtIndex(0);
  await nextTurn();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].value, "2026-10-06");
  assert.equal(captured[0].scheduleLog.reason, "");
  assert.equal(captured[0].work.summary, "Did the thing");
});

test("Shift+Enter on a Ready task commits in four gestures without a Work Log", async () => {
  const captured = [];
  const { modal, plugin } = openScheduleStage({
    content: "- [ ] #task Ready work ^ready",
  });
  plugin.setBulletPropertyValue = async (_editor, _cursor, name, value, options) => {
    captured.push({ value, scheduleLog: options.scheduleLog });
    return true;
  };
  typeQuery(modal, "3");
  pressInputKey(modal, "Enter", { shiftKey: true });
  await nextTurn();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].value, "2026-10-06");
  assert.equal(captured[0].scheduleLog.reason, "");
  assert.equal(modal.isOpen, false);
});

test("invalid typed dates render an error preview and do not write", async () => {
  const captured = [];
  const { modal, plugin } = openScheduleStage();
  plugin.setBulletPropertyValue = async () => {
    captured.push("wrote");
    return true;
  };
  typeQuery(modal, "2026-02-29");
  const invalid = modal.visibleItems[0];
  assert.equal(invalid.valid, false);
  assert.equal(invalid.error, "invalid date");
  assert.match(flattenText(modal.resultsEl), /invalid date/i);
  pressInputKey(modal, "Enter");
  await nextTurn();
  assert.equal(captured.length, 0);
  assert.equal(modal.isOpen, true);
  assert.equal(modal.stage, "value");
});

test("the card's schedule stage always uses the concise resolver", () => {
  const { modal } = openScheduleStage();
  assert.equal(modal.placeholder, "Type 3, 3d, mon, +3d, or 6/24");
  for (const query of ["3", "3d", "mon"]) {
    typeQuery(modal, query);
    const typed = modal.visibleItems[0];
    assert.equal(typed.typedSchedule, true, query);
    assert.equal(typed.valid, true, query);
  }
});

test("tomorrow stays a preset filter and is not stolen as a typed date", () => {
  const { modal } = openScheduleStage();
  typeQuery(modal, "tomorrow");
  assert.equal(
    modal.visibleItems.some((item) => item.typedSchedule),
    false,
  );
  assert.ok(modal.visibleItems.some((item) => item.label === "Tomorrow"));
});

test("mixed Task Links preview one date and freeze that action with the inline reason", async () => {
  const captured = [];
  const { modal, plugin } = openScheduleStage({
    content: "- [[Tasks/Alpha#^alpha]]",
    filePath: "2026/20261003.md",
    linkSession: {
      kind: "task-link",
      requestedCount: 2,
      targets: [{ line: 0 }, { line: 4 }],
      resolved: [
        {
          path: "Tasks/Alpha.md",
          line: 0,
          rawLine:
            "- [ ] #task Alpha [priority:: high] [scheduled:: 2026-10-12] ^alpha",
          content:
            "- [ ] #task Alpha [priority:: high] [scheduled:: 2026-10-12] ^alpha\n",
        },
        {
          path: "Tasks/Beta.md",
          line: 4,
          rawLine:
            "- [*] #task Beta [priority:: medium] [scheduled:: 2026-10-18] ^beta",
          content:
            "- [*] #task Beta [priority:: medium] [scheduled:: 2026-10-18] ^beta\n",
        },
      ],
    },
  });
  plugin.applyLinkPickerPropertyValue = async (_picker, item, options) => {
    captured.push({ value: item.value, scheduleLog: options.scheduleLog });
    return true;
  };
  typeQuery(modal, "3 waiting on API");
  const typed = modal.visibleItems[0];
  assert.equal(typed.value, "2026-10-06");
  assert.equal(typed.inlineReason, "waiting on API");
  pressInputKey(modal, "Enter");
  await nextTurn();
  assert.equal(modal.stage, "schedule-review");
  assert.equal(modal.scheduleReviewReasonEl.value, "waiting on API");
  assert.ok(modal.scheduleReviewSummaryEl);
  assert.match(modal.getScheduleReviewSubtitle(), /waiting on API|scheduled → 2026-10-06/);
  modal.scheduleReviewSummaryEl.value = "";
  modal.visibleItems = modal.getFilteredItems();
  await modal.openItemAtIndex(0);
  await nextTurn();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].value, "2026-10-06");
  assert.equal(captured[0].scheduleLog.reason, "waiting on API");
  assert.equal(captured[0].scheduleLog.to, "2026-10-06");
});

test("Ctrl+Enter still takes the recommended roll from the Task Card date stage", async () => {
  const { modal } = openScheduleStage({
    content: "- [ ] #task Ready work [priority:: medium] [scheduled:: 2026-10-12] ^ready",
  });
  let applied = 0;
  modal.applyRecommendedRoll = async () => {
    applied += 1;
    return true;
  };
  pressInputKey(modal, "Enter", { ctrlKey: true });
  await nextTurn();
  assert.equal(applied, 1);
});
