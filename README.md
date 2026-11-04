# PaperWeave · 论文织译

选中 Zotero 中的 PDF，把论文做成「一段英文、一段中文」的阅读副本，并保存可修改的译文项目。

**状态：0.1.0-alpha.1，早期开发版。** 面向 Zotero 10，依赖其结构化文档接口。
当前仅完成源码、类型检查与安装包构建；尚未完成 Zotero 内的端到端运行验证。
欢迎协助报告问题；请保留原始论文与项目备份。

## 功能

- 右键单个 PDF 或只有一个 PDF 的论文条目，打开翻译与修订工作台。
- 默认使用 OpenAI-compatible Chat Completions 接口，可设置 DeepSeek 或本地服务。
- 默认模型名为 `deepseek-flash`，按用户设置原样发送；是否可用取决于所填 API 服务。
- 按全文分批识别本文的技术术语，词表可修改；用占位符保护已识别术语。
- 正文、标题按段翻译；图、图注、表格、表注、公式、代码和参考文献保留英文。
- 英文与图形直接嵌入原 PDF 的矢量片段，保留源字体与公式；中文使用 OFL 字体。
- 段落译文可以直接编辑，自动保存；可重新翻译单段或只翻译未完成段落。
- 从本地缓存重新排版，不必再次调用模型；每次导入为新 PDF 附件。
- 可导出/导入 JSON 修订项目，便于备份及后续扩展。
- 默认附加完整原 PDF，便于发现版面识别遗漏。

首版使用逐段上下对照。左右双栏排版、OCR、批量任务、阅读器内跳转修订与跨版本批注迁移见 [Roadmap](docs/ROADMAP.md)。

## 安装

1. 使用带 SDT 结构提取接口的 **Zotero 10**。Zotero 7/8/9 不在首版支持范围内。
2. 从 [Releases](https://github.com/alan-hpc/zotero-paper-weave/releases) 下载 `.xpi`。
3. Zotero → 工具 → 插件，点击齿轮 → 从文件安装插件，选择 `.xpi`。
4. 回到文库，选中 PDF → 右键 → **PaperWeave · 逐段双语 PDF / 修订**。

不需要安装 Python、额外 PDF 引擎或幻觉翻译插件。操作系统兼容性尚待实际运行验证。

## 第一次翻译

1. 展开「模型与翻译偏好」，填写 Base URL、模型和 API Key，点击保存。
   - DeepSeek 示例 Base URL：`https://api.deepseek.com/v1`。
   - 填服务当前支持的模型 ID。遇到 HTTP 400/404 时检查模型名及端点。
   - 兼容本地服务时可填写 `http://localhost:端口/v1`，Key 可留空。
2. 等待本地版面分析。浏览区域列表，确认图表和图注被设为原文类型。
3. 点击「识别本文术语」，在词表中增删应保留英文的术语。
4. 点击「翻译未完成段落」。如果尚未提取术语，将先自动识别。
5. 阅读译文并修订，点击「生成并导入双语 PDF」。

默认只向所选 API 发送论文文本与术语请求，不上传 PDF 文件或图片。调用 API 可能产生费用。
本插件未托管模型，也没有公共代理服务。

## 翻译不对时怎么修改、保存

1. 再次选择原 PDF，或选择由本插件生成的 PDF，右键打开工作台。
2. 选择段落，在「中文译文」中修改；编辑后自动保存，也可点击「保存修订」。
3. 点击「生成并导入双语 PDF」，本地重新排版并产生新附件。

译文的可编辑来源是翻译项目。Zotero PDF 阅读器可高亮和批注；正文修订通过工作台完成。
自动翻译不会覆盖已有译文。点击「重新翻译本段（覆盖）」会明确替换当前段落。
修改词表不会自动重译已有段落；请按需选择段落重新翻译。

**旧版 PDF 的批注不会自动迁移到新版。** 原 PDF 与已有双语附件均不会被覆盖。

## 数据、隐私及备份

- Key 存在 Zotero 的 Login Manager，按 API 端点隔离；不写入 PDF 或项目 JSON。
- 设置和自定义补充 Prompt 存在 Zotero 偏好中，请勿把密钥填入 Prompt。
- 译文项目位于 Zotero 数据目录下的 `paperweave/`，含原文文本和译文，默认不随文库同步。
- 按原附件身份与文件哈希匹配缓存。原 PDF 内容变更后生成独立项目。
- 「导出修订项目」可保存单篇 JSON；分享前注意其中包含论文文本。
- 生成的 PDF 使用 Zotero 标准附件导入接口，遵循所在文库的附件同步设置。
- 停用/卸载插件会保留项目和凭据；可在卸载前用工作台删除 Key，并自行备份/删除项目目录。
- 无遥测、广告、插件作者服务器或后台模型请求。

详见 [Privacy](docs/PRIVACY.md)。

## 已知限制

- 尚未在真实 Zotero 会话中验证端到端运行，当前发布用于早期反馈。
- 本地版面分析可能错误分类或遗漏内容，需人工复核；不能保证任意 PDF 自动排版完全正确。
- 纯扫描件不带 OCR。加密文件、旋转页面暂不处理；结构分析失败会停止。
- 多栏、跨页段落依赖 Zotero 提供的阅读顺序与段落链接。
- 未识别的技术术语、大小写/词形变化仍可能被翻译；可补入词表后重译。
- 中文中的行内数学表达依赖抽取文本及模型保留；英文原片段始终用于核对。显示公式保留源片段。
- 首版不提供坐标级裁剪编辑。图表与段落很高时会缩放；完整原 PDF 附录保留原始清晰版。
- Zotero SDT 为宿主接口，版本升级可能改变行为；适配代码集中在一个模块。
- 生成项目不跨设备自动同步，PDF 批注不自动迁移；见 Roadmap。

## 开发与持续扩展

```sh
npm ci
npm run typecheck
npm run build
```

需要 Node.js 20.10+。输出：`dist/paperweave-0.1.0-alpha.1.xpi`。
开发者的构建依赖由 lockfile 固定。安装用户只需要 XPI。
字体及许可证已包含于仓库，无需构建时下载。

| 模块 | 负责内容 |
|---|---|
| `src/controller.ts` | Zotero 菜单、凭据、项目文件、附件导入 |
| `src/extract.ts` | Zotero SDT 适配、段落与保护区域 |
| `src/provider.ts` | API、术语识别、占位符保护、逐段翻译 |
| `src/render.ts` | 原 PDF 片段与中文逐段排版 |
| `src/model.ts` | 有版本的项目数据结构 |
| `src/workbench.ts` | 修订工作台交互 |

参见 [Architecture](docs/ARCHITECTURE.md)、[Contributing](CONTRIBUTING.md) 和 [发布流程](docs/RELEASING.md)。

## English overview

PaperWeave is an early Zotero 10 add-on for editable, paragraph-aligned English–Chinese PDFs.
It uses Zotero's local structured document extraction, a user-configured Chat Completions API,
per-paper terminology, and vector snippets from the original PDF. It creates new attachments and
retains editable local projects. Charts, captions, tables and displayed formulas stay in English.
This alpha has been built and type-checked but has **not yet been validated end to end inside Zotero**.
See the limitations above before use. Bug reports and contributions are welcome.

## License

Own source: MIT. Fonts: SIL OFL 1.1. Bundled libraries retain their licenses;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
PaperWeave is an independent community project, unaffiliated with Zotero, DeepSeek, or HJFY.
