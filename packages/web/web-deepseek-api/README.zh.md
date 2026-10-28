---
description: "DeepSeek Search 与 Fetch API 提供者、共享的鉴权与传输层、端点配置及标准化结果。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-deepseek-api

[English](README.md) | 中文

## 概述

通过 DeepSeek Search 与 Fetch API 搜索和抓取网页：每次操作只发起一次直接请求，无需辅助模型请求。插件注册 `deepseek-search-api` 和 `deepseek-fetch-api`，两者共用一份凭据和一个 API 基础地址，并使用 API key（API 密钥）鉴权。Search 返回标题、URL、可用的摘要和可用的发布时间；Fetch 返回页面 Markdown。Messages 搜索仍由 [dsh-web-search-deepseek](../web-search-deepseek/README.zh.md) 提供；面向模型的工具由 `dsh-tool-web` 提供。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

将插件与 `dsh-web` 一起挂载，并选择它的提供者。内置配置挂载此插件，同时选择 Messages 搜索和本地 HTTP 抓取。在**插件 > 内置插件配置 > 网页搜索**中开启**启用新版 Web 搜索 API**并保存，会同时选择此包的两个提供者；关闭后恢复内置选择。保存的选择从下一次操作开始生效。

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: deepseek-search-api
    fetchProvider: deepseek-fetch-api
- name: '@deepseek-ai/dsh-web-deepseek-api'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | 省略 | 字面 API 密钥；建议使用凭据引用 |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 每次操作解析的凭据引用 |
| `baseURL` | `https://api.deepseek.com/v1/tools` | 包含部署路径前缀的 Search 与 Fetch API 基础地址；追加 `/search` 或 `/fetch` |
| `count` | `10` | Search API 每次搜索的结果数，为 1 至 50 的整数；请求中更小的 `maxResults` 优先 |

`baseURL` 填写完整的 API 基础地址，包含路径前缀，但不包含操作名。默认值请求 `https://api.deepseek.com/v1/tools/search` 和 `https://api.deepseek.com/v1/tools/fetch`；使用其他前缀（例如 `/api/v1/tools`）的部署需要填写其完整基础地址。

真实 API 测试要求同时设置 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_SEARCH_API_TEST_BASE_URL`，后者包含 API 路径前缀。

### 鉴权

搜索与网页读取仅使用 API 密钥鉴权，不提供账号登录鉴权。

### 结果与失败

Search API 接收 `query`、`count`（配置的结果数，或请求中更小的 `maxResults`）和 `need_content: false`，不会自动附带会话中的用户原话。提供者直接映射 `results[].snippet`，并将可为 null 的 `date` 映射为可选的 `publishedAt`。空结果数组表示成功。Fetch 发送 `url`，以文本正文返回原始 Markdown，并报告 HTTP 状态 200，因为目标没有可用内容时 API 会返回错误状态。返回 URL 为请求 URL：API 不报告重定向后的最终 URL。

空白或无法解析的 `baseURL` 会使两个提供者不可用；`count` 不在 1 至 50 范围内会使 Search 不可用。缺少凭据时返回 `WEB_PROVIDER_CREDENTIAL_MISSING`，取消时返回 `WEB_ABORTED`，传输、HTTP 和响应格式错误返回 `WEB_PROVIDER_ERROR`。重定向在访问目标前被拒绝。Fetch API 的非成功状态表示抓取失败，不代表目标页面状态。请求失败会指出端点和 `baseURL` 设置项，不会自动重试或切换提供者。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[插件](src/index.ts)在每次操作时读取一次设置，并注册两个提供者。[Search 提供者](src/search.ts)在返回服务结果前校验响应 JSON；[Fetch 提供者](src/fetch.ts)校验 Markdown 正文。[传输层](src/transport.ts)负责凭据解析、取消、重定向拒绝和失败指引；记录钩子在发送前运行，抛出异常即阻止发送。Search 与 Fetch API 调用不产生辅助请求事件。工具调用和结果仍按常规记录到会话。

服务类型见 [Web 子系统](../../../docs/subsystems/web.zh.md)，受限的模型输出见 [tool-web](../tool-web/README.zh.md)。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 会话工具结果

#### 模型看到什么

`web_search` 和 `web_fetch` 工具在外部内容提示下呈现搜索来源或 Markdown。Fetch 结果包含请求 URL 和 HTTP 200。错误保留可操作的凭据或端点指引。Search 将查询直接发送给 Search API，不会自动附带会话中的用户原话。

#### Token 影响

不消耗辅助模型 token。会话结果 token 随返回的摘要或 Markdown 增长，并受消费方限制。API 抓取计费独立于模型 token。

#### KV Cache 影响

工具结果追加在已有会话前缀之后。提供者注册不增加模型上下文。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 共享搜索请求不暴露 `localization`；提供者仅请求摘要，不消费 `summary`、`site_name`、`site_icon` 或搜索全文。2026-10-16 实测返回的 `summary` 长度为 1,000–2,300 个字符。
- 查询和 URL 约束由远端服务执行。2026-10-16 抓取无法解析的目标域名时返回 HTTP 500，而非文档所述的 404，其失败信息与端点失败附带相同的端点指引。Fetch 既不暴露目标状态，也不暴露最终重定向 URL，因此结果报告 HTTP 200 和请求 URL；提供者丢弃 API 返回的页面标题。
- 可用性检查会读取已配置凭据；操作执行时凭据解析仍可能失败。

<a id="dev-note"></a>
### 开发备注

无。
