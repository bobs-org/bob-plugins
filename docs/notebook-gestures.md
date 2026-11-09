---
title: "Notebook gestures"
description: "How Bob's plugins name notes, show notebooks in pickers, enforce the notebook parent rules, and create a notebook from Obsidian."
---

A notebook is a note with `type: "[[notebook]]"` that holds note bullets, never
tasks, under an area, a project, or another notebook. These are the Obsidian
gestures around it; the file format and `bob notebooks` commands live in the
bob-cli [Notebooks](https://bobs-org.github.io/notebooks/) contract.

## Naming a note

The block ID prompt names a plain note bullet the way it names a task. `Ctrl+6`
on `- Try mergiraf for merge conflicts [created::2026-11-09]` suggests
`try-mergiraf-merge`: the `[created::]` stamp and other inline fields are
ignored, so only the note's own words count. A bullet with no usable words
falls back to `note`. See [Block ID defaults](block-id-defaults.md).

## Notebooks in pickers

Notebooks show the `notebook-tabs` icon and a 📓 **Notebook** badge in the
child-note and parent pickers, and Open child note counts them
(`2 notebooks`). Task move (`Ctrl+Shift+M`) and inbox routing never offer a
notebook, because notebooks hold no tasks.

## Parent rules

The Change parent panel (`Ctrl+Shift+-`) follows the notebook parent rules:

- An area, project, reference, or record note never sees a notebook as a
  parent candidate.
- A notebook sees only areas, projects, and other notebooks.
- Any other note may still choose a notebook.

Typing a name the rules hide explains why, for example `dev_git is a notebook —
areas, projects, references, and record notes can't hang under one`. Enter
re-checks the rules against the live vault, so a stale pick is refused with the
same wording and nothing is written.

## Create notebook here

The **Create notebook here** command (`create-notebook-here`, no default
hotkey) creates a notebook under the active note, which must be an area, a
project, or a notebook; anywhere else a notice says so.

The modal asks for a required one-line **Summary**, an **ID**, and an optional
**Title**. The ID starts as the suggestion the block ID prompt would give a note
bullet, built from the summary and avoiding the parent's existing notebooks; it
keeps following the summary until you edit it. A line under the fields shows
the file to be written, such as `Creates dev_nvim.md`. Create stays disabled
until the summary is present and the ID uses only letters, digits, and `-`; an
ID whose file exists, or a summary over 140 characters, is called out in the
status line.

Enter or **Create** runs `bob notebooks create` through the Bob Ledger Tools
`api.notebooks` v1 namespace (desktop only). Bob writes the new note and every
affected catalog row in one guarded write, and the plugin opens the note. A
refusal, such as a damaged catalog or an existing file, appears as one notice
with bob's message and hint, and the modal stays open so you can fix it.

## Related

- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — the parent panel and pickers.
- [Block ID defaults](block-id-defaults.md) — how suggestions are generated.
