# PaperWeave · 论文织译

选中 Zotero 中的 PDF，把论文做成「左侧原文 60%、右侧中文 40%」的逐段对照阅读副本，并保存可修改的译文项目。

**状态：0.1.0-alpha.34，早期开发版。** 面向 Zotero 10，依赖其结构化文档接口。
alpha.34 默认跳过作者、单位、邮箱及通讯作者说明的翻译和右栏重排，原始信息完整保留在左侧。已有项目更新分类时保留所有译文缓存与人工措辞；手工指定的区域类型优先。
alpha.33 支持分别保存 Codex 和 DeepSeek API，并在 Codex 明确报告额度受限时自动切换到 DeepSeek。首选服务、两套地址/模型/Key 和自动切换开关都在工作台中设置；现有 Key、术语断点、译文及人工修订保留。参见 [本机 Codex 代理与双模型配置](docs/CODEX_PROXY.zh-CN.md)。
沿用 alpha.31 的扁平保护表和单次还原，防止「未知占位符」；该机制已通过本机 15 篇、3241 段的离线往返检查。连续校正失败的段落保留待重试，其余段落继续保存，生成前要求正文完整。详见 [保护协议与错误恢复](docs/PROTECTION_PROTOCOL.md)。
沿用完整数学处理流程：按完整表达式绑定原 PDF 字形，右栏保真显示，手工 LaTeX 离线渲染；不确定的对应保留原文并提示复核。alpha.30 已将完整 SpinQuant 的 119 处行内数学及 5 个独立公式重排，107 段缓存译文及人工修改保持原样。本版尚未在 Zotero 中安装验证。早期版本在 macOS / Zotero 10.0.7 上完成过少量段落的 DeepSeek 翻译、项目保存和首选附件验证。
此前的小规模验证不能代表整篇或任意 PDF 的版面质量。
欢迎协助报告问题；请保留原始论文与项目备份。

## 功能

- 右键单个 PDF 或论文条目打开工作台；阅读器工具栏「织译」或 Alt+Shift+T 也可进入。
- 同时只保留一个工作台；重复点击会恢复并聚焦已有窗口。选择另一篇论文时先聚焦当前工作台，关闭后再打开新论文，保留当前任务。
- 默认使用 OpenAI-compatible Chat Completions 接口，可设置 DeepSeek 或本地服务。
- 可选本机 Codex 代理：使用已登录的 ChatGPT/Codex 账户和可用额度；以独立文字任务翻译，不继承当前聊天。配套代理需要 Node.js 和官方 Codex CLI，仅监听本机。
- 默认模型名为 `deepseek-flash`，按用户设置原样发送；是否可用取决于所填 API 服务。
- 按全文分批识别本文的技术术语，词表可修改；公式、代码和术语共用逐段隔离的 ASCII 保护表，自动校正常见标记变化，拒绝歧义、重复和未知标记。
- 数学表达作为完整对象绑定原 PDF 逐字坐标，整式保护后翻译周围文字，保存译文到原式的显式对应关系。旧项目本地升级结构，不覆盖缓存和人工修订；不确定的对应、坐标或过宽公式保留原文段落并提示复核。
- 正文、标题按段翻译，最多同时翻译 3 段，每段完成后立即保存。单段保护校验失败会列为待重试，其他段落继续；临时连接/响应异常、超时及限流有限重试，持续失败或配置错误会停止新请求。恢复只处理未完成段落，不生成缺段 PDF。图、图注、表格、表注、公式、代码和参考文献保留原文；图表及说明整组裁切，和独立公式一起插入右侧对应位置。
- B 版排版：左侧 60% 保留完整原始 PDF 页面，右侧 40% 按原文页码排列逐段译文，中间以竖线分隔。
- 原文的双栏、标题、公式、图表、表格、图注和页内布局保留在左侧；右侧按识别顺序插入公式裁片和逐段译文。原文加粗范围会在对应译文中保留强调。译文或公式过长时增加续页，并重复显示对应原文页。
- 公式即使被 Zotero 标为辅助内容，也保留公式分类；裁片包含同栏边缘的公式编号。旧项目会本地恢复公式分类与能确定对应关系的粗体标签，无需整篇重译。
- 多子图、图例、坐标轴和总图注保持原有位置；重叠识别区域合为一个裁片，避免重复。图表与其说明整组排版，空间不足时移到续页，按完整比例缩放。
- 未被识别为图片的矢量图按编号图注和相邻正文边界恢复；孤立坐标标签不单独裁切，避免错误坐标把正文或页眉带入图中。
- 译文支持离线 LaTeX：`\(R_1^T\)`、`\(\frac{x}{y}\)`、`\(\begin{pmatrix}a&b\\c&d\end{pmatrix}\)`，公式以矢量路径写入 PDF，不需另装 TeX。上下标和整段公式不参与字间拉伸；行高按公式调整。
- 工作台显示行内数学、独立公式和需复核段落数量；「公式 / 格式需复核」筛选可集中处理异常。完整策略见 [数学处理流程](docs/MATH_PIPELINE.md)。
- 中文正文两端对齐，段落末行左对齐；标题与行内代码保留自然排版。
- 列表符号或编号独立绘制，正文使用悬挂缩进；符号不参与两端对齐，续页不重复符号。旧项目中的重复前导符号在本地排版时清理，不改写已有译文。
- 中英文正文与英文技术术语统一使用思源宋体字库中的衬线字形，行内代码使用更纱等宽字体；缺少的数学符号自动使用内置备用字形，原字符保持不变。两种字库均嵌入 PDF，跨设备阅读保持字体一致。
- 段落译文可以直接编辑，自动保存；可重新翻译单段或只翻译未完成段落。
- 从本地缓存重新排版，不必再次调用模型；每次导入为新 PDF 附件。
- 新附件标题采用「论文名字__日期时间」，不添加双语或布局比例前缀。
- 操作按钮下方固定显示当前阶段、阶段进度条、任务用时、模型响应等待和自动重试。术语识别完成前，「已翻译段落」计数保持不变。
- 生成后默认设为该论文优先打开的 PDF；可用「优先打开原文」切回。重启时异步恢复首选附件，不依赖论文条目已在当前集合中加载。
- 可导出/导入 JSON 修订项目，便于备份及后续扩展。
- 只生成对照阅读页，不在末尾附加原文；原始附件继续保留在 Zotero 中。

OCR、批量任务、阅读器内跳转修订与跨版本批注迁移见 [Roadmap](docs/ROADMAP.md)。

## 安装

1. 使用带 SDT 结构提取接口的 **Zotero 10**。Zotero 7/8/9 不在首版支持范围内。
2. 从 [Releases](https://github.com/alan-hpc/zotero-paper-weave/releases) 下载 `.xpi`。
3. Zotero → 工具 → 插件，点击齿轮 → 从文件安装插件，选择 `.xpi`；更新后重启 Zotero。
4. 回到文库，选中 PDF → 右键 → **PaperWeave · 逐段双语 PDF / 修订**。

Alpha 预发布版请手动安装更新；GitHub 的 latest 下载地址不会自动指向预发布版。

不需要安装 Python、额外 PDF 引擎或幻觉翻译插件。只有选择本机 Codex 代理时需要 Node.js 和 Codex CLI。操作系统兼容性尚待实际运行验证。

## 第一次翻译

1. 展开「模型与翻译偏好」，选择首选服务，分别填写 Codex、DeepSeek 的 Base URL、模型和 Key，点击「保存全部设置」。Codex 本机代理 Key 留空；勾选自动切换时，明确额度错误会将未完成请求发送到已配置的 DeepSeek API 并按其账户计费。
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
3. 需要更新阅读副本时，点击「翻译并生成 PDF」，生成新附件，并默认将它设为该论文优先打开的版本。所有段落已有译文时直接使用缓存，不调用模型，也不要求配置 Key；还有未完成段落时先继续翻译。

译文的可编辑来源是翻译项目。Zotero PDF 阅读器可高亮和批注；正文修订通过工作台完成。
自动翻译不会覆盖已有译文。点击「重新翻译本段（覆盖）」会明确替换当前段落。
修改词表不会自动重译已有段落；请按需选择段落重新翻译。
旧译文优先按完整公式恢复原文显示，不改变缓存中的措辞。无法可靠对应时，右栏暂保留该段原文，中文仍可编辑；请在复核筛选中处理。手工输入的 LaTeX 优先使用离线排版，需自行核对数学含义。

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

- 早期版本已验证两段真实模型请求与本地修订流程；本版已离线重排整篇 SpinQuant，尚未在 Zotero 内安装验收，其他系统和其他 Zotero 版本仍待覆盖。
- 本地版面分析可能错误分类或遗漏内容，需人工复核；不能保证任意 PDF 自动排版完全正确。
- 纯扫描件不带 OCR。加密文件、旋转页面暂不处理；结构分析失败会停止。
- 右侧段落分组依赖 Zotero 提供的页码和阅读顺序；跨页段落的译文归到起始页，超长译文会使用重复原文页的续页。
- 未识别的技术术语、大小写/词形变化仍可能被翻译；可补入词表后重译。
- 图表、图注与公式裁片依赖版面分析提供正确的类型、顺序和坐标；跨源页的图表按源页片段保留。行内数学候选依赖文本、样式和逐字坐标，尚不能保证检测到所有数学内容；左侧完整原页可用于逐项核对。
- 左侧原页按比例缩放到 60% 栏宽，较小字号的论文可能需要放大阅读；右侧 40% 栏宽为中文提供更多排版空间，较长译文仍可能增加续页。需要原尺寸时可打开原始附件。
- Zotero SDT 为宿主接口，版本升级可能改变行为；适配代码集中在一个模块。
- 生成项目不跨设备自动同步，PDF 批注不自动迁移；见 Roadmap。

## 开发与持续扩展

```sh
npm ci
npm run typecheck
npm test
npm run build
```

需要 Node.js 20.10+。输出：`dist/paperweave-0.1.0-alpha.32.xpi`，以及可选的 `dist/paperweave-codex-proxy.mjs`。
开发者的构建依赖由 lockfile 固定。安装用户只需要 XPI。
字体及许可证已包含于仓库，无需构建时下载。

| 模块 | 负责内容 |
|---|---|
| `src/controller.ts` | Zotero 菜单、凭据、项目文件、附件导入 |
| `src/extract.ts` | Zotero SDT 适配、段落与保护区域 |
| `src/provider.ts` | API、术语识别、占位符保护、逐段翻译 |
| `src/protection.ts` | 扁平保护表、逐段命名空间、响应校验及单次还原 |
| `src/render.ts` | 60/40 对照、完整原页嵌入、公式裁片、粗体译文、逐页排版 |
| `src/typography.ts` | 衬线正文与等宽行内代码混排 |
| `src/mathRecognition.ts` | 完整数学候选、逐字坐标、基线与可靠性检查 |
| `src/inlineMath.ts` / `src/mathText.ts` | 整式保护、源译绑定、旧缓存匹配和歧义检查 |
| `src/latex.ts` | 显式 LaTeX 的离线矢量排版 |
| `src/formatting.ts` | 已保存译文中的粗体范围与段首标签恢复 |
| `src/upgrade.ts` | 保留译文及人工修订的版面元数据升级 |
| `src/graphics.ts` | 子图、图注、表格及表注的完整原文分组 |
| `src/snippets.ts` | Zotero PDF.js 原文区域渲染适配 |
| `src/preferred.ts` | 每篇论文的首选附件与宿主排序适配 |
| `src/model.ts` | 有版本的项目数据结构 |
| `src/workbench.ts` | 修订工作台交互 |

参见 [Architecture](docs/ARCHITECTURE.md)、[Contributing](CONTRIBUTING.md) 和 [发布流程](docs/RELEASING.md)。

## English overview

PaperWeave is an early Zotero 10 add-on for editable English–Chinese PDFs.
It uses Zotero's local structured document extraction, a user-configured Chat Completions API,
per-paper terminology and a 60/40 layout with complete original PDF pages beside editable, page-grouped translations. It creates new attachments and
retains editable local projects. Charts, captions, tables and displayed formulas stay in English.
Generated attachments can be preferred on parent-item opening while the add-on is enabled.
A small two-paragraph workflow has been checked on macOS / Zotero 10.0.7 with DeepSeek,
manual revision persistence and preferred attachments. This does not validate arbitrary full papers.
See the limitations above before use. Bug reports and contributions are welcome.

## License

Own source: MIT. Fonts: SIL OFL 1.1. Bundled libraries retain their licenses;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
PaperWeave is an independent community project, unaffiliated with Zotero, DeepSeek, or HJFY.
