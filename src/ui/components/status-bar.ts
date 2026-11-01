import { theme } from '../theme';
import type { ErrorStore } from '../../protocol/error-store';
import { ErrorsBadge } from './errors-badge';
import { AudioPtt } from './audio-ptt';
import { AudioMonitor } from './audio-monitor';

const SUN_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFB74D" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="4"/>
  <line x1="12" y1="2" x2="12" y2="5"/>
  <line x1="12" y1="19" x2="12" y2="22"/>
  <line x1="2" y1="12" x2="5" y2="12"/>
  <line x1="19" y1="12" x2="22" y2="12"/>
  <line x1="4.5" y1="4.5" x2="6.5" y2="6.5"/>
  <line x1="17.5" y1="17.5" x2="19.5" y2="19.5"/>
  <line x1="4.5" y1="19.5" x2="6.5" y2="17.5"/>
  <line x1="17.5" y1="6.5" x2="19.5" y2="4.5"/>
</svg>`;

const MOON_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b0b3bb" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>
</svg>`;

// Sliders icon — matches the hub Settings button so the same glyph
// always means "open settings" across hub + control views.
const SETTINGS_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b0b3bb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <line x1="4" y1="21" x2="4" y2="14"/>
  <line x1="4" y1="10" x2="4" y2="3"/>
  <line x1="12" y1="21" x2="12" y2="12"/>
  <line x1="12" y1="8" x2="12" y2="3"/>
  <line x1="20" y1="21" x2="20" y2="16"/>
  <line x1="20" y1="12" x2="20" y2="3"/>
  <line x1="1" y1="14" x2="7" y2="14"/>
  <line x1="9" y1="8" x2="15" y2="8"/>
  <line x1="17" y1="16" x2="23" y2="16"/>
</svg>`;

export interface NavBarOptions {
  /** Click handler for the settings icon. When provided, the icon is
   *  rendered as the rightmost item in the navbar (control view: opens
   *  the settings drawer). When absent, the icon is hidden. */
  onMenuClick?: () => void;
  onPttStart?: () => void;
  onPttEnd?: () => void;
  onAudioMonitorStart?: () => void;
  onAudioMonitorStop?: () => void;
}

export class NavBar {
  private container: HTMLElement;
  private netTypeEl!: HTMLElement;
  private batteryFill!: HTMLElement;
  private batteryText!: HTMLElement;
  private motorTempEl!: HTMLElement;
  private motorTempLastValue: number | null = null;
  private bodyTempLastValue: number | null = null;
  private tempPopover: HTMLElement | null = null;
  private wifiIconEl!: HTMLImageElement;
  private themeIconWrap!: HTMLElement;
  private menuIconWrap: HTMLButtonElement | null = null;
  private audioPtt: AudioPtt | null = null;
  private audioMonitor: AudioMonitor | null = null;
  private unsubTheme: () => void = () => {};
  private onBack: () => void;
  private errorsBadge: ErrorsBadge | null = null;
  private options: NavBarOptions;

  constructor(
    parent: HTMLElement,
    onBack: () => void,
    errorStore?: ErrorStore,
    options: NavBarOptions = {},
  ) {
    this.onBack = onBack;
    this.options = options;

    this.container = document.createElement('div');
    this.container.className = 'nav-bar';
    this.build();
    parent.appendChild(this.container);

    // Mount the inline error badge into the right-side cluster, just before
    // the theme toggle. Visible only when active error count > 0.
    // Clicking the badge opens an anchored popover (handled internally).
    if (errorStore) {
      const slot = this.container.querySelector('.nav-bar-right')!;
      const themeIcon = slot.querySelector('.nav-theme-icon')!;
      this.errorsBadge = new ErrorsBadge(slot as HTMLElement, errorStore, 'inline');
      // Move the badge just before the theme icon so layout reads
      // … wifi · [badge] · theme · bt
      slot.insertBefore(this.errorsBadge.element, themeIcon);
      this.errorsBadge.setVisible(true);
    }
  }

  private build(): void {
    this.container.innerHTML = `
      <div class="nav-bar-left">
        <button class="back-btn" aria-label="Back to Home" title="Back to Home">
          <img src="/sprites/nav-bar-left-icon.png" alt="Back" />
        </button>
      </div>
      <div class="nav-bar-right">
        <span class="motor-temp-label"></span>
        <div class="nav-divider"></div>
        <div class="battery-icon">
          <div class="battery-fill-box">
            <div class="battery-fill"></div>
            <span class="battery-text">--%</span>
          </div>
        </div>
        <div class="nav-divider"></div>
        <span class="net-type-label"></span>
        <img class="wifi-icon" src="/sprites/icon_wifi.png" alt="WiFi" />
        <div class="nav-theme-icon" title="Toggle theme"
             style="cursor:pointer;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:rgba(26,29,35,0.95);border:1.5px solid #3a3d45;margin-left:4px;transition:all 0.15s;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>
      </div>
    `;

    // Append the audio monitor, PTT button, and settings icon at the end of the right cluster.
    const rightSlot = this.container.querySelector('.nav-bar-right')!;

    if (this.options.onAudioMonitorStart && this.options.onAudioMonitorStop) {
      this.audioMonitor = new AudioMonitor({
        onStart: () => this.options.onAudioMonitorStart?.(),
        onStop: () => this.options.onAudioMonitorStop?.(),
      });
      rightSlot.appendChild(this.audioMonitor.element);
    }

    if (this.options.onPttStart && this.options.onPttEnd) {
      this.audioPtt = new AudioPtt({
        onPttStart: () => this.options.onPttStart?.(),
        onPttEnd: () => this.options.onPttEnd?.(),
      });
      rightSlot.appendChild(this.audioPtt.element);
    }

    if (this.options.onMenuClick) {
      this.menuIconWrap = document.createElement('button');
      this.menuIconWrap.type = 'button';
      this.menuIconWrap.className = 'nav-menu-icon nav-circle-icon';
      this.menuIconWrap.title = 'Open settings';
      this.menuIconWrap.setAttribute('aria-label', 'Open settings');
      this.menuIconWrap.innerHTML = SETTINGS_SVG;
      this.menuIconWrap.addEventListener('click', () => this.options.onMenuClick?.());
      rightSlot.appendChild(this.menuIconWrap);
    }

    this.batteryFill = this.container.querySelector('.battery-fill')!;
    this.batteryText = this.container.querySelector('.battery-text')!;
    this.motorTempEl = this.container.querySelector('.motor-temp-label')!;
    this.netTypeEl = this.container.querySelector('.net-type-label')!;
    this.wifiIconEl = this.container.querySelector('.wifi-icon')!;
    this.themeIconWrap = this.container.querySelector('.nav-theme-icon')!;

    // Theme toggle
    this.themeIconWrap.addEventListener('click', () => theme().toggle());
    this.themeIconWrap.addEventListener('mouseenter', () => {
      this.themeIconWrap.style.background = 'rgba(255,183,77,0.15)';
      this.themeIconWrap.style.transform = 'scale(1.05)';
    });
    this.themeIconWrap.addEventListener('mouseleave', () => {
      this.themeIconWrap.style.background = 'rgba(26,29,35,0.95)';
      this.themeIconWrap.style.transform = 'scale(1)';
    });
    this.renderTheme(theme().theme);
    this.unsubTheme = theme().onChange((t) => this.renderTheme(t));

    this.container.querySelector('.back-btn')!.addEventListener('click', this.onBack);
  }

  private renderTheme(t: 'dark' | 'light'): void {
    // Dark mode shows moon (click -> go light); Light mode shows sun (click -> go dark)
    this.themeIconWrap.innerHTML = t === 'dark' ? MOON_SVG : SUN_SVG;
    this.themeIconWrap.title = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  }

  destroy(): void {
    this.unsubTheme();
    this.errorsBadge?.destroy();
    this.errorsBadge = null;
    this.audioMonitor?.destroy();
    this.audioMonitor = null;
    this.audioPtt?.destroy();
    this.audioPtt = null;
  }


  setBattery(percent: number): void {
    const p = Math.round(percent);
    this.batteryText.textContent = `${p}%`;
    this.batteryFill.style.width = `${p}%`;

    // APK color coding: red <=33%, yellow 34-66%, green 67%+
    let color: string;
    if (p <= 33) color = '#FF3D3D';
    else if (p <= 66) color = '#FCD335';
    else color = '#42CF55';
    this.batteryFill.style.backgroundColor = color;
  }

  setMotorTemp(maxTemp: number): void {
    const t = Math.round(maxTemp);
    this.motorTempLastValue = t;
    this.motorTempEl.textContent = `${t}°C`;
    if (t > 70) this.motorTempEl.style.color = '#FF3D3D';
    else if (t > 50) this.motorTempEl.style.color = '#FCD335';
    else this.motorTempEl.style.color = '#aaa';
    if (!this.motorTempEl.dataset.clickWired) {
      this.motorTempEl.style.cursor = 'pointer';
      this.motorTempEl.dataset.clickWired = '1';
      this.motorTempEl.addEventListener('click', () => this.toggleTempPopover());
    }
    this.refreshTempPopover();
  }

  /** Body / chassis IMU temperature, surfaced alongside Max Motor Temp
   *  in the navbar popover. Optional — Go2's lowstate.imu_state already
   *  carries it; G1 lights it from rt/lf/lowstate_doubleimu. */
  setBodyTemp(temp: number | null): void {
    this.bodyTempLastValue = temp == null ? null : Math.round(temp);
    this.refreshTempPopover();
  }

  private toggleTempPopover(): void {
    if (this.tempPopover) { this.tempPopover.remove(); this.tempPopover = null; return; }
    this.tempPopover = document.createElement('div');
    this.tempPopover.className = 'nav-temp-popover';
    this.tempPopover.style.cssText = 'position:absolute;background:rgba(20,22,28,0.97);border:1px solid #2a2d35;border-radius:6px;padding:8px 12px;font-size:12px;line-height:1.6;color:#e0e0e0;box-shadow:0 4px 16px rgba(0,0,0,0.4);z-index:50;white-space:nowrap;';
    this.refreshTempPopover();
    const r = this.motorTempEl.getBoundingClientRect();
    const parentR = this.container.getBoundingClientRect();
    this.tempPopover.style.top = `${r.bottom - parentR.top + 4}px`;
    this.tempPopover.style.left = `${r.left - parentR.left}px`;
    this.container.appendChild(this.tempPopover);
    // Dismiss on outside click
    setTimeout(() => {
      const off = (e: PointerEvent) => {
        if (!this.tempPopover) return;
        if (this.motorTempEl.contains(e.target as Node)) return;
        this.tempPopover.remove();
        this.tempPopover = null;
        document.removeEventListener('pointerdown', off);
      };
      document.addEventListener('pointerdown', off);
    }, 0);
  }

  private refreshTempPopover(): void {
    if (!this.tempPopover) return;
    const motor = this.motorTempLastValue;
    const body = this.bodyTempLastValue;
    this.tempPopover.innerHTML = `
      <div><span style="color:#888;">Motor:</span> ${motor != null ? motor + '°C' : '—'}</div>
      <div><span style="color:#888;">Body:</span> ${body != null ? body + '°C' : '—'}</div>
    `;
  }

  setNetworkType(type: string): void {
    this.netTypeEl.textContent = type;
    // Swap the nav-bar WiFi icon based on the actual transport (APK icons)
    let src = '/sprites/icon_wifi.png';
    const upper = type.toUpperCase();
    if (upper === '4G' || upper === 'LTE') src = '/sprites/icon_net_4g.png';
    else if (upper === 'AP') src = '/sprites/icon_net_ap.png';
    else if (upper === 'STA-T' || upper === 'REMOTE') src = '/sprites/icon_net_remote.png';
    else if (upper === 'STA-L') src = '/sprites/icon_net_sta.png';
    if (this.wifiIconEl.getAttribute('src') !== src) this.wifiIconEl.src = src;
  }
}
