# PaperWeave · 论文织译

在 Zotero 中，把英文论文生成「**左侧原文 60% / 右侧中文 40%**」的对照 PDF。译文可以逐段修改、保存，再生成新的阅读副本。

适用于 **Zotero 10**，目前为早期开发版。

[下载安装包](https://github.com/alan-hpc/zotero-paper-weave/releases) · [反馈问题](https://github.com/alan-hpc/zotero-paper-weave/issues) · [更新记录](CHANGELOG.md)

![PaperWeave 实际生成的双语 PDF：左侧保留论文原页，右侧按段显示中文译文](docs/images/bilingual-pdf-preview.png)

实际输出示例，使用公开论文 [Dissecting an Unexplored SASS Control-Code Field](https://arxiv.org/abs/2611.24437)。译文较长时会增加续页，并重复显示对应原文页。

## 安装

> 最新预览版：[**0.1.0-alpha.37**](https://github.com/alan-hpc/zotero-paper-weave/releases/tag/v0.1.0-alpha.37)。这是早期试用版，alpha.37 尚未完成 Zotero 内安装验收；Alpha 更新需手动下载安装。

1. 安装 **Zotero 10**。
2. 下载 [alpha.37 安装包 `.xpi`](https://github.com/alan-hpc/zotero-paper-weave/releases/download/v0.1.0-alpha.37/paperweave-0.1.0-alpha.37.xpi)，或从 [Releases](https://github.com/alan-hpc/zotero-paper-weave/releases) 选择版本。
3. 在 Zotero 中打开「**工具 → 插件 → 齿轮 → 从文件安装插件**」，选择 `.xpi`，然后重启 Zotero。

## 第一次翻译

1. 选中一个 PDF 附件或包含 PDF 的论文条目，右键选择「**PaperWeave · 逐段双语 PDF / 修订**」。
2. 展开「**模型与翻译偏好**」，启用要使用的服务并填写配置（只用 DeepSeek 时，仅启用 DeepSeek）：

| 设置 | DeepSeek API | 本机 Codex 代理 |
| --- | --- | --- |
| Base URL | `https://api.deepseek.com/v1` | `http://127.0.0.1:47771/v1` |
| 模型 | 账户可用的模型 ID，例如 `deepseek-flash` | `codex-local`，或账户可用的具体模型 ID |
| API Key | 填写 DeepSeek Key | 留空 |

使用 Codex 前，需要安装 Node.js 20.10+、在官方 Codex CLI 中使用 ChatGPT 登录，并启动本机代理。**翻译期间保持代理运行**，详见 [Codex 配置指南](docs/CODEX_PROXY.zh-CN.md)。

3. 点击「**保存全部设置**」，然后点击「**翻译并生成 PDF**」。插件会识别本文术语、逐段翻译并生成附件。
4. 生成后直接在 Zotero 阅读新 PDF。默认将它设为这篇论文优先打开的附件，原始 PDF 仍然保留。

服务按**从上到下的优先级**调用，用「上移 / 下移」调整后保存；未启用或配置不完整的服务会跳过。只配置 DeepSeek 就能使用，不需要 Codex。

勾选「**额度耗尽时按顺序切换到下一可用服务**」后，明确的额度或余额耗尽会触发切换，下一服务可能计费。普通排队、临时限速或连接失败仍按原服务重试。

也可启用「其他兼容 API」，填写自己的 Chat Completions 接口。

## 修改译文、继续翻译

- **修订译文**：再次右键打开原 PDF 或生成的 PDF，选择段落，修改「中文译文」，点击「保存修订」。
- **更新 PDF**：再次点击「翻译并生成 PDF」。已有译文直接使用缓存，不需要整篇重译；每次生成新附件。
- **失败后继续**：再次点击主按钮，只处理未完成段落。若某段校验仍失败，可选择该段修订或重新翻译。
- **调整术语**：展开「本文术语表」增删需要保留英文的词，再按需重新翻译相关段落。

正文修订在 PaperWeave 工作台完成；Zotero 阅读器用于阅读、高亮和批注。

alpha.39 的结构修复方案和使用方式见[算法、数学与旧译文修复](docs/DOCUMENT_STRUCTURE.zh-CN.md)。旧译文可在“分步操作：词表与翻译”中选择“重译需复核段落（保留人工修订）”；只重新生成 PDF 不会自动改好旧的翻译措辞。

alpha.40 增加 [DeepSeek 图片识别](docs/VISION.zh-CN.md)：选中疑难段落，在编辑区展开“DeepSeek 图片识别与原图核对”，识别、核对并采用英文/LaTeX，再重译或修订。alpha.41 起，在主按钮下启用自动图片复核后，点击“翻译并生成 PDF”即可识别、重译需复核段落，再导出；有疑问时停留在核对区，保留人工修订。

工作台空闲时，打开另一篇论文会先保存再切换；翻译或载入期间会保留当前论文，并提示等待或取消。窗口与页内标题显示当前论文名称。

## 保留什么，需要注意什么

- 左侧保留完整原页；图表、图注、表格和公式保留原貌，按对应位置放入右栏。
- 技术术语逐篇识别。作者、单位、邮箱及通讯作者说明仅保留在左侧，不参与正文翻译。
- 版面识别可能出错，请对照原文复核。扫描件需先 OCR；加密或旋转页面暂不支持。
- **旧 PDF 的批注不会自动迁移到新 PDF。** 译文项目默认保存在本机，可用「导出修订项目」备份。
- 翻译会向所选模型服务发送论文文本，可能产生费用；可选 DeepSeek 图片识别会发送目标段落截图。插件不上传整篇 PDF，Key 保存在 Zotero 凭据管理器中。详见[隐私说明](docs/PRIVACY.md)。

## 从源码构建

需要 Node.js 20.10+：

```sh
git clone https://github.com/alan-hpc/zotero-paper-weave.git
cd zotero-paper-weave
npm ci
npm run build
```

安装包位于 `dist/*.xpi`。源码用户启动 Codex 代理可运行 `npm run proxy:codex`，再按上表配置。

开发检查：`npm run typecheck`、`npm test`。更多内容见[架构说明](docs/ARCHITECTURE.md)、[参与开发](CONTRIBUTING.md)和[后续计划](docs/ROADMAP.md)。

## 许可证

插件源码使用 [MIT](LICENSE) 许可证；字体和依赖保留各自许可，见[第三方声明](THIRD_PARTY_NOTICES.md)。本项目独立开发，与 Zotero 官方无隶属关系。
