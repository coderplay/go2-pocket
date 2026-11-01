/**
 * Gated logger. Each call routes to the matching `console.{info,debug,
 * warn,error}` method so Chrome's DevTools "Default levels" filter is
 * the verbosity control: tick "Verbose" to see debug, untick "Info" to
 * hide info, etc. The in-app Settings page only controls *which
 * categories* emit — a category-off entry mutes all four channels for
 * that bucket; a category-on entry lets everything flow through to
 * console and Chrome decides what's visible.
 *
 * Pattern:
 *   import { log } from '../ui/logger';
 *   log.webrtc.info('connected');     → console.info('[webrtc]', ...)
 *   log.account.debug('payload:', x); → console.debug('[account]', ...)
 *   log.bluetooth.error('pair failed', err);
 *
 * A global kill-switch (Settings → "Enable console logging") suppresses
 * every call site at once when off.
 */

import { appSettings, type LogCategory } from './app-settings';

type CategoryLogger = {
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  group: (label: string) => void;
  groupEnd: () => void;
};

function makeCategory(cat: LogCategory): CategoryLogger {
  const prefix = `[${cat}]`;
  return {
    info:  (...args) => { if (appSettings().shouldEmit(cat)) console.info(prefix, ...args); },
    debug: (...args) => { if (appSettings().shouldEmit(cat)) console.debug(prefix, ...args); },
    warn:  (...args) => { if (appSettings().shouldEmit(cat)) console.warn(prefix, ...args); },
    error: (...args) => { if (appSettings().shouldEmit(cat)) console.error(prefix, ...args); },
    // console.groupCollapsed keeps the header alone on screen — the user
    // clicks the chevron to peek inside. Contents emitted via .info /
    // .debug etc. respect Chrome's "Default levels" filter once expanded.
    group: (label) => { if (appSettings().shouldEmit(cat)) console.groupCollapsed(`${prefix} ${label}`); },
    groupEnd: () => { if (appSettings().shouldEmit(cat)) console.groupEnd(); },
  };
}

export const log = {
  webrtc:    makeCategory('webrtc'),
  account:   makeCategory('account'),
  bluetooth: makeCategory('bluetooth'),
  ui:        makeCategory('ui'),
  scene:     makeCategory('scene'),
} as const;

/** Listen for log frames from a Web Worker and route them through the
 *  given category. Workers post `{type: '__log__', level, args}` via
 *  workerLog (src/workers/worker-logger.ts); we forward to the
 *  in-app-gated logger so the user can mute / verbose them from the
 *  Settings page just like any other category.
 *
 *  Host-side onmessage handlers should still check
 *  `e.data?.type === '__log__'` and bail before they try to interpret
 *  the frame as a domain payload — both listeners receive every
 *  message. */
export function pipeWorkerLogs(worker: Worker, category: LogCategory): void {
  worker.addEventListener('message', (e: MessageEvent) => {
    const m = e.data;
    if (!m || m.type !== '__log__' || typeof m.level !== 'string') return;
    const sink = log[category];
    const args = Array.isArray(m.args) ? m.args : [];
    switch (m.level as 'info' | 'debug' | 'warn' | 'error') {
      case 'info':  sink.info(...args);  break;
      case 'debug': sink.debug(...args); break;
      case 'warn':  sink.warn(...args);  break;
      case 'error': sink.error(...args); break;
    }
  });
}
