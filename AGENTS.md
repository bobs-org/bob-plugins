Source-of-truth monorepo for bob (Bugyi's Obsidian) plugins, deployed to the vault
(in the ~/bob/ directory) via `bob plugins sync`.

Plugins with `src/fragments.json` use the committed source build. Edit their `src/`
fragments, run `npm run build`, and never hand-edit their generated `main.js`. The
manifest array is the source order; fragments share one script scope and each hand-edited
fragment must stay at or below 1000 lines. Run `npm run build:check` (also included
first in `npm test` and `npm run validate`) to verify generated entrypoints are current.
Plugins without `src/fragments.json` remain hand-edited in `main.js`.

After any changes to files in this repo, you MUST run `bob plugins sync` to sync the
repo changes to the vault.
