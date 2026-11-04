# Changelog

## 0.1.0-alpha.2

- Default design B: English 60%, Chinese 40%, vertical divider and paragraph alignment.
- Reflow prose; retain original vector snippets for math, figures, tables and captions.
- Fix missing CJK glyphs by embedding the full bundled OFL font.
- Prefer each newly generated bilingual PDF when opening its parent paper, with persistent local selection and a restore-original action.
- Reader toolbar button, Alt+Shift+T shortcut, one-click translation/generation and optional HJFY configuration import.
- Fix bootstrap globals and async credential saving on Zotero 10.
- Add offline regression checks for bootstrap, attachment preference lifecycle and PDF layout/revisions.
- Use the public npm registry for reproducible community builds.

Validation: type checking, offline smoke checks, four-page synthetic PDF rendering and manual-revision visual review. Zotero runtime / live model validation remains pending.

## 0.1.0-alpha.1

Initial public development preview:

- Zotero 10 menu integration and local structured PDF extraction adapter.
- Per-paper terminology extraction and protected-term translation.
- Editable paragraph cache with manual revisions and project import/export.
- English-vector / Chinese-text paragraph PDF renderer with original-only graphics.
- New attachment generation and local mapping back to the source project.
- API endpoint settings, Login Manager storage, cancellation and bounded API retries.
- MIT source, bundled OFL font, contribution documentation and build workflow.

Validation status: TypeScript type check and XPI build only. No Zotero runtime validation yet.
