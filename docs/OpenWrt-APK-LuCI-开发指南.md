# OpenWrt APK / LuCI 应用开发指南（离线速查手册）

> 目的：作为本地离线参考，覆盖 OpenWrt 软件包（apk）与 LuCI Web 应用的开发全流程，供后续开发其他应用时直接查阅，避免反复联网检索。
> 基准：OpenWrt 25.x / LuCI master（客户端 JavaScript 视图架构）。
> **重要（25.x 变更）**：OpenWrt 自 25.12 起将包管理器由 `opkg` 全面切换为 **`apk`（Alpine Package Keeper）**，软件包格式由 `.ipk` 改为 **`.apk`**，包索引由 `Packages.gz` 改为 `packages.adb`。旧的 opkg 分支已停止维护。**24.10 及更早仍用 opkg/ipk**。本文以 25.x（apk）为准，并在需要处标注 opkg 对应写法。
> 说明：命令以 buildroot（源码编译环境，Linux）为准；`$` 表示 shell 提示符。

---

## 目录
1. [基础概念](#1-基础概念)
2. [构建系统与 feeds](#2-构建系统与-feeds)
3. [源码包 Makefile 详解](#3-源码包-makefile-详解)
4. [LuCI 应用与 luci.mk](#4-luci-应用与-lucimk)
5. [LuCI 应用目录结构](#5-luci-应用目录结构)
6. [客户端 JS 视图（view.extend）](#6-客户端-js-视图viewextend)
7. [前端常用模块 API](#7-前端常用模块-api)
8. [后端：ucode rpcd 脚本](#8-后端ucode-rpcd-脚本)
9. [ACL 权限配置](#9-acl-权限配置)
10. [菜单入口 menu.d](#10-菜单入口-menud)
11. [UCI 配置](#11-uci-配置)
12. [国际化 i18n（po/lmo）](#12-国际化-i18npolmo)
13. [构建、安装、部署 apk](#13-构建安装部署-apk)
14. [调试技巧](#14-调试技巧)
15. [安全要点](#15-安全要点)
16. [完整可复制模板骨架](#16-完整可复制模板骨架)
17. [速查表 Cheat Sheet](#17-速查表-cheat-sheet)

---

## 1. 基础概念

### 1.1 OpenWrt 三层结构
- **buildroot**：OpenWrt 源码编译系统（基于 Make），产出固件与 apk 包（25.x；旧版为 ipk）。
- **apk**：25.x 设备上的包管理器（Alpine Package Keeper），安装 `.apk` 包；旧版（≤24.10）为 `opkg` + `.ipk`。
- **LuCI**：Web 管理界面框架，采用 MVC 变体：
  - Model：数据（UCI 配置 / ubus 数据）
  - View：UI（现代方式 = 客户端 JS `.js`；传统方式 = Lua `.htm` 模板）
  - Controller：路由与业务逻辑（现代方式由前端 JS + rpcd 后端承担；传统方式用 Lua controller）

### 1.2 现代 vs 传统 LuCI
| 维度 | 传统（Lua） | 现代（JS，推荐） |
|------|-------------|------------------|
| 路由 | `controller/*.lua` `index()` `entry()` | `menu.d/*.json` 声明式 |
| 视图 | `view/*.htm` 服务端渲染 | `htdocs/.../view/*.js` 客户端渲染 |
| 表单 | Lua CBI | JS `form.*`（CBI 的客户端实现） |
| 后端 | Lua + `luci.sys.call` | ucode rpcd 脚本 + ubus |
| 优点 | 老教程多 | 交互流畅、官方新应用标准 |

**新开发一律采用现代 JS 方式。** 本文以官方 `luci-app-wol` 为范例。

### 1.3 关键运行时组件
- **ubus**：进程间总线。前端 `rpc.declare` → uHTTPd/rpcd → ubus object 方法。
- **rpcd**：ubus 上的 RPC 守护进程；加载 `acl.d`（权限）、`/usr/share/rpcd/ucode/*`（ucode 后端）。
- **uhttpd**：Web 服务器，托管 LuCI 静态资源与 `/ubus` JSON-RPC 端点。
- **UCI**：`/etc/config/*` 统一配置，`uci` 命令读写，前端 `uci.load/get/set/save/commit`。

---

## 2. 构建系统与 feeds

### 2.1 目录布局（buildroot 顶层）
```
openwrt/
├── package/          # 内置软件包（每个含 Makefile）
│   └── feeds/        # 由 feeds 安装的第三方包软链接
├── feeds/            # feed 源（luci, packages, routing ...）
├── feeds.conf.default
├── rules.mk          # 全局变量与规则
├── scripts/feeds     # feed 管理脚本
├── bin/packages/<arch>/  # 编译产出的 apk（旧版为 ipk）
└── tmp/
```

### 2.2 feed 常用命令
```
$ ./scripts/feeds update -a          # 拉取所有 feed 索引
$ ./scripts/feeds install -a         # 安装全部到 package/feeds
$ ./scripts/feeds install -a -p luci # 仅安装 luci feed
$ ./scripts/feeds search wol         # 搜索包
$ ./scripts/feeds list -f            # 列出 feed
```

### 2.3 放置自定义包的两种方式
1. **直接放入 `package/`**（本地开发最快）：`package/luci-app-xxx/`
2. **作为 feed**：在 `feeds.conf.default` 添加本地 feed，再 `feeds install`。

LuCI 应用惯例放在 luci feed：`feeds/luci/applications/luci-app-xxx/`。

### 2.4 编译
```
$ make menuconfig                    # 图形化选择包/固件
$ make -j$(nproc)                    # 全量编译
# 只编译某个包：
$ make package/luci-app-xxx/{clean,compile} V=s
# luci feed 内的应用：
$ make package/feeds/luci/luci-app-xxx/{clean,compile} V=s
```
产物（25.x）：`bin/packages/<arch>/<feed>/luci-app-xxx-<version>-r<release>.<arch>.apk`
（旧版为 `luci-app-xxx_<version>-<release>_<arch>.ipk`；apk 文件名用 `-` 分隔并带架构后缀，索引文件为 `packages.adb`）

---

## 3. 源码包 Makefile 详解

### 3.1 通用软件包 Makefile 模板
```makefile
include $(TOPDIR)/rules.mk

PKG_NAME:=mypkg
PKG_VERSION:=1.0
PKG_RELEASE:=1

PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://example.com/download
PKG_HASH:=<sha256>

PKG_LICENSE:=GPL-2.0
PKG_MAINTAINER:=You <you@example.com>

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk

define Package/mypkg
  SECTION:=net
  CATEGORY:=Network
  TITLE:=My package short title
  URL:=https://example.com
  DEPENDS:=+libuci +luci-base
endef

define Package/mypkg/description
  Long description shown in menuconfig.
endef

# 编译步骤（若为纯脚本包可省略）
define Build/Compile
	$(MAKE) -C $(PKG_BUILD_DIR) \
		CC="$(TARGET_CC)" CFLAGS="$(TARGET_CFLAGS)"
endef

# 安装步骤：把文件放进 $(1)（即软件包根目录，最终打包为 .apk）
define Package/mypkg/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/mypkg $(1)/usr/bin/
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/mypkg.conf $(1)/etc/config/mypkg
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/mypkg.init $(1)/etc/init.d/mypkg
endef

$(eval $(call BuildPackage,mypkg))
```

### 3.2 关键变量/函数
| 名称 | 说明 |
|------|------|
| `$(TOPDIR)/rules.mk` | 全局规则，务必第一行 include |
| `$(INCLUDE_DIR)/package.mk` | 软件包通用逻辑 |
| `PKG_RELEASE` | 包自身修订号（源码不变但打包改动时递增） |
| `PKG_HASH` | 源码校验（缺失会警告/失败） |
| `SECTION/CATEGORY` | menuconfig 分类 |
| `DEPENDS` | 依赖，`+pkg` 强制，`+pkg:COND` 条件依赖 |
| `$(INSTALL_DIR)` | `install -d`（建目录，权限 0755） |
| `$(INSTALL_BIN)` | `install -m 0755`（可执行） |
| `$(INSTALL_DATA)` | `install -m 0644`（数据） |
| `$(INSTALL_CONF)` | `install -m 0600`（配置，含敏感信息） |
| `$(eval $(call BuildPackage,name))` | 收尾，注册包（buildroot 签名） |

### 3.3 依赖语法
```
DEPENDS:=+luci-base +etherwake        # 强依赖
DEPENDS:=+kmod-nf-nathelper:arm       # 仅 arm 架构
DEPENDS:=+libfoo @!SMALL_FLASH        # 符号条件
```
`+` 表示选中本包时自动选中依赖。

---

## 4. LuCI 应用与 luci.mk

LuCI 应用是一种特殊软件包，通过 include `luci.mk` 简化打包（自动处理 htdocs/root/po 安装、语言子包生成等）。

### 4.1 LuCI 应用 Makefile（真实范例，来自 luci-app-wol）
```makefile
include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI Support for Wake-on-LAN
LUCI_DEPENDS:=+luci-base +etherwake

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Jo-Philipp Wich <jo@mein.io>

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
```

### 4.2 luci.mk 常用变量
| 变量 | 说明 |
|------|------|
| `LUCI_TITLE` | 应用标题（显示在软件包管理/menuconfig） |
| `LUCI_DESCRIPTION` | 描述 |
| `LUCI_DEPENDS` | 依赖（同 DEPENDS 语法，常含 `+luci-base`） |
| `LUCI_PKGARCH` | 架构（纯前端可设 `all`） |
| `LUCI_LANG.<code>` | 声明翻译语言子包，如 `LUCI_LANG.zh_Hans:=简体中文` |
| `LUCI_LANG_zh_Hans` | 旧写法（部分版本） |
| `PKG_LICENSE` / `PKG_MAINTAINER` | 许可/维护者 |

> `include ../../luci.mk` 的相对路径取决于包在 luci feed 中的位置（`applications/luci-app-xxx/` → `../../luci.mk`）。放入 `package/` 时用 `$(TOPDIR)/feeds/luci/luci.mk` 或调整路径。

### 4.3 语言子包命名
- 主包：`luci-app-xxx`
- 翻译包：`luci-i18n-xxx-<lang>`，如 `luci-i18n-wol-zh-cn`（对应 `po/zh_Hans`）。
luci.mk 会为每个 `LUCI_LANG.*` 自动生成翻译子包。

---

## 5. LuCI 应用目录结构

标准布局（现代 JS 应用）：
```
luci-app-xxx/
├── Makefile
├── htdocs/
│   └── luci-static/
│       └── resources/
│           └── view/
│               └── xxx.js                 # 客户端视图（核心）
├── po/
│   ├── templates/xxx.pot                  # 翻译模板（英文源串）
│   └── zh_Hans/xxx.po                     # 简体中文翻译
└── root/                                  # 原样安装到设备根 /
    ├── etc/
    │   ├── config/xxx                     # UCI 默认配置
    │   └── uci-defaults/xxx               # 首次启动执行的初始化脚本(可选)
    ├── usr/
    │   ├── share/
    │   │   ├── luci/menu.d/xxx.json       # 菜单入口
    │   │   └── rpcd/acl.d/xxx.json        # 权限
    │   ├── share/rpcd/ucode/xxx           # ucode 后端(可选)
    │   └── libexec/rpcd/xxx               # 传统后端脚本位置(可选)
    └── www/                               # 额外静态资源(可选)
```

**root/ 下路径 = 设备绝对路径**（`root/etc/config/xxx` → `/etc/config/xxx`）。luci.mk/打包会自动映射。

---

## 6. 客户端 JS 视图（view.extend）

### 6.1 基本骨架
```js
'use strict';
'require view';
'require uci';
'require ui';
'require rpc';
'require form';
'require tools.widgets as widgets';

return view.extend({
	// 视图级属性/状态
	load() {
		// 返回 Promise，页面渲染前并行拉取数据
		return Promise.all([
			uci.load('xxx'),
			this.callSomeRpc()
		]);
	},

	render(data) {
		// 用 load() 的结果构建并返回 DOM/Map
		let m, s, o;
		m = new form.Map('xxx', _('Title'), _('Description'));
		s = m.section(form.NamedSection, 'defaults', 'xxx', _('Settings'));
		o = s.option(form.Value, 'name', _('Name'));
		return m.render();
	}
});
```

### 6.2 生命周期
1. `load()`：页面加载时调用一次，返回 Promise，用于拉取 UCI/ubus 数据。
2. `render(results)`：`load()` resolve 后调用，参数是 `load()` 返回值，返回要渲染的节点。
3. 表单保存：用户点 Save → `form.Map` 自动 `uci.save()` + `uci.commit()`（经 ubus）。

### 6.3 声明 RPC 调用
```js
callExec: rpc.declare({
	object: 'luci.xxx',      // ubus object 名
	method: 'exec',          // 方法名
	params: ['name', 'args'],// 参数名数组（对应后端 request.args.<name>）
	expect: {}               // 期望返回结构（{} 表示对象）
}),
```
调用：`this.callExec(name, args).then(res => ...)`。

### 6.4 事件绑定
```js
'click': ui.createHandlerFn(this, 'handleSomething', arg1)
// 或
'click': ui.createHandlerFn(this, function(ev) { ... })
```
`ui.createHandlerFn` 会在执行期间禁用按钮并显示 loading，自动处理异常。

### 6.5 手动构建 DOM
```js
E('div', { 'class': 'cbi-section' }, [
	E('h3', {}, _('Title')),
	E('button', { 'class': 'btn cbi-button-action',
		'click': ui.createHandlerFn(this, 'handleX') }, [_('Click')])
])
```
`E(tag, attrs, children)` 是 LuCI 的 DOM 构造助手。

---

## 7. 前端常用模块 API

### 7.1 require 的模块
| 模块 | 用途 |
|------|------|
| `view` | 视图基类，`view.extend({...})` |
| `form` | CBI 表单组件（Map/Section/Option） |
| `uci` | UCI 读写：`load/get/set/add/delete/save/commit/apply` |
| `rpc` | `rpc.declare` 声明 ubus 调用 |
| `ui` | UI 助手：`createHandlerFn`、`showModal`、`hideModal`、通知等 |
| `fs` | 文件操作（经后端） |
| `tools.widgets` | 高级控件：`DeviceSelect`、`NetworkSelect`、`ZoneSelect` 等 |
| `luci`（全局 `L`） | `L.url()`、`L.bind()`、`L.resolveDefault()`、`L.toArray()`、`L.sortedKeys()`、`_.format` |

### 7.2 form 组件类型
**Map**
```js
m = new form.Map('configname', _('Title'), _('Desc'));
m.readonly = false;
```
**Section 类型**
- `form.NamedSection(name, type, title, desc)`：固定命名段
- `form.TypedSection(type, title, desc)`：某类型所有段
- `form.GridSection(type, title, desc)`：表格网格（适合列表，带增删改）
- `form.TableSection(...)`：表格
- `form.JSONMap(...)`：JSON 数据源

GridSection 常用属性：
```js
s.addremove = true;    // 允许增删
s.anonymous = true;    // 匿名段（自动生成 id）
s.sortable = true;     // 可排序
s.nodescriptions = true;
s.modaltitle = L.bind(function(sid){ return _('Edit') + ': ' + uci.get('cfg', sid, 'name'); }, this);
```

**Option 类型**
| 类型 | 用途 |
|------|------|
| `form.Value` | 单行文本 |
| `form.TextValue` | 多行文本 |
| `form.PasswordValue` | 密码 |
| `form.Flag` | 开关（0/1） |
| `form.ListValue` | 下拉单选，`o.value(v, label)` |
| `form.MultiValue` | 多选 |
| `form.DynamicList` | 动态列表 |
| `form.Button` | 按钮 |
| `form.DummyValue` | 只读展示（可 rawhtml） |

Option 常用属性：
```js
o.rmempty = false;              // 不允许空
o.datatype = 'macaddr';         // 校验类型
o.default = '...';
o.placeholder = '...';
o.value('v', 'Label');          // ListValue 选项
o.onchange = function(ev, sid, val){ ... };
o.cfgvalue / o.write / o.remove // 自定义读写
```

**datatype 常见值**：`string`、`integer`、`uinteger`、`float`、`bool`、`ip4addr`、`ip6addr`、`ipaddr`、`macaddr`、`port`、`portrange`、`hostname`、`and(...)`、`or(...)`、`negate`、`min(x)`、`max(x)`、`range(a,b)`、`cidr4`、`list(type)`。
组合示例：`o.datatype = 'or(macaddr,ip4addr("nomask"))'`。

### 7.3 widgets（tools.widgets）
```js
o = s.option(widgets.DeviceSelect, 'iface', _('Interface'));
o.noaliases = true; o.noinactive = true;   // 需要 getNetworkDevices ACL
o = s.option(widgets.NetworkSelect, 'network', _('Network'));
o = s.option(widgets.ZoneSelect, 'zone', _('Zone'));
```

### 7.4 uci API
```js
uci.load('xxx');                       // 加载配置(返回 Promise)
uci.get('xxx', section, option);       // 读
uci.set('xxx', section, option, val);  // 写(暂存)
uci.add('xxx', 'type');                // 新增匿名段, 返回 sid
uci.delete('xxx', section[, option]);
uci.save('xxx');                       // 提交到 /tmp/.uci 暂存
uci.commit('xxx');                     // 落盘 /etc/config
uci.apply('xxx');                      // 保存并应用(触发 reload)
uci.sections('xxx', 'type');           // 遍历某类型所有段
uci.foreach('xxx','type',function(s){});
```

---

## 8. 后端：ucode rpcd 脚本

ucode 是 OpenWrt 的脚本语言（类 JS 语法），用于编写 rpcd 后端，注册为 ubus object 供前端调用。放置于 `/usr/share/rpcd/ucode/<name>`（可执行）。

### 8.1 完整范例（luci-app-wol 官方后端 + 扩展 ping/status）
```ucode
#!/usr/bin/ucode
'use strict';

import { access, popen } from 'fs';

const etherwake = '/usr/bin/etherwake';
const wakeonlan = '/usr/bin/wakeonlan';
const pingbin   = '/bin/ping';

function shellquote(s) {
	return "'" + replace(s, "'", "'\\''") + "'";
}

// 校验 IPv4，防注入
function is_ip4(s) {
	return match(s, /^(\d{1,3}\.){3}\d{1,3}$/) != null;
}

const methods = {
	stat: {
		call: function(request) {
			return {
				etherwake: access(etherwake, "x") ? true : false,
				wakeonlan: access(wakeonlan, "x") ? true : false,
				ping:      access(pingbin, "x") ? true : false
			};
		}
	},

	exec: {
		args: { name: 'string', args: [] },
		call: function(request) {
			const result = { stdout: '', stderr: '', code: 1 };
			// 白名单：仅允许 etherwake/wakeonlan
			if (request.args.name == etherwake || request.args.name == wakeonlan) {
				let parts = map(request.args.args, shellquote);
				const fd = popen(request.args.name + ' ' + join(' ', parts));
				result.stdout = fd.read('all');
				result.code = fd.close();
			} else {
				result.stderr = 'disallowed';
			}
			return result;
		}
	},

	// 单个 IP ping
	ping: {
		args: { ip: 'string', count: 'int', timeout: 'int' },
		call: function(request) {
			const ip = request.args.ip;
			if (!is_ip4(ip)) return { state: 'unknown', reason: 'invalid-ip' };
			const c = request.args.count || 1;
			const t = request.args.timeout || 1;
			const fd = popen(pingbin + ' -c ' + c + ' -W ' + t + ' ' + shellquote(ip) + ' 2>/dev/null');
			const out = fd.read('all');
			fd.close();
			// busybox ping 成功时含 "bytes from"
			const online = index(out, 'bytes from') >= 0 || index(out, 'seq=') >= 0;
			return { ip: ip, state: online ? 'online' : 'offline', raw: out };
		}
	}
};

return { "luci.wol": methods };
```

### 8.2 ucode 要点
- 文件首行 shebang `#!/usr/bin/ucode`，且需可执行权限。
- 末尾 `return { "<object名>": methods };` 注册 ubus object。
- 每个方法：`args`（参数类型声明）+ `call(request)`；参数在 `request.args.<name>`。
- `args` 类型：`'string'`、`'int'`、`'bool'`、`[]`（数组）、`{}`（对象）。
- 常用内建：`access/stat/popen/readfile/writefile`（`fs`）、`map/filter/join/split/index/replace/match/length/type`。
- `popen()` 返回文件描述符对象，`.read('all')` 读全部，`.close()` 返回退出码。
- 修改后端后需重启 rpcd：`/etc/init.d/rpcd restart`。

### 8.3 传统后端（可执行脚本，非 ucode）
也可用任意可执行脚本（放在 `/usr/libexec/rpcd/`），输出 JSON 注册 ubus。ucode 是官方新标准，优先使用。

---

## 9. ACL 权限配置

路径：`root/usr/share/rpcd/acl.d/<app>.json`。声明登录用户经 rpcd 可访问的 ubus/uci 资源。**最小权限原则**。

### 9.1 范例
```json
{
	"luci-app-xxx": {
		"description": "Grant access to xxx",
		"read": {
			"ubus": {
				"luci.xxx": [ "stat", "ping", "status" ],
				"luci-rpc": [ "getHostHints", "getNetworkDevices" ]
			},
			"uci": [ "xxx" ]
		},
		"write": {
			"ubus": {
				"luci.xxx": [ "exec" ],
				"uci": [ "add", "set", "delete", "order", "commit", "apply" ]
			},
			"uci": [ "xxx" ]
		}
	}
}
```

### 9.2 说明
- 顶层 key（`luci-app-xxx`）= ACL 组名，menu.d 的 `depends.acl` 引用它。
- `read`/`write` 分别声明只读/写权限。
- `ubus` 下按 object 名列出允许的方法数组。
- `uci` 列出允许读写的配置文件名。
- `luci-rpc` 是内置 object，提供 `getHostHints`（MAC↔IP/主机名）、`getNetworkDevices`、`getSystemInfo`、`getBoardInfo` 等。
- 修改后 `/etc/init.d/rpcd restart`（或重登）生效。

---

## 10. 菜单入口 menu.d

路径：`root/usr/share/luci/menu.d/<app>.json`。声明式定义菜单项与路由，替代传统 Lua controller。

### 10.1 范例
```json
{
	"admin/services/xxx": {
		"title": "My App",
		"order": 90,
		"action": {
			"type": "view",
			"path": "xxx"
		},
		"depends": {
			"acl": [ "luci-app-xxx" ]
		}
	}
}
```

### 10.2 字段说明
| 字段 | 说明 |
|------|------|
| key（`admin/services/xxx`） | 菜单路径；`admin/services`、`admin/network`、`admin/system`、`admin/status` 等 |
| `title` | 菜单显示名（可 i18n，前端翻译） |
| `order` | 同级排序（数字小在前） |
| `action.type` | `view`（加载 JS 视图）/ `template` / `call` / `firstchild` |
| `action.path` | 视图路径，对应 `htdocs/.../view/<path>.js`（`xxx` → `view/xxx.js`；子目录用 `/`） |
| `depends.acl` | 需要的 ACL 组，未授权则隐藏 |
| `depends.uci` | 需要存在的 UCI 配置 |

---

## 11. UCI 配置

### 11.1 默认配置文件
路径：`root/etc/config/<name>`（安装到 `/etc/config/<name>`）。
```
config xxx 'defaults'
	option enabled '1'
	option interval '5'

config target
	option name 'NAS'
	option mac '00:11:22:33:44:55'
```
- `config <type> [<name>]`：命名段带 name，匿名段省略 name。
- `option <key> '<value>'`：单值；`list <key> '<v>'`：列表项。

### 11.2 uci-defaults 初始化脚本
路径：`root/etc/uci-defaults/<name>`，首次启动（或包安装后首次）执行一次，执行成功后被删除。常用于设置默认值、启用服务：
```sh
#!/bin/sh
uci -q get xxx.defaults >/dev/null || {
	uci add xxx xxx >/dev/null
	uci commit xxx
}
exit 0
```

### 11.3 命令行操作
```
$ uci show xxx                 # 查看全部
$ uci get xxx.defaults.interval
$ uci set xxx.defaults.interval='10'
$ uci add xxx target           # 新增匿名段
$ uci delete xxx.@target[0]
$ uci commit xxx               # 落盘
$ uci changes                  # 查看暂存改动
```

---

## 12. 国际化 i18n（po/lmo）

### 12.1 机制
- 前端所有用户可见字符串用 `_('...')` 包裹，**英文原文即源串**。
- `po/templates/<app>.pot`：翻译模板（含所有源串）。
- `po/<lang>/<app>.po`：各语言翻译（如 `po/zh_Hans/<app>.po`）。
- 构建时编译为 `.lmo`（二进制），安装到 `/usr/lib/lua/luci/i18n/` 或 `/usr/share/luci/lmo/`。
- LuCI 依据系统语言（`uci get luci.main.lang` 或浏览器 `Accept-Language`）加载对应 `.lmo`；**无匹配则回退英文源串**。因此英文天然作为默认语言，无需单独 en 文件。

### 12.2 po 文件格式
```po
msgid ""
msgstr ""
"Language: zh_Hans\n"
"Content-Type: text/plain; charset=UTF-8\n"

#: applications/luci-app-xxx/htdocs/.../view/xxx.js
msgid "Wake on LAN"
msgstr "网络唤醒"

msgid "Online"
msgstr "在线"

msgid "Offline"
msgstr "离线"

#, c-format
msgid "Install %s"
msgstr "安装 %s"
```
- `msgid` = 源串（英文）；`msgstr` = 译文。
- 带占位符用 `%s`/`%d`，前端配合 `'...'.format(x)`。
- 复数：`msgid_plural` + `msgstr[0]/[1]`。

### 12.3 语言代码
| 语言 | LuCI 目录名 | 说明 |
|------|-------------|------|
| 简体中文 | `zh_Hans` | 对应 i18n 包 `luci-i18n-xxx-zh-cn` |
| 繁体中文 | `zh_Hant` | `luci-i18n-xxx-zh-tw` |
| 英文 | （源语言，无目录） | 默认 |

### 12.4 Makefile 声明翻译
```makefile
LUCI_LANG.zh_Hans:=简体中文
# 或旧写法： LUCI_LANG_zh_Hans:=简体中文
```
luci.mk 会为每个声明的语言生成 `luci-i18n-xxx-<lang>` 子包。

### 12.5 工作流
1. 在 JS 中用 `_('...')` 写英文源串。
2. 生成/更新 `po/templates/xxx.pot`（可用 luci 的 `i18n-scan` 或手动）。
3. 复制 pot 为 `po/zh_Hans/xxx.po`，填写 `msgstr` 中文。
4. 编译时自动打包为 lmo；设备上切换语言即生效。

---

## 13. 构建、安装、部署 apk

> 25.x 用 `apk` + `.apk`；≤24.10 用 `opkg` + `.ipk`。以下以 apk 为准，括号内给出 opkg 对应写法。

### 13.1 buildroot 编译（见 §2.4）
产出 apk 于 `bin/packages/<arch>/<category>/`，文件名形如 `luci-app-xxx-1.0-r1.all.apk`；同目录生成索引 `packages.adb`。
- **源码包 Makefile 格式基本不变**（仍 `include $(TOPDIR)/rules.mk` + `$(eval $(call BuildPackage,name))`），只是构建系统产出 apk 而非 ipk。
- apk 版本串用 `~` 分隔上游版本与 git 快照，如 `1.0~abc1234-r1`；`PKG_RELEASE` 对应 `-rN`。
- 纯前端/脚本包可设 `PKGARCH:=all`（LuCI 应用常由 luci.mk 处理为 all）。

### 13.2 SDK 编译（无需全量源码）
下载对应架构的 OpenWrt SDK，把包放进 `package/`，`make package/xxx/{clean,compile} V=s`，产物同样为 `.apk`。

### 13.3 设备上安装
```sh
# 方式一：从本地 .apk 安装（自建包通常未签名，需 --allow-untrusted）
$ apk add --allow-untrusted /tmp/luci-app-xxx-1.0-r1.all.apk
$ apk add luci-i18n-xxx-zh-cn                 # 翻译子包(可选，来自仓库)
# 离线/禁止联网刷新索引：
$ apk add --allow-untrusted --repositories-file /dev/null /tmp/xxx.apk

# 方式二：从已配置的软件源安装
$ apk update
$ apk add luci-app-xxx

# 方式三：手动铺文件(开发调试最快)
把 root/ 下文件 scp 到设备对应路径，htdocs 的 js 放到
/www/luci-static/resources/view/xxx.js
然后：
$ /etc/init.d/rpcd restart
$ rm -rf /tmp/luci-*        # 清 LuCI 缓存
$ 重新登录 LuCI
```
> **签名要求**：apk 默认要求所有包有合法签名；自建/第三方未签名包必须加 `--allow-untrusted`（opkg 对本地包无此要求）。

### 13.4 软件源（repositories）配置
- apk 源目录：`/etc/apk/repositories.d/`，主源文件 `distfeeds.list`（旧版 opkg 为 `/etc/opkg/distfeeds.conf` 或 `/etc/opkg.conf`）。
- 换国内镜像示例：
  ```sh
  $ sed -i 's|downloads.openwrt.org|mirrors.tuna.tsinghua.edu.cn/openwrt|g' /etc/apk/repositories.d/distfeeds.list
  $ apk update
  ```

### 13.5 升级注意事项（重要）
- **切勿用 `apk upgrade` 升级系统包**——多个包（`hostapd-*`、`wpad-*`、`ucode-mod-*`、各类库）存在依赖/冲突声明不全，盲目升级可能变砖。
- 安全升级方式：LuCI **Attended Sysupgrade (ASU)**、命令行 **`owut`**、或 **Firmware Selector** 重建镜像。

### 13.6 前端 JS 部署位置
- 源码：`htdocs/luci-static/resources/view/xxx.js`
- 设备安装后：`/www/luci-static/resources/view/xxx.js`
浏览器请求 `/luci-static/resources/view/xxx.js` 加载。

### 13.7 opkg → apk 命令对照（速查）
| 用途 | apk (25.x) | opkg (≤24.10) |
|------|------------|----------------|
| 刷新软件源 | `apk update` | `opkg update` |
| 安装 | `apk add pkg` | `opkg install pkg` |
| 卸载 | `apk del pkg` | `opkg remove pkg` |
| 更新并安装 | `apk --update-cache add pkg` | `opkg update && opkg install pkg` |
| 试运行(不改动) | `apk add --simulate pkg` / `apk del --simulate pkg` | （无） |
| 列出全部可用 | `apk list` | `opkg list` |
| 列出已安装 | `apk list --installed [P]` / `apk info` | `opkg list-installed` |
| 可升级列表 | `apk list --upgradeable [P]` | `opkg list-upgradable` |
| 谁提供 X | `apk list --providers X` | `opkg -A whatprovides X` |
| 包信息 | `apk info P` / `apk info --all P` | `opkg info P` |
| 包内文件 | `apk info --contents P` | `opkg files P` |
| 文件属于哪个包 | `apk info --who-owns <file>` | `opkg search <file>` |
| 依赖 | `apk info --depends P` | `opkg depends P` |
| 反向依赖 | `apk info --rdepends P` | `opkg whatdepends P` |
| 解包 | `apk extract --allow-untrusted P` | `tar -xvf P` |
| 指定根目录操作 | `apk -p <root> ...` | `opkg -d <dest> ...` |
> `[P]` 为文件通配模式（如 `*dns*`）。`P` 大小写敏感按包名。
> 25.12 首次 SSH 登录会显示 apk 速查提示；关闭：删除/移动 `/etc/profile.d/apk-cheatsheet.sh`。
> 常见告警 `WARNING: opening from cache … No such file` 多为本地索引缺失/过期，`apk update` 即可；不影响安装时可忽略。

---

## 14. 调试技巧

### 14.1 前端
- 浏览器 DevTools → Console 看 JS 报错；Network 看 `/ubus` 请求与响应。
- `require('ui')` 的 `ui.showModal`/通知用于临时提示。
- LuCI 静态资源有缓存：改 JS 后强刷（Ctrl+F5）或清 `/tmp/luci-*`。

### 14.2 后端 / ubus
```
$ ubus list                       # 列出所有 object，确认 luci.xxx 已注册
$ ubus -v list luci.xxx           # 查看方法
$ ubus call luci.xxx stat '{}'    # 命令行直接调用测试
$ ubus call luci.xxx ping '{"ip":"192.168.1.1"}'
$ logread -f                      # 系统日志(rpcd/ucode 报错在此)
$ /etc/init.d/rpcd restart        # 改后端后重启
```

### 14.3 UCI
```
$ uci show xxx
$ uci changes        # 未提交改动
$ uci commit xxx
```

### 14.4 常见坑
| 现象 | 原因/解决 |
|------|-----------|
| 菜单不显示 | menu.d JSON 语法错 / ACL 未授权 / rpcd 未重启 |
| 前端 404 加载 view | menu.d `action.path` 与 js 文件名不符 |
| ubus 调用 permission denied | ACL 未声明该方法 read/write |
| 改了 JS 不生效 | 浏览器/LuCI 缓存，强刷或清 `/tmp/luci-*` |
| ucode 后端不加载 | 缺 shebang / 无执行权限 / 语法错（看 logread） |
| 翻译不生效 | po 未编译进包 / 语言码目录名错 / 未切系统语言 |
| `module 'luci.cbi' not found` | 混用了传统 Lua 方式但缺依赖，改用现代 JS |

---

## 15. 安全要点

1. **命令执行白名单**：后端 `exec`/`ping` 只允许固定二进制路径，拒绝任意命令。
2. **参数转义**：所有拼进 shell 的参数经 `shellquote`（单引号包裹 + 转义内部单引号）。
3. **输入校验**：IP 用正则/`ip4addr` 校验，MAC 用 `macaddr`，端口用 `port`；拒绝非法输入。
4. **最小 ACL**：只授予必需 ubus 方法与 UCI 文件；读写分离。
5. **防 XSS**：前端展示外部数据用 `E()`/文本节点，避免 `rawhtml` 拼接未净化内容。
6. **敏感配置**：含密码的配置用 `$(INSTALL_CONF)`（0600）。
7. **避免命令注入链**：不要把用户输入直接传给 `popen`/`system`。

---

## 16. 完整可复制模板骨架

> 复制以下结构，把 `xxx` 换成应用名即可起步。

### 16.1 `Makefile`
```makefile
include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI Support for XXX
LUCI_DEPENDS:=+luci-base
LUCI_LANG.zh_Hans:=简体中文

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=You <you@example.com>

include ../../luci.mk
# call BuildPackage - OpenWrt buildroot signature
```

### 16.2 `root/usr/share/luci/menu.d/luci-app-xxx.json`
```json
{
	"admin/services/xxx": {
		"title": "XXX",
		"order": 90,
		"action": { "type": "view", "path": "xxx" },
		"depends": { "acl": [ "luci-app-xxx" ] }
	}
}
```

### 16.3 `root/usr/share/rpcd/acl.d/luci-app-xxx.json`
```json
{
	"luci-app-xxx": {
		"description": "Grant access to xxx",
		"read":  { "ubus": { "luci.xxx": [ "stat" ] }, "uci": [ "xxx" ] },
		"write": { "ubus": { "luci.xxx": [ "exec" ] },
		           "uci": [ "add", "set", "delete", "commit", "apply" ] }
	}
}
```

### 16.4 `root/etc/config/xxx`
```
config xxx 'defaults'
	option enabled '1'
```

### 16.5 `root/usr/share/rpcd/ucode/luci.xxx`
```ucode
#!/usr/bin/ucode
'use strict';
import { access, popen } from 'fs';

const methods = {
	stat: { call: function(req) { return { ok: true }; } }
};
return { "luci.xxx": methods };
```

### 16.6 `htdocs/luci-static/resources/view/xxx.js`
```js
'use strict';
'require view';
'require uci';
'require ui';
'require rpc';
'require form';

return view.extend({
	callStat: rpc.declare({ object: 'luci.xxx', method: 'stat', expect: {} }),

	load() {
		return Promise.all([ L.resolveDefault(this.callStat(), {}), uci.load('xxx') ]);
	},

	render([stat]) {
		let m = new form.Map('xxx', _('XXX'), _('XXX configuration'));
		let s = m.section(form.NamedSection, 'defaults', 'xxx', _('Settings'));
		let o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = o.enabled;
		return m.render();
	}
});
```

### 16.7 `po/templates/xxx.pot`
```po
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\n"

msgid "XXX"
msgstr ""

msgid "Enabled"
msgstr ""
```

### 16.8 `po/zh_Hans/xxx.po`
```po
msgid ""
msgstr ""
"Language: zh_Hans\n"
"Content-Type: text/plain; charset=UTF-8\n"

msgid "XXX"
msgstr "XXX 应用"

msgid "Enabled"
msgstr "启用"
```

---

## 17. 速查表 Cheat Sheet

### 文件 → 设备路径映射
| 源码路径 | 设备路径 | 作用 |
|----------|----------|------|
| `htdocs/luci-static/resources/view/x.js` | `/www/luci-static/resources/view/x.js` | 前端视图 |
| `root/etc/config/x` | `/etc/config/x` | UCI 配置 |
| `root/etc/uci-defaults/x` | `/etc/uci-defaults/x` | 首次初始化脚本 |
| `root/usr/share/luci/menu.d/x.json` | 同路径 | 菜单/路由 |
| `root/usr/share/rpcd/acl.d/x.json` | 同路径 | 权限 |
| `root/usr/share/rpcd/ucode/x` | 同路径 | ucode 后端 |
| `po/zh_Hans/x.po` | 编译为 lmo | 翻译 |

### 前端 require 速查
`view` `form` `uci` `rpc` `ui` `fs` `tools.widgets`；全局 `L`（url/bind/resolveDefault/toArray/sortedKeys）、`_()`（i18n）、`E()`（DOM）。

### ubus 调试
```
ubus list | grep luci
ubus call luci.xxx stat '{}'
logread -f
/etc/init.d/rpcd restart
```

### 开发-部署循环（设备上快速迭代）
```
# 改 js 后
scp view/xxx.js root@router:/www/luci-static/resources/view/
ssh root@router "rm -rf /tmp/luci-*; /etc/init.d/rpcd restart"
# 浏览器 Ctrl+F5
```

> 注意：`?v=` 资源版本串在 LuCI 页面加载时已固定，Ctrl+F5 未必刷新该缓存键。可靠做法：浏览器控制台执行
> `fetch('/luci-static/resources/view/xxx.js?v=<原版本串>', {cache:'reload'}).then(()=>location.reload())`。
> 另外 `/etc/init.d/rpcd restart` 会使 LuCI 登录会话失效，需重新登录。

### 真机踩坑实录（OpenWrt 25.12.5 / LuCI HEAD 128a7812）
以下差异与线上文档/旧版 LuCI 不同，均在真机验证过：

**ucode rpcd 后端（/usr/share/rpcd/ucode/）：**
- 不支持 `for (const x in ...)`，须用 `let`。
- 正则是 POSIX ERE：不支持 `\s`、`\d`，用 `[[:space:]]`、`[0-9]`。
- 数组无 `.push()`/`.indexOf()` 方法，须用全局函数 `push(arr, v)` / `index(arr, v)`。

**前端 form.js（新版表格渲染管线）：**
- 表格（GridSection/TableSection）单元格默认走 `renderTextValue()`（纯文本 `<em>none</em>`）；自定义控件必须 `o.editable = true` 并覆盖 `o.renderWidget = function(section_id) {...}`。直接覆盖 `o.render` 无效。
- `AbstractValue.render` 签名是 `render(option_index, section_id, in_table)`——section_id 是**第二个**参数。
- 无 `form.PasswordValue`，用 `form.Value` + `o.password = true`。

**poll 轮询：**
- `poll.add(fn, interval)` 在 tick 已初始化时会**同步**触发一次 tick；此时视图节点尚未插入 DOM，若回调里检查 `rootNode.isConnected` 会立即自我注销导致轮询失效。注册应推迟到 `setTimeout(..., 0)`（节点插入发生在微任务中，先于宏任务）。
- 官方模式是视图只调 `poll.add()`，由框架在 `initDOM` 里统一 `Poll.start()`。

**rpc.declare：**
- `expect: { 'results': [] }` 会把响应**解包**为 `data.results` 数组本身，回调拿到的是数组而非 `{results:[...]}` 对象；`expect: {}` 返回整个响应对象；`expect: { '': {} }` 同样返回整体。

**网络后端逻辑：**
- 同一 MAC 可能持有多个 IPv4（多宿主主机，如群晖双网卡），探测在线状态须 ping 全部候选地址（用户配置 IP 优先），任一响应即判在线——只取 ARP 第一条会误判。

**apk mkpkg 手工打包（无构建环境时）：**
- 路由器上的 apk-tools 3.0.5 用户态**没有 mkpkg 子命令**。用官方静态二进制 `apk.static`（GitLab Alpine apk-tools releases，`https://gitlab.alpinelinux.org/api/v4/projects/5/packages/generic/apk-tools/<ver>/<arch>/apk.static` 下载）。
- 依赖项不能用 `--depends luci-base`（报 unrecognized option），须用 `--info depends:luci-base`。
- 数据文件**必须**用 `--files PKGROOT`（或 `-F`）指定打包根目录；只给 `--output` 会生成一个只有元数据的空包（~284 字节）。PKGROOT 内即安装后的绝对路径布局（如 `pkgroot/www/...`、`pkgroot/usr/share/...`）。
- 安装自建未签名包：`apk add --allow-untrusted ./x.apk`；若设备已有同路径配置（如 /etc/config/xxx），安装时**保留现有配置**，包内默认文件存为 `/etc/config/xxx.apk-new`。
- **pkgroot 必须是最新源码**：调试期常用 scp 直接铺文件，pkgroot 目录往往是早期复制的。打包前务必用 `src/` 重新覆盖 pkgroot 并 **md5 比对确认**，否则 apk 会静默回退设备上的正确文件（本项目 v1.0.0 就因此发布了修复前的旧代码，只能补 1.0.1）。
  ```
  # 打包前逐文件核对
  md5sum src/.../wolmon.js && ssh root@router md5sum /data/pkgroot/www/.../wolmon.js
  ```
- 打包后**必须解包验证**（权限 + 内容），别只看包能装：
  ```
  mkdir /tmp/chk && cd /tmp/chk && apk extract --allow-untrusted ../x.apk
  ls -laR /tmp/chk        # 确认 ucode 后端是 -rwxr-xr-x
  ```
- BusyBox `find` 不支持 `-printf`，列权限用 `ls -laR`。
- 完整示例（luci-app-wolmon 实测）：
```
apk.static mkpkg \
  --info name:luci-app-wolmon --info version:1.0.0 --info arch:x86_64 \
  --info license:Apache-2.0 \
  --info 'description:...' \
  --info depends:luci-base \
  --files /data/app-wol/pkgroot \
  --output /data/app-wol/luci-app-wolmon-1.0.0.apk
```

### apk 包管理速查（25.x；详见 §13.7）
```
apk update                         # 刷新索引
apk add pkg                        # 安装
apk add --allow-untrusted ./x.apk  # 安装自建未签名包
apk del pkg                        # 卸载
apk list --installed               # 已安装列表
apk info --contents pkg            # 包内文件
# 源配置：/etc/apk/repositories.d/distfeeds.list
# 升级系统用 ASU / owut / Firmware Selector，切勿 apk upgrade
```

### i18n 三原则
1. 英文源串写进 `_('...')`（默认语言）。
2. `po/zh_Hans/*.po` 提供中文。
3. 不硬编码语言，靠系统 `luci.main.lang` / `Accept-Language` 自动选择，缺失回退英文。

---

*本指南基于 OpenWrt 官方 `luci-app-wol` 源码、`opkg-to-apk` 官方速查表与打包规范整理，作为离线参考。若官方 API/命令变动，以 `openwrt/luci` 仓库、`openwrt.github.io/luci/jsapi/` 与 `openwrt.org/docs/guide-user/additional-software/opkg-to-apk-cheatsheet` 为准。*
