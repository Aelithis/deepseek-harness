---
kind: upgrade-guide
description: The private desktop distribution removes account login, telemetry, automatic updates, and preselected providers.
---

# DSH Private

English | [中文](guide.zh.md)

## Change

DSH Private uses a separate application identity and defaults to `~/.dsh-private`. It does not import the official or NEXT client’s credentials, plugins, or history. The account login, device registration, session upload, product analytics, anonymous tracking identifiers, and background update implementations are removed. Local session files and crash logs remain local.

The official API-key model provider starts inactive and can be added, removed, and added again. No model or search provider is preselected. The model catalog returns `default: null` until a selection is saved. Calls to `agentDefaultModel.currentSelection()` require a configured model; callers that display an empty state use `configuredSelection()`.

Official API-key search, direct HTTP fetch, dependency downloads, and plugin management remain available. Search endpoints are configured independently from chat endpoints. Account-only wallet and quota features are absent. Configured service requests still carry their required authentication and task data. Third-party plugins may define additional network behavior.

## Migration

1. Install DSH Private beside the existing client and open its independent workspace.
2. In model settings, add a custom provider or the official DeepSeek API-key provider, then select a model. Removing the selected provider clears its default selection instead of switching to another service.
3. In web-search settings, explicitly select and configure a search provider. A chat gateway must support the selected search API before it can also serve search. Direct HTTP webpage fetching works independently.
4. Keep model keys and user data on the local machine. GitHub builds require neither model keys nor old client files.
5. Upgrade manually using the installer from this repository’s DSH Private macOS workflow. Verify the installer against its SHA256 and recorded source commit.
