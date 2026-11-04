# PaperWeave: editable paragraph-aligned English–Chinese PDFs for Zotero 10 (early alpha)

I am sharing an independent open-source add-on for a paper-reading workflow:
select a PDF, identify paper-specific terminology, translate paragraph by paragraph, and create
a new PDF attachment with each English paragraph followed by Chinese.

Translations can be edited and saved in a local project, then rebuilt without retranslating the
whole paper. Figures, captions, tables and displayed formulas retain original PDF content.
Users configure their own compatible model endpoint and credentials.

Source: https://github.com/alan-hpc/zotero-paper-weave

Releases: https://github.com/alan-hpc/zotero-paper-weave/releases

This is **0.1.0-alpha.1**, a development preview. It has been type-checked and packaged but has
**not yet been validated end to end inside Zotero**. Feedback from developers is especially welcome.
It requires Zotero 10's structured-document API. OCR and rotated pages are not supported in this
first version. Layout classification requires review. New PDFs retain old versions rather than
migrating their annotations. Local revision projects are not automatically synced.

Model requests go directly to the user's configured endpoint and may incur costs. The project
has no telemetry or author-hosted translation server. It is unaffiliated with Zotero, DeepSeek or HJFY.

Planned work includes reader-to-editor navigation, alternate layouts and visual segmentation
correction. Issues and contributions are welcome.

---

Draft only; no forum post has been sent. Keep the validation statement accurate when publishing.
