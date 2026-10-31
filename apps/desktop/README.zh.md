---
description: "DSH Private 以独立的 macOS 或 Windows 桌面应用运行本地 Harness 工作区。"
---

# DSH Private 桌面端

[English](README.md) | 中文

## 概述

DSH Private 是从本仓库构建的个人桌面版，启动后直接进入工作区，模型和搜索供应商均未预设。[个人版说明](../../docs/upgrade-guide/v0.2.1-rc.3/private-distribution/guide.zh.md)介绍已移除的回传功能及 API Key 配置方式。

## 应用与数据

应用名称为 DSH Private，应用标识为 `org.aelith.dsh-private`。Electron 浏览器状态保存在独立的 DSH Private 应用支持目录。Harness 数据目录默认为 `~/.dsh-private`，显式指定的 `DSH_HOME` 可覆盖此目录。程序不导入官方版或 NEXT 的现有数据。

Electron 以 Node 模式子进程运行私有 Host。Host 通过带鉴权的本机回环监听器提供工作区，端口由系统分配。文件访问、终端命令、浏览器工具、依赖下载和插件安装继续可用。崩溃报告保留在本机，关闭与退出仍检查运行中的任务。

主窗口将普通窗口的宽高保存到 Electron 应用支持目录下的 `window-state.json`，下次启动时恢复；首次仍使用 1280 × 820。窗口尺寸与模型配置、会话数据分别保存。

## 构建与升级

系统原生模块从本次源码编译并打包，目标运行时不包含其他操作系统或处理器架构的平台包。

安装仓库锁定的依赖后运行：

```sh
pnpm run package:desktop:mac:arm64:unsigned
pnpm run package:desktop:win:x64:unsigned
```

在对应操作系统上运行相应命令。macOS 生成采用本地签名的 ARM64 DMG，不需要 Apple Developer ID 或公证凭据；Windows 生成无签名的 x64 EXE，不需要发布配置文件或签名凭据。[macOS](../../.github/workflows/private-macos.yml) 和 [Windows](../../.github/workflows/private-windows.yml) 的 GitHub 手动工作流均在 GitHub 托管构建机上构建，保存源码提交、依赖记录、SHA256 和构建来源证明。后续使用这些安装包手动升级，程序不包含后台更新服务。

## 开发与检查

使用 `pnpm run dev:desktop` 从源码构建并启动；`pnpm run start:desktop` 复用现有产物。桌面与 Host 测试分别位于 [tests](tests) 和 [desktop-host tests](../desktop-host/tests)，个人版启动及运行时检查覆盖独立数据目录和已移除的联网功能。
