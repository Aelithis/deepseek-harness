# DeepSeek 官方 LLM API 协议扩展

[English](deepseek-llm-api-wire-extensions.md) | 中文

本参考定义 [`@deepseek-ai/dsh-llm-deepseek`](../packages/llm/llm-deepseek/README.zh.md) 在 `deepseek-official` Messages 请求中发送的全部 DeepSeek Harness 专用 HTTP 标头与附加 JSON 字段。它不重新定义上游 DeepSeek API 自有字段。提供方无关的 LLM 接口与 `llm-pi-ai` 不实现这些扩展。

适配器将这些扩展发送至已解析的 `baseURL`，包括已配置的网关。扩展位于 `messages`、系统提示词和工具 schema 之外，因此不会增加模型输入 token，也不会改变模型可见前缀。

## 扩展注册

[扩展注册表](../packages/llm/deepseek-llm-api-extensions/README.zh.md)为每个顶层字段保留一个提供方。随附组合不注册提供方。

## 正文扩展事务

适配器先序列化包括确切 `messages` 在内的完整基础正文，再让已注册提供方准备字段。提供方会收到该不可变正文、请求取消信号，以及可选的 `sessionId` 和辅助调用 `purpose`。提供方返回 `undefined` 时，本次请求会省略其字段。

系统将已准备的 JSON 值与提供方持有的状态分离，再将其作为基础字段的顶层同级成员合并，并序列化到同一个 HTTP 正文中。某个贡献方准备失败时，系统在该次请求中省略其字段，且只记录首次失败，其余字段照常发送；与基础字段冲突的字段会阻止请求。合并后的正文无法序列化时，适配器发送不含任何扩展字段的基础正文，跳过接受事务，让贡献方在之后的请求中重发自身状态，并记录被省略的字段名。组合未挂载注册表时，适配器发送未经扩展的基础正文。

已配置端点返回 HTTP 2xx 后，适配器会在读取 SSE 正文之前运行已准备的 `accept()` 事务。传输失败和非 2xx 响应不会接受任何贡献。接受失败会记录告警，但不会使模型请求失败；贡献方会在之后的请求中重发未被接受的状态。接受仅记录端点级 HTTP 成功，不表示 SSE 流已完整结束，也不表示端点已持久化扩展。
