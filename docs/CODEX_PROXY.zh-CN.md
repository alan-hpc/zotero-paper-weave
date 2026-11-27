# 使用本机 Codex 代理翻译

> alpha.50 的中文与原公式核验需要新版配套代理。更新包内 `paperweave-codex-proxy.mjs`，在代理空闲时停止旧进程后启动新版；地址、模型和登录保持原配置。仅安装 XPI 无法给旧代理增加这些任务能力。健康页的 `capabilities.formulaReview: 1` 表示支持。

PaperWeave 可以通过 `127.0.0.1` 上的代理调用已经登录的官方 Codex CLI。代理接收现有的 Chat Completions 请求，创建独立的 Codex 翻译或图片识别任务，再把结果交回插件。术语、公式占位符、缓存、修订和 60/40 PDF 排版继续由 PaperWeave 处理。

代理使用 Codex CLI 保存的 **ChatGPT 登录**；不读取或复制其认证文件，不继承 API Key 环境变量，也不把网页会话当作接口。实际请求消耗该账户的可用 Codex 额度，仍受计划、模型权限和速率限制。它不会继承当前聊天的内容、自定义 GPT 的知识库或聊天界面选中的模型。

## 启动

需要 Node.js 20.10+、支持代理受限配置的 Codex CLI，以及有效的 ChatGPT 登录。此机已检查的版本为 `codex-cli 0.167.0-alpha.4.1`。Mac 上可自动发现 ChatGPT / Codex 应用附带的 CLI，也可以使用 PATH 中的 `codex`。

先在终端检查：

```sh
codex login status
```

如未使用 ChatGPT 登录，运行 `codex login` 并完成浏览器流程。代理不修改你的 Codex 默认配置或其他端点凭据。

下载配套的 `paperweave-codex-proxy.mjs` 后运行：

```sh
node /你的下载目录/paperweave-codex-proxy.mjs
```

从源码运行也可以使用 `npm run proxy:codex`。终端显示 `http://127.0.0.1:47771/v1` 后，保持该进程运行；关闭终端或重启电脑后需要重新启动。按 Ctrl+C 停止。本版不安装开机启动服务。

## 配置 PaperWeave

安装插件并重启 Zotero，展开「模型与翻译偏好」，点击 **填写本机 Codex 代理**，再点击 **保存全部设置**。也可在 Codex 配置区手动填写：

| 设置 | 内容 |
| --- | --- |
| API Base URL | `http://127.0.0.1:47771/v1` |
| 模型名称 | `codex-local` |
| API Key | 留空 |

`codex-local` 是代理的默认别名，不是 OpenAI 的模型 ID。像配置 DeepSeek 一样，可以直接在插件「模型名称」中填写账户可用的 Codex 模型 ID，代理原样传给 CLI，无需修改脚本。填写 `codex-local` 时使用 `PAPERWEAVE_CODEX_MODEL` 的启动设置，未设置则使用 CLI 默认模型。代理跳过用户的工具/项目配置，但保留 CLI 管理的认证。不要假定默认模型与当前聊天所选模型相同；模型是否可用以实际请求为准。

保存后点击「翻译并生成 PDF」。已有术语批次和译文继续复用，切换模型不会清空进度；如果希望新模型重新识别整篇词表，再使用单独的覆盖词表操作。

## 单独使用 DeepSeek 或配置调用顺序

不需要 Codex 也可以使用插件。只启用 **DeepSeek**，填写 `https://api.deepseek.com/v1`、账户支持的模型（如 `deepseek-flash`）和 API Key，保存即可。Codex 与其他 API 可以留空或停用。

三个服务分别保存设置，按列表 **从上到下** 的顺序调用。用每项的 **上移 / 下移** 调整优先级，再点击 **保存全部设置**。未启用、地址/模型缺失或远程端点未保存 Key 的服务会跳过；界面会显示实际调用顺序和跳过原因。本机 Codex 代理无需 Key，但需要明确启用并保持运行。

例如希望先用 Codex、额度耗尽后用 DeepSeek：

1. 启用 **Codex** 与 **DeepSeek**，把 Codex 移到 DeepSeek 上面。
2. 填写并保存两者的地址、模型和 DeepSeek API Key。
3. 勾选 **额度耗尽时按顺序切换到下一可用服务**，点击 **保存全部设置**。

只有明确的额度/余额耗尽响应（如 `codex_usage_limit`、`insufficient_quota` 或 HTTP 402）才会切到下一可用服务。失败的批次或段落原样重试；本次任务后续请求继续使用切换后的服务，下一次新任务从列表顶部重新开始。已完成或仍在正常处理的请求不会重做，人工修订与缓存保留。

切换提示显示前后服务，每段译文保存实际使用的服务和模型。普通排队、临时限速、网络故障、登录错误与内容校验错误不触发额度切换；没有后续可用服务时保留进度并停止。服务顺序在同一次任务中不会循环。

自动切换会将对应论文文本发送到下一服务，并可能使用其计费额度。可取消该选项，仅使用第一项可用服务。请同时更新配套代理脚本，以正确区分 Codex 额度耗尽与临时限速。旧版配置会按原首选服务迁移，已保存的 Key 保留。

## 运行边界

- 只监听 IPv4 回环地址，检查 Host、来源及 JSON 请求类型，不提供跨站浏览器调用或公网部署模式。
- 只接受 PaperWeave 的术语识别、逐段翻译和目标段落图片识别、中文/公式独立核验和带图片翻译任务；默认两个任务同时运行，排队有上限，客户端取消会终止对应请求。
- 使用官方 `codex exec`、临时独立目录、只读沙箱和临时会话；关闭 shell、网页搜索、图像查看/生成、电脑操作、多代理及插件工具，不执行论文中的指令。
- 输入经 stdin 传递，不拼接为 shell 命令。仅在 Codex 成功完成、退出正常且返回预期 JSON 后交付结果。命令错误、截断、额度耗尽和取消不会写入译文。
- 图片识别仅接收内嵌 PNG，不从网址或用户提供的路径读取文件；每段最多 6 张，有体积与尺寸限制。截图保存在私有临时目录，以 CLI 图片附件发送，不启用图像查看工具。
- 代理不记录请求正文或认证信息。临时文件包含输出结构定义及本次图片附件，成功、失败或取消后删除；账户数据处理依照 Codex 和所选工作区的政策。

## 可选环境设置

| 变量 | 用途 |
| --- | --- |
| `PAPERWEAVE_CODEX_BIN` | 指定 Codex CLI 可执行文件路径 |
| `PAPERWEAVE_CODEX_MODEL` | 明确指定账户可用的 Codex 模型 |
| `PAPERWEAVE_PROXY_PORT` | 修改端口，默认 `47771`；插件地址也需一起修改 |

`GET http://127.0.0.1:47771/health` 可检查代理是否正在运行；alpha.43 配套代理的健康页包含 `capabilities.images: true`；旧代理只支持文字，需要更新并重启。健康页不代表账户额度或选定模型可用，实际完成一次请求才能验证。

## 官方依据与替代方案

- [Codex 非交互调用](https://learn.chatgpt.com/docs/non-interactive-mode)：脚本调用、结构化输出及已保存 CLI 认证。
- [Codex 认证](https://learn.chatgpt.com/docs/auth)：ChatGPT 登录和 API Key 登录的区别。
- [开源应用的 Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source)：可作为后续插件原生登录方案；需要应用单独获得用户授权，不提供现有聊天内容。

本机代理已做短句级的真实调用验证。安装新版 XPI 后，Zotero 内的实际连接和整篇论文仍需继续验收；没有自动发起整篇翻译。
