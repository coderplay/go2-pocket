/**
 * Global app-settings store — theme reference + per-category console
 * logging on/off. Persists each preference to its own localStorage key.
 *
 * Logging model: every call site is routed through `log.<category>.*`
 * which forwards to the matching `console.{info,debug,warn,error}`
 * method when (a) the global gate is on AND (b) that category is on.
 * Verbosity (info / debug / warn / error visibility) is controlled by
 * Chrome's DevTools "Default levels" filter — we don't try to gate
 * that ourselves anymore.
 */

export type LogCategory = 'webrtc' | 'account' | 'bluetooth' | 'ui' | 'scene';
export const LOG_CATEGORIES: ReadonlyArray<LogCategory> = ['webrtc', 'account', 'bluetooth', 'ui', 'scene'];

const STORAGE_KEY_ENABLED = 'unitree_ui.consoleLog.enabled';
const STORAGE_KEY_CATEGORY_PREFIX = 'unitree_ui.consoleLog.category.';
// Old (level-based) storage key still consulted once on first read so
// upgrading users don't lose their preference.
const STORAGE_KEY_LEGACY_LEVEL_PREFIX = 'unitree_ui.consoleLog.level.';

type Listener = () => void;

class AppSettingsStore {
  private enabled: boolean;
  private categories: Record<LogCategory, boolean>;
  private listeners: Set<Listener> = new Set();

  constructor() {
    // Default: global on, every category on. Chrome's level filter is
    // the volume control — by default the user sees everything, but
    // they can switch off a category in Settings to silence it
    // completely (e.g. mute 'scene' while debugging 'webrtc').
    this.enabled = localStorage.getItem(STORAGE_KEY_ENABLED) !== 'false';
    this.categories = {} as Record<LogCategory, boolean>;
    for (const cat of LOG_CATEGORIES) {
      this.categories[cat] = this.loadCategoryFlag(cat);
    }
  }

  /** Migration-aware reader: prefers the new boolean key, falls back to
   *  the old level key (anything but 'none' counts as on), defaults to
   *  on when neither is set. */
  private loadCategoryFlag(cat: LogCategory): boolean {
    const raw = localStorage.getItem(STORAGE_KEY_CATEGORY_PREFIX + cat);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    const legacy = localStorage.getItem(STORAGE_KEY_LEGACY_LEVEL_PREFIX + cat);
    if (legacy === 'none') return false;
    return true;
  }

  /** Global kill-switch. When false, no logs emit regardless of
   *  per-category state. */
  isEnabled(): boolean { return this.enabled; }

  setEnabled(value: boolean): void {
    if (value === this.enabled) return;
    this.enabled = value;
    localStorage.setItem(STORAGE_KEY_ENABLED, String(value));
    this.notify();
  }

  isCategoryEnabled(cat: LogCategory): boolean { return this.categories[cat]; }

  setCategoryEnabled(cat: LogCategory, value: boolean): void {
    if (this.categories[cat] === value) return;
    this.categories[cat] = value;
    localStorage.setItem(STORAGE_KEY_CATEGORY_PREFIX + cat, String(value));
    this.notify();
  }

  /** A call passes when both the global kill-switch and the category
   *  switch are on. Chrome's DevTools log-level filter handles
   *  info/debug/warn/error visibility from there. */
  shouldEmit(cat: LogCategory): boolean {
    return this.enabled && this.categories[cat];
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) {
      try { cb(); } catch { /* ignore listener crashes */ }
    }
  }
}

let _instance: AppSettingsStore | null = null;
export function appSettings(): AppSettingsStore {
  if (!_instance) _instance = new AppSettingsStore();
  return _instance;
}
