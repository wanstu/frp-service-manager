# FRP Service Manager

基于 Wails 2 + Wails Desktop Kit 的 FRPS Dashboard 桌面管理器。

## 产品边界

本项目**不包含 frps 程序，也不负责安装、启动、停止或升级 frps**。它只连接已经部署并开启 Dashboard 的 FRPS 服务端，通过 Dashboard API 查看运行状态。

支持同时保存和管理多个 FRPS Dashboard 连接。

## 当前能力

- 多 FRPS 连接：名称、Dashboard 地址、用户名、密码、TLS 校验选项。
- Dashboard Basic Auth。
- 密码使用 Wails Desktop Kit `secureconfig` 加密保存。
- 普通配置统一保存在 `~/.config/frp-service-manager/settings.json`。
- 服务概览：FRPS 版本、连接数、流量及服务端信息。
- 客户端列表：支持新版本 `/api/clients`。
- 代理列表：优先尝试新版本聚合接口，并自动回退旧版 `/api/proxy/{type}`。
- 保留原始 Dashboard JSON，便于兼容不同 FRP 版本。
- 系统托盘、单实例、开机启动。
- Kit v0.8.0 light / dark / system 明暗模式与 Runtime Theme；Linux 默认关闭到托盘；托盘点击行为由桌面环境与底层托盘后端决定；主题包由 Kit 在运行时同步、校验和缓存。
- GitHub Release 使用 Kit Packaging Pipeline，同时发布 Linux 裸二进制与 `.deb` 安装包；`.deb` 自带桌面启动项与应用图标。
- Windows / Linux / macOS 的 Kit 桌面生命周期基础能力。

## FRPS 端要求

FRPS 需要开启 Dashboard，例如：

~~~toml
webServer.addr = "0.0.0.0"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "your-password"
~~~

然后在应用中添加：

~~~text
名称：生产 FRPS
Dashboard：http://server.example.com:7500
用户名：admin
密码：***
~~~

应用连接的是 Dashboard 地址，不是 frps 的 `bindPort`。

## 数据与密码

普通配置：

~~~text
~/.config/frp-service-manager/settings.json
~~~

密码不会写入该 JSON。它由 Kit Secure Config 加密后存放在：

~~~text
~/.config/frp-service-manager/secure/
~~~

加密主密钥由操作系统安全凭据库保存。

## 构建

Windows：

~~~powershell
.\scripts\build.ps1
~~~

输出：

~~~text
cmd/frp-service-manager/build/bin/frp-service-manager.exe
~~~

## API 兼容策略

FRP Dashboard API 在新版本中持续演进。当前实现：

1. `/api/serverinfo` 作为基础连通性与概览接口。
2. 尝试 `/api/clients` 获取客户端。
3. 尝试 `/api/proxies` 获取聚合代理。
4. 不存在聚合接口时，回退 `/api/proxy/tcp`、`udp`、`http`、`https`、`tcpmux`、`stcp`、`sudp`、`xtcp`。

这样可以覆盖较新的 Dashboard API 与大量仍在使用旧 Dashboard API 的 FRPS 部署。
