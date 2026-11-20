"use strict";
// Obsidian 2.1.2's default button rules, root variables, and light/dark
// palettes. Shared by the copy-chip, command-chip, and authoring-card
// previews so the palettes cannot drift. Includes --color-blue,
// --text-on-accent, and --text-on-accent-inverted (black in both themes).

const OBSIDIAN_BUTTON_RULES = `button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color);
  font-size: var(--font-ui-small);
  border-radius: var(--button-radius);
  border: 0;
  padding: var(--size-4-1) var(--size-4-3);
  height: var(--input-height);
  font-weight: var(--input-font-weight);
  cursor: var(--cursor);
  font-family: inherit;
  outline: none;
  user-select: none;
  white-space: nowrap;
  transition: var(--button-transition);
}
button:not(.clickable-icon) {
  color: var(--text-color);
  background-color: var(--interactive-normal);
  box-shadow: var(--input-shadow);
}
@media (hover: hover) {
  button:hover {
    background-color: var(--interactive-hover);
    box-shadow: var(--input-shadow-hover);
  }
}
button:focus-visible {
  box-shadow: 0 0 0 3px var(--background-modifier-border-focus);
}
button:not(.clickable-icon).mobile-tap {
  background-color: var(--interactive-hover);
  box-shadow: var(--input-shadow-hover);
}`;

const ROOT_CSS = [
  "*, *::before, *::after { box-sizing: border-box; }",
  ":root { --radius-s: 4px; --layer-tooltip: 40; --font-ui-small: 13px; --font-ui-smaller: 12px; --input-height: 30px;",
  "  --button-radius: 5px; --size-4-1: 4px; --size-4-3: 12px; --input-font-weight: 500; --cursor: default;",
  "  --button-transition: background-color 140ms ease, box-shadow 140ms ease; --icon-size: 18px; --icon-stroke: 1.75px;",
  "  --font-interface: Inter, ui-sans-serif, sans-serif; --font-text: Inter, ui-sans-serif, sans-serif; --font-monospace: ui-monospace, 'DejaVu Sans Mono', monospace; }",
  "body { --text-color: var(--text-normal); }",
  ".svg-icon { width: var(--icon-size); height: var(--icon-size); stroke-width: var(--icon-stroke); }",
].join("\n");

// Obsidian's default palette (light and dark), accent hsl(258 88% 66%).
const PALETTE_LIGHT = `body[data-theme="light"] {
  --background-primary:#ffffff; --background-secondary:#f6f6f6; --background-modifier-border:#e0e0e0;
  --background-modifier-border-focus:#bdbdbd; --background-modifier-hover:rgba(0,0,0,.067);
  --text-normal:#222222; --text-muted:#5c5c5c; --text-faint:#ababab; --text-on-accent:#ffffff;
  --text-on-accent-inverted:black; --text-highlight-bg:rgba(255, 208, 0, 0.4);
  --text-error:#e93147; --text-accent:hsl(258 88% 66%); --interactive-accent:hsl(258 88% 66%);
  --interactive-normal:#ffffff; --interactive-hover:#fafafa;
  --color-red:#e93147; --color-orange:#ec7500; --color-yellow:#e0ac00; --color-green:#08b94e;
  --color-cyan:#00bfbc; --color-blue:#086ddd; --color-purple:#7852ee;
  --input-shadow:inset 0 0 0 1px rgba(0,0,0,.12), 0 2px 3px 0 rgba(0,0,0,.05), 0 1px 1.5px 0 rgba(0,0,0,.03), 0 1px 2px 0 rgba(0,0,0,.04), 0 0 0 0 transparent;
  --input-shadow-hover:inset 0 0 0 1px rgba(0,0,0,.17), 0 2px 3px 0 rgba(0,0,0,.1), 0 1px 1.5px 0 rgba(0,0,0,.03), 0 1px 2px 0 rgba(0,0,0,.04), 0 0 0 0 transparent;
  --shadow-s:0 1px 2px rgba(0,0,0,.028), 0 3.4px 6.7px rgba(0,0,0,.042), 0 15px 30px rgba(0,0,0,.07);
  --shadow-l:0 12px 32px #20263a22;
  color-scheme:light;
}`;

const PALETTE_DARK = `body[data-theme="dark"] {
  --background-primary:#1e1e1e; --background-secondary:#262626; --background-modifier-border:#363636;
  --background-modifier-border-focus:#555555; --background-modifier-hover:rgba(255,255,255,.075);
  --text-normal:#dadada; --text-muted:#b3b3b3; --text-faint:#666666; --text-on-accent:#ffffff;
  --text-on-accent-inverted:black; --text-highlight-bg:rgba(255, 208, 0, 0.4);
  --text-error:#fb464c; --text-accent:hsl(258 88% 66%); --interactive-accent:hsl(258 88% 66%);
  --interactive-normal:#363636; --interactive-hover:#3f3f3f;
  --color-red:#fb464c; --color-orange:#e9973f; --color-yellow:#e0de71; --color-green:#44cf6e;
  --color-cyan:#53dfdd; --color-blue:#027aff; --color-purple:#a882ff;
  --input-shadow:inset 0 .5px .5px .5px rgba(255,255,255,.09), 0 2px 4px 0 rgba(0,0,0,.15), 0 1px 1.5px 0 rgba(0,0,0,.1), 0 1px 2px 0 rgba(0,0,0,.2), 0 0 0 0 transparent;
  --input-shadow-hover:inset 0 .5px 1px .5px rgba(255,255,255,.16), 0 2px 3px 0 rgba(0,0,0,.3), 0 1px 1.5px 0 rgba(0,0,0,.2), 0 1px 2px 0 rgba(0,0,0,.4), 0 0 0 0 transparent;
  --shadow-s:0 1px 2px rgba(0,0,0,.121), 0 3.4px 6.7px rgba(0,0,0,.179), 0 15px 30px rgba(0,0,0,.3);
  --shadow-l:0 12px 32px #0008;
  color-scheme:dark;
}`;

function baselineCss() {
  return [ROOT_CSS, OBSIDIAN_BUTTON_RULES].join("\n");
}

function paletteCss() {
  return [PALETTE_LIGHT, PALETTE_DARK].join("\n");
}

function css() {
  return [baselineCss(), paletteCss()].join("\n");
}

module.exports = {
  OBSIDIAN_BUTTON_RULES,
  ROOT_CSS,
  PALETTE_LIGHT,
  PALETTE_DARK,
  baselineCss,
  paletteCss,
  css,
};
