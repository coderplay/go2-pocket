import { SettingsPage, type SettingsCallbacks, type SettingsState } from './settings-page';

/**
 * Slide-in settings drawer for the WebView control view. Replaces the old
 * floating SettingBar — same controls as the hub-side Settings tab, but
 * presented as an animated right-side panel that the user opens via the
 * 3-dot menu in the NavBar.
 *
 * Mirrors the APK's XPopup `DrawerPopupView` UX (see ErrorsDrawerPop /
 * DefaultSportDrawerPop). Closes on backdrop click, Escape, or the
 * header's close button.
 */
export class SettingsDrawer {
  private overlay: HTMLElement;
  private panel: HTMLElement;
  private body: HTMLElement;
  private inner: SettingsPage;
  private callbacks: SettingsCallbacks;
  private state: SettingsState;
  private onOpenCallbacks: Set<() => void> = new Set();
  private keydownHandler: (e: KeyboardEvent) => void;
  private mounted = false;

  constructor(initial: SettingsState, callbacks: SettingsCallbacks, onDisconnect?: () => void) {
    this.state = { ...initial };
    this.callbacks = callbacks;

    this.overlay = document.createElement('div');
    this.overlay.className = 'settings-drawer-overlay';

    this.panel = document.createElement('div');
    this.panel.className = 'settings-drawer-panel';
    this.overlay.appendChild(this.panel);

    // Drawer header (mirrors the page-header layout but uses an X close
    // button instead of a back button).
    const header = document.createElement('div');
    header.className = 'settings-drawer-header';
    const title = document.createElement('h2');
    title.textContent = 'Controls';
    header.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'settings-drawer-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close controls');
    closeBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);
    this.panel.appendChild(header);

    this.body = document.createElement('div');
    this.body.className = 'settings-drawer-body';
    this.panel.appendChild(this.body);

    // Mount SettingsPage inside the body in embedded mode (no page-header).
    this.inner = new SettingsPage(this.body, this.state, null, this.callbacks);
    if (onDisconnect) {
      const disconnect = document.createElement('button');
      disconnect.type = 'button'; disconnect.className = 'pocket-disconnect';
      disconnect.textContent = 'Disconnect Go2';
      disconnect.addEventListener('click', onDisconnect);
      this.panel.appendChild(disconnect);
    }

    // Close on backdrop click (but not when clicking inside the panel).
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.keydownHandler = (e) => {
      if (e.key === 'Escape' && this.isOpen()) this.close();
    };
  }

  /** Register a callback that fires every time the drawer is opened —
   *  used by App to re-fetch get_rfpower / rm_con / VUI state on entry. */
  onOpen(fn: () => void): void {
    this.onOpenCallbacks.add(fn);
  }

  open(): void {
    if (!this.mounted) {
      document.body.appendChild(this.overlay);
      this.mounted = true;
    }
    document.addEventListener('keydown', this.keydownHandler);
    // Force a reflow so the next-tick class change triggers the transition.
    void this.overlay.offsetWidth;
    this.overlay.classList.add('open');
    for (const cb of this.onOpenCallbacks) cb();
  }

  close(): void {
    this.overlay.classList.remove('open');
    document.removeEventListener('keydown', this.keydownHandler);
  }

  isOpen(): boolean {
    return this.overlay.classList.contains('open');
  }

  /** Push state changes (VUI / OBSTACLE / bashrunner / rm_con responses). */
  setState(partial: Partial<SettingsState>): void {
    Object.assign(this.state, partial);
    this.inner.setState(partial);
  }

  /** Re-fetch the audio library list (called when the drawer opens). */
  refreshAudio(): void {
    this.inner.refreshAudio();
  }

  /** Push a robot play-state update into the audio player. */
  setAudioPlayState(state: { is_playing?: boolean; current_audio_unique_id?: string | null }): void {
    this.inner.setAudioPlayState(state);
  }

  destroy(): void {
    document.removeEventListener('keydown', this.keydownHandler);
    if (this.mounted) {
      this.overlay.remove();
      this.mounted = false;
    }
    this.onOpenCallbacks.clear();
  }
}
