# PaperWeave 0.1.0-alpha.1

初始开发预览版 / Initial development preview.

下载 `.xpi` 后，通过 Zotero → 工具 → 插件 → 从文件安装。
需要 Zotero 10。此版本尚未完成 Zotero 内端到端运行验证。

## Included

- Paragraph English–Chinese PDF generation and manual translation revisions.
- Per-paper English terminology, original figures/captions/tables/formulas.
- User-configured compatible model API, local cache, new attachment versions.
- Project import/export and an optional complete original-PDF appendix.

## Validation and limitations

TypeScript type checking and the XPI build were performed. No in-app runtime testing was performed.
Treat this as an alpha for development feedback. Review block classification against the original.
No OCR, rotated-page support, annotation migration or automatic project sync is included.
Model calls may incur fees and send paper text to the configured provider.

See README for configuration, data handling and contribution guidance.
