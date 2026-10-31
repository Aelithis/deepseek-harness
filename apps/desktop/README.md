---
description: "DSH Private runs the local Harness workspace in an independent macOS or Windows desktop application."
---

# DSH Private Desktop

English | [中文](README.zh.md)

## Summary

DSH Private is the personal desktop distribution built from this repository. It opens the workspace directly and leaves model and search providers unconfigured. The [private distribution guide](../../docs/upgrade-guide/v0.2.1-rc.3/private-distribution/guide.md) describes removed reporting features and API-key configuration.

## Application and data

The application name is DSH Private and its application ID is `org.aelith.dsh-private`. Electron keeps its own browser state under the DSH Private application-support directory. Harness data defaults to `~/.dsh-private`; an explicitly supplied `DSH_HOME` overrides that directory. Existing official and NEXT client data is not imported.

Electron runs the private Host as a Node-mode child. The Host serves the workspace through an authenticated loopback listener on an allocated port. The application retains file access, terminal commands, browser tools, dependency downloads, and plugin installation. Crash reports remain local. Closing and quitting retain the existing running-task checks.

The main window saves its normal width and height to `window-state.json` under Electron's application-support directory and restores them on launch. The initial size remains 1280 × 820. Window dimensions are independent of model configuration and sessions.

## Build and upgrade

The system native addon is built and packed from this checkout. Platform packages for other operating systems or CPU architectures are omitted from the target runtime.

Install the repository's locked dependencies, then run:

```sh
pnpm run package:desktop:mac:arm64:unsigned
pnpm run package:desktop:win:x64:unsigned
```

Run the matching command on its native operating system. macOS produces a locally signed ARM64 DMG without Apple Developer ID or notarization credentials; Windows produces an unsigned x64 EXE without a release configuration file or signing credentials. The manual GitHub workflows for [macOS](../../.github/workflows/private-macos.yml) and [Windows](../../.github/workflows/private-windows.yml) build on GitHub-hosted runners and retain the source commit, dependency records, SHA256, and build attestation. Upgrades use those installers manually; no background update service is included.

## Development and checks

Use `pnpm run dev:desktop` to build and launch from source. `pnpm run start:desktop` reuses existing artifacts. Desktop and Host tests live in [tests](tests) and [desktop-host tests](../desktop-host/tests); the private startup and runtime checks cover the independent data location and removed network features.
