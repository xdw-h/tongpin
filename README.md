# 同频 Tongpin

通过电脑或手机浏览器连接本机 Codex，继续已有任务、查看结果并处理待确认事项。适合可信局域网或公司 VPN 内网使用。

## 功能

- 任务状态分组、搜索、置顶、重命名、归档与恢复。
- 原任务对话、附件上传、结果与文件下载、公开执行过程。
- 手机待确认事项、执行中追加指令、文字暂存、本轮验收标记。
- 日夜主题、断线恢复、连接诊断、站内提醒。
- 手机访问码配对、授权撤销、后台守护与可选登录启动。

## 环境

Windows、PowerShell 7、Node.js 18 或更高版本，以及已登录的 Codex 桌面程序。前端依赖已包含在 `outputs/ai-team/vendor`，无需运行 npm install。

同频使用 Codex 桌面程序的本地工具和实时 IPC 通道，这些接口可能随桌面版本变化。本项目不是官方 Codex 手机客户端。

## 启动

首次建议在 Codex 桌面程序中打开本项目，要求 Codex 执行：

```powershell
pwsh -NoProfile -File ./scripts/start-tongpin.ps1 -Open
```

之后可双击根目录的 `启动同频.cmd`。打开 [本机页面](http://127.0.0.1:4188/)。电脑上的 Codex 需保持运行；首次从普通终端启动可能只有网页可用，需要从 Codex 启动一次以建立当前用户的桌面连接配置。

启动脚本优先读取本机 `work/startup-config.json` 中的 `nodePath` 和 `port`，没有配置时自动寻找 Node.js，端口默认 4188。可选配置的示例见 [config/startup-config.example.json](config/startup-config.example.json)。该配置仅保存在本机。

手机打开“我的 → 手机连接”显示的内网地址并输入访问码。手机与电脑需网络互通，Windows 防火墙需允许对应 Node.js 程序访问 TCP 4188；不要把端口直接映射到公网。

## 停止与可选自启动

双击 `停止同频.cmd`，或运行：

```powershell
pwsh -NoProfile -File ./scripts/stop-tongpin.ps1
```

登录自启动需自行启用：`pwsh -NoProfile -File ./scripts/install-startup.ps1`；关闭时增加 `-Disable`。下载项目不会自动注册自启动或修改防火墙。

## 本地数据

配对信息、桌面连接、发送回执、运行日志和上传文件存放在 `work/`，全部排除在 Git 之外。任务目录迁移映射 `outputs/ai-team/project-bindings.json` 也是本机配置，缺省为空。手机草稿、暂存要求、置顶和验收标记保存在当前浏览器。

配对设备可以查看任务并发出执行指令，请只授权可信设备。此版本未实现同事之间按指定任务共享的功能。

详细操作见 [使用同频.md](使用同频.md)。第三方 Vue 和 Marked 的许可证保留在 `outputs/ai-team/vendor` 中。
