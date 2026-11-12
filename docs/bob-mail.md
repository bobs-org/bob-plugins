---
title: "Bob Mail"
description: "Link Gmail threads to notes and tasks from Obsidian."
---

Bob Mail connects Obsidian to Bob's saved Gmail notes. `bob` owns the Gmail
search and save behavior; the plugin displays its results and inserts links.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Mail |
| ID | `bob-mail` |
| Version | 0.2.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | Yes |
| Description | Link, open, refresh, and send saved Gmail threads from Obsidian. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Bob Mail: Link email… | `link-email` | — |
| Bob Mail: New email | `new-email` | — |
| Bob Mail: Open in Gmail | `open-in-gmail` | — |
| Bob Mail: Refresh this email | `refresh-this-email` | — |
| Bob Mail: Reply | `reply` | — |
| Bob Mail: Reply all | `reply-all` | — |
| Bob Mail: Save draft | `save-draft` | — |
| Bob Mail: Send | `send` | — |
| Bob Mail: Task from this email | `task-from-this-email` | — |
<!-- END GENERATED: commands -->

## Link an email

Run **Bob Mail: Link email…** from any Markdown note. The picker starts with
recent inbox threads, searches as you type, shows the sender, date, message
count, and whether the thread is already saved, then inserts Bob's returned
email link at the editor cursor. If the note or cursor changes while the save
is running, Bob still saves the email but the plugin leaves the editor alone.

Pasting one Gmail URL into a Markdown note saves it and replaces the URL with
the email link. This is on by default and can be disabled under **Settings →
Bob Mail**. If a paste or picker save fails, the URL or editor text stays as it
was and the notice shows Bob's message.

## Work from an email

- **Bob Mail: Open in Gmail** opens the current mail note's Gmail URL, a
  `[[mail/…]]` link anywhere on the cursor's line (first mail link wins;
  fenced and inline code never count), or — from a checkbox task row with
  no mail link of its own — a direct link-only child bullet's mail note.
  Task status does not matter; a missing or invalid `gmail_url` stays a
  silent no-op.
- Press **Cmd+Enter** (vim normal mode, `<M-CR>` / `<M-Enter>`) anywhere
  on the row to open the same thread in the browser. The muted `⌘↵ Gmail`
  chip (macOS; `M-↵ Gmail` elsewhere) on the cursor's row shows exactly
  when the keymap is live. The plugin exposes `mailGmailOpenKeymap = 1`
  only after the vim mappings register, so the chip never advertises a
  keymap that is not live.
- **Bob Mail: Refresh this email** saves the open mail note again and reports
  whether new messages were added.
- **Bob Mail: Task from this email** offers `Follow up: <subject>` as editable
  task text, then captures it with a link to the mail note. When the cursor is
  in a message card, that link points to the message's `^m-…` block. It
  shares the widened email context above, so it is also available on
  line-borne and child-hop rows.
- Bob Command Mode offers **Save this email to Bob Mail** under **FROM
  CLIPBOARD** when the clipboard contains a Gmail URL.

## Write and send email

- **Bob Mail: New email** asks for To and Subject, creates the compose note
  at its final `mail/` path with `bob gmail new`, and opens it with the
  cursor in the message body.
- **Bob Mail: Reply** and **Bob Mail: Reply all** add the reply section with
  `bob gmail reply` and put the cursor inside it.
- **Bob Mail: Save draft** records the Gmail draft with `bob gmail draft`
  and shows a toast with the draft digest.
- **Bob Mail: Send** renders the exact preview from
  `bob gmail send -d` — recipients, subject, text body, attachments, and any
  flattened-link notice — in a confirmation modal. Choosing Send starts an
  Undo countdown (5 seconds by default, adjustable under **Settings → Bob
  Mail**); when it lapses without Undo, the plugin runs
  `bob gmail send -c <digest>` with the digest bound to that preview. If the
  note changed since the preview, nothing is sent and the fresh preview
  opens instead. A second Send click while one is in flight is ignored.

Read-only and missing-scope failures show Bob's hint, for example to run
`bob gmail login -s compose` on the approved compose host.

These commands appear only when their required note or link context is
available. **Link email…** is available in any active Markdown note, as is
**New email**. Reply, Save draft, and Send need the open mail note.

Bob Mail needs a Bob version that includes `bob gmail`. Older versions show
the quiet notice **Update bob to use Bob Mail**. On first use, enable Bob Mail
in Obsidian's Community plugins list after deploying it with `bob plugins sync`.

Mail notes use the `.bob-mail` reading style when this plugin is enabled. The
note content remains ordinary Markdown if the stylesheet is unavailable.
