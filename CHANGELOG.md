# Changelog

## 0.1.0-alpha.13

- Restore saved preferred attachments with the asynchronous Zotero item loader so uncached parent items cannot abort startup and hide all translation entry points.
- Isolate cache restoration failures per paper and wait for restoration during startup and shutdown.
- Add offline regression coverage for cold item caches, unavailable records, preference restoration and asynchronous bootstrap ordering.
- Verify the installed alpha.13 menu after an actual Zotero 10.0.7 restart on macOS, retaining saved preferred-attachment choices.

## 0.1.0-alpha.12

- Use PDF.js print intent for protected snippets so inactive reader tabs do not wait indefinitely for animation frames.
- Bound each source-region attempt to 30 seconds and retry once at a lower resolution, with canvas and render-task cleanup.
- Propagate cancellation through the native renderer and guard unresponsive raster callbacks.
- Show the current source page, block, rendering stage and region elapsed time; supply host timers explicitly to the controller sandbox.
- Add offline coverage for background rendering, hangs, retries, encoding failure, cancellation and resource cleanup.

## 0.1.0-alpha.11

- Fall back to the other bundled font for missing glyphs, including the mathematical symbols ∼, ⌈ and ⌉, without replacing the source characters.
- Validate glyph coverage against the selected font for each run, including inline code.
- Retain the alpha.10 stage progress panel and cached translations during PDF rebuilds.
- Complete add-on shutdown cleanup when previously closed reader windows have dead DOM objects.

## 0.1.0-alpha.10

- Move task status next to the primary actions in a sticky progress panel.
- Show completed terminology batches, translated paragraphs, rendering stages and elapsed time.
- Show model response waiting time, the 120-second request limit and HTTP retry countdowns.
- Check progress updates, retry callbacks and busy-state cleanup with mock responses; no additional model requests are needed.

## 0.1.0-alpha.9

- Justify English and Chinese body paragraphs while keeping paragraph endings left aligned, including explicit breaks and page continuations.
- Expand English word spaces and CJK boundaries without stretching Latin words or inline-code spacing.
- Preserve natural heading alignment and protected original figures, tables and captions.
- Validate line geometry and rebuild the cached two-paragraph sample without model calls.

## 0.1.0-alpha.8

- Use the same embedded serif face for English prose, Chinese translations and English technical terms.
- Reserve monospace for explicit inline code; per-paper terminology protection is unchanged.
- Keep Chinese closing punctuation with the preceding word when wrapping translated prose.
- Check the new typography using cached two-paragraph translations without additional model calls.

## 0.1.0-alpha.6

- Embedded serif Chinese body text with glossary/inline-code monospace runs.
- Render protected regions with the host PDF.js to avoid hidden clipped text in the output text layer.
- Handle privileged reader compartments and cross-realm PNG data.
- Validate two live DeepSeek paragraphs, local revisions and preferred attachment selection on macOS / Zotero 10.0.7.

### Internal alpha.3 runtime fixes

- Fix workbench initialization in privileged XHTML: wait for DOMContentLoaded and load the script after the interface.
- Show initialization errors in the status area and expose a readiness promise for diagnostics.
- Add regression coverage for early script execution, settings and project loading.
- Use the parent paper title for newly extracted projects.
- Read packaged fonts directly from their local resource channel.
- Extend wide protected snippets to avoid clipping underestimated small-cap title bounds.

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
