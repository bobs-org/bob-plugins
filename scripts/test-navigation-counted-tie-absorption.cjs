// Counted tie absorption for nav dependency writers
// (bob-cli plan:202611/finish_plain_link_ties.md, phase nav-tie-writers).
// Covers a counted session (270/570 same-note planner) and a counted batch
// (420 vault-counted pairs), each with same-note and cross-note plain links
// plus the malformed LINKS failure suffix.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestNotice {
      constructor(message) {
        notices.push(String(message));
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: class {},
      Notice: TestNotice,
      Plugin: EmptyClass,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const LINKS = "🪢 **LINKS:**";
const taskLine = (status, text, blockId) => `- [${status}] ${text} #task ^${blockId}`;
const linksChild = (entries) => `\t- ${LINKS} ${entries}`;

function countedSession(content, sourceLines, targetLine) {
  const session = helpers.discoverCountedObsidianTaskTargets(content, sourceLines[0], sourceLines.length - 1);
  const dependencyTask = helpers.getOpenLocalTasks(content).find((task) => task.line === targetLine);
  return { session, dependencyTask };
}

test("counted session absorbs same-note plain links in one transaction", () => {
  const content = [
    taskLine(" ", "One", "one"),
    linksChild("[[#^target]]"),
    taskLine(" ", "Two", "two"),
    linksChild("[[#^target]]"),
    "- [ ] #task Target [id:: Tasks__target] ^target",
  ].join("\n");
  const { session, dependencyTask } = countedSession(content, [0, 1], 4);
  const planned = helpers.planCountedLocalTaskDependency(content, session, dependencyTask, "Tasks.md", {
    resolveLinkpath: (note, from) => (!note ? from : `${note}.md`),
    vaultFiles: ["Tasks.md"],
  });
  assert.equal(planned.valid, true);
  assert.equal(planned.operation, "add");
  assert.ok((planned.tieDropped || 0) + (planned.tieMirrorDropped || 0) > 0);
  assert.doesNotMatch(planned.content, /\*\*LINKS:\*\* \[\[#\^target\]\]/);
  assert.match(planned.content, /DEPENDS ON/);
  const notice = helpers.withTieAbsorptionNotice("⛓ Linked 2 tasks", {
    dropped: planned.tieDropped,
    mirrorDropped: planned.tieMirrorDropped,
  });
  assert.match(notice, /replaced the 🪢 link/);
});

test("counted session removal never touches LINKS lines", () => {
  const content = [
    "- [?] #task One [dependsOn:: Tasks__target] ^one",
    linksChild("[[#^target]]"),
    "- [?] #task Two [dependsOn:: Tasks__target] ^two",
    "- [ ] #task Target [id:: Tasks__target] ^target",
  ].join("\n");
  const { session, dependencyTask } = countedSession(content, [0, 1], 3);
  const planned = helpers.planCountedLocalTaskDependency(content, session, dependencyTask, "Tasks.md", {
    resolveLinkpath: (note, from) => (!note ? from : `${note}.md`),
    vaultFiles: ["Tasks.md"],
  });
  assert.equal(planned.valid, true);
  assert.equal(planned.operation, "remove");
  assert.equal(planned.tieDropped || 0, 0);
  assert.match(planned.content, /\*\*LINKS:\*\* \[\[#\^target\]\]/);
});

test("counted batch cross-note pairs absorb both sides with follow-up preimage", () => {
  const ownerContent = [
    taskLine(" ", "One", "one"),
    linksChild("[[Other#^target]]"),
  ].join("\n");
  const targetContent = [
    taskLine(" ", "Target", "target"),
    linksChild("[[Tasks#^one]]"),
  ].join("\n");
  const pairs = [{
    owner: { path: "Tasks.md", blockId: "one", line: 0 },
    other: { path: "Other.md", blockId: "target" },
  }];
  const absorbedOwner = helpers.absorbTiePairsFromContents({
    contents: new Map([["Tasks.md", ownerContent]]),
    pairs,
    paths: ["Tasks.md"],
    resolveLinkpath: (note, from) => (!note ? from : `${note}.md`),
    isWritable: () => true,
  });
  assert.ok(absorbedOwner.dropped > 0);
  assert.doesNotMatch(absorbedOwner.contents.get("Tasks.md"), /Other#\^target/);
  const absorbedTarget = helpers.absorbTiePairsFromContents({
    contents: new Map([["Other.md", targetContent]]),
    pairs,
    paths: ["Other.md"],
    resolveLinkpath: (note, from) => (!note ? from : `${note}.md`),
    isWritable: () => true,
  });
  assert.ok(absorbedTarget.dropped > 0);
  assert.doesNotMatch(absorbedTarget.contents.get("Other.md"), /Tasks#\^one/);
});

test("counted absorption reports malformed LINKS with the honest suffix", () => {
  const content = [
    taskLine(" ", "One", "one"),
    "\t- 🪢 **LINKS:** [[#^target]] until Friday",
    taskLine(" ", "Two", "two"),
    "- [ ] #task Target [id:: Tasks__target] ^target",
  ].join("\n");
  const { session, dependencyTask } = countedSession(content, [0, 1], 3);
  const planned = helpers.planCountedLocalTaskDependency(content, session, dependencyTask, "Tasks.md", {
    resolveLinkpath: (note, from) => (!note ? from : `${note}.md`),
    vaultFiles: ["Tasks.md"],
  });
  assert.equal(planned.valid, true);
  assert.ok((planned.tieSkipped || []).length > 0);
  const notice = helpers.withTieAbsorptionFailureSuffix("⛓ Linked 2 tasks", planned.tieSkipped);
  assert.match(notice, /reconcile will fold it/);
});

test("lane transfer and Pomodoro consumption stay intact on counted absorb", () => {
  const content = [
    taskLine(" ", "One", "one"),
    linksChild("[[#^target]]"),
    "- [ ] #task Target [id:: Tasks__target] ^target",
  ].join("\n");
  const { session, dependencyTask } = countedSession(content, [0], 2);
  const planned = helpers.planCountedLocalTaskDependency(content, session, dependencyTask, "Tasks.md", {
    resolveLinkpath: (note, from) => (!note ? from : `${note}.md`),
    vaultFiles: ["Tasks.md"],
    recovery: { registry: null, today: new Date(), vaultContents: null },
  });
  assert.equal(planned.valid, true);
  assert.ok(Array.isArray(planned.pomodoroTargets));
  assert.ok(Array.isArray(planned.blocksFollowUps));
});
