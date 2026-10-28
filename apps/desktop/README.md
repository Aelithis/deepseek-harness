---
description: "DSH Private runs the local Harness workspace in an independent macOS desktop application."
---

# DSH Private Desktop

English | [中文](README.zh.md)

## Summary

DSH Private is the personal desktop distribution built from this repository. It opens the workspace directly and leaves model and search providers unconfigured. The [private distribution guide](../../docs/upgrade-guide/v0.2.1-rc.3/private-distribution/guide.md) describes removed reporting features and API-key configuration.

## Application and data

The application name is DSH Private and its application ID is `org.aelith.dsh-private`. Electron keeps its own browser state under the DSH Private application-support directory. Harness data defaults to `~/.dsh-private`; an explicitly supplied `DSH_HOME` overrides that directory. Existing official and NEXT client data is not imported.

Electron runs the private Host as a Node-mode child. The Host serves the workspace through an authenticated loopback listener on an allocated port. The application retains file access, terminal commands, browser tools, dependency downloads, and plugin installation. Crash reports remain local. Closing and quitting retain the existing running-task checks.

## Build and upgrade

Install the repository's locked dependencies, then run:

```sh
pnpm run package:desktop:mac:arm64:unsigned
```

This produces a locally signed macOS ARM64 DMG without Apple Developer ID or notarization credentials. The [manual GitHub workflow](../../.github/workflows/private-macos.yml) builds it on a GitHub-hosted runner and retains its source commit, dependency records, SHA256, and build attestation. Upgrades use those installers manually; no background update service is included.

## Development and checks

Use `pnpm run dev:desktop` to build and launch from source. `pnpm run start:desktop` reuses existing artifacts. Desktop and Host tests live in [tests](tests) and [desktop-host tests](../desktop-host/tests); the private startup and runtime checks cover the independent data location and removed network features.
