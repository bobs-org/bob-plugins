# emoji vendor data

## gemoji

The gemoji-emoji.json file is copied from github/gemoji, db/emoji.json, at commit
fadaeaf1f1a9be82b321316a6c5502e43138b2f6.

The database is distributed under the MIT License. GitHub's copyright and license
notice are preserved in LICENSE.gemoji.txt.

## CLDR English annotations (search keywords)

`cldr-annotations-en.json` is the `en/annotations.json` file from the
`cldr-annotations-full` package of unicode-org/cldr-json, at commit
7d2b9cb11cec08f4d333ad73209deb3df0711c3b (release 49.0.0).

`cldr-annotations-derived-en.json` is the `en/annotations.json` file from the
`cldr-annotations-derived-full` package of unicode-org/cldr-json, at the same
commit 7d2b9cb11cec08f4d333ad73209deb3df0711c3b.

Both files are distributed under the Unicode License. The copyright and permission
notice are preserved in LICENSE.cldr.txt.

Regenerate the committed JavaScript catalog with
`node scripts/gen-emoji-catalog.mjs`; do not hand-edit generated files. The
generator merges each catalog glyph's CLDR keywords and TTS name into a
`keywords` array (VS16-insensitive glyph match, deduped against aliases and
tags) and preserves each entry's gemoji `category`.
