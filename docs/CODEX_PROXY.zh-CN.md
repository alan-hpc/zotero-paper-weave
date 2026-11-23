# 使用本机 Codex 代理翻译

PaperWeave 可以通过 `127.0.0.1` 上的代理调用已经登录的官方 Codex CLI。代理接收现有的 Chat Completions 请求，创建独立的 Codex 文字任务，再把结果交回插件。术语、公式占位符、缓存、修订和 60/40 PDF 排版继续由 PaperWeave 处理。

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

安装 alpha.33 并重启 Zotero，展开「模型与翻译偏好」，点击 **填写本机 Codex 代理**，再点击 **保存全部设置**。也可在 Codex 配置区手动填写：

| 设置 | 内容 |
| --- | --- |
| API Base URL | `http://127.0.0.1:47771/v1` |
| 模型名称 | `codex-local` |
| API Key | 留空 |

`codex-local` 是代理的默认别名，不是 OpenAI 的模型 ID。像配置 DeepSeek 一样，可以直接在插件「模型名称」中填写账户可用的 Codex 模型 ID，代理原样传给 CLI，无需修改脚本。填写 `codex-local` 时使用 `PAPERWEAVE_CODEX_MODEL` 的启动设置，未设置则使用 CLI 默认模型。代理跳过用户的工具/项目配置，但保留 CLI 管理的认证。不要假定默认模型与当前聊天所选模型相同；模型是否可用以实际请求为准。

保存后点击「翻译并生成 PDF」。已有术语批次和译文继续复用。截图对应的项目已保存 10/54 批，切换模型后仍可使用这些术语；如果明确希望新模型重新识别整篇词表，再使用单独的覆盖词表操作。

## 同时配置 DeepSeek 并自动切换

工作台分别保留 Codex、DeepSeek API 和其他兼容 API 的配置，不需要来回覆盖地址或 Key。旧版单模型设置自动迁移；Key 仍按端点保存在 Zotero 凭据管理器中，留空表示保留该端点已有的 Key。

1. 首选服务选择 **Codex**，保留本机地址和 `codex-local`，或填写明确的 Codex 模型 ID。
2. 在 **DeepSeek API** 区填写 `https://api.deepseek.com/v1`、账户支持的模型（如 `deepseek-flash`）和 DeepSeek API Key。已有相同端点的 Key 会直接沿用，不会显示明文。
3. 勾选 **Codex 额度受限时自动切换到 DeepSeek**，点击 **保存全部设置**。

只有 Codex 明确返回额度错误（例如代理的 `codex_usage_limit`）才会自动切换。失败的术语批次或段落原样发往 DeepSeek；同一个任务里的后续请求也使用 DeepSeek。已经完成或仍在 Codex 正常处理的请求不会重做，已有译文与人工修订不覆盖。每次新任务重新优先尝试 Codex。

切换提示保留在任务进度中，每个请求标明服务，每段新译文保存其服务和模型。DeepSeek 失败或 Key 缺失时停止并保留进度，不会在两种服务之间反复切换。临时限速、本机队列忙、网络故障、登录错误和保护标记校验失败都不触发额度切换。

自动切换会将对应论文文本发送到 DeepSeek API，并使用该 API 账户的计费额度。可以取消勾选，或将首选服务改为 **DeepSeek API** 直接使用 DeepSeek。请同时更新配套代理脚本，以正确区分额度耗尽与临时限速。

## 运行边界

- 只监听 IPv4 回环地址，检查 Host、来源及 JSON 请求类型，不提供跨站浏览器调用或公网部署模式。
- 只接受 PaperWeave 的术语识别及逐段翻译任务；默认两个任务同时运行，排队有上限，客户端取消会终止对应请求。
- 使用官方 `codex exec`、临时独立目录、只读沙箱和临时会话；关闭 shell、网页搜索、图像查看/生成、电脑操作、多代理及插件工具，不执行论文中的指令。
- 输入经 stdin 传递，不拼接为 shell 命令。仅在 Codex 成功完成、退出正常且返回预期 JSON 后交付结果。命令错误、截断、额度耗尽和取消不会写入译文。
- 代理不记录请求正文或认证信息。临时文件仅含输出结构定义，结束后删除；账户数据处理依照 Codex 和所选工作区的政策。

## 可选环境设置

| 变量 | 用途 |
| --- | --- |
| `PAPERWEAVE_CODEX_BIN` | 指定 Codex CLI 可执行文件路径 |
| `PAPERWEAVE_CODEX_MODEL` | 明确指定账户可用的 Codex 模型 |
| `PAPERWEAVE_PROXY_PORT` | 修改端口，默认 `47771`；插件地址也需一起修改 |

`GET http://127.0.0.1:47771/health` 可检查代理是否正在运行；健康页不代表账户额度或选定模型可用，实际完成一次请求才能验证。

## 官方依据与替代方案

- [Codex 非交互调用](https://learn.chatgpt.com/docs/non-interactive-mode)：脚本调用、结构化输出及已保存 CLI 认证。
- [Codex 认证](https://learn.chatgpt.com/docs/auth)：ChatGPT 登录和 API Key 登录的区别。
- [开源应用的 Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source)：可作为后续插件原生登录方案；需要应用单独获得用户授权，不提供现有聊天内容。

本机代理已做短句级的真实调用验证。安装新版 XPI 后，Zotero 内的实际连接和整篇论文仍需继续验收；没有自动发起整篇翻译。
