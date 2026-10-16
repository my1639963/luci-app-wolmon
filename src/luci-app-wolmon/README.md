# luci-app-wolmon

Wake on LAN Monitor — a visual Wake-on-LAN client for OpenWrt LuCI with live
device status monitoring.

## Description

This application extends the classic WOL use case with online-status
monitoring of the configured targets:

- Send Wake-on-LAN magic packets to hosts in the local network
  (via `etherwake` or `wakeonlan`).
- Keep a persistent list of wake targets (UCI config `luci-wolmon`), showing
  **MAC address, current IPv4 address and live status** for each device.
- Probe the status of all recorded devices every 5 seconds (fixed interval)
  by combining the kernel ARP/neighbor table with a parallel `ping` sweep.
- **Post-wake IP discovery**: a powered-off device has no ARP entry yet.
  After waking it, the app polls the ARP table until the device's IPv4
  address appears, then backfills it into the record and switches to
  regular ping probing.
- A MAC owning multiple IPv4 addresses (multi-homed hosts) is probed on all
  of its addresses; the first one that responds is reported as online.
- Internationalized: English (source language) and Simplified Chinese
  (`zh_Hans`), following the system language automatically.

## Screenshot

Target list showing live status, MAC, discovered IP address and per-row
Wake/Edit/Delete actions:

| Name   | MAC Address       | Status | IP Address       | Interface | Broadcast |
|--------|-------------------|--------|------------------|-----------|-----------|
| NAS    | E0:D5:5E:2E:2E:5F | Online | 192.168.10.5 (1 ms) | br-lan  | yes       |

## Dependencies

- `luci-base`
- `etherwake` (or `wakeonlan`) — a button to install the missing tool is
  shown in the UI when neither is available
- busybox `ping` for reachability probing

## Usage

1. Install the package (or copy the files, see below).
2. Browse to *Services → Wake on LAN Monitor*.
3. Add a target: name and MAC address are mandatory, the IPv4 address is
   optional and auto-discovered after the first wake.
4. Click **Wake** to send a magic packet; the output area shows the command
   result. The status column refreshes every 5 seconds.

## Architecture

```
htdocs/luci-static/resources/view/wolmon.js   client view (form + poll)
root/usr/share/rpcd/ucode/luci.wolmon         ucode rpcd backend
  stat()    check etherwake/wakeonlan/ping availability
  exec()    whitelist-executed WOL command
  arp()     ARP/neighbor table as { mac: { ipv4[], iface[] } }
  status()  batch resolve MAC→IP and parallel-ping targets
root/usr/share/luci/menu.d/…                  menu entry (Services)
root/usr/share/rpcd/acl.d/…                   ACL (least privilege)
root/etc/config/luci-wolmon                   UCI defaults
po/templates/wolmon.pot, po/zh_Hans/wolmon.po translations
```

## Building

Build inside an OpenWrt buildroot with the LuCI feed, or install the files
directly onto a device:

```
scp htdocs/luci-static/resources/view/wolmon.js  root@router:/www/luci-static/resources/view/
scp root/usr/share/rpcd/ucode/luci.wolmon        root@router:/usr/share/rpcd/ucode/
ssh root@router "chmod +x /usr/share/rpcd/ucode/luci.wolmon; /etc/init.d/rpcd restart"
```

## License

Apache License, Version 2.0. See [LICENSE](LICENSE).
