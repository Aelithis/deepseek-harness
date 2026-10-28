# Official DeepSeek LLM API wire extensions

English | [中文](deepseek-llm-api-wire-extensions.zh.md)

This reference defines every DeepSeek Harness-specific HTTP header and additive JSON field sent by [`@deepseek-ai/dsh-llm-deepseek`](../packages/llm/llm-deepseek/README.md) on `deepseek-official` Messages requests. It does not redefine fields owned by the upstream DeepSeek API. The provider-neutral LLM interface and `llm-pi-ai` do not implement these additions.

The adapter sends the additions to its resolved `baseURL`, including a configured gateway. They remain outside `messages`, system prompts, and tool schemas, so they do not add model-input tokens or alter the model-visible prefix.

## Extension registration

The [extension registry](../packages/llm/deepseek-llm-api-extensions/README.md) reserves one provider per top-level field. The shipped composition registers no providers.

## Body-extension transaction

The adapter serializes the complete base body, including the exact `messages`, before it asks registered providers to prepare fields. A provider receives that immutable body, the request cancellation signal, and optional `sessionId` and auxiliary-call `purpose`. Returning `undefined` omits that provider's field for the request.

Prepared JSON values are detached from provider-owned state, merged as top-level siblings of the base fields, and serialized in the same HTTP body. A contributor whose preparation fails is omitted from that request, with only its first failure logged, while the other fields are still sent; a field that collides with a base field prevents the request. If the merged body fails to serialize, the adapter sends the base body without any extension field, skips the acceptance transaction so contributors resend their state on a later request, and logs the omitted field names. A composition without the registry sends the unextended base body.

After the configured endpoint returns HTTP 2xx, the adapter runs the prepared `accept()` transaction before reading the SSE response body. Transport failures and non-2xx responses do not accept any contribution. An acceptance failure is logged and does not fail the model request; the contributor resends its unaccepted state on a later request. Acceptance records endpoint-level HTTP success; it does not assert that an SSE stream completed or that the endpoint persisted an extension.
