// Compose-surface coverage for Bob Mail: New email, Reply, Reply all,
// Save draft, and the digest-bound Send flow with its Undo countdown.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { ElementStub, ModalStub, click } = require("./modal-harness.cjs");

const notices = [];
const openedModals = [];

class TestMarkdownView {}

class TestNotice {
  constructor(message, timeout) {
    this.message = String(message);
    this.timeout = timeout;
    this.noticeEl = new ElementStub();
    this.hidden = false;
    notices.push(this);
  }

  hide() {
    this.hidden = true;
  }

  setMessage(message) {
    this.message = String(message);
  }
}

class TestPluginBase {
  constructor(app) {
    this.app = app;
    this.commands = [];
  }

  async loadData() {
    return {};
  }

  async saveData() {}

  addCommand(command) {
    this.commands.push(command);
  }

  addSettingTab() {}

  registerEvent() {}
}

class TestModal extends ModalStub {
  constructor(app) {
    super(app);
    openedModals.push(this);
  }
}

class TestPluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
}

class TestSetting {}

const originalLoad = Module._load;
Module._load = function loadWithMailComposeStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Modal: TestModal,
      Notice: TestNotice,
      Plugin: TestPluginBase,
      PluginSettingTab: TestPluginSettingTab,
      Setting: TestSetting,
      openExternal: () => {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const BobMailPlugin = require("../plugins/bob-mail/main.js");
const mail = BobMailPlugin.helpers;
Module._load = originalLoad;

const DIGEST = "a".repeat(64);

function previewDocument(overrides = {}) {
  return {
    schema_version: 1,
    ok: true,
    status: "preview",
    note: "mail/2026/260919_lease_renewal.md",
    draft_id: "r_123",
    digest: DIGEST,
    preview: {
      account: "you@example.com",
      from: "you@example.com",
      to: ["dana@example.com"],
      cc: ["lee@example.com"],
      bcc: [],
      subject: "Lease renewal for 14 Elm St",
      reply_target: {
        thread_id: "199c3f1e8b2d4a10",
        message_id: "19a0",
        rfc_message_id: "<aaa@mail.gmail.com>",
        mode: "single",
      },
      text_body: "Thanks Dana — two questions before I sign.",
      html_sha256: "b".repeat(64),
      signature: "gmail",
      attachments: [
        {
          vault_path: "img/mail/abc/renewal_offer.pdf",
          filename: "renewal_offer.pdf",
          byte_length: 248000,
          sha256: "c".repeat(64),
        },
      ],
      flattened_links: [{ original_target: "https://example.com/lease", text: "lease" }],
    },
    ...overrides,
  };
}

function flattenText(element) {
  return [element.textContent, ...element.children.map(flattenText)]
    .filter(Boolean)
    .join(" ");
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

function composePlugin(overrides = {}) {
  const plugin = Object.create(BobMailPlugin.prototype);
  plugin.app = overrides.app || {};
  plugin.settings = { undoSeconds: 5, ...(overrides.settings || {}) };
  plugin.mailSendActive = false;
  plugin.mailCall = overrides.mailCall || (async () => ({ ok: false, error: "not stubbed" }));
  return plugin;
}

test("compose arg builders match the bob gmail CLI contract", () => {
  assert.deepEqual(mail.mailNewComposeArgs({ to: "dana@example.com", subject: "Hi" }), [
    "gmail", "new", "-t", "dana@example.com", "-s", "Hi", "-f", "json",
  ]);
  assert.deepEqual(mail.mailNewComposeArgs({ to: "  ", subject: "" }), ["gmail", "new", "-f", "json"]);
  assert.deepEqual(mail.mailReplyComposeArgs("mail/2026/x.md", false), [
    "gmail", "reply", "mail/2026/x.md", "-f", "json",
  ]);
  assert.deepEqual(mail.mailReplyComposeArgs("mail/2026/x.md", true), [
    "gmail", "reply", "mail/2026/x.md", "-a", "-f", "json",
  ]);
  assert.deepEqual(mail.mailDraftComposeArgs("mail/2026/x.md"), ["gmail", "draft", "mail/2026/x.md", "-f", "json"]);
  assert.deepEqual(mail.mailSendPreviewArgs("mail/2026/x.md"), ["gmail", "send", "mail/2026/x.md", "-d", "-f", "json"]);
  assert.deepEqual(mail.mailSendConfirmArgs("mail/2026/x.md", DIGEST), [
    "gmail", "send", "mail/2026/x.md", "-c", DIGEST, "-f", "json",
  ]);
});

test("preview and error payload helpers classify bob documents", () => {
  const payload = mail.mailPreviewPayload(previewDocument());
  assert.equal(payload.note, "mail/2026/260919_lease_renewal.md");
  assert.equal(payload.draftId, "r_123");
  assert.equal(payload.digest, DIGEST);
  assert.equal(payload.preview.subject, "Lease renewal for 14 Elm St");
  assert.equal(mail.mailPreviewPayload({ ok: false }), null);
  assert.equal(mail.mailPreviewPayload({ ok: true, note: "x" }), null);

  const final = mail.mailFinalSendPayload({
    schema_version: 1,
    ok: true,
    status: "sent",
    note: "mail/2026/x.md",
    draft_id: "r_1",
    thread_id: "t_1",
    sent_message_id: "m_1",
  });
  assert.equal(final.status, "sent");
  assert.equal(final.threadId, "t_1");

  const mismatch = {
    ok: false,
    error: "the confirmation digest does not match",
    document: {
      schema_version: 1,
      ok: false,
      error: { kind: "confirmation_mismatch", message: "mismatch", hint: "run `bob gmail send NOTE --dry-run`" },
    },
  };
  assert.equal(mail.mailIsDigestMismatch(mismatch), true);
  assert.equal(mail.mailComposeErrorHint(mismatch), "run `bob gmail send NOTE --dry-run`");
  assert.equal(mail.mailIsDigestMismatch({ ok: false, error: "boom" }), false);

  assert.equal(mail.mailComposeUndoSeconds({ undoSeconds: 5 }), 5);
  assert.equal(mail.mailComposeUndoSeconds({ undoSeconds: "abc" }), 5);
  assert.equal(mail.mailComposeUndoSeconds({ undoSeconds: 0 }), 0);
  assert.equal(mail.mailComposeUndoSeconds({}), 5);

  assert.equal(mail.mailTryBeginSend({}), true);
  const busy = { mailSendActive: true };
  assert.equal(mail.mailTryBeginSend(busy), false);
  mail.mailEndSend(busy);
  assert.equal(mail.mailTryBeginSend(busy), true);

  assert.match(mail.mailPreviewFlattenedNotice(previewDocument().preview), /plain text/);
  assert.match(mail.mailPreviewFlattenedNotice(previewDocument().preview), /example\.com\/lease/);
  assert.equal(mail.mailPreviewFlattenedNotice({}), "");
  assert.match(mail.mailPreviewReplyLine(previewDocument().preview), /Reply/);
});

test("the send modal renders the exact preview from fixture JSON", () => {
  openedModals.length = 0;
  const payload = mail.mailPreviewPayload(previewDocument());
  const modal = new mail.BobMailSendModal({}, { mailSendActive: false, settings: {} }, payload);
  modal.open();
  const text = flattenText(modal.contentEl);
  assert.match(text, /Send email/);
  assert.match(text, /you@example\.com/);
  assert.match(text, /dana@example\.com/);
  assert.match(text, /lee@example\.com/);
  assert.match(text, /Lease renewal for 14 Elm St/);
  assert.match(text, /two questions before I sign/);
  assert.match(text, /renewal_offer\.pdf/);
  assert.match(text, /plain text/);
  assert.match(text, /Preview a{8}/);
  modal.close();
});

test("undo cancels the send before bob is called", async () => {
  notices.length = 0;
  const calls = [];
  const plugin = composePlugin({
    settings: { undoSeconds: 5 },
    mailCall: async (args) => {
      calls.push(args);
      return { ok: true, document: { schema_version: 1, ok: true, status: "sent", note: "n", draft_id: "r" } };
    },
  });
  const preview = previewDocument().preview;
  const pending = plugin.mailSendWithUndo({ note: "mail/2026/x.md", digest: DIGEST, preview });
  const undoNotice = notices[notices.length - 1];
  assert.match(undoNotice.message, /Sending in 5s/);
  const button = undoNotice.noticeEl.children.find((child) => child.tagName === "BUTTON");
  assert.ok(button);
  button.listeners.click({});
  assert.equal(await pending, false);
  assert.equal(calls.length, 0);
  assert.ok(notices.some((notice) => notice.message.includes("Send cancelled")));
  assert.equal(plugin.mailSendActive, false);
});

test("a second send is ignored while one is in flight, and the digest passes through", async () => {
  notices.length = 0;
  const calls = [];
  const plugin = composePlugin({
    settings: { undoSeconds: 0 },
    mailCall: async (args) => {
      calls.push(args);
      return {
        ok: true,
        document: {
          schema_version: 1,
          ok: true,
          status: "sent",
          note: "mail/2026/x.md",
          draft_id: "r_1",
          thread_id: "t_1",
          sent_message_id: "m_1",
        },
      };
    },
  });
  const preview = previewDocument().preview;
  const payload = { note: "mail/2026/x.md", digest: DIGEST, preview };
  const first = plugin.mailSendWithUndo(payload);
  const second = await plugin.mailSendWithUndo(payload);
  assert.equal(second, false);
  assert.ok(notices.some((notice) => notice.message.includes("already running")));
  assert.equal(await first, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["gmail", "send", "mail/2026/x.md", "-c", DIGEST, "-f", "json"]);
  assert.ok(notices.some((notice) => notice.message.includes("Sent")));
  assert.equal(plugin.mailSendActive, false);
});

test("a digest mismatch re-previews instead of sending", async () => {
  notices.length = 0;
  openedModals.length = 0;
  const calls = [];
  const plugin = composePlugin({
    mailCall: async (args) => {
      calls.push(args);
      if (args.includes("-c")) {
        return {
          ok: false,
          error: "the confirmation digest does not match the current Gmail preview",
          document: {
            schema_version: 1,
            ok: false,
            error: {
              kind: "confirmation_mismatch",
              message: "the confirmation digest does not match the current Gmail preview",
              hint: "run `bob gmail send NOTE --dry-run` to obtain the current digest",
            },
          },
        };
      }
      return { ok: true, document: previewDocument() };
    },
  });
  assert.equal(await plugin.mailExecuteConfirmedSend("mail/2026/x.md", "0".repeat(64)), false);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("-c"));
  assert.ok(calls[1].includes("-d"));
  assert.ok(notices.some((notice) => notice.message.includes("review the new preview")));
  assert.equal(
    openedModals.filter((modal) => modal instanceof mail.BobMailSendModal).length,
    1,
  );
});

test("the send modal ignores a double click on Send", async () => {
  openedModals.length = 0;
  const calls = [];
  let resolveSend;
  const plugin = {
    mailSendActive: false,
    settings: {},
    mailSendWithUndo: (payload) => {
      calls.push(payload);
      return new Promise((resolve) => {
        resolveSend = resolve;
      });
    },
  };
  const payload = mail.mailPreviewPayload(previewDocument());
  const modal = new mail.BobMailSendModal({}, plugin, payload);
  modal.open();
  const send = descendants(modal.contentEl).find(
    (element) => element.tagName === "BUTTON" && element.textContent === "Send",
  );
  assert.ok(send);
  click(send);
  click(send);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], payload);
  resolveSend(true);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(modal.isOpen, false);
});

test("compose commands appear only with a mail-note context, except New email", async () => {
  notices.length = 0;
  const view = {
    file: { path: "mail/2026/x.md", basename: "x" },
    editor: { getLine: () => "", getCursor: () => ({ line: 0, ch: 0 }) },
  };
  const app = {
    activeView: view,
    workspace: {
      getActiveViewOfType() {
        return this.app.activeView;
      },
      on() {
        return {};
      },
      app: null,
    },
    metadataCache: {
      getFileCache: (file) => (file.path === "mail/2026/x.md"
        ? { frontmatter: { type: "[[mail]]", gmail_thread_id: "abc" } }
        : { frontmatter: null }),
      getFirstLinkpathDest: () => null,
    },
    vault: { adapter: { basePath: "/vault" } },
  };
  app.workspace.app = app;
  const plugin = new BobMailPlugin(app);
  await plugin.onload();
  const commands = Object.fromEntries(plugin.commands.map((command) => [command.id, command]));
  for (const id of ["new-email", "reply", "reply-all", "save-draft", "send"]) {
    assert.ok(commands[id], `missing command ${id}`);
  }
  assert.equal(commands["new-email"].checkCallback(true), true);
  assert.equal(commands.reply.checkCallback(true), true);
  assert.equal(commands["reply-all"].checkCallback(true), true);
  assert.equal(commands["save-draft"].checkCallback(true), true);
  assert.equal(commands.send.checkCallback(true), true);

  app.activeView = {
    file: { path: "daily.md", basename: "daily" },
    editor: { getLine: () => "", getCursor: () => ({ line: 0, ch: 0 }) },
  };
  assert.equal(commands["new-email"].checkCallback(true), true);
  assert.equal(commands.reply.checkCallback(true), false);
  assert.equal(commands["reply-all"].checkCallback(true), false);
  assert.equal(commands["save-draft"].checkCallback(true), false);
  assert.equal(commands.send.checkCallback(true), false);
});
