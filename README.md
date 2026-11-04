# PaperWeave · 论文织译

选中 Zotero 中的 PDF，把论文做成「左侧英文 60%、右侧中文 40%」的逐段对照阅读副本，并保存可修改的译文项目。

**状态：0.1.0-alpha.9，早期开发版。** 面向 Zotero 10，依赖其结构化文档接口。
已完成类型检查、离线回归检查，并在 macOS / Zotero 10.0.7 上验证少量段落的 DeepSeek 翻译、项目保存和新版附件优先打开。
这是小规模验证，不能代表整篇或任意 PDF 的版面质量。
欢迎协助报告问题；请保留原始论文与项目备份。

## 功能

- 右键单个 PDF 或论文条目打开工作台；阅读器工具栏「织译」或 Alt+Shift+T 也可进入。
- 默认使用 OpenAI-compatible Chat Completions 接口，可设置 DeepSeek 或本地服务。
- 默认模型名为 `deepseek-flash`，按用户设置原样发送；是否可用取决于所填 API 服务。
- 按全文分批识别本文的技术术语，词表可修改；用占位符保护已识别术语。
- 正文、标题按段翻译；图、图注、表格、表注、公式、代码和参考文献保留英文。
- B 版排版：左英文 60%、右中文 40%，中间竖线，对应段落同高起始。
- 中英文正文两端对齐，段落末行左对齐；英文单词和行内代码内部不拉伸。标题与原文保护区域保留自然排版。
- 中英文正文与英文技术术语统一使用思源宋体字库中的衬线字形，仅行内代码使用更纱等宽字体。两种字库均嵌入 PDF，跨设备阅读保持字体一致。
- 含数学符号的英文、图表和图注以高清原文片段保留，避免裁剪区域外的隐藏文字干扰正文选取。
- 段落译文可以直接编辑，自动保存；可重新翻译单段或只翻译未完成段落。
- 从本地缓存重新排版，不必再次调用模型；每次导入为新 PDF 附件。
- 生成后默认设为该论文优先打开的 PDF；可用「优先打开原文」切回。
- 可导出/导入 JSON 修订项目，便于备份及后续扩展。
- 默认附加完整原 PDF，便于发现版面识别遗漏。

OCR、批量任务、阅读器内跳转修订与跨版本批注迁移见 [Roadmap](docs/ROADMAP.md)。

## 安装

1. 使用带 SDT 结构提取接口的 **Zotero 10**。Zotero 7/8/9 不在首版支持范围内。
2. 从 [Releases](https://github.com/alan-hpc/zotero-paper-weave/releases) 下载 `.xpi`。
3. Zotero → 工具 → 插件，点击齿轮 → 从文件安装插件，选择 `.xpi`；更新后重启 Zotero。
4. 回到文库，选中 PDF → 右键 → **PaperWeave · 逐段双语 PDF / 修订**。

Alpha 预发布版请手动安装更新；GitHub 的 latest 下载地址不会自动指向预发布版。

不需要安装 Python、额外 PDF 引擎或幻觉翻译插件。操作系统兼容性尚待实际运行验证。

## 第一次翻译

1. 展开「模型与翻译偏好」，填写 Base URL、模型和 API Key，点击保存；也可点击「从幻觉翻译导入配置与 Key」。
   - DeepSeek 示例 Base URL：`https://api.deepseek.com/v1`。
   - 填服务当前支持的模型 ID。遇到 HTTP 400/404 时检查模型名及端点。
   - 兼容本地服务时可填写 `http://localhost:端口/v1`，Key 可留空。
2. 等待本地版面分析。浏览区域列表，确认图表和图注被设为原文类型。
3. 点击「翻译并生成 PDF」，自动识别术语、逐段翻译并生成附件。已有译文不会被覆盖。
4. 需要先复核术语时，展开分步操作，先识别本文术语并修改词表，再翻译。
5. 默认勾选「生成后优先打开双语 PDF」；之后双击父论文条目会打开该版本。

默认只向所选 API 发送论文文本与术语请求，不上传 PDF 文件或图片。调用 API 可能产生费用。
本插件未托管模型，也没有公共代理服务。

## 翻译不对时怎么修改、保存

1. 再次选择原 PDF，或选择由本插件生成的 PDF，右键打开工作台。
2. 选择段落，在「中文译文」中修改；编辑后自动保存，也可点击「保存修订」。
3. 点击「保存新版 PDF（本地重排）」，生成新附件，并默认将它设为该论文优先打开的版本。

译文的可编辑来源是翻译项目。Zotero PDF 阅读器可高亮和批注；正文修订通过工作台完成。
自动翻译不会覆盖已有译文。点击「重新翻译本段（覆盖）」会明确替换当前段落。
修改词表不会自动重译已有段落；请按需选择段落重新翻译。

**旧版 PDF 的批注不会自动迁移到新版。** 原 PDF 与已有双语附件均不会被覆盖。

优先打开针对父论文条目生效；直接双击某个附件仍打开所点附件。选择保存在本机并在重启后恢复，默认不随文库同步。当前 Zotero 没有公开的首选附件 setter，插件在启用期间适配附件排序接口；停用后恢复宿主默认顺序。独立 PDF 没有父论文条目，只生成并打开新附件。

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

- 已验证两段真实模型请求与本地修订流程；整篇论文、其他系统和其他 Zotero 版本尚待覆盖。
- 本地版面分析可能错误分类或遗漏内容，需人工复核；不能保证任意 PDF 自动排版完全正确。
- 纯扫描件不带 OCR。加密文件、旋转页面暂不处理；结构分析失败会停止。
- 多栏、跨页段落依赖 Zotero 提供的阅读顺序与段落链接。
- 未识别的技术术语、大小写/词形变化仍可能被翻译；可补入词表后重译。
- 中文中的行内数学表达依赖抽取文本及模型保留；含数学符号的英文使用原片段用于核对。显示公式保留源片段。
- 图表、公式和受保护片段中的文字作为图像保留，不提供片段内部的文本选择；完整原文附录仍可用于原文检索和批注。
- 首版不提供坐标级裁剪编辑。图表与段落很高时会缩放；完整原 PDF 附录保留原始清晰版。
- Zotero SDT 为宿主接口，版本升级可能改变行为；适配代码集中在一个模块。
- 生成项目不跨设备自动同步，PDF 批注不自动迁移；见 Roadmap。

## 开发与持续扩展

```sh
npm ci
npm run typecheck
npm test
npm run build
```

需要 Node.js 20.10+。输出：`dist/paperweave-0.1.0-alpha.9.xpi`。
开发者的构建依赖由 lockfile 固定。安装用户只需要 XPI。
字体及许可证已包含于仓库，无需构建时下载。

| 模块 | 负责内容 |
|---|---|
| `src/controller.ts` | Zotero 菜单、凭据、项目文件、附件导入 |
| `src/extract.ts` | Zotero SDT 适配、段落与保护区域 |
| `src/provider.ts` | API、术语识别、占位符保护、逐段翻译 |
| `src/render.ts` | 60/40 对照、英文重排、原文片段与中文 |
| `src/typography.ts` | 衬线正文与等宽行内代码混排 |
| `src/snippets.ts` | Zotero PDF.js 原文区域渲染适配 |
| `src/preferred.ts` | 每篇论文的首选附件与宿主排序适配 |
| `src/model.ts` | 有版本的项目数据结构 |
| `src/workbench.ts` | 修订工作台交互 |

参见 [Architecture](docs/ARCHITECTURE.md)、[Contributing](CONTRIBUTING.md) 和 [发布流程](docs/RELEASING.md)。

## English overview

PaperWeave is an early Zotero 10 add-on for editable, paragraph-aligned English–Chinese PDFs.
It uses Zotero's local structured document extraction, a user-configured Chat Completions API,
per-paper terminology, 60/40 side-by-side layout and high-resolution snippets for protected content. It creates new attachments and
retains editable local projects. Charts, captions, tables and displayed formulas stay in English.
Generated attachments can be preferred on parent-item opening while the add-on is enabled.
A small two-paragraph workflow has been checked on macOS / Zotero 10.0.7 with DeepSeek,
manual revision persistence and preferred attachments. This does not validate arbitrary full papers.
See the limitations above before use. Bug reports and contributions are welcome.

## License

Own source: MIT. Fonts: SIL OFL 1.1. Bundled libraries retain their licenses;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
PaperWeave is an independent community project, unaffiliated with Zotero, DeepSeek, or HJFY.
