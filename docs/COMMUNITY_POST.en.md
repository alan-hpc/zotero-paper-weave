# PaperWeave: editable paragraph-aligned English–Chinese PDFs for Zotero 10 (early alpha)

I am sharing an independent open-source add-on for a paper-reading workflow:
select a PDF, identify paper-specific terminology, translate paragraph by paragraph, and create
a new PDF attachment with the original on the left (60%) and Chinese on the right (40%), paragraph aligned.

Translations can be edited and saved in a local project, then rebuilt without retranslating the
whole paper. Complete figures and tables, including subpanels, captions and notes, are inserted as
original crops beside the matching translations and kept together across output pagination. Display-math
crops and bold emphasis are also preserved.
List markers are drawn separately from justified text with a hanging indent. Only one workbench
opens at a time; repeated clicks focus it without changing the current project or task.
Users configure their own compatible model endpoint and credentials.
Codex and DeepSeek settings are saved independently. When enabled, an explicit Codex quota error
replays unfinished work through DeepSeek and keeps subsequent requests on DeepSeek for that task.
Temporary rate limits, queueing and network failures do not initiate quota fallback.
Detected authors, affiliations, email addresses and author notes remain on the intact source page,
without translation or right-column reflow. Cached wording and explicit user classifications survive.

Source: https://github.com/alan-hpc/zotero-paper-weave

Releases: https://github.com/alan-hpc/zotero-paper-weave/releases

This is **0.1.0-alpha.34**, a development preview with an integrated mathematical-object pipeline.
An optional loopback helper forwards text tasks to the official Codex CLI under saved ChatGPT login;
a synthetic real request preserves glossary values, a formula and its source binding. Transient
connection/response failures and timeouts now have bounded retries with accurate progress reasons.
The translation protocol uses a paragraph-scoped flat registry and a single-pass restore, preventing
nested markers from being mistaken for unknown model output. Offline echo round trips cover 3241
paragraphs across 15 local projects without model calls or cache changes. Paragraph-local protocol
failures remain pending while other work saves; incomplete projects cannot generate a PDF.
Whole expressions bind to source glyph geometry, receive immutable translation placeholders, and
render from original PDF resources; explicit user-authored LaTeX renders offline as vectors.
Uncertain coordinates or legacy correspondence preserve the original paragraph and request review.
The alpha.30 complete 24-page SpinQuant rebuild covers 119 inline objects and 5 displayed formulas, preserving
all 107 cached translations and manual flags without excluding affected paragraphs or calling a model.
Structural and failure-path regressions cover common mathematical layouts, bindings and fallback.
Type checks and offline regressions cover provider migration, credential isolation, quota fallback,
concurrent requests, cancellation, author metadata and figure boundaries. Quota fallback is tested
with simulated errors; no real account quota was deliberately exhausted.
The alpha.34 SASS-paper rebuild uses cached translations: 7 source pages become 19 comparison pages,
omitting five author-metadata blocks from the right column without model calls or cache changes.
This alpha.34 build has not completed installation acceptance in Zotero.
Arbitrary PDFs and other platforms still require review.
It requires Zotero 10's structured-document API. OCR and rotated pages are not supported in this
first version. Layout classification requires review. New PDFs retain old versions rather than
migrating their annotations. Local revision projects are not automatically synced.

Model requests go directly to the user's configured endpoint and may incur costs. The project
has no telemetry or author-hosted translation server. It is unaffiliated with Zotero, DeepSeek or HJFY.

Planned work includes reader-to-editor navigation, alternate layouts and visual segmentation
correction. Issues and contributions are welcome.

---

Draft only; no forum post has been sent. Keep the validation statement accurate when publishing.
