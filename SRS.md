# luci-app-wolmon 软件需求规格说明书 (SRS)

- 项目名称：**luci-app-wolmon**（可视化网络唤醒 + 在线状态监控）
- 目标平台：OpenWrt 25.12.x / LuCI（当前 master，客户端 JavaScript 视图架构）
- 文档版本：v1.2
- 状态：草稿（评审问题已修复）
- 命名说明：包名采用 **luci-app-wolmon**（而非 `luci-app-wol`），以避免与官方 `luci-app-wol` 冲突，可与其共存。对应 UCI 配置 `luci-wolmon`、ubus object `luci.wolmon`、翻译包 `luci-i18n-wolmon-zh-cn`。

---

## 1. 引言

### 1.1 目的
本 SRS 定义一个运行于 OpenWrt LuCI Web 管理界面的可视化 Wake-on-LAN（WOL，网络唤醒）应用的完整需求。本文档作为设计、实现、测试与验收的依据。

### 1.2 范围
应用在官方 `luci-app-wol` 架构基础上进行扩展（改名 `luci-app-wolmon` 以共存），除“发送魔术包唤醒设备”外，新增以下能力：

1. 用户输入 MAC 地址唤醒 LAN 内设备；
2. 唤醒发出后，对目标设备持续探测在线状态并在 UI 实时显示；探测**结合 ARP/邻居表 + ping**（详见 FR-3）；
3. 被唤醒过的设备被**永久记录**（持久化到 UCI 配置），列表显示其 **MAC、对应 IP 地址与实时状态**；
4. 用户可删除已记录的设备；
5. **打开页面时立即显示所有已记录设备的当前在线状态**；
6. **仅显示实时状态**，不保留历史（不记录/展示最近唤醒时间、上线时间等）；
7. **唤醒后 IP 发现（关键逻辑修正，见 FR-7）**：设备被唤醒前通常处于关机态，ARP/邻居表中无其 IP，无法直接 ping。因此唤醒后须**轮询 ARP/邻居表**，直到解析出该 MAC 对应的 IPv4 地址，随后**更新该记录的 IP（地址列表）**并开始 ping 探测；
8. 国际化：默认 `en-US`（英文为源语言），支持 `zh-CN`，并跟随系统语言自动切换；
9. 状态轮询**固定间隔 5s，不提供用户配置项**。

### 1.3 术语
| 术语 | 说明 |
|------|------|
| WOL / 魔术包 | Wake-on-LAN，通过广播特殊数据帧远程唤醒设备 |
| etherwake / wakeonlan | OpenWrt 上两种 WOL 命令行工具 |
| UCI | OpenWrt 统一配置接口，配置持久化于 `/etc/config/` |
| rpcd / ubus | OpenWrt 的 RPC 守护进程与进程间总线，前端经 ubus 调用后端 |
| ucode | OpenWrt 的模板/脚本语言，官方 WOL 后端即用 ucode 实现 |
| CBI / form | LuCI 的配置绑定接口，前端以 JS `form.*` 组件渲染表单 |
| getHostHints | luci-rpc 提供的接口，返回 MAC↔IP/主机名 映射（来自 ARP/邻居表与 DHCP 租约） |

### 1.4 参考
- 官方应用源码：`openwrt/luci` → `applications/luci-app-wol/`
- LuCI 客户端 JS API：`http://openwrt.github.io/luci/jsapi/`
- OpenWrt 打包策略：`https://openwrt.org/docs/guide-developer/package-policies`

---

## 2. 总体描述

### 2.1 产品视角
应用作为 LuCI 的一个子页面挂载在 **服务（Services）→ Wake on LAN**，与其他官方应用风格一致，复用 LuCI 的鉴权、菜单、i18n、UBus/UCI 基础设施。

### 2.2 架构（严格遵循官方现代 LuCI 模式）
```
浏览器 (LuCI 前端)
  └─ htdocs/luci-static/resources/view/wolmon.js   客户端视图 (view.extend)
        │  'require' form / uci / rpc / ui / tools.widgets
        │  rpc.declare → 经 ubus 调用后端；固定 5s 轮询 status
        ▼
rpcd (ubus)
  ├─ object "luci.wolmon"   root/usr/share/rpcd/ucode/luci.wolmon
  │     stat()    检测 etherwake/wakeonlan/ping 是否可用
  │     exec()    白名单方式执行 WOL 命令（发送魔术包）
  │     arp()     读取 ARP/邻居表，返回 MAC↔IPv4/IPv6 映射
  │     status()  批量：MAC→IP(查ARP，缺失则记录待发现) + ping，返回实时状态
  ├─ object "luci-rpc"   getHostHints / getNetworkDevices（辅助 MAC↔IP、网卡列表）
  └─ UCI                 配置持久化：/etc/config/luci-wolmon
```

> ARP/邻居表数据来源：`/proc/net/arp`、`ip neighbor`（IPv4/IPv6），以及 luci-rpc `getHostHints`（融合 DHCP 租约）。唤醒后设备刚上线时，其条目可能短暂缺失，需轮询直至出现（FR-7）。

### 2.3 权限模型（ACL）
通过 `root/usr/share/rpcd/acl.d/luci-app-wolmon.json` 授予登录用户：
- read：`luci.wolmon` 的 `stat`/`arp`/`status`；`luci-rpc` 的 `getHostHints`/`getNetworkDevices`；uci 读取 `luci-wolmon`
- write：`luci.wolmon` 的 `exec`；uci `add`/`set`/`delete`/`order`/`commit`/`apply` `luci-wolmon`

菜单入口 `root/usr/share/luci/menu.d/luci-app-wolmon.json`（路径 `admin/services/wolmon`）通过 `depends.acl` 绑定该权限，未授权用户不可见。

### 2.4 运行环境
- 依赖包：`+luci-base`（必需）；`+etherwake` 或 `+wakeonlan`（至少一个，用于 WOL 能力）
- `ping` 工具（busybox 自带）用于在线探测
- 用户须为已登录的 LuCI 管理员

### 2.5 约束
- 后端所有对外命令执行**必须白名单化**：`exec` 仅允许 etherwake/wakeonlan（参数经 shell 转义）；`ping` 仅在 `status()` 内部使用，不对外暴露。杜绝命令注入。
- 目标为二层广播唤醒，唤醒能力取决于目标网卡 BIOS/驱动的 WOL 设置，应用不保证一定唤醒成功。
- 前端为纯客户端渲染，状态刷新通过轮询后端完成，不引入常驻守护进程。
- **ICMP 限制**：若目标设备阻止 ICMP（如防火墙丢弃 ping），状态可能显示为 `offline`（实际在线）。这是 ping 探测的固有限制。
- **IPv6 支持**：当前版本仅支持 IPv4 发现与 ping，IPv6 支持待后续版本。

---

## 3. 功能需求

### FR-1 输入 MAC 并唤醒设备
- **FR-1.1** 用户可在界面新增一条唤醒目标，字段至少包含：名称（Name）、MAC 地址（MAC）；IP 地址为**可选**——可留空，由系统经 ARP/邻居表自动发现（FR-7），也可手填以加速探测。
- **FR-1.2** MAC 输入须做格式校验（`datatype = macaddr`），非法输入阻止提交并提示。
- **FR-1.3** MAC 输入框提供 `getHostHints` 的主机提示（已知设备自动补全）。
- **FR-1.4** 每条记录提供“唤醒（Wake）”按钮，点击后：
  - 若 etherwake 可用：`etherwake [-D] [-i <iface>] [-b] [-p <password>] <mac>`
  - 否则使用 wakeonlan：`wakeonlan <mac>`
- **FR-1.5** 唤醒结果（成功/失败/命令输出）反馈到界面输出区。
- **FR-1.6** 唤醒发出后，该目标开始被持续监控（FR-3）并触发 ARP 发现流程（FR-7）。

### FR-2 打开页面即显示当前在线状态
- **FR-2.1** 视图 `load()` 阶段并行拉取：后端能力探测（stat）、ARP/邻居表与主机提示（arp/getHostHints）、UCI 记录（luci-wolmon），并**立即对所有已记录设备执行一次状态探测**（FR-3）。
- **FR-2.2** 首屏渲染时，每条记录旁显示其状态徽标（在线/离线/发现中/未知）及 MAC、IP 列。
- **FR-2.3** 状态在数据返回前显示“探测中（Checking…）”占位，避免闪烁与误判。

### FR-3 唤醒后持续探测并显示状态
- **FR-3.1** 对已记录设备，前端以**固定 5s 间隔**轮询后端 `status` 接口（不提供用户配置项）。
- **FR-3.2** 后端探测逻辑（ARP/邻居表 + ping 结合）：
  - 先查 ARP/邻居表（`/proc/net/arp`、`ip neighbor`）与 `getHostHints`，将 MAC 解析为 IP；
  - 若解析到 IP：执行 `ping -c 1 -W 1 <ip>`，可达 → `online`，不可达但 ARP 有条目 → `offline`；
  - 若 ARP 中尚无该 MAC 的 IPv4（设备未上线/刚唤醒）：状态为 `offline` 或 `discovering`，并按 FR-7 继续轮询等待其出现；
  - 完全无法解析且从未上线：`unknown`。
- **FR-3.3** UI 实时更新每条记录的 **MAC、IP、状态徽标**；状态变化（离线→在线）时，徽标短暂高亮（CSS 动画 1s）并显示 toast 通知"设备 X 已上线"（3s 后自动消失）。
- **FR-3.4** 页面不可见（切换标签/最小化）时应暂停轮询以节省资源；恢复可见时立即刷新一次。
- **FR-3.5** 轮询须为幂等只读操作，失败不阻塞界面，单次超时不影响下一轮。

### FR-4 永久记录设备
- **FR-4.1** 每条唤醒目标持久化到 UCI 配置 `luci-wolmon`（`config target` 段），保存后写入 `/etc/config/luci-wolmon`，**重启后仍存在**。
- **FR-4.2** 持久化记录字段：`name`、`mac`（必填）、`ip`（可选，FR-7 发现后回填）、`iface`（可选，etherwake 用）、`broadcast`（可选）、`password`（可选）。**仅持久化配置，不持久化状态历史**。
- **FR-4.3** 记录列表以表格（GridSection）展示，列包含：状态徽标、名称、**MAC、对应 IP**、操作（唤醒/编辑/删除）。IP 为运行时经 ARP 发现的实时值（发现后回填 UCI 以便下次直接探测）。
- **FR-4.4** 记录支持排序、编辑、去重：前端在提交新增前检查 UCI 中是否已存在相同 MAC，存在则提示用户"该 MAC 已存在"并阻止重复添加。

### FR-5 删除已记录设备
- **FR-5.1** 每条记录提供“删除（Delete）”操作，删除后从 UCI 移除并 `commit`，界面即时移除该行。
- **FR-5.2** 删除前给出确认提示，避免误删。
- **FR-5.3** 删除设备后停止对其的状态轮询。

### FR-6 依赖工具缺失处理
- **FR-6.1** 若 etherwake 与 wakeonlan 均不可用，界面显示“需要安装 WOL 工具”的提示与一键跳转软件包管理器的按钮（沿用官方交互）。
- **FR-6.2** 若 ping 不可用，状态列显示“未知（Unknown）”并说明原因，不报错崩溃。

### FR-7 唤醒后 ARP 发现 IP 并更新地址列表（关键逻辑修正）
**问题背景**：设备关机时被唤醒，此刻 ARP/邻居表中**没有**该 MAC 的条目，无法立即得到 IP，也就无法 ping。若在唤醒瞬间只查一次 ARP，会永远拿不到 IP。

- **FR-7.1** 点击“唤醒”后，除发送魔术包外，须对该 MAC 启动**轮询 ARP/邻居表**流程（复用 FR-3 的 5s 轮询），持续查找 `MAC → IPv4` 映射。
- **FR-7.2** 轮询期间该记录状态显示为”发现中（Discovering…）”，UI 提示正在等待设备上线。
- **FR-7.3** 一旦在 ARP/邻居表（或 `getHostHints`）中查到该 MAC 的 **IPv4 地址**：
  - **前端**在 `status()` 返回发现 IP 后，立即调用 `uci.set('luci-wolmon', sectionId, 'ip', discoveredIp)` + `uci.commit('luci-wolmon')` 回填到该记录的 `ip` 字段（持久化，便于重启后直接探测）；
  - UI 的 IP 列即时显示该地址；
  - 状态由”发现中”转为按 FR-3 的 ping 结果（online/offline）。
- **FR-7.4** 发现超时策略：在设定时间窗内（如 60s，可内部常量）仍未出现 IPv4，则停止“发现中”态、回退为 `offline/unknown`，但**保留记录**并继续常规 5s 轮询（下次设备上线仍会被发现）。
- **FR-7.5** 幂等与并发：前端维护一个 `discoveringMacs` 集合（Set），唤醒时加入，发现 IP 或超时后移除；同一 MAC 的发现流程不重复启动；多条记录可同时处于发现/探测中，互不阻塞。
- **FR-7.6** 安全：ARP 解析与 IP 回填仅接受合法 IPv4（`ip4addr` 校验），拒绝非法值写入 UCI。

---

## 4. 国际化需求（i18n）

- **I18N-1** 默认语言为英文（`en-US`）。所有用户可见字符串在 JS 视图中以 `_('...')` 包裹，英文原文即翻译源串（source strings）。
- **I18N-2** 提供简体中文（`zh-CN` / LuCI 中对应 `zh_Hans`）翻译文件 `po/zh_Hans/wolmon.po`。
- **I18N-3** 翻译流程遵循官方：`po/templates/wolmon.pot`（模板）→ 各语言 `po/<lang>/wolmon.po` → 构建时编译为 `.lmo`。
- **I18N-4** **跟随系统语言自动切换**：LuCI 依据系统/浏览器语言设置（`luci.main.lang` 或 HTTP `Accept-Language`）加载对应 `.lmo`；当无匹配翻译时回退到英文源串。应用不得硬编码语言。
- **I18N-5** Makefile 中通过 `LUCI_LANG` / `luci.mk` 机制声明并打包 `zh_Hans` 翻译（对应 `luci-i18n-wolmon-zh-cn`）。
- **I18N-6** 日期/时间、状态徽标文案、按钮、提示语均须走 i18n，不得出现未翻译的硬编码中文/英文字面量（日志/调试除外）。

---

## 5. 数据模型

### 5.1 UCI 配置 `/etc/config/luci-wolmon`
```
config wolmon 'defaults'
        option executable '/usr/bin/etherwake'   # 默认 WOL 程序

config target
        option name 'NAS'
        option mac '00:11:22:33:44:55'
        option ip '192.168.1.20'      # 可选；缺省时由 ARP 发现(FR-7)后回填
        option iface 'br-lan'         # 可选，etherwake 用
        option broadcast '0'          # 可选
        # option password '...'       # 可选，SecureOn 密码
```
> 注意：**不含轮询间隔配置项**（固定 5s，见 FR-3.1）。仅持久化配置，不持久化任何状态/历史。

### 5.2 状态数据（运行时，非持久化）
后端 `status` 接口对每个目标返回：
```json
{ "mac": "00:11:22:33:44:55", "ip": "192.168.1.20",
  "state": "online",           // online | offline | discovering | unknown
  "rtt_ms": 3 }                // ping 延迟（毫秒），仅 online 时有效
```
- `ip` 为 null/空表示尚未从 ARP 发现（对应 `discovering`/`unknown`）。
- `rtt_ms` 用于 UI 显示响应时间（如"在线 (3ms)"），仅 `state=online` 时有值。
- 发现到 IPv4 后，后端在 `status` 返回中带上 `ip`，前端据此回填 UCI（FR-7.3）。

---

## 6. 后端接口设计（ubus object `luci.wolmon`）

| 方法 | 参数 | 说明 | 权限 |
|------|------|------|------|
| `stat` | 无 | 返回 `{etherwake:bool, wakeonlan:bool, ping:bool}` | read |
| `exec` | `name:string, args:[]` | 白名单执行 WOL（仅 etherwake/wakeonlan），参数 shell 转义，返回 stdout/stderr/code | write |
| `arp` | 无（或 `iface:string`） | 读取 ARP/邻居表，返回 `[{mac, ipv4, ipv6, iface}]` 映射 | read |
| `status` | `targets:[{mac,ip}]` | 批量：查 ARP 解析 MAC→IP（缺失则标记 discovering）+ 对已知 IP 执行 ping，返回每目标实时状态与（新发现的）ip | read |

> 安全要求：`exec` 只接受白名单二进制与经 `shellquote` 处理的参数；`status`/`arp` 内部对每个 IP 做格式校验（`ip4addr`/`ip6addr`），拒绝非法输入；ARP 数据来源为只读的 `/proc/net/arp`、`ip neighbor`，不接受用户传入的任意命令。

---

## 7. 用户界面设计

单页面（`admin/services/wolmon`），自上而下：
1. **Map 标题区**：应用名与说明。
2. **默认设置区**（NamedSection `defaults`）：仅“默认 WOL 程序”（etherwake/wakeonlan）。**无轮询间隔配置项**（固定 5s）。
3. **设备列表区**（GridSection `target`）：
   - 列：状态徽标 | 名称 | **MAC** | **IP（对应地址）** | 操作（唤醒 / 编辑 / 删除）
   - 状态徽标：使用 CSS 类（`.status-online`/`.status-offline`/`.status-discovering`/`.status-unknown`）+ 背景色（绿/红/黄/灰），保证跨平台一致渲染
   - IP 列显示逻辑：若记录中已有 IP（手动填写或已发现），直接显示；否则显示”—/发现中”（FR-7.3 发现后即时更新）
   - 在线设备在 IP 后显示延迟（如”192.168.1.20 (3ms)”），取自 `rtt_ms`
   - 顶部”添加设备”按钮；行内”唤醒”按钮。
4. **输出区**（只读 textarea）：显示唤醒命令与结果日志。**会话级**：页面刷新后清空，不持久化。
5. 缺失 WOL 工具时，列表区替换为安装引导按钮。

交互细节：
- 状态由前端固定 5s 轮询 `status` 后局部更新徽标与 IP，不整页刷新。
- 页面隐藏时暂停轮询（FR-3.4）。
- 仅呈现实时状态，不显示任何历史时间线（最近唤醒/上线时间等）。

---

## 8. 文件结构（交付物）
```
luci-app-wolmon/
├── Makefile
├── htdocs/luci-static/resources/view/wolmon.js   # 客户端视图
├── po/
│   ├── templates/wolmon.pot                       # 翻译模板(英文源)
│   └── zh_Hans/wolmon.po                          # 简体中文翻译
└── root/
    ├── etc/config/luci-wolmon                     # UCI 默认配置
    ├── usr/share/luci/menu.d/luci-app-wolmon.json # 菜单入口
    ├── usr/share/rpcd/acl.d/luci-app-wolmon.json  # 权限
    └── usr/share/rpcd/ucode/luci.wolmon           # 后端(stat/exec/arp/status)
```

---

## 9. 非功能需求
- **NFR-1 安全**：所有命令执行白名单 + 参数转义；ACL 最小授权；防命令注入/XSS。
- **NFR-2 性能**：单次状态探测（并发批量，后端并行 ping）应在 ~2s 内返回（≤20 台设备）；轮询不阻塞 UI；固定间隔 5s（不可配置）。
- **NFR-3 可靠性**：后端探测失败/超时须优雅降级为 offline/unknown；前端轮询异常自动恢复。
- **NFR-4 兼容性**：与官方 LuCI master（25.12.x）客户端视图架构一致；busybox ping 可用。
- **NFR-5 可维护性**：复用官方模式与命名；字符串全部走 i18n；代码无冗余注释。
- **NFR-6 资源占用**：无常驻守护进程，不额外占用路由器有限资源。
- **NFR-7 可扩展性**：建议支持 ≤50 台设备，超过可能影响性能（ping 并发数受限、UI 渲染变慢）。

---

## 10. 验收标准
| 编号 | 验收项 |
|------|--------|
| AC-1 | 输入合法 MAC 点击唤醒，能发送魔术包并在输出区看到结果；非法 MAC 被拦截 |
| AC-2 | 打开页面后数秒内，所有已记录设备显示正确的在线/离线状态，且列表显示每个设备的 MAC 与对应 IP |
| AC-3 | 唤醒一台关机设备后，其状态先显示“发现中”，待 ARP/邻居表出现该 MAC 的 IPv4 后自动回填 IP 列并将状态转为在线 |
| AC-4 | 已记录设备在路由器重启后仍然存在（持久化生效）；发现的 IP 已回填并保留 |
| AC-5 | 删除某设备后，该行消失、停止轮询，重启后不再出现 |
| AC-6 | 系统语言设为中文时界面为中文，设为英文（或无翻译语言）时为英文，切换后刷新即生效 |
| AC-7 | 未安装 etherwake/wakeonlan 时显示安装引导而非报错 |
| AC-8 | 后端拒绝白名单外命令与非法 IP 参数（安全测试通过） |
| AC-9 | 界面不显示任何历史时间信息，仅呈现实时状态；轮询固定 5s 且无用户配置项 |

---

## 11. 已确认决策（原待确认事项）
1. **轮询间隔**：固定 5s，不提供用户配置项（FR-3.1、§5.1 不含 interval）。
2. **探测方式**：ARP/邻居表 + ping 结合（FR-3.2、`arp`/`status` 后端方法），对未分配 IP 的设备更鲁棒。
3. **历史数据**：仅显示实时状态，不记录/展示最近唤醒或上线时间（FR-4.2、§7）。
4. **包名**：采用 `luci-app-wolmon`（UCI `luci-wolmon`、ubus `luci.wolmon`、翻译 `luci-i18n-wolmon-zh-cn`），与官方 `luci-app-wol` 共存不冲突。
5. **唤醒后 IP 发现**：新增 FR-7，唤醒后轮询 ARP/邻居表获取该 MAC 的 IPv4，发现后回填地址列表（UCI + UI），再转 ping 探测；含发现超时回退与并发/幂等约束。
6. **UI 列表**：显示每个客户端的 MAC 与对应 IP 地址（§7）。
```
