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
| Version | 0.1.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | Yes |
| Description | Link, open, and refresh saved Gmail threads from Obsidian. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Bob Mail: Link email… | `link-email` | — |
| Bob Mail: Open in Gmail | `open-in-gmail` | — |
| Bob Mail: Refresh this email | `refresh-this-email` | — |
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

- **Bob Mail: Open in Gmail** opens the current mail note's Gmail URL or a
  `[[mail/…]]` link under the cursor.
- **Bob Mail: Refresh this email** saves the open mail note again and reports
  whether new messages were added.
- **Bob Mail: Task from this email** offers `Follow up: <subject>` as editable
  task text, then captures it with a link to the mail note. When the cursor is
  in a message card, that link points to the message's `^m-…` block.
- Bob Command Mode offers **Save this email to Bob Mail** under **FROM
  CLIPBOARD** when the clipboard contains a Gmail URL.

These commands appear only when their required note or link context is
available. **Link email…** is available in any active Markdown note.

Bob Mail needs a Bob version that includes `bob gmail`. Older versions show
the quiet notice **Update bob to use Bob Mail**. On first use, enable Bob Mail
in Obsidian's Community plugins list after deploying it with `bob plugins sync`.

Mail notes use the `.bob-mail` reading style when this plugin is enabled. The
note content remains ordinary Markdown if the stylesheet is unavailable.
