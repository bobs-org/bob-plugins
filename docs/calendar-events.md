---
title: "Calendar Events"
description: "Google Calendar sync and display behavior in Bob Ledger Tools."
---

## Calendar Events

**Toggle Google Calendar sync on daily-note creation** watches new daily notes
(on by default, session-only). Ledger Tools waits up to 60 seconds for a
rendered, settled note (`## Pomodoros`, no Templater tags), then runs
`bob gcal sync -q --format json` once; on timeout sync still spawns for Bob's
guard. Waiting and held reports show one Notice per day. Bob is the only
writer; errors log to the console, at most one Notice per day.

**Toggle calendar event painting** is also a session-only toggle. Events rows
in Live Preview and Reading view show quiet time pills, context tags, and
calendar/video/location badges. Ledger Task Links to the note's Event Tasks
wear the same pill beside the link; the
[Event link times](https://bobs-org.github.io/event-link-times/) contract
owns that echo. The Bob-owned `↻ synced` line under `## Events`
paints as a muted caption; it shows the last `bob gcal sync` run; sync runs on
demand, so the painter never marks it stale. On today's note, a meeting in
progress gets the MEET hue and a past meeting dims. A `[buffer:: -30m +15m]`
field paints hatched lead-in and lead-out wings fused to the time pill, labelled
`30m` / `15m` in the event hue, dashed when the row is off the clock. The pill
tooltip reads `Holds 11:30–13:15 · 30m before · 15m after`. A wing lights with
the hue outline while that buffer is in progress (`data-buffer-phase` is
`lead-in` or `lead-out`); the pill fades to past only after the buffered end.
The raw `[buffer::]` field is hidden on inactive lines and Dataview's
`.dataview.inline-field` for `buffer` is hidden in Reading view. The clock
refreshes once a minute while today's note is active. Painting reads the note
and never changes it. Ledger Task Links to off-clock tasks wear the same dashed
`off` chip, tagged or inherited.

An Event Task carrying a standalone `#off` tag (deprecated aliases `#offclock`,
`#off-clock`, and `#untracked`, case-insensitive; sync writes the canonical
`#off` spelling for a Google event tagged with any of them, and hand-written
rows may carry it too) is *off the clock*: in Live Preview its tag becomes a
single chip that shows the tag name without `#` (a `timer-off` icon in muted
ink with a dashed outline, tooltip "Off-clock · on the calendar, off the
clock"), and the raw tag returns while the cursor is on the line; in Reading
view its tag paints as a quiet mark with the same icon, outline, and tooltip.
Its time pill switches to a dashed outline in both views. A tag inside a code
span or Markdown link, or a nested `#off/x`, is not a tag.

Untagged Event Tasks that resolve off-clock through `taskEffectiveOffClock`
(an area or project `offclock: true` or a matching `offclock_types` entry on
the root walk) get the same dashed time pill in both views, with tooltip
`Off-clock · from love` (the deciding note's stem). Sync never writes an
inherited `#off`, so there is no tag chip.
A standalone `#on` keeps the solid pill and a neutral tooltip
`On the clock (override)` in both views, even under an off-clock note; `#on`
still wins when an off spelling is also on the line, and the off-clock chip
stays on that explicit tag.

The session that links such an event is written with `[off:: Nm]` instead of
`[t::]`, so its Pomodoro home chip is dashed too, with its minutes, and its
tooltip reads `love · 60m off the clock`. In Reading view the chip is dashed
only when the rendered row still shows an explicit `[off::]`, so a field the
rendering dropped never dashes a worked session.

After a successful daily auto-sync, a non-empty additive `deprecations[]` in
the JSON report shows at most one Notice per day, for example
`3 calendar events still use #offclock · run bob gcal list`. An omitted
`deprecations` field is treated as empty. Setup and writer-host errors stay in
the console; a runtime sync failure still shows at most one Notice per day of
its own.

`Ctrl+9` reuses an already open tab showing today's daily note in any window
before using the current tab or opening a new one, including a background tab
Obsidian has not loaded yet. Pinned main-area tabs are preferred, followed by
other main-area tabs, pinned sidebar tabs, and other sidebar tabs.
When the current tab is a lower-ranked copy of today's daily note, `Ctrl+9`
switches to the best-ranked tab first; it jumps to the current Pomodoro only
when pressed again on that home tab.

