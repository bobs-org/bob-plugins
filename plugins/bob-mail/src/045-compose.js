// Bob Mail compose surface: New email, Reply, Reply all, Save draft, Send.
//
// Pure helpers stay testable without Obsidian; the two modals at the bottom
// are thin renderers over the payload shapes `bob gmail send -d -f json`
// and `bob gmail draft -f json` return.

const MAIL_COMPOSE_DEFAULT_UNDO_SECONDS = 5;
const MAIL_COMPOSE_MAX_UNDO_SECONDS = 60;

function mailComposeUndoSeconds(settings) {
  const raw = settings && settings.undoSeconds;
  const parsed = typeof raw === "string" ? Number(String(raw).trim()) : Number(raw);
  if (!Number.isFinite(parsed)) return MAIL_COMPOSE_DEFAULT_UNDO_SECONDS;
  return Math.min(Math.max(Math.floor(parsed), 0), MAIL_COMPOSE_MAX_UNDO_SECONDS);
}

function mailComposeNotePath(context) {
  if (context && context.file && typeof context.file.path === "string") return context.file.path;
  return null;
}

function mailNewComposeArgs(input = {}) {
  const args = ["gmail", "new"];
  const to = String(input.to || "").trim();
  const subject = String(input.subject || "").trim();
  if (to) args.push("-t", to);
  if (subject) args.push("-s", subject);
  args.push("-f", "json");
  return args;
}

function mailReplyComposeArgs(notePath, replyAll) {
  const args = ["gmail", "reply", String(notePath)];
  if (replyAll) args.push("-a");
  args.push("-f", "json");
  return args;
}

function mailDraftComposeArgs(notePath) {
  return ["gmail", "draft", String(notePath), "-f", "json"];
}

function mailSendPreviewArgs(notePath) {
  return ["gmail", "send", String(notePath), "-d", "-f", "json"];
}

function mailSendConfirmArgs(notePath, digest) {
  return ["gmail", "send", String(notePath), "-c", String(digest), "-f", "json"];
}

// A draft/send `-d` preview document carries the exact preview plus the
// digest the confirmation must match. Anything else is not a preview.
function mailPreviewPayload(document) {
  if (!document || document.ok === false) return null;
  if (!document.preview || typeof document.preview !== "object") return null;
  if (!document.digest || !document.draft_id || !document.note) return null;
  return {
    note: String(document.note),
    draftId: String(document.draft_id),
    digest: String(document.digest),
    preview: document.preview,
    status: typeof document.status === "string" ? document.status : "preview",
  };
}

// A confirmed-send document reports one final status, never a preview.
function mailFinalSendPayload(document) {
  if (!document || !document.ok) return null;
  if (typeof document.status !== "string" || !document.note) return null;
  return {
    status: document.status,
    note: String(document.note),
    draftId: document.draft_id != null ? String(document.draft_id) : null,
    threadId: document.thread_id != null ? String(document.thread_id) : null,
    sentMessageId: document.sent_message_id != null ? String(document.sent_message_id) : null,
  };
}

// A note cursor from `bob gmail new -f json` / `reply -f json`.
function mailNoteCursorPayload(document) {
  if (!document || !document.ok || !document.note) return null;
  const cursor = document.cursor;
  const line = cursor && Number.isInteger(cursor.line) ? cursor.line : 0;
  const column = cursor && Number.isInteger(cursor.column) ? cursor.column : 0;
  return { note: String(document.note), line: Math.max(0, line), column: Math.max(0, column) };
}

function mailSendErrorKind(result) {
  const error = result && result.document && result.document.error;
  return error && typeof error.kind === "string" ? error.kind : null;
}

function mailIsDigestMismatch(result) {
  return mailSendErrorKind(result) === "confirmation_mismatch";
}

function mailComposeErrorHint(result) {
  const error = result && result.document && result.document.error;
  const hint = error && error.hint;
  return typeof hint === "string" && hint.trim() ? hint.trim() : null;
}

function mailPreviewList(preview, key) {
  if (!preview || !Array.isArray(preview[key])) return [];
  return preview[key];
}

function mailPreviewAttachmentRows(preview) {
  return mailPreviewList(preview, "attachments").map((entry) => ({
    vaultPath: String(entry.vault_path || entry.filename || ""),
    filename: String(entry.filename || entry.vault_path || "attachment"),
    byteLength: Number(entry.byte_length) || 0,
    sha256: String(entry.sha256 || ""),
  }));
}

function mailPreviewFlattenedNotice(preview) {
  const flattened = mailPreviewList(preview, "flattened_links");
  if (!flattened.length) return "";
  const targets = flattened
    .map((entry) => String(entry.original_target || entry.text || "").trim())
    .filter(Boolean);
  const count = `${flattened.length} link${flattened.length === 1 ? "" : "s"}`;
  return `${count} will be sent as plain text${targets.length ? `: ${targets.join(", ")}` : ""}`;
}

function mailPreviewReplyLine(preview) {
  const target = preview && preview.reply_target;
  if (!target || typeof target !== "object") return "";
  const mode = target.mode === "all" ? "Reply all" : "Reply";
  const thread = target.thread_id ? ` · thread ${target.thread_id}` : "";
  return `${mode}${thread}`;
}

// One send at a time per plugin instance, mirroring Command Mode's single
// writer slot: a second Send click is ignored while one is in flight.
function mailTryBeginSend(plugin) {
  if (plugin && plugin.mailSendActive) return false;
  if (plugin) plugin.mailSendActive = true;
  return true;
}

function mailEndSend(plugin) {
  if (plugin) plugin.mailSendActive = false;
}

function mailUndoCountdownLabel(secondsLeft) {
  const remaining = Math.max(0, Math.ceil(Number(secondsLeft) || 0));
  if (remaining <= 0) return "Sending…";
  return `Sending in ${remaining}s — press Undo to cancel`;
}

// Timer-injectable undo window: `onFire` runs unless `cancel()` wins first.
// With `seconds <= 0` the fire is still deferred, so Undo can win the tick.
function mailCreateSendUndo(options = {}) {
  const seconds = Math.max(0, Number(options.seconds) || 0);
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
  let settled = false;
  let timer = null;
  const fire = () => {
    if (settled) return;
    settled = true;
    timer = null;
    if (typeof options.onFire === "function") options.onFire();
  };
  timer = setTimeoutFn(fire, seconds * 1000);
  return {
    get pending() {
      return !settled;
    },
    cancel() {
      if (settled) return false;
      settled = true;
      try {
        clearTimeoutFn(timer);
      } catch (error) {
        // The fire already escaped; onCancel still reports the intent.
      }
      timer = null;
      if (typeof options.onCancel === "function") options.onCancel();
      return true;
    },
  };
}

class BobMailNewModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.toInput = null;
    this.subjectInput = null;
    this.creating = false;
  }

  onOpen() {
    const content = this.contentEl;
    content.empty();
    content.createEl("h2", { text: "New email" });
    this.toInput = content.createEl("input", { type: "text", placeholder: "To · comma-separated recipients" });
    this.toInput.setAttribute("aria-label", "To recipients");
    this.subjectInput = content.createEl("input", { type: "text", placeholder: "Subject" });
    this.subjectInput.setAttribute("aria-label", "Subject");
    const buttons = content.createEl("div", { cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const create = buttons.createEl("button", { text: "Create email", cls: "mod-cta" });
    create.addEventListener("click", () => {
      void this.create();
    });
    this.toInput.focus();
  }

  async create() {
    if (this.creating) return false;
    this.creating = true;
    try {
      const to = String((this.toInput && this.toInput.value) || "").trim();
      const subject = String((this.subjectInput && this.subjectInput.value) || "").trim();
      const created = await this.plugin.mailCreateCompose(to, subject);
      if (created) this.close();
      return created;
    } finally {
      this.creating = false;
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

class BobMailSendModal extends Modal {
  constructor(app, plugin, payload) {
    super(app);
    this.plugin = plugin;
    this.payload = payload;
    this.sending = false;
  }

  onOpen() {
    const content = this.contentEl;
    content.empty();
    const preview = this.payload && this.payload.preview;
    if (!preview) {
      content.createEl("p", { text: "No email preview is available." });
      return;
    }
    content.createEl("h2", { text: "Send email" });
    const meta = content.createEl("div", { cls: "bob-mail-send-meta" });
    mailSendMetaRow(meta, "From", preview.from);
    mailSendMetaRow(meta, "To", mailPreviewJoin(preview.to));
    if (Array.isArray(preview.cc) && preview.cc.length) mailSendMetaRow(meta, "Cc", mailPreviewJoin(preview.cc));
    if (Array.isArray(preview.bcc) && preview.bcc.length) mailSendMetaRow(meta, "Bcc", mailPreviewJoin(preview.bcc));
    mailSendMetaRow(meta, "Subject", preview.subject || "(no subject)");
    const replyLine = mailPreviewReplyLine(preview);
    if (replyLine) mailSendMetaRow(meta, "Mode", replyLine);
    const body = content.createEl("pre", { cls: "bob-mail-send-body", text: String(preview.text_body || "") });
    body.setAttribute("aria-label", "Email body preview");
    const attachments = mailPreviewAttachmentRows(preview);
    if (attachments.length) {
      const list = content.createEl("ul", { cls: "bob-mail-send-attachments" });
      for (const attachment of attachments) {
        list.createEl("li", { text: `📎 ${attachment.filename} · ${mailPreviewBytes(attachment.byteLength)}` });
      }
    } else {
      content.createEl("p", { cls: "bob-mail-send-empty", text: "No attachments." });
    }
    const flattened = mailPreviewFlattenedNotice(preview);
    if (flattened) content.createEl("p", { cls: "bob-mail-send-flattened", text: flattened });
    if (this.payload && this.payload.digest) {
      const digest = content.createEl("p", { cls: "bob-mail-send-digest" });
      digest.setAttribute("aria-label", "Preview digest");
      digest.setText(`Preview ${String(this.payload.digest).slice(0, 12)}…`);
    }
    const buttons = content.createEl("div", { cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const send = buttons.createEl("button", { text: "Send", cls: "mod-cta" });
    send.addEventListener("click", () => {
      void this.confirm();
    });
  }

  async confirm() {
    if (this.sending) return false;
    this.sending = true;
    try {
      const started = await this.plugin.mailSendWithUndo(this.payload);
      if (started) this.close();
      return started;
    } finally {
      this.sending = false;
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

function mailSendMetaRow(parent, label, value) {
  const row = parent.createEl("div", { cls: "bob-mail-send-row" });
  row.createEl("span", { cls: "bob-mail-send-label", text: `${label}: ` });
  row.createEl("span", { cls: "bob-mail-send-value", text: String(value == null || value === "" ? "—" : value) });
}

function mailPreviewJoin(values) {
  return Array.isArray(values) ? values.map(String).join(", ") : String(values || "");
}

function mailPreviewBytes(byteLength) {
  const size = Number(byteLength) || 0;
  if (size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / 104857.6) / 10} MB`;
}
