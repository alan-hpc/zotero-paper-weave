# Changelog

## 0.1.0-alpha.43

- Make optional image recognition follow the current enabled/configured model and service priority instead of a fixed DeepSeek profile. Keep an active text-quota transition for subsequent vision and repair requests in the same task; image failures do not forward screenshots elsewhere.
- Support PNG image transcription in the local Codex proxy, forwarding the selected model and private temporary image attachments through `codex exec --image`. Validate image/task boundaries, preserve restricted tool settings, and clean attachments after success, failure or cancellation.
- Send DeepSeek-specific vision parameters only to DeepSeek models; use standard image detail for other compatible APIs. Reject known text-only models before upload and explain how to update an old local proxy.
- Fix newline characters being reported as missing font glyphs in multi-paragraph OCR translations. Preserve stored wording and line breaks; include Unicode code points in genuine missing-glyph errors.
- Pass offline route/proxy/layout regressions, including current-model selection, quota-transition continuity and temporary-file cleanup. Verify one synthetic image through local Codex `gpt-6-luna` and regenerate the reported paper's cached b89 paragraph without model calls or cache writes. Native Zotero installation is not yet accepted for this version.

## 0.1.0-alpha.42

- Fix Gecko's “Accessing TypedArray data over Xrays” error by cloning binary data into the consuming realm before inspecting it. Apply the same boundary to screenshot ArrayBuffers, PNG cache reads/writes, source PDFs, packaged fonts, workbench transfers and PDF attachment writes.
- Preserve sliced-view offsets and independent buffers. Keep existing Xray waivers limited to the PDF.js object API, and use structured cloning for binary ownership. Reject failed font copies instead of leaving their promises pending.
- Report screenshot-cache read and write failures at their actual stage. Preserve original documents, saved translations, API configuration and optional-image routing.
- Add rejecting binary-wrapper fixtures, real JavaScript VM context checks, screenshot/cached-PNG paths, native-write boundaries and a real PDF generated through the workbench with wrapped PDF/font inputs. Native Zotero installation and real DeepSeek requests remain unverified for this version.

## 0.1.0-alpha.41

- Fix false mathematical regions inside PDF-spaced URLs such as `https: //…/r/PDEVIS-3EDD/README.md`, and retain the multiplication suffix in numeric speedups such as `1.65×`. Refresh strictly compatible cached math metadata without changing saved translations or manual edits.
- Run opt-in DeepSeek vision repair from the primary translate-and-generate action, including fully translated projects. Move the explicit screenshot-upload option beside the primary action and share formula review detection with PDF generation.
- Hold PDF generation and open the review editor for uncertain or invalid recognition rather than silently exporting another source-paragraph fallback. Resume translation from explicitly adopted OCR without rejecting its original uncertainty again; keep manual translations and recognition provenance.
- Add regressions for split URLs, numeric multipliers, cached migration, render/editor review agreement, primary-action vision repair, uncertain-result hold and adoption/resume. No native installation or real DeepSeek request has been performed for this version.

## 0.1.0-alpha.40

- Add optional DeepSeek image transcription using the existing enabled DeepSeek endpoint, key and `deepseek-flash` model. Send bounded PNG regions with original image detail, non-thinking structured output, timeouts, cancellation and no cross-provider image fallback.
- Capture source-bound paragraph regions through Zotero's background print renderer and cache local screenshots privately. Validate page/rectangle/fingerprint ownership, region counts and request size before sending; malformed/cancelled images cannot become saved results.
- Store recognition as a separate English/LaTeX source layer with explicit adoption/restoration, editable OCR text, raw model text and recent history. Keep canonical source/geometry intact, bind translated text to recognition versions, and retain manual OCR edits across cache reuse.
- Add local-only image preview and selected-paragraph recognition/adoption in the workbench. A default-off option performs vision before selective review retranslation; skip manual translations, hold uncertain/type/number/length changes for review, and preserve previous results on failure.
- Validate recognized JSON identity, English transcription, LaTeX, bold structure and source binding. Reuse the existing term/math protection and local PDF renderer, including for vision-derived automatic translations. Update privacy and usage documentation to disclose optional screenshot uploads.
- Pass complete offline regressions, including multimodal HTTP format, source image caching, editing/adoption, UI review repair, PDF generation, cancellation and cross-paper/fallback guards. No real DeepSeek request or native Zotero installation has been performed for this version.

## 0.1.0-alpha.39

- Recover prose/math and numbered-reference boundaries from SDT font runs and glyph advances before text normalization; preserve source identities, explicit scripts, URL/code literals and layout hyphens. Avoid inferring mathematical styling from small-cap headings or graphic labels.
- Give complete physical algorithm/graphic regions ownership of their interior blocks. Merge overlapping algorithm/table fragments across interrupted reading order, recover title/list-only algorithms and trailing steps, separate numbered tables/columns, and keep partial-page prose and manual classifications outside automatic suppression.
- Recognize multiplication signs and ellipses as part of complete expressions. Typeset supported linear inline expressions locally as MathJax vectors instead of relying on shifted inline PDF crops; retain displayed formulas/algorithms as complete original regions. Unknown two-dimensional structure or correspondence falls back to the full source paragraph with a review notice.
- Preserve all existing wording/manual edits on strict source-compatible migration. Flag retained glued-source artifacts, add a selective review-retranslation action that skips manual revisions, and replace each old automatic paragraph only after successful validation.
- Pass type checks, complete offline regressions and real PDF generation. Check copies of 25 local projects (11051 blocks, 5051 translations): all saved wording/manual flags retained, zero duplicate source-page block ownership, 19 strict-compatible migrations and 6 protected non-migrations. Inspect ReplaySSM algorithms 1–6 and four locally revised paragraphs. No live model calls, original cache writes, native installation acceptance or community release for this version.

## 0.1.0-alpha.38

- Resolve the clicked library item independently of active reader tabs, and capture each open request before asynchronous work. Snapshot reader-toolbar item IDs when binding their buttons.
- Switch an idle workbench by saving its revisions and opening a fresh, immutable document session. Keep running/loading tasks on their current paper and explain that the user must wait or cancel; save failure retains the editor. Later requests supersede pending switches without retargeting old callbacks.
- Use unique native window targets under the process-wide singleton so Gecko cannot recycle another document's arguments. Display the bound paper title in both the workbench and native title bar.
- Bind project load/save, PDF reads/imports, revisions and preferred-attachment actions to their original attachment. Validate library ID, attachment key, file hash and parent identity; reject mismatched caches before relabeling or writing and reject cross-paper output mappings.
- Add ReplaySSM/Linear regressions for entry selection, save/switch, busy tasks, failed saves, late callbacks, equal-hash/different-attachment isolation, rapid requests, parent items and generated PDFs. Audit the reported local projects and output-parent mappings read-only; no cache cross-over was found in that sample.

## 0.1.0-alpha.37

- Complete the workbench singleton fix with recovery when a previous add-on sandbox leaves an inaccessible shared registry. Recreate the guard and find the existing native window before any new item lookup/open.
- Add a regression for destroyed-sandbox registry access. Retain all alpha.36 singleton behavior and alpha.35 provider priorities.
- Type checks, complete offline regressions and packaging pass. No real model calls or in-app installation acceptance were performed.

## 0.1.0-alpha.36

- Keep the workbench singleton through initial document unloads and navigation. Release ownership only after the native window is confirmed closed or its wrapper is dead; a temporary WindowProxy access failure no longer permits another window.
- Discover existing workbenches through Zotero's native window mediator, including windows absent from a controller's local registry. Share pending opens and window references on the Zotero host across controller scopes and main windows, with a stable native window name and type.
- Repeated actions restore/focus the existing project without changing the paper or task. Shutdown saves and closes discovered workbenches, and failed/cancelled opens release only their own guard.
- Reproduce the duplicate-window path against alpha.35's implementation, then pass new regressions for top-level unload, native discovery, transient/dead wrappers, independent controller scopes, concurrent opens and failed native opens. Full offline checks and packaging pass; no real translation or in-app installation acceptance is claimed.

## 0.1.0-alpha.35

- Call enabled, complete model profiles in their visible top-to-bottom order. Add per-service enable switches and move-up/down buttons, persist the order, and migrate the previous primary provider and fallback preference.
- Support DeepSeek alone with blank/disabled Codex and custom profiles. Skip incomplete profiles and remote profiles without saved keys, and show the effective call order before starting a task.
- With quota fallback enabled, advance only to the next configured service on an explicit quota/balance exhaustion response. Share each transition across parallel requests; keep result-specific provider/model metadata. Normal rate limits, connection failures, authentication failures and invalid content retain their existing behavior.
- Validate all credential destinations before saving any key, while allowing empty unused profiles. Keep credentials scoped to endpoints and outside preferences/projects.
- Pass type checks and offline regressions for DeepSeek-only requests, ordering, skipped/disabled profiles, three-provider parallel fallback, cancellation, credentials and workbench order persistence. No real model request or Zotero installation was performed for this update.

## 0.1.0-alpha.34

- Exclude detected first-page author names, affiliations, email addresses and author notes from terminology/translation requests and right-column prose. Keep their original PDF layout intact on the left.
- Apply the same conservative classification to existing caches without re-extraction, removing blocks or deleting translations/manual wording. Preserve explicit manual classification overrides and mark author metadata in the workbench.
- Retain excluded author metadata as figure-crop boundaries and prevent it from becoming an auxiliary figure label, so neighboring figure recovery cannot copy the author band into the right column.
- Add regressions for new extraction, cache migration, accented/CJK names, initials, repeated/Unicode affiliation markers, shared email syntax, footnotes, branding/title/body preservation, manual overrides and figure crops.
- Rebuild the reported SASS paper locally using existing translations, omitting five metadata blocks without model requests or source-cache changes. Package the update separately from the installed plugin.

## 0.1.0-alpha.33

- Save independent Codex, DeepSeek and custom endpoint/model profiles, with credentials kept in the existing endpoint-scoped Zotero Login Manager. Migrate single-provider settings without changing cached translations or saved keys.
- Prefer Codex and optionally replay the failed terminology batch or paragraph through DeepSeek on an explicit Codex quota error. Keep subsequent requests on DeepSeek for that task, share the transition across parallel workers and retry Codex at the start of a new task.
- Distinguish subscription quota exhaustion from transient rate limits and local queue saturation. Network failures, queueing, authentication errors and invalid output do not initiate paid fallback. Missing fallback credentials and failed fallback requests stop with saved progress intact.
- Display the active provider per request and a persistent switch notice. Record the actual provider/model per translated paragraph, including primary requests that finish after another worker switches.
- Pass type checks and offline regressions for migration, credential isolation, cancellation, parallel quota responses, mixed-provider provenance, resumable terminology and failure paths. No real quota exhaustion or full-paper translation was triggered.

## 0.1.0-alpha.32

- Add an optional loopback Codex CLI adapter for saved ChatGPT authentication, with a settings preset. The helper excludes API-key environment overrides, uses isolated ephemeral read-only tasks, disables agent tools, and returns completed structured output through the existing translation protocol.
- Bound helper concurrency and queueing, reject non-PaperWeave tasks/browser origins, preserve UTF-8, cancel disconnected work, and avoid logging paper content or credentials. Ship the standalone helper and setup guide beside the XPI.
- Retry transient connection failures, interrupted/invalid response bodies, timeouts and HTTP 408/429/5xx within one request budget. Keep configuration failures and user cancellation out of automatic retry loops.
- Report connection, response, format and timeout retries separately; reset the display clock for each phase/attempt so countdowns remain meaningful.
- Verify a real synthetic translation through PaperWeave → local HTTP proxy → official Codex CLI → ChatGPT login, preserving glossary values, a formula and its source binding. No paper cache was written and no full-paper translation was started.
- Verify offline recovery of the reported 54-batch terminology job from 10 saved batches: 44 remaining batches plus one recovered simulated connection failure. Type checks and mocked transport/proxy regressions pass. Not installed in Zotero.

## 0.1.0-alpha.31

- Replace chained placeholder substitutions with a shared flat registry. Exclude earlier locks from every later formula/glossary detector, merge source overlaps before protection, and verify input invariants before a model request.
- Use paragraph-scoped namespaces, conservative marker normalization and exact-count expansion recovery. Validate missing, repeated, unknown, foreign and malformed markers before a single-pass restore; never re-scan inserted source text.
- Preserve source marker literals, code/LaTeX, printed stars, bold/list offsets and mathematical bindings. Retain proven literal math inside code/TeX without a duplicate crop.
- Isolate exhausted paragraph-local protection failures: finish and save other work, report failed IDs, prevent an incomplete PDF and resume only pending paragraphs. Network/configuration errors still stop new requests.
- Reproduce the reported alpha.30 failure offline in three Zero-SM NCCL paragraphs. Pass read-only round trips for all 140 paragraphs and all 3241 paragraphs across 15 local projects (18769 protected values), without model calls or cache changes.
- Add protocol and workbench failure/recovery regressions. Prompt v8 remains compatible with existing projects; no extraction upgrade or full retranslation is required. Not installed in Zotero.

## 0.1.0-alpha.30

- Add a complete mathematical-object pipeline: recognize whole expressions from text/style/glyph geometry, preserve original PDF vectors, and keep source offsets, baselines and review reasons in the versioned project.
- Protect each entire expression before terminology/prose translation and persist explicit source-to-target bindings. Reject missing, duplicated or unknown markers without overwriting saved revisions.
- Match legacy caches by maximal whole expressions, retain manual wording, and reject ambiguous normalized aliases. Use the original paragraph with a review notice when coordinates, correspondence or readable inline sizing cannot be established.
- Keep explicit user-authored LaTeX authoritative. Preserve formulas as atomic layout units with adaptive ascent/descent, no internal justification and shared source-page resources.
- Preserve exact relative geometry and non-text mathematical strokes. Rejoin physical prose-line wraps on their source baselines while retaining intrinsic two-dimensional formulas and source-required hyphens.
- Add workbench math counts and a review filter. Document the pipeline, migration policy, revision workflow and limits in `docs/MATH_PIPELINE.md`.
- Add structural and failure-path regressions for fractions, scripts, accents, transpose, gradients, sums, integrals, radicals, matrices, multiline math, marker failures, geometry, footnotes/URLs, ambiguity, manual TeX and safe fallback.
- Rebuild the complete 24-page SpinQuant cache into 36 comparison pages, covering 119 inline objects and 5 displayed formulas with all 107 translations/manual flags preserved and no model requests. Not installed in Zotero.

## 0.1.0-alpha.29

- Render common LaTeX expressions offline with bundled MathJax SVG paths embedded as PDF vectors. Keep formulas atomic during wrapping/justification and adjust line height for fractions and matrices.
- Preserve complete multi-letter scripts in extracted math identifiers, protect them through translation, and recover layout hyphens between scripted atoms. Render matching legacy forms locally without rewriting saved translations or manual revisions.
- Recover missing vector figures from numbered captions and adjacent prose boundaries. Separate neighboring figures, ignore isolated auxiliary labels, and prevent stale coordinates from copying surrounding text or page headers.
- Retain the list-marker repair for legacy caches and validate it against the actual SpinQuant project.
- Stop appending the full original PDF and remove its checkbox. Keep original pages in the left column and the original attachment in Zotero.
- Pass type checks and offline regression tests. Inspect SpinQuant source pages 2, 3 and 5, preserving all 107 cached translations without model requests. Mark unresolved legacy math structure for review. Not installed in Zotero.

## 0.1.0-alpha.28

- Name new Zotero PDF attachments as `Paper title__date-time`, removing the bilingual/layout prefix and middle-dot separators.
- Remove the standalone PDF rebuild button while keeping Save revision and Retranslate selected paragraph. Use the main translation/generation action to rebuild complete cached translations without model settings or requests.
- Pass type checks and offline regression tests; no model calls or Zotero installation.

## 0.1.0-alpha.27

- Remove the HJFY configuration/key import button, its event handler and the controller integration. Keep manual model settings and existing saved credentials.
- Pass type checks and offline regression tests, including workbench initialization. No model calls or Zotero installation.

## 0.1.0-alpha.26

- Limit PaperWeave to one workbench across all papers and entry points. Repeated or concurrent opens focus the current window, restoring it from a minimized state without replacing its project or task.
- Release the window slot on close, ignore child-document unload events, and prevent pending item lookups from opening windows after shutdown or an add-on restart.
- Normalize list markers during extraction and render them separately from justified prose with a hanging indent. Keep ordered starting numbers and do not repeat markers on continuation pages.
- Repair legacy double-bullet rendering locally while preserving cached wording, manual edits and bold ranges. New list translation requests contain only item prose.
- Pass type checks and offline regression tests. Generate a focused real-paper preview with 6 list items, preserving all 239 cached translations. No model calls or Zotero installation.

## 0.1.0-alpha.25

- Insert complete original figures and tables with their captions and notes in the translated column.
- Group subpanels, legends and overlapping detected regions into one source-page crop; keep separate numbered graphics distinct and preserve caption-above-table ordering.
- Move each complete group to a continuation page when needed and scale to page space without slicing the image or separating its caption.
- Preserve table semantics when SDT embeds a caption inside a table node; upgrade matching legacy metadata without changing saved translations.
- Pass regression tests covering panel groups, overlapping labels, captions and source-page continuity. Verify 23 graphic units and 32 formula blocks from a real cached project, preserving all 159 translations. No model calls or Zotero installation.

## 0.1.0-alpha.24

- Fix SDT auxiliary/excluded flow flags overriding math and other protected block types, which prevented display formulas from reaching the right column.
- Upgrade legacy keep blocks to their protected semantic types when source content matches; preserve all translations, edits and explicit user classifications.
- Recover bold run-in headings from saved translations locally and exclude bold mathematical variables from prose emphasis markers.
- Include the surrounding text-column width in formula crops so equation numbers are retained.
- Pass type checks and offline regression tests; render a real 28-page cached project with 32 formula crops while preserving all 159 saved translations. Check a second cached project containing 9 formulas. No live model calls or Zotero installation.

## 0.1.0-alpha.23

- Insert cropped original display-math blocks in the matching order between translated paragraphs in the Chinese column.
- Preserve inline bold emphasis in translated text and full-block bold styling, with formatting ranges saved in the editable project.
- Upgrade existing project extraction metadata while retaining saved translations and edits; flag styled math paragraphs for retranslation when needed.
- Type check and package build only; not installed or verified in Zotero.

## 0.1.0-alpha.22

- Restore the side-by-side layout to 60% original PDF on the left and 40% editable Chinese translation on the right.
- Update progress messages, attachment titles, documentation and community post drafts to match.
- Type check and package build only; this layout update has not been live-tested in Zotero.

## 0.1.0-alpha.21

- Set the side-by-side layout to 70% original PDF on the left and 30% editable Chinese translation on the right.
- Update progress messages, attachment titles, documentation and community post drafts to show the new ratio.
- Build only; this layout update has not been live-tested in Zotero.

## 0.1.0-alpha.20

- Fix PDF generation failing with WinAnsi cannot encode 原 by drawing mixed Chinese/English page labels with the embedded CJK font.
- Keep the standard Helvetica font only for ASCII paragraph IDs and page numbers.

## 0.1.0-alpha.19

- Preserve each complete original PDF page in the English 60% column, retaining its columns, figures, tables, formulas, captions and page layout.
- Place editable translations in the Chinese 40% column, grouped by original page and kept in paragraph reading order.
- Add a continuation page when a page's translations do not fit; repeat the matching original page for context.
- Keep untranslated figures, captions, tables, formulas, code and references visible in the original page.

## 0.1.0-alpha.18

- Preserve Zotero inline superscript/subscript characters when extracting text; keep styled source paragraphs as original PDF crops.
- Protect inline math expressions, script variables, and list markers before translation, then restore them exactly afterward.
- Retain bullet and ordered-list markers in extracted text; headings, paragraph order, and non-translatable figure/table/equation blocks remain in document order.
- Upgrade legacy paragraph structure locally when block IDs still match, carrying every saved translation and manual edit forward without overwrite; flag old math translations for review.
- Existing translations are not overwritten. Re-translate a flagged paragraph whose math was flattened to apply the new protection.

## 0.1.0-alpha.17

- Request structured JSON output where supported; automatically fall back for compatible endpoints that reject JSON mode.
- Accept valid JSON wrapped in Markdown or a short preamble, retry malformed or empty responses, and accept plain-text translation responses as a fallback.
- Normalize common model edits to protected term markers, restore markers when the model outputs the original English term, and retry with explicit repair details before stopping a paragraph.
- Completed translations and manual edits remain untouched; only the failed paragraph is retried.

## 0.1.0-alpha.16

- Translate up to three independent paragraphs at once to reduce waiting time on long papers.
- Save each completed translation immediately; failed or cancelled jobs keep completed paragraphs and resume with only untranslated text.
- Show progress for all active model requests while retaining the existing bounded retry behavior for rate limits and transient errors.

## 0.1.0-alpha.15

- Replace Unicode term placeholders with distinct ASCII markers for more reliable model copying.
- Send only the marker list, not a second list of protected term text, to reduce ambiguity in the translation request.
- Automatically retry a paragraph once when a marker is missing or altered; continue to reject the paragraph if the retry is still invalid.
- Existing saved translations and manual revisions remain unchanged.

## 0.1.0-alpha.14

- Split long-paper terminology analysis into requests of at most about 7,000 characters and limit each response to 80 terms.
- Save every completed terminology batch and resume only unfinished batches after a timeout, cancellation or restart.
- Retry one timed-out terminology request with a 90-second limit; show the current batch, retry and timeout in progress.
- Keep completed paragraph translations and manual revisions untouched while terminology analysis resumes.
- Add offline mock coverage for batch limits, incremental checkpoints and resume behavior.

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
