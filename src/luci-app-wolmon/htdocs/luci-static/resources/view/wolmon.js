'use strict';
'require view';
'require uci';
'require ui';
'require rpc';
'require poll';
'require form';
'require tools.widgets as widgets';

const ETHERWAKE_BIN = '/usr/bin/etherwake';
const WAKEONLAN_BIN = '/usr/bin/wakeonlan';

const POLL_INTERVAL = 5;          /* seconds, fixed (FR-3.1) */
const DISCOVER_TIMEOUT = 60000;   /* ms, FR-7.4 */

const PACKAGES_URL = 'admin/system/package-manager';

const STATUS_CLASS = {
	online: 'wolmon-online',
	offline: 'wolmon-offline',
	discovering: 'wolmon-discovering',
	unknown: 'wolmon-unknown'
};

return view.extend({
	outputText: '',
	rootNode: null,
	boundPollFn: null,
	visibilityHandler: null,
	discoveringMacs: {},
	lastStates: {},

	callStat: rpc.declare({
		object: 'luci.wolmon',
		method: 'stat',
		params: [],
		expect: {}
	}),

	callExec: rpc.declare({
		object: 'luci.wolmon',
		method: 'exec',
		params: ['name', 'args'],
		expect: {}
	}),

	callStatus: rpc.declare({
		object: 'luci.wolmon',
		method: 'status',
		params: ['targets'],
		expect: { 'results': [] }
	}),

	callHostHints: rpc.declare({
		object: 'luci-rpc',
		method: 'getHostHints',
		expect: { '': {} }
	}),

	callUciSet: rpc.declare({
		object: 'uci',
		method: 'set',
		params: ['config', 'section', 'option', 'value']
	}),

	callUciCommit: rpc.declare({
		object: 'uci',
		method: 'commit',
		params: ['config']
	}),

	option_install_etherwake() {
		window.open(L.url(PACKAGES_URL) +
			'?query=etherwake', '_blank', 'noopener');
	},

	option_install_wakeonlan() {
		window.open(L.url(PACKAGES_URL) +
			'?query=wakeonlan', '_blank', 'noopener');
	},

	load() {
		return Promise.all([
			L.resolveDefault(this.callStat(), {}),
			L.resolveDefault(this.callHostHints(), {}),
			uci.load('luci-wolmon')
		]);
	},

	render([stat, hosts]) {
		const has_ewk = stat && stat.etherwake,
			has_wol = stat && stat.wakeonlan;
		let m, s, o;

		this.injectStyles();

		if (!has_ewk && !has_wol) {
			m = new form.Map('luci-wolmon', _('Wake on LAN Monitor'),
				_('Wake on LAN is a mechanism to boot computers remotely in the local network.'));

			s = m.section(form.NamedSection, 'packages', 'packages',
				_('Required Packages'),
				_('At least one Wake on LAN utility is needed. Please install one of the following packages (some extra permissions may be required):'));

			s.render = L.bind(function(view) {
				return form.NamedSection.prototype.render.apply(this, arguments)
					.then(L.bind(function(node) {
						node.appendChild(E('div', {
							'class': 'control-group'
						}, [
							E('button', {
								'class': 'btn cbi-button-action',
								'click': ui.createHandlerFn(view, 'option_install_etherwake'),
								'title': _('Install etherwake')
							}, [_('Install etherwake')]),
							' ',
							E('button', {
								'class': 'btn cbi-button-action',
								'click': ui.createHandlerFn(view, 'option_install_wakeonlan'),
								'title': _('Install wakeonlan')
							}, [_('Install wakeonlan')])
						]));
						return node;
					}, this));
			}, s, this);

			return m.render();
		}

		m = new form.Map('luci-wolmon', _('Wake on LAN Monitor'),
			_('Wake on LAN is a mechanism to boot computers remotely in the local network.'));

		s = m.section(form.NamedSection, 'defaults', 'wolmon', _('Default Settings'));

		if (has_ewk && has_wol) {
			o = s.option(form.ListValue, 'executable', _('Default WoL program'),
				_('Choose the default Wake on LAN utility'));
			o.value(ETHERWAKE_BIN, 'Etherwake');
			o.value(WAKEONLAN_BIN, 'Wakeonlan');
			o.default = ETHERWAKE_BIN;
			o.onchange = function(ev, section_id, value) {
				return m.save(null, true);
			};
		}
		else {
			o = s.option(form.DummyValue, '_info');
			o.rawhtml = true;
			o.default = E('div', {}, [
				E('p', {}, [
					_('Binary used') + ': ',
					E('strong', {}, has_ewk ? 'Etherwake' : 'Wakeonlan')
				]),
				E('p', {
						'style': 'margin-top: 10px'
					},
					_('You can also install the alternative Wake on LAN utility (some extra permissions may be required):')),
				E('div', {
					'class': 'control-group'
				}, [
					E('button', {
						'class': 'btn cbi-button-action',
						'click': ui.createHandlerFn(this, has_ewk ? 'option_install_wakeonlan' : 'option_install_etherwake')
					}, [_('Install %s').format(has_ewk ? 'wakeonlan' : 'etherwake')])
				])
			]);
		}

		let sdesc = _('Configure hosts that can be woken up. Click the Wake button to send a magic packet. The status column shows the live state, refreshed every 5 seconds.');

		if (has_wol)
			sdesc += '<br>' +
				_('Note: wakeonlan binary does not support interface, broadcast, and password options (etherwake only).') + ' ' +
				_('These options will be ignored if wakeonlan is used.');

		s = m.section(form.GridSection, 'target', _('Wake on LAN Targets'), sdesc);

		s.addremove = true;
		s.anonymous = true;
		s.sortable = true;
		s.nodescriptions = true;

		o = s.option(form.Value, 'name', _('Name'), _('Mandatory'));
		o.rmempty = false;
		o.datatype = 'string';

		o = s.option(form.Value, 'mac', _('MAC Address'), _('Mandatory'));
		o.rmempty = false;
		o.datatype = 'macaddr';
		o.validate = L.bind(function(section_id, value) {
			if (!value)
				return true;

			const v = value.toLowerCase();
			const dup = uci.sections('luci-wolmon', 'target').some(function(sec) {
				return sec['.name'] != section_id &&
					(sec.mac || '').toLowerCase() == v;
			});

			return dup ? _('MAC already exists') : true;
		}, this);

		L.sortedKeys(hosts).forEach(function(mac) {
			const hint = hosts[mac].name ||
				L.toArray(hosts[mac].ipaddrs || hosts[mac].ipv4)[0] ||
				L.toArray(hosts[mac].ip6addrs || hosts[mac].ipv6)[0];
			o.value(mac, hint ? '%s (%s)'.format(mac, hint) : mac);
		});

		o = s.option(form.DummyValue, '_status', _('Status'));
		o.editable = true;
		o.renderWidget = function(section_id) {
			return E('span', {
				'id': 'wolmon-status-' + section_id,
				'class': 'wolmon-status wolmon-unknown'
			}, _('Checking…'));
		};

		o = s.option(form.DummyValue, '_ipcol', _('IP Address'));
		o.editable = true;
		o.renderWidget = function(section_id) {
			const ip = uci.get('luci-wolmon', section_id, 'ip');
			return E('span', { 'id': 'wolmon-ip-' + section_id }, ip || '—');
		};

		o = s.option(form.Value, 'ip', _('IP Address'),
			_('Optional. If left empty, the IPv4 address is discovered automatically via the ARP table after waking the device.'));
		o.datatype = 'ip4addr("nomask")';
		o.rmempty = true;
		o.modalonly = true;
		o.placeholder = '192.168.1.100';

		if (has_ewk) {
			o = s.option(widgets.DeviceSelect, 'iface', _('Interface'), _('Etherwake only'));
			o.noaliases = true;
			o.noinactive = true;

			o = s.option(form.Flag, 'broadcast', _('Broadcast'), _('Etherwake only'));
			o.default = o.disabled;

			o = s.option(form.Value, 'password', _('Password'), _('Etherwake only'));
			o.password = true;
			o.datatype = 'or(macaddr,ip4addr("nomask"))';
			o.placeholder = '00:22:44:66:88:aa or 192.168.1.1';
			o.modalonly = true;
		}

		s.modaltitle = L.bind(function(section_id) {
			const name = uci.get('luci-wolmon', section_id, 'name');
			return _('Edit target') + (name ? ': ' + name : '');
		}, this);

		const gridSection = s;

		s.renderRowActions = L.bind(function(section_id) {
			const defaultButtons = form.GridSection.prototype.renderRowActions.call(gridSection, section_id, _('Edit'));

			const wakeButton = E('button', {
				'class': 'cbi-button cbi-button-action',
				'click': ui.createHandlerFn(this, function() {
					return this.handleWakeup(section_id, has_ewk, has_wol);
				})
			}, _('Wake'));

			const buttonContainer = defaultButtons.querySelector('div');
			if (buttonContainer)
				buttonContainer.insertBefore(wakeButton, buttonContainer.firstChild);

			return defaultButtons;
		}, this);

		s = m.section(form.NamedSection, 'output', 'wolmon', _('Output'));
		s.anonymous = true;
		s.render = L.bind(function() {
			return E('div', {
				'class': 'cbi-section'
			}, [
				E('h3', {}, _('Output')),
				E('textarea', {
					'readonly': true,
					'rows': 10,
					'style': 'width: 100%; font-family: monospace;',
					'id': 'wolmon-output-text'
				}, this.outputText)
			]);
		}, this);

		const self = this;

		return m.render().then(function(node) {
			self.rootNode = node;

			/* Poll.add() fires an immediate synchronous tick, which would
			 * run before the framework inserts this node into the DOM and
			 * trip the disconnected-view cleanup below. Defer registration
			 * to a macrotask so the node is connected by then. */
			window.setTimeout(function() {
				if (!self.rootNode || !self.rootNode.isConnected)
					return;

				self.boundPollFn = L.bind(self.pollStatus, self);
				poll.add(self.boundPollFn, POLL_INTERVAL);

				self.visibilityHandler = function() {
					if (!document.hidden && self.rootNode && self.rootNode.isConnected)
						self.pollStatus();
				};
				document.addEventListener('visibilitychange', self.visibilityHandler);

				self.pollStatus();
			}, 0);

			return node;
		});
	},

	pollStatus() {
		if (!this.rootNode || !this.rootNode.isConnected) {
			if (this.boundPollFn)
				poll.remove(this.boundPollFn);
			if (this.visibilityHandler)
				document.removeEventListener('visibilitychange', this.visibilityHandler);
			return;
		}

		const sections = uci.sections('luci-wolmon', 'target').filter(function(s) {
			return s.mac;
		});

		if (!sections.length)
			return;

		const targets = sections.map(function(s) {
			return {
				sid: s['.name'],
				mac: s.mac.toLowerCase(),
				ip: s.ip || null
			};
		});

		this.callStatus(targets.map(function(t) {
			return { mac: t.mac, ip: t.ip };
		})).then(L.bind(function(res) {
			/* rpc.declare expect unwraps the single "results" key into an array */
			const results = Array.isArray(res) ? res : ((res && res.results) || []);
			for (let i = 0; i < targets.length && i < results.length; i++)
				this.updateRow(targets[i], results[i]);
		}, this)).catch(L.bind(function() {
			targets.forEach(L.bind(function(t) {
				this.setStatusCell(t.sid, 'unknown', false);
			}, this));
		}, this));
	},

	updateRow(t, r) {
		if (!t || !r)
			return;

		const mac = (r.mac || t.mac || '').toLowerCase();
		const prev = this.lastStates[t.sid];
		let state;

		if (r.state == 'online')
			state = 'online';
		else if (r.state == 'offline')
			state = 'offline';
		else if (this.discoveringMacs[mac])
			state = 'discovering';
		else
			state = 'unknown';

		if (r.ip && r.ip != uci.get('luci-wolmon', t.sid, 'ip')) {
			uci.set('luci-wolmon', t.sid, 'ip', r.ip);
			uci.save();
			/* Persist the discovered IP so probing works directly after a reboot (FR-7.3) */
			this.callUciSet('luci-wolmon', t.sid, 'ip', r.ip)
				.then(L.bind(function() {
					return this.callUciCommit('luci-wolmon');
				}, this)).catch(function() {});
		}

		var ipEls = this.findAllById('wolmon-ip-' + t.sid);
		for (let i = 0; i < ipEls.length; i++) {
			if (r.ip)
				ipEls[i].textContent = (state == 'online' && r.rtt_ms != null)
					? '%s (%.2f ms)'.format(r.ip, r.rtt_ms)
					: r.ip;
			else
				ipEls[i].textContent = (state == 'discovering') ? _('Discovering…') : '—';
		}

		this.setStatusCell(t.sid, state, state == 'online' && prev != null && prev != 'online');

		if (state == 'online' && prev != null && prev != 'online') {
			const name = uci.get('luci-wolmon', t.sid, 'name') || mac;
			ui.addNotification(null, E('p', {},
				_('Device %s is now online').format(name)));
			delete this.discoveringMacs[mac];
		}

		this.lastStates[t.sid] = state;
	},

	setStatusCell(sid, state, flash) {
		/* The edit modal clones grid cells, so the same id can exist twice
		 * (table row + modal copy); update every copy, not just the first. */
		const els = this.findAllById('wolmon-status-' + sid);
		if (!els.length)
			return;

		for (let i = 0; i < els.length; i++) {
			const el = els[i];
			el.className = 'wolmon-status ' + (STATUS_CLASS[state] || STATUS_CLASS.unknown);
			el.textContent = this.statusText(state);

			if (flash) {
				el.classList.add('wolmon-flash');
				window.setTimeout(function() {
					el.classList.remove('wolmon-flash');
				}, 1000);
			}
		}
	},

	findAllById(id) {
		return Array.prototype.slice.call(document.querySelectorAll('#' + id));
	},

	statusText(state) {
		switch (state) {
			case 'online':
				return _('Online');
			case 'offline':
				return _('Offline');
			case 'discovering':
				return _('Discovering');
			default:
				return _('Unknown');
		}
	},

	handleWakeup(section_id, has_ewk, has_wol) {
		const self = this;
		const name = uci.get('luci-wolmon', section_id, 'name');
		const mac = uci.get('luci-wolmon', section_id, 'mac');

		const defaultBin = uci.get('luci-wolmon', 'defaults', 'executable');
		let bin = defaultBin || (has_ewk ? ETHERWAKE_BIN : WAKEONLAN_BIN);

		if (bin == ETHERWAKE_BIN && !has_ewk)
			bin = WAKEONLAN_BIN;
		else if (bin == WAKEONLAN_BIN && !has_wol)
			bin = ETHERWAKE_BIN;

		const args = [];

		if (bin == ETHERWAKE_BIN) {
			args.push('-D');

			const iface = uci.get('luci-wolmon', section_id, 'iface');
			if (iface)
				args.push('-i', iface);

			const broadcast = uci.get('luci-wolmon', section_id, 'broadcast');
			if (broadcast == '1')
				args.push('-b');

			const password = uci.get('luci-wolmon', section_id, 'password');
			if (password)
				args.push('-p', password);

			args.push(mac);
		}
		else {
			args.push(mac);
		}

		this.appendOutput(_('Sending wakeup to %s (%s)…').format(name, mac) + '\n');

		const lmac = (mac || '').toLowerCase();
		this.discoveringMacs[lmac] = Date.now();
		window.setTimeout(function() {
			if (self.discoveringMacs[lmac])
				delete self.discoveringMacs[lmac];
		}, DISCOVER_TIMEOUT);

		return this.callExec(bin, args).then(function(res) {
			res = res || {};
			if (res.stdout)
				self.appendOutput(res.stdout + '\n');
			if (res.stderr)
				self.appendOutput(_('Error: %s').format(res.stderr) + '\n');
			if (!res.stdout && !res.stderr)
				self.appendOutput(_('Command completed with code %d').format(res.code || 0) + '\n');
			self.appendOutput('\n');
		}).then(function() {
			self.pollStatus();
		}).catch(function(err) {
			self.appendOutput(_('Error: %s').format(err) + '\n\n');
		});
	},

	appendOutput(text) {
		this.outputText += text;
		const textarea = document.getElementById('wolmon-output-text');
		if (textarea) {
			textarea.value = this.outputText;
			textarea.scrollTop = textarea.scrollHeight;
		}
	},

	injectStyles() {
		if (document.getElementById('wolmon-style'))
			return;

		document.head.appendChild(E('style', { 'id': 'wolmon-style' }, [
			'.wolmon-status { display: inline-block; padding: 2px 10px; border-radius: 10px; ' +
				'font-size: 12px; font-weight: bold; color: #fff; min-width: 60px; text-align: center; }',
			'.wolmon-online { background: #5cb85c; }',
			'.wolmon-offline { background: #d9534f; }',
			'.wolmon-discovering { background: #f0ad4e; }',
			'.wolmon-unknown { background: #777; }',
			'@keyframes wolmon-flash-kf { 0% { box-shadow: 0 0 0 4px rgba(92,184,92,0.8); } ' +
				'100% { box-shadow: 0 0 0 4px rgba(92,184,92,0); } }',
			'.wolmon-flash { animation: wolmon-flash-kf 1s ease-out; }'
		]));
	}
});
