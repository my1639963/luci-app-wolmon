# luci-app-wolmon

**luci-app-wolmon** — OpenWrt/LuCI 可视化网络唤醒（Wake-on-LAN）+ 在线状态监控应用。

> 仓库地址：<https://github.com/my1639963/luci-app-wolmon>

面向 OpenWrt 25.12.x（LuCI master，客户端 JS 视图架构），在官方 `luci-app-wol`
基础上扩展：唤醒后持续探测设备在线状态、持久化记录已唤醒设备并显示其
MAC / IP / 实时状态。

## 功能特性

- 输入 MAC 地址发送魔术包唤醒局域网设备（etherwake / wakeonlan，自动检测可用工具）
- 唤醒目标持久化保存（UCI 配置 `luci-wolmon`），重启后仍存在
- 打开页面即显示所有已记录设备的当前在线状态
- 固定 5 秒间隔轮询（ARP/邻居表 + 并行 ping 结合探测），无用户配置项
- **唤醒后 IP 发现**：设备关机时 ARP 表无其条目，唤醒后轮询 ARP 表直到解析出
  IPv4 地址，自动回填记录并转入 ping 探测
- 多宿主主机（一个 MAC 多个 IPv4）全部候选地址并行探测，任一响应即判在线
- 页面不可见时暂停轮询，恢复可见时立即刷新
- i18n：英文（源语言）+ 简体中文（`zh_Hans`），跟随系统语言

## 仓库结构

```
SRS.md                          软件需求规格说明书（v1.2，权威规格）
docs/
  OpenWrt-APK-LuCI-开发指南.md   离线开发手册（apk 世代，含真机踩坑实录）
src/
  luci-app-wolmon/              应用源码
    Makefile                    luci.mk 构建（LUCI_TITLE/DEPENDS/LANG）
    htdocs/…/view/wolmon.js     前端视图（form + 5s 轮询）
    root/usr/share/rpcd/
      ucode/luci.wolmon         ucode 后端（stat/exec/arp/status）
      acl.d/…                   ACL 权限（最小授权 + 命令白名单）
    root/usr/share/luci/menu.d/ 菜单入口（服务 → 网络唤醒监控）
    root/etc/config/luci-wolmon UCI 默认配置
    po/templates, po/zh_Hans    翻译（pot → po → lmo）
```

## 构建

放入 OpenWrt buildroot 的 LuCI feed（如 `feeds/luci/applications/`）后：

```
make package/luci-app-wolmon/compile
```

或直接把文件部署到设备（快速迭代）：

```
scp src/luci-app-wolmon/htdocs/luci-static/resources/view/wolmon.js root@router:/www/luci-static/resources/view/
scp src/luci-app-wolmon/root/usr/share/rpcd/ucode/luci.wolmon root@router:/usr/share/rpcd/ucode/
ssh root@router "chmod +x /usr/share/rpcd/ucode/luci.wolmon; /etc/init.d/rpcd restart; rm -rf /tmp/luci-*"
```

详见 [docs/OpenWrt-APK-LuCI-开发指南.md](docs/OpenWrt-APK-LuCI-开发指南.md)。

## 状态

已在 OpenWrt 25.12.5 完成端到端验收：状态轮询、
IP 发现回填持久化、唤醒流程均验证通过。

## 许可证

Apache License, Version 2.0。见 [LICENSE](LICENSE) 与
[src/luci-app-wolmon/LICENSE](src/luci-app-wolmon/LICENSE)。

## qoder 编码

---

# luci-app-wolmon (English)

**luci-app-wolmon** — OpenWrt/LuCI visual Wake-on-LAN + online status monitoring application.

> Repository: <https://github.com/my1639963/luci-app-wolmon>

Targeting OpenWrt 25.12.x (LuCI master, client-side JS view architecture), extending the official `luci-app-wol` with: continuous device online status detection after wake-up, persistent recording of awakened devices, and display of their MAC / IP / real-time status.

## Features

- Input MAC address to send magic packets for waking up LAN devices (etherwake / wakeonlan, auto-detect available tools)
- Persistent storage of wake targets (UCI config `luci-wolmon`), survives reboots
- Display current online status of all recorded devices upon page load
- Fixed 5-second polling interval (ARP/neighbor table + parallel ping probing), no user configuration options
- **Post-wake IP discovery**: When device is off, ARP table has no entry; after wake-up, poll ARP table until IPv4 address is resolved, auto-fill record and switch to ping probing
- Multi-homed hosts (one MAC with multiple IPv4): probe all candidate addresses in parallel, consider online if any responds
- Pause polling when page is not visible, refresh immediately when it becomes visible again
- i18n: English (source language) + Simplified Chinese (`zh_Hans`), follows system language

## Repository Structure

```
SRS.md                          Software Requirements Specification (v1.2, authoritative spec)
docs/
  OpenWrt-APK-LuCI-Development-Guide.md   Offline development guide (apk era, with real-device troubleshooting records)
src/
  luci-app-wolmon/              Application source code
    Makefile                    luci.mk build (LUCI_TITLE/DEPENDS/LANG)
    htdocs/…/view/wolmon.js     Frontend view (form + 5s polling)
    root/usr/share/rpcd/
      ucode/luci.wolmon         ucode backend (stat/exec/arp/status)
      acl.d/…                   ACL permissions (least privilege + command whitelist)
    root/usr/share/luci/menu.d/ Menu entry (Services → Wake-on-LAN Monitor)
    root/etc/config/luci-wolmon UCI default configuration
    po/templates, po/zh_Hans    Translations (pot → po → lmo)
```

## Build

Place into OpenWrt buildroot's LuCI feed (e.g., `feeds/luci/applications/`), then:

```
make package/luci-app-wolmon/compile
```

Or directly deploy files to the device (for rapid iteration):

```
scp src/luci-app-wolmon/htdocs/luci-static/resources/view/wolmon.js root@router:/www/luci-static/resources/view/
scp src/luci-app-wolmon/root/usr/share/rpcd/ucode/luci.wolmon root@router:/usr/share/rpcd/ucode/
ssh root@router "chmod +x /usr/share/rpcd/ucode/luci.wolmon; /etc/init.d/rpcd restart; rm -rf /tmp/luci-*"
```

See [docs/OpenWrt-APK-LuCI-Development-Guide.md](docs/OpenWrt-APK-LuCI-开发指南.md) for details.

## Status

End-to-end acceptance completed on OpenWrt 25.12.5: status polling,
IP discovery backfill persistence, and wake-up workflow all verified.

## License

Apache License, Version 2.0. See [LICENSE](LICENSE) and
[src/luci-app-wolmon/LICENSE](src/luci-app-wolmon/LICENSE).

## Generated by Qoder
