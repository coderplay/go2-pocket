import type { ConnectionMode, ConnectionConfig } from '../types';
import { MODE_LABELS, DEFAULT_AP_IP } from '../connection/modes';
import { scanForRobots, type ScanResult } from '../connection/network-scan';
import { cloudApi, type RobotDevice } from '../api/unitree-cloud';
import { phoneName, wifiSettings } from '../mobile/native-device';

export type ConnectHandler = (config: ConnectionConfig) => void;

/**
 * Connection panel — Local / AP / Remote chooser.
 * Login lives in the Account Manager; this panel only consumes the cached
 * cloudApi session. Remote mode is disabled when logged out (the option
 * label hints to log in via the Account Manager).
 */
export class ConnectionPanel {
  private container: HTMLElement;
  private modeSelect!: HTMLSelectElement;
  private ipInput!: HTMLInputElement;
  private connectBtn!: HTMLButtonElement;
  private scanBtn!: HTMLButtonElement;
  private discoveredSn = '';
  private statusEl!: HTMLElement;
  private robotPickerGroup!: HTMLElement;
  private robotSelect!: HTMLSelectElement;
  private remoteHintEl!: HTMLElement;
  private networkHelp!: HTMLElement;
  private setupApBtn!: HTMLButtonElement;
  private localIp = '';
  private previousMode: ConnectionMode = 'STA-L';
  private scanGeneration = 0;
  private destroyed = false;
  private selectedSn = '';
  private devices: RobotDevice[] = [];
  private onConnect: ConnectHandler;
  private onBack: () => void;
  private onAccountManager: () => void;
  private authUnsub: () => void;

  constructor(
    parent: HTMLElement,
    onConnect: ConnectHandler,
    onBack: () => void,
    onAccountManager: () => void,
    onSetupHotspot: () => void = () => {},
    initialMode: ConnectionMode = 'STA-L',
  ) {
    this.container = document.createElement('div');
    this.container.className = 'connection-panel';
    this.onConnect = onConnect;
    this.onBack = onBack;
    this.onAccountManager = onAccountManager;
    this.build(onSetupHotspot, initialMode);
    parent.appendChild(this.container);

    // Re-render on login/logout so the Remote option flips between disabled
    // and "show robot picker".
    this.authUnsub = cloudApi.onAuthChange(() => {
      this.refreshDevicesForRemote();
      this.updateVisibility();
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.scanGeneration++;
    this.authUnsub();
    this.container.remove();
  }

  private build(onSetupHotspot: () => void, initialMode: ConnectionMode): void {
    this.container.innerHTML = `
      <div class="conn-back-row">
        <button id="conn-back-btn" class="conn-back-link" type="button">
          <svg class="conn-back-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          <span>Main page</span>
        </button>
      </div>
      <h2 class="conn-title">Connect to Go2</h2>
      <div class="form-group">
        <label for="mode-select">Connection Mode</label>
        <select id="mode-select"></select>
        <div id="remote-hint" class="conn-remote-hint" style="display:none;"></div>
      </div>
      <div id="network-help" class="pocket-network-help"></div>
      <button id="setup-ap-btn" class="btn-scan pocket-setup-ap" type="button" hidden>Set up Go2 hotspot</button>
      <div class="form-group" id="ip-group">
        <label for="ip-input">Robot IP Address</label>
        <div class="ip-row">
          <input type="text" id="ip-input" placeholder="Robot IP on your home Wi-Fi" inputmode="decimal" />
          <button id="scan-btn" class="btn-scan" title="Find Go2 on your network">Find Go2</button>
        </div>
        <div id="scan-results" class="scan-results" style="display:none;"></div>
      </div>
      <div class="form-group" id="robot-picker-group" style="display:none">
        <label>Choose Robot</label>
        <select id="robot-select"><option value="">-- Select robot --</option></select>
      </div>
      <button id="connect-btn" class="btn-connect">Connect</button>
      <div id="connection-status" class="status"></div>
    `;

    this.modeSelect = this.container.querySelector('#mode-select')!;
    this.ipInput = this.container.querySelector('#ip-input')!;
    this.connectBtn = this.container.querySelector('#connect-btn')!;
    this.scanBtn = this.container.querySelector('#scan-btn')!;
    this.statusEl = this.container.querySelector('#connection-status')!;
    this.robotPickerGroup = this.container.querySelector('#robot-picker-group')!;
    this.robotSelect = this.container.querySelector('#robot-select')!;
    this.remoteHintEl = this.container.querySelector('#remote-hint')!;
    this.networkHelp = this.container.querySelector('#network-help')!;
    this.setupApBtn = this.container.querySelector('#setup-ap-btn')!;
    this.setupApBtn.addEventListener('click', onSetupHotspot);
    const backBtn = this.container.querySelector('#conn-back-btn') as HTMLButtonElement;
    backBtn.addEventListener('click', () => this.onBack());

    for (const [mode, label] of Object.entries(MODE_LABELS)) {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = label;
      this.modeSelect.appendChild(option);
    }

    // Restore Go2's last local address and discovered identity.
    try {
      this.ipInput.value = localStorage.getItem('unitree_last_ip_go2') || '';
      if (this.ipInput.value === DEFAULT_AP_IP) this.ipInput.value = '';
      this.localIp = this.ipInput.value;
      this.discoveredSn = localStorage.getItem('unitree_last_sn_go2') || '';
    } catch { /* ignore */ }

    this.modeSelect.addEventListener('change', () => {
      // Block selecting Remote while logged out — bounce back to STA-L.
      if (this.modeSelect.value === 'STA-T' && !cloudApi.isLoggedIn) {
        this.modeSelect.value = 'STA-L';
      }
      this.updateVisibility();
    });
    this.connectBtn.addEventListener('click', () => this.handleConnect());

    // Enter key triggers connect
    const handleEnter = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); this.handleConnect(); } };
    this.container.addEventListener('keydown', handleEnter);
    this.scanBtn.addEventListener('click', () => this.handleScan());
    this.robotSelect.addEventListener('change', () => {
      this.selectedSn = this.robotSelect.value;
    });

    this.modeSelect.value = initialMode;

    // Pre-populate the robot picker if the user is already logged in
    // (e.g. from auto-login at app start).
    this.refreshDevicesForRemote();
    this.updateVisibility();
  }

  private updateVisibility(): void {
    const mode = this.modeSelect.value as ConnectionMode;
    const isRemote = mode === 'STA-T';
    const ipGroup = this.container.querySelector('#ip-group') as HTMLElement;
    if (this.previousMode === 'STA-L') this.localIp = this.ipInput.value;
    if (this.previousMode !== mode) {
      this.scanGeneration++;
      this.scanBtn.disabled = false;
      this.scanBtn.textContent = 'Find Go2';
      this.renderScanResults([]);
      this.setStatus('');
    }
    this.networkHelp.hidden = isRemote;
    this.setupApBtn.hidden = mode !== 'AP';
    this.scanBtn.hidden = mode === 'AP';
    let hotspotName = 'the Go2 hotspot';
    try { hotspotName = localStorage.getItem('go2_hotspot_ssid') || hotspotName; } catch { /* ignore */ }
    this.networkHelp.textContent = mode === 'AP'
      ? `Join ${hotspotName} in ${wifiSettings}, then tap Connect.\nCan’t see the hotspot? Set it up below.`
      : `Connect your ${phoneName} and Go2 to the same home Wi-Fi. If Find Go2 finds nothing, enter the robot IP address directly.`;

    // Remote option label flips based on auth state. The <option> stays
    // selectable so users can see the entry, but the change handler bounces
    // the selection back to STA-L when they're logged out.
    const remoteOpt = Array.from(this.modeSelect.options).find(o => o.value === 'STA-T');
    if (remoteOpt) {
      if (cloudApi.isLoggedIn) {
        remoteOpt.textContent = MODE_LABELS['STA-T'];
        remoteOpt.disabled = false;
      } else {
        remoteOpt.textContent = `${MODE_LABELS['STA-T']} (log in via Account Manager)`;
        remoteOpt.disabled = true;
      }
    }

    ipGroup.style.display = isRemote || mode === 'AP' ? 'none' : '';
    this.robotPickerGroup.style.display = cloudApi.isLoggedIn && this.devices.length > 1 ? '' : 'none';

    // Inline hint under the mode selector covers the remaining cases:
    // logged-in single-robot ("ready"), logged-in zero-robots ("bind one"),
    // logged-out ("login required").
    if (isRemote) {
      if (!cloudApi.isLoggedIn) {
        this.remoteHintEl.textContent = 'Login required — open Account Manager';
        this.remoteHintEl.style.display = '';
      } else if (this.devices.length === 0) {
        this.remoteHintEl.innerHTML = 'No robots bound to this account. <a href="#" id="open-acct-link">Open Account Manager</a> to bind one.';
        this.remoteHintEl.style.display = '';
        const link = this.remoteHintEl.querySelector('#open-acct-link') as HTMLAnchorElement | null;
        link?.addEventListener('click', (e) => { e.preventDefault(); this.onAccountManager(); });
      } else if (this.devices.length === 1) {
        const d = this.devices[0];
        this.remoteHintEl.textContent = `Robot: ${d.alias || d.sn}`;
        this.remoteHintEl.style.display = '';
        this.selectedSn = d.sn;
      } else {
        this.remoteHintEl.style.display = 'none';
      }
    } else {
      this.remoteHintEl.style.display = 'none';
    }

    if (mode === 'AP') {
      this.ipInput.value = DEFAULT_AP_IP;
      this.ipInput.readOnly = true;
    } else {
      this.ipInput.readOnly = false;
      if (this.previousMode === 'AP') this.ipInput.value = this.localIp;
    }
    this.previousMode = mode;
  }

  /** Fetch the device list when logged in and rebuild the picker.
   *  Called on construct and on login state changes. */
  private refreshDevicesForRemote(): void {
    if (!cloudApi.isLoggedIn) {
      this.devices = [];
      this.populateRobotSelect();
      return;
    }
    void cloudApi.listDevices().then((devices) => {
      if (this.destroyed) return;
      this.devices = devices;
      this.populateRobotSelect();
      this.updateVisibility();
    }).catch(() => { /* leave devices as-is on error */ });
  }

  private populateRobotSelect(): void {
    this.robotSelect.innerHTML = '<option value="">-- Select robot --</option>';
    for (const d of this.devices) {
      const opt = document.createElement('option');
      opt.value = d.sn;
      opt.textContent = `${d.alias || d.sn} — ${d.series} [${d.sn}]`;
      this.robotSelect.appendChild(opt);
    }
    if (this.devices.length === 1) {
      this.robotSelect.value = this.devices[0].sn;
      this.selectedSn = this.devices[0].sn;
      // Keep the identity next to the already-cached key when AP has no internet.
      this.setSnInputAndPersist(this.selectedSn);
    } else if (this.devices.some(d => d.sn === this.discoveredSn)) {
      this.robotSelect.value = this.discoveredSn;
      this.selectedSn = this.discoveredSn;
    }
  }

  private handleConnect(): void {
    const mode = this.modeSelect.value as ConnectionMode;

    if (mode === 'STA-T') {
      if (!cloudApi.isLoggedIn) {
        this.setStatus('Login required — open Account Manager', 'error');
        return;
      }
      const sn = this.selectedSn || this.robotSelect.value || (this.devices.length === 1 ? this.devices[0].sn : '');
      if (!sn) {
        this.setStatus('Please select a robot', 'error');
        return;
      }
      this.onConnect({
        mode,
        ip: '',
        token: cloudApi.accessToken,
        serialNumber: sn,
        email: '',
        password: '',
      });
    } else {
      const ip = this.ipInput.value.trim();
      // Keep the home IP when connecting to the fixed hotspot address.
      if (ip && mode === 'STA-L') try { localStorage.setItem('unitree_last_ip_go2', ip); } catch { /* ignore */ }
      // The discovered or cloud-bound serial selects Go2's cached device key.
      const typedSn = this.discoveredSn;
      const familyDevs = this.devices.filter((d) => d.series.toUpperCase() === cloudApi.connectFamily.toUpperCase());
      const sn = this.robotSelect.value || typedSn || (familyDevs.length === 1 ? familyDevs[0].sn : '');
      this.setSnInputAndPersist(sn);
      this.onConnect({
        mode,
        ip,
        token: '',
        serialNumber: sn,
        email: '',
        password: '',
      });
    }
  }

  /** Discover Go2 and retain its identity for authenticated local connections. */
  private async handleScan(): Promise<void> {
    if (this.modeSelect.value === 'AP') return;
    const generation = ++this.scanGeneration;
    this.scanBtn.disabled = true;
    this.scanBtn.textContent = '...';
    this.setStatus('Scanning network...', 'info');
    this.renderScanResults([]);  // clear stale list

    // Include known identities in addition to a network-wide discovery.
    const targetSns = new Set<string>();
    for (const d of this.devices) {
      if (d.sn) targetSns.add(d.sn);
    }
    const typedSn = this.discoveredSn;
    if (typedSn) targetSns.add(typedSn);

    try {
      // Fire the broadcast and every per-SN scan in parallel; aggregate
      // and dedupe by SN. Each branch swallows its own errors so a
      // single network blip doesn't sink the whole run.
      const branches: Array<Promise<ScanResult[]>> = [
        scanForRobots(cloudApi.connectFamily, (msg) => { if (generation === this.scanGeneration) this.setStatus(msg, 'info'); }),
        ...Array.from(targetSns).map((sn) =>
          scanForRobots(cloudApi.connectFamily, undefined, sn).catch(() => [] as ScanResult[]),
        ),
      ];
      const seen = new Map<string, ScanResult>();
      const all = await Promise.all(branches);
      if (generation !== this.scanGeneration) return;
      for (const batch of all) {
        for (const r of batch) {
          if (r.sn && !seen.has(r.sn)) seen.set(r.sn, r);
        }
      }
      const results = Array.from(seen.values());
      if (results.length === 0) {
        this.setStatus('Search found no Go2. Check that both devices use the same Wi-Fi, or enter the robot IP address directly.', 'error');
        return;
      }
      // Single hit: populate IP + SN, no list needed.
      if (results.length === 1) {
        const only = results[0];
        this.ipInput.value = only.ip;
        this.setSnInputAndPersist(only.sn || '');
        if (only.ip !== DEFAULT_AP_IP) {
          this.modeSelect.value = 'STA-L';
          this.updateVisibility();
        }
        this.setStatus(`Found robot at ${only.ip} (SN: ${only.sn || 'unknown'})`, 'success');
        return;
      }
      // Multiple hits: show the list and let the user click one.
      this.modeSelect.value = 'STA-L';
      this.updateVisibility();
      this.setStatus(`Found ${results.length} robots — pick one`, 'success');
      this.renderScanResults(results);
    } catch (err) {
      if (generation === this.scanGeneration) this.setStatus('Scan failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error');
    } finally {
      if (generation === this.scanGeneration) {
        this.scanBtn.disabled = false;
        this.scanBtn.textContent = 'Find Go2';
      }
    }
  }

  /** Render the scan-results dropdown. Empty array hides it. The list
   *  caps at ~4 rows tall and scrolls beyond — taller lists keep the
   *  rest of the connection panel from getting pushed off-screen. */
  private renderScanResults(results: ScanResult[]): void {
    const slot = this.container.querySelector('#scan-results') as HTMLElement;
    if (!slot) return;
    slot.innerHTML = '';
    if (results.length === 0) {
      slot.style.display = 'none';
      return;
    }
    slot.style.display = '';
    for (const r of results) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'scan-result-row';
      row.innerHTML = `<span class="scan-result-ip">${r.ip}</span><span class="scan-result-sn">${r.sn || 'unknown'}</span>`;
      row.addEventListener('click', () => {
        this.ipInput.value = r.ip;
        this.setSnInputAndPersist(r.sn || '');
        this.setStatus(`Selected ${r.ip} (SN: ${r.sn || 'unknown'})`, 'success');
        this.renderScanResults([]);
      });
      slot.appendChild(row);
    }
  }

  setStatus(text: string, type: 'info' | 'success' | 'error' = 'info'): void {
    this.statusEl.textContent = text;
    this.statusEl.className = `status status-${type}`;
  }

  /** Remember the Go2 selected from network discovery. */
  private setSnInputAndPersist(sn: string): void {
    this.discoveredSn = sn;
    if (!sn) return;
    try {
      localStorage.setItem(`unitree_last_sn_${cloudApi.connectFamily.toLowerCase()}`, sn);
    } catch { /* ignore */ }
  }

  setConnecting(connecting: boolean): void {
    this.connectBtn.disabled = connecting;
    this.connectBtn.textContent = connecting ? 'Connecting...' : 'Connect';
  }

  connectNow(): void { this.handleConnect(); }

  setConnected(connected: boolean): void {
    this.connectBtn.textContent = connected ? 'Disconnect' : 'Connect';
    this.connectBtn.disabled = false;
  }
}
