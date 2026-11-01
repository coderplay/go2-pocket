import { theme } from '../theme';
import { appSettings, LOG_CATEGORIES, type LogCategory } from '../app-settings';

/**
 * Landing-screen Settings page — app-wide preferences that don't depend
 * on an active robot connection (vs the hub's robot Controls page, which
 * controls volume / radar / lidar etc. on a live connection).
 *
 * Currently exposes:
 *   - Theme: light / dark (mirrors the global ThemeToggle icon in the corner).
 *   - Console logging: master kill-switch + per-category on/off toggle.
 *     Verbosity (info / debug / warn / error visibility) is controlled
 *     by Chrome DevTools' "Default levels" filter — we don't try to
 *     gate that ourselves.
 */
export class AppSettingsPage {
  private container: HTMLElement;

  constructor(parent: HTMLElement, onBack: () => void) {
    this.container = document.createElement('div');
    this.container.className = 'settings-page';

    const header = document.createElement('div');
    header.className = 'page-header';
    const backBtn = document.createElement('button');
    backBtn.className = 'page-back-btn';
    backBtn.innerHTML = `<img src="/sprites/nav-bar-left-icon.png" alt="Back" />`;
    backBtn.addEventListener('click', onBack);
    header.appendChild(backBtn);
    const title = document.createElement('h2');
    title.textContent = 'Settings';
    header.appendChild(title);
    this.container.appendChild(header);

    const content = document.createElement('div');
    content.className = 'page-content';

    // ── Appearance ─────────────────────────────────────────────────────
    const appearance = this.buildCategory('Appearance');
    appearance.appendChild(this.buildToggleSection(
      'Dark mode',
      'Use dark colors throughout the app. Light mode uses a soft off-white.',
      theme().theme === 'dark',
      (enabled) => theme().set(enabled ? 'dark' : 'light'),
    ));
    content.appendChild(appearance);

    // ── Console Logging ────────────────────────────────────────────────
    const logging = this.buildCategory('Console Logging');
    logging.appendChild(this.buildToggleSection(
      'Enable console logging',
      'Master kill-switch. When off, no logs reach the browser console regardless of category. Verbosity (Info / Verbose / Warning / Error) is controlled by Chrome DevTools — see the "Default levels" dropdown in the Console panel.',
      appSettings().isEnabled(),
      (enabled) => {
        appSettings().setEnabled(enabled);
        this.refreshCategoryRows();
      },
    ));
    for (const cat of LOG_CATEGORIES) {
      logging.appendChild(this.buildCategoryToggleRow(cat));
    }
    content.appendChild(logging);

    this.container.appendChild(content);
    parent.appendChild(this.container);
  }

  destroy(): void {
    this.container.remove();
  }

  // ── Builders (mirrors the hub SettingsPage idioms) ────────────────────

  private buildCategory(title: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'settings-category';
    const h = document.createElement('div');
    h.className = 'settings-category-title';
    h.textContent = title;
    wrap.appendChild(h);
    return wrap;
  }

  private buildToggleSection(
    title: string,
    description: string,
    initial: boolean,
    onChange: (enabled: boolean) => void,
  ): HTMLElement {
    const section = document.createElement('div');
    section.className = 'settings-section';

    const text = document.createElement('div');
    text.className = 'settings-text';
    const t = document.createElement('div');
    t.className = 'settings-title';
    t.textContent = title;
    text.appendChild(t);
    const d = document.createElement('div');
    d.className = 'settings-desc';
    d.textContent = description;
    text.appendChild(d);

    const ctrl = document.createElement('label');
    ctrl.className = 'settings-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', title);
    input.checked = initial;
    input.addEventListener('change', () => onChange(input.checked));
    const slider = document.createElement('span');
    slider.className = 'settings-toggle-slider';
    ctrl.appendChild(input);
    ctrl.appendChild(slider);

    section.appendChild(text);
    section.appendChild(ctrl);
    return section;
  }

  /** Per-category on/off toggle row. */
  private buildCategoryToggleRow(cat: LogCategory): HTMLElement {
    const row = this.buildToggleSection(
      labelFor(cat),
      descriptionFor(cat),
      appSettings().isCategoryEnabled(cat),
      (enabled) => appSettings().setCategoryEnabled(cat, enabled),
    );
    row.classList.add('log-category-row');
    row.dataset.category = cat;
    this.applyDisabledStyle(row);
    return row;
  }

  /** Visually de-emphasize per-category rows when the global gate is off. */
  private refreshCategoryRows(): void {
    const rows = this.container.querySelectorAll('.log-category-row');
    for (const row of Array.from(rows) as HTMLElement[]) {
      this.applyDisabledStyle(row);
    }
  }

  private applyDisabledStyle(row: HTMLElement): void {
    row.classList.toggle('settings-section-muted', !appSettings().isEnabled());
  }
}

function labelFor(cat: LogCategory): string {
  switch (cat) {
    case 'webrtc':    return 'WebRTC';
    case 'account':   return 'Account Manager';
    case 'bluetooth': return 'Bluetooth';
    case 'ui':        return 'UI';
    case 'scene':     return '3D Scene';
  }
}

function descriptionFor(cat: LogCategory): string {
  switch (cat) {
    case 'webrtc':    return 'Connection handshake, peer state, validation, topic publishes/subscribes.';
    case 'account':   return 'Cloud API calls — login, device list, token refresh.';
    case 'bluetooth': return 'BLE pairing, status icon, BT-relay state.';
    case 'ui':        return 'Screen transitions, action-bar dispatch, error / fault store.';
    case 'scene':     return 'Three.js renderer, robot model loader, voxel decoder, SLAM worker.';
  }
}
