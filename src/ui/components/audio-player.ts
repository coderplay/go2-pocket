import { log } from '../logger';

/**
 * Audio Player — faithful re-implementation of the Unitree Go2 app's
 * "Audio Player" (audiohub / megaphone) screen, rebuilt from the decompiled
 * web frontend (frontend_1.11.4). Two-column layout: a record control on the
 * left, an upload button + scrollable recording list on the right. Per-row
 * play/pause, a 3-state loop toggle, rename modal, and immediate delete —
 * matching the original API map (1001–1010, 2001) and colour tokens.
 */

export type LoopMode = 'single_cycle' | 'list_loop' | 'no_cycle';

/** Per-family audiohub API map. Go2 and G1 differ substantially: G1 has no
 *  pause/resume (only a single stop), no loop mode, and uses different ids for
 *  rename/delete. See the firmware audio_player service for each family. */
export interface AudioApi {
  list: number;          // get audio list (1001 both)
  play: number;          // start playing a track (1002 both)
  stop: number;          // stop/pause playback (Go2 pause 1003 / G1 stop 1005)
  rename: number;        // rename a track (Go2 1008 / G1 1003)
  del: number;           // delete a track (Go2 1009 / G1 1004)
  loopSet: number | null;  // set play mode (Go2 1007 / G1 unsupported)
  loopGet: number | null;  // get play mode (Go2 1010 / G1 unsupported)
}

export const GO2_AUDIO_API: AudioApi = {
  list: 1001, play: 1002, stop: 1003, rename: 1008, del: 1009, loopSet: 1007, loopGet: 1010,
};
export const G1_AUDIO_API: AudioApi = {
  list: 1001, play: 1002, stop: 1005, rename: 1003, del: 1004, loopSet: null, loopGet: null,
};

export interface AudioPlayerCallbacks {
  /** Per-family audiohub API id map. Defaults to the Go2 map if omitted. */
  api?: AudioApi;
  /** Publish an audiohub request and resolve with the parsed response. */
  publishRequest: (apiId: number, payload: string) => Promise<unknown>;
  /** Synchronously return the last cached audio-list response (api 1001), if
   *  any, so the list renders instantly on open while a fresh fetch runs. */
  getCachedList?: () => unknown;
  /** Begin recording the microphone. */
  onRecordStart?: () => Promise<void> | void;
  /** Stop recording and save the clip to the library. `onProgress` reports
   *  0–100 as the recorded WAV uploads. Resolves when saved. */
  onRecordStop?: (onProgress: (pct: number) => void) => Promise<void> | void;
  /** Upload a user-picked audio file from the browser. `onProgress` is called
   *  with 0–100 as conversion + chunk upload proceeds. */
  onUploadFile?: (file: File, onProgress: (pct: number) => void) => Promise<void> | void;
}

interface AudioFile {
  UNIQUE_ID: string;
  CUSTOM_NAME: string;
  ADD_TIME?: string | number;
  FILE_SIZE?: number;
}

const MAX_RECORDINGS = 10;
const MAX_NAME_LEN = 40;
const LOOP_ORDER: LoopMode[] = ['single_cycle', 'list_loop', 'no_cycle'];
const LOOP_ICON: Record<LoopMode, string> = {
  single_cycle: '/sprites/audio_single_cycle.svg',
  list_loop: '/sprites/audio_list_loop.svg',
  no_cycle: '/sprites/audio_no_cycle.svg',
};
const LOOP_LABEL: Record<LoopMode, string> = {
  single_cycle: 'Repeat one',
  list_loop: 'Repeat all',
  no_cycle: 'No repeat',
};

let stylesInjected = false;

/** Build the inline style for a single-colour icon rendered as a CSS mask —
 *  this lets the SVG shape take any `background-color` (unlike <img>, which
 *  can't inherit currentColor and would render the asset's intrinsic fill). */
function maskStyle(src: string, w: number, h: number, color: string): string {
  return (
    `display:inline-block;width:${w}px;height:${h}px;background-color:${color};` +
    `-webkit-mask:url(${src}) no-repeat center/contain;mask:url(${src}) no-repeat center/contain;`
  );
}
/** Swap the mask asset on an existing masked-icon span. */
function setMask(el: HTMLElement, src: string): void {
  el.style.webkitMaskImage = `url(${src})`;
  el.style.maskImage = `url(${src})`;
}

export class AudioPlayer {
  element: HTMLElement;
  private cb: AudioPlayerCallbacks;
  private api: AudioApi;
  private files: AudioFile[] = [];
  private playingId: string | null = null;
  private loopMode: LoopMode = 'list_loop';
  private recording = false;
  private recordTimer: number | null = null;
  private recordSeconds = 0;

  // refs
  private listEl!: HTMLElement;
  private recordBtn!: HTMLButtonElement;
  private recordIcon!: HTMLSpanElement;
  private timerEl!: HTMLElement;
  private loopBtn!: HTMLButtonElement;
  private loopIcon!: HTMLSpanElement;
  private openMenuId: string | null = null;

  constructor(cb: AudioPlayerCallbacks) {
    this.cb = cb;
    this.api = cb.api ?? GO2_AUDIO_API;
    injectStyles();
    this.element = document.createElement('div');
    this.element.className = 'aud-player';
    this.build();
    // Render instantly from the cached list (warmed on connect) so the user
    // sees songs immediately, then refresh in the background.
    const cached = this.cb.getCachedList?.();
    if (cached != null) {
      const files = parseAudioList(cached);
      if (files.length) {
        this.files = files;
        this.listLoaded = true;
      }
    }
    this.renderList();
    void this.loadList();
    void this.loadLoopMode();
    // Close any open row menu on outside click.
    document.addEventListener('click', this.onDocClick);
  }

  private onDocClick = (): void => {
    if (this.openMenuId) {
      this.closeRowMenu();
      this.renderList();
    }
  };

  private build(): void {
    // ── Top: controls row (record + timer · loop · upload) ──
    const controls = document.createElement('div');
    controls.className = 'aud-controls';

    // Record button + timer
    const recordCol = document.createElement('div');
    recordCol.className = 'aud-record-col';

    this.recordBtn = document.createElement('button');
    this.recordBtn.type = 'button';
    this.recordBtn.className = 'aud-record-btn';
    const inner = document.createElement('span');
    inner.className = 'aud-record-inner';
    this.recordIcon = document.createElement('span');
    this.recordIcon.style.cssText = maskStyle('/sprites/audio_mic.svg', 30, 30, '#7b8cf0');
    inner.appendChild(this.recordIcon);
    this.recordBtn.appendChild(inner);
    this.recordBtn.addEventListener('click', () => this.toggleRecord());
    recordCol.appendChild(this.recordBtn);

    this.timerEl = document.createElement('div');
    this.timerEl.className = 'aud-timer';
    this.timerEl.textContent = 'Click to record';
    recordCol.appendChild(this.timerEl);

    controls.appendChild(recordCol);

    // Upload button (compact, sits between the timer and the loop toggle)
    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'aud-upload-btn';
    uploadBtn.innerHTML =
      `<span style="${maskStyle('/sprites/audio_upload.svg', 16, 16, '#fff')}"></span><span>Upload Audio</span>`;
    uploadBtn.addEventListener('click', () => this.pickAndUpload());
    controls.appendChild(uploadBtn);

    // Loop-mode toggle (far right)
    this.loopBtn = document.createElement('button');
    this.loopBtn.type = 'button';
    this.loopBtn.className = 'aud-loop-btn';
    this.loopIcon = document.createElement('span');
    this.loopIcon.style.cssText = maskStyle(LOOP_ICON[this.loopMode], 24, 22, '#303133');
    this.loopBtn.appendChild(this.loopIcon);
    this.loopBtn.addEventListener('click', () => this.cycleLoopMode());
    // Loop mode is Go2-only; G1's audio_hub has no play-mode api. When hidden,
    // right-align the upload button so the row stays balanced.
    if (this.api.loopSet != null) {
      controls.appendChild(this.loopBtn);
    } else {
      uploadBtn.style.marginLeft = 'auto';
    }

    this.element.appendChild(controls);

    // ── Bottom: full-width recording list ──
    this.listEl = document.createElement('div');
    this.listEl.className = 'aud-list';
    this.element.appendChild(this.listEl);

    this.updateLoopIcon();
  }

  // ── Data ──

  private loading = false;
  private pendingReload = false;
  private listLoaded = false;

  private async loadList(): Promise<void> {
    // Serialize: if a fetch is already in flight, mark that one more refresh
    // is wanted and let the current one finish first. This avoids overlapping
    // 1001 requests whose responses race.
    if (this.loading) {
      this.pendingReload = true;
      return;
    }
    this.loading = true;
    try {
      const resp = await this.cb.publishRequest(this.api.list, '{}');
      // A null response means the request failed or timed out. Do NOT clobber
      // an already-populated list with an empty one in that case — keep what
      // we have and try again later. (This was the "appear then disappear"
      // bug: a slow second fetch timed out and wiped the freshly-loaded list.)
      if (resp == null) {
        if (!this.listLoaded) this.renderList();
        return;
      }
      this.files = parseAudioList(resp);
      this.listLoaded = true;
      this.renderList();
    } catch (err) {
      log.ui.error('audio: list failed', err);
      if (!this.listLoaded) this.renderList();
    } finally {
      this.loading = false;
      if (this.pendingReload) {
        this.pendingReload = false;
        void this.loadList();
      }
    }
  }

  private async loadLoopMode(): Promise<void> {
    if (this.api.loopGet == null) return; // family has no loop mode (G1)
    try {
      const resp = await this.cb.publishRequest(this.api.loopGet, '{}');
      const mode = parsePlayMode(resp);
      if (mode) {
        this.loopMode = mode;
        this.updateLoopIcon();
      }
    } catch {
      /* keep default */
    }
  }

  private renderList(): void {
    this.listEl.innerHTML = '';

    if (this.files.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'aud-empty';
      empty.textContent = 'No audio';
      this.listEl.appendChild(empty);
      return;
    }

    for (const f of this.files) {
      const selected = f.UNIQUE_ID === this.playingId;
      const isPlaying = selected && this.playingId !== null && this.playingState;

      const wrap = document.createElement('div');
      wrap.className = 'aud-item-wrap' + (selected ? ' selected' : '');

      const item = document.createElement('div');
      item.className = 'aud-item';

      // play / pause
      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'aud-play';
      const playImg = document.createElement('span');
      playImg.style.cssText = maskStyle(
        isPlaying ? '/sprites/audio_pause.svg' : '/sprites/audio_play.svg',
        14, 16, '#c3c9e9',
      );
      playBtn.appendChild(playImg);
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePlay(f);
      });
      item.appendChild(playBtn);

      // info — name uses a marquee track so long names scroll fully into view
      const info = document.createElement('div');
      info.className = 'aud-info';
      const name = document.createElement('div');
      name.className = 'aud-name';
      const nameText = document.createElement('span');
      nameText.className = 'aud-name-text';
      nameText.textContent = f.CUSTOM_NAME;
      name.appendChild(nameText);
      info.appendChild(name);
      const dt = document.createElement('span');
      dt.className = 'aud-datetime';
      dt.textContent = formatAddTime(f.ADD_TIME);
      info.appendChild(dt);
      item.appendChild(info);

      // kebab menu — the dropdown itself is rendered as a fixed-position
      // floating element (see showRowMenu) so it isn't clipped by the
      // scrolling list container.
      const menuWrap = document.createElement('div');
      menuWrap.className = 'aud-menu-wrap';
      const kebab = document.createElement('button');
      kebab.type = 'button';
      kebab.className = 'aud-kebab' + (selected ? ' selected' : '');
      kebab.innerHTML = `<span></span><span></span><span></span>`;
      kebab.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.openMenuId === f.UNIQUE_ID) {
          this.closeRowMenu();
        } else {
          this.showRowMenu(f, kebab);
        }
      });
      menuWrap.appendChild(kebab);

      item.appendChild(menuWrap);
      wrap.appendChild(item);
      this.listEl.appendChild(wrap);
    }

    // After layout, start a marquee on any name that overflows its track so
    // the full title scrolls into view (ping-pong, pausing at both ends).
    requestAnimationFrame(() => this.applyMarquees());
  }

  /** Measure each name; if it overflows, animate it left by the overflow
   *  amount and back so the whole title is readable. */
  private applyMarquees(): void {
    const names = this.listEl.querySelectorAll<HTMLElement>('.aud-name');
    names.forEach((box) => {
      const text = box.firstElementChild as HTMLElement | null;
      if (!text) return;
      const overflow = text.scrollWidth - box.clientWidth;
      if (overflow > 4) {
        // ~28px/s travel, min 4s, so longer names scroll proportionally.
        const dur = Math.max(4, Math.round((overflow / 28) * 2 + 2));
        text.style.setProperty('--aud-shift', `-${overflow + 6}px`);
        text.style.animation = `aud-marquee ${dur}s ease-in-out infinite alternate`;
      } else {
        text.style.animation = '';
      }
    });
  }

  private floatingMenu: HTMLElement | null = null;

  /** Build a fixed-position Rename/Delete dropdown anchored to the kebab,
   *  appended to <body> so no ancestor `overflow` can clip it. */
  private showRowMenu(f: AudioFile, anchor: HTMLElement): void {
    this.closeRowMenu();
    this.openMenuId = f.UNIQUE_ID;

    const menu = document.createElement('div');
    menu.className = 'aud-menu aud-menu-floating';

    const renameItem = document.createElement('button');
    renameItem.type = 'button';
    renameItem.className = 'aud-menu-item';
    renameItem.innerHTML =
      `<span style="${maskStyle('/sprites/audio_edit.svg', 13, 13, '#4b4c4d')}"></span><span>Rename</span>`;
    renameItem.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeRowMenu();
      this.openRenameModal(f);
    });
    menu.appendChild(renameItem);

    const divider = document.createElement('div');
    divider.className = 'aud-menu-divider';
    menu.appendChild(divider);

    const delItem = document.createElement('button');
    delItem.type = 'button';
    delItem.className = 'aud-menu-item aud-menu-del';
    delItem.innerHTML =
      `<span style="${maskStyle('/sprites/audio_del.svg', 13, 13, '#000')}"></span><span>Delete</span>`;
    delItem.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeRowMenu();
      void this.deleteFile(f);
    });
    menu.appendChild(delItem);

    document.body.appendChild(menu);
    this.floatingMenu = menu;

    // Position below the kebab; flip above if it would overflow the viewport.
    const r = anchor.getBoundingClientRect();
    const mh = menu.offsetHeight;
    const mw = menu.offsetWidth;
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
    let left = r.right - mw;
    if (left < 8) left = 8;
    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.left = `${left}px`;
  }

  private closeRowMenu(): void {
    this.openMenuId = null;
    if (this.floatingMenu) {
      this.floatingMenu.remove();
      this.floatingMenu = null;
    }
  }

  private playingState = false;

  // ── Playback ──

  private async togglePlay(f: AudioFile): Promise<void> {
    const isThisPlaying = this.playingId === f.UNIQUE_ID && this.playingState;
    if (isThisPlaying) {
      // Stop/pause. Go2 pauses (1003); G1 has only a single stop (1005) that
      // takes no parameter (the extra unique_id is ignored).
      this.playingState = false;
      await this.safe(() => this.cb.publishRequest(this.api.stop, JSON.stringify({ unique_id: f.UNIQUE_ID })));
    } else {
      this.playingId = f.UNIQUE_ID;
      this.playingState = true;
      await this.safe(() => this.cb.publishRequest(this.api.play, JSON.stringify({ unique_id: f.UNIQUE_ID })));
    }
    this.renderList();
  }

  // ── Loop mode ──

  private cycleLoopMode(): void {
    if (this.api.loopSet == null) return;
    const idx = LOOP_ORDER.indexOf(this.loopMode);
    this.loopMode = LOOP_ORDER[(idx + 1) % LOOP_ORDER.length];
    this.updateLoopIcon();
    void this.safe(() => this.cb.publishRequest(this.api.loopSet!, JSON.stringify({ play_mode: this.loopMode })));
  }

  private updateLoopIcon(): void {
    setMask(this.loopIcon, LOOP_ICON[this.loopMode]);
    this.loopBtn.title = LOOP_LABEL[this.loopMode];
  }

  // ── Record (captures mic and saves the clip to the library) ──

  private async toggleRecord(): Promise<void> {
    if (this.recording) {
      await this.stopRecord();
    } else {
      await this.startRecord();
    }
  }

  private async startRecord(): Promise<void> {
    try {
      await this.cb.onRecordStart?.();
    } catch (err) {
      log.ui.error('audio: record start failed', err);
      return;
    }
    this.recording = true;
    this.recordSeconds = 0;
    this.recordBtn.classList.add('recording');
    setMask(this.recordIcon, '/sprites/audio_record_stop.svg');
    this.recordIcon.style.width = '30px';
    this.recordIcon.style.height = '30px';
    this.recordIcon.style.backgroundColor = '#e25555';
    this.tickTimer();
    this.recordTimer = window.setInterval(() => {
      this.recordSeconds++;
      this.tickTimer();
      if (this.recordSeconds >= 60) void this.stopRecord();
    }, 1000);
  }

  private async stopRecord(): Promise<void> {
    if (!this.recording) return;
    this.recording = false;
    if (this.recordTimer) {
      clearInterval(this.recordTimer);
      this.recordTimer = null;
    }
    this.recordBtn.classList.remove('recording');
    setMask(this.recordIcon, '/sprites/audio_mic.svg');
    this.recordIcon.style.width = '30px';
    this.recordIcon.style.height = '30px';
    this.recordIcon.style.backgroundColor = '#7b8cf0';
    this.timerEl.textContent = 'Saving…';
    try {
      await this.cb.onRecordStop?.((pct) => {
        this.timerEl.textContent = pct < 100 ? `Saving ${pct}%` : 'Finishing…';
      });
    } catch (err) {
      log.ui.error('audio: record stop failed', err);
    }
    this.timerEl.textContent = 'Click to record';
    // Give the robot a moment to register the new file, then refresh.
    window.setTimeout(() => void this.loadList(), 800);
  }

  private tickTimer(): void {
    const m = Math.floor(this.recordSeconds / 60).toString().padStart(2, '0');
    const s = (this.recordSeconds % 60).toString().padStart(2, '0');
    this.timerEl.textContent = `${m}:${s}`;
  }

  // ── Upload ──

  private pickAndUpload(): void {
    if (this.files.length >= MAX_RECORDINGS) {
      alert(`Cannot exceed ${MAX_RECORDINGS} recordings`);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,.mp3,.wav';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      this.timerEl.textContent = 'Converting…';
      try {
        await this.cb.onUploadFile?.(file, (pct) => {
          this.timerEl.textContent = pct < 100 ? `Uploading ${pct}%` : 'Finishing…';
        });
      } catch (err) {
        log.ui.error('audio: upload failed', err);
        this.timerEl.textContent = 'Upload failed';
        window.setTimeout(() => { this.timerEl.textContent = 'Click to record'; }, 2000);
        return;
      }
      this.timerEl.textContent = 'Click to record';
      window.setTimeout(() => void this.loadList(), 800);
    });
    input.click();
  }

  // ── Rename ──

  private openRenameModal(f: AudioFile): void {
    const overlay = document.createElement('div');
    overlay.className = 'aud-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'aud-modal';
    modal.innerHTML = `
      <div class="aud-modal-title">Please enter audio name</div>
      <div class="aud-modal-content">
        <input class="aud-modal-input" type="text" maxlength="${MAX_NAME_LEN}" placeholder="Recording Name" />
      </div>
      <div class="aud-modal-footer">
        <button type="button" class="aud-modal-cancel">Cancel</button>
        <button type="button" class="aud-modal-confirm">Confirm</button>
      </div>`;

    const input = modal.querySelector('.aud-modal-input') as HTMLInputElement;
    input.value = f.CUSTOM_NAME;
    const close = () => overlay.remove();

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    modal.querySelector('.aud-modal-cancel')!.addEventListener('click', close);
    modal.querySelector('.aud-modal-confirm')!.addEventListener('click', async () => {
      const newName = input.value.trim();
      if (!newName) {
        alert('Enter the audio name.');
        return;
      }
      if (newName.length > MAX_NAME_LEN) {
        alert(`No more than ${MAX_NAME_LEN} characters`);
        return;
      }
      close();
      await this.safe(() =>
        this.cb.publishRequest(this.api.rename, JSON.stringify({ unique_id: f.UNIQUE_ID, new_name: newName })),
      );
      window.setTimeout(() => void this.loadList(), 400);
    });

    overlay.appendChild(modal);
    this.element.appendChild(overlay);
    input.focus();
    input.select();
  }

  // ── Delete (immediate, matching APK — no confirm) ──

  private async deleteFile(f: AudioFile): Promise<void> {
    if (this.playingId === f.UNIQUE_ID) {
      this.playingId = null;
      this.playingState = false;
    }
    await this.safe(() => this.cb.publishRequest(this.api.del, JSON.stringify({ unique_id: f.UNIQUE_ID })));
    window.setTimeout(() => void this.loadList(), 400);
  }

  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      log.ui.error('audio: request failed', err);
    }
  }

  /** Public: refresh the list (e.g. after an external PTT recording). */
  refresh(): void {
    void this.loadList();
  }

  /** Public: apply a play-state push from the robot
   *  (rt/audiohub/player/state) so the playing indicator reflects reality —
   *  e.g. clears when a track ends, or follows the active track in loop mode. */
  setPlayState(state: { is_playing?: boolean; current_audio_unique_id?: string | null }): void {
    const id = state.current_audio_unique_id || null;
    const playing = !!state.is_playing && !!id;
    if (id === this.playingId && playing === this.playingState) return;
    this.playingId = id;
    this.playingState = playing;
    this.renderList();
  }

  destroy(): void {
    document.removeEventListener('click', this.onDocClick);
    this.closeRowMenu();
    if (this.recordTimer) clearInterval(this.recordTimer);
    this.element.remove();
  }
}

// ── helpers ──

export function parseAudioList(resp: unknown): AudioFile[] {
  try {
    let data: any = resp;
    if (data && typeof data === 'object' && 'data' in data) data = (data as any).data;
    if (typeof data === 'string') data = JSON.parse(data);
    if (data && typeof data === 'object' && 'data' in data) {
      const inner = (data as any).data;
      data = typeof inner === 'string' ? JSON.parse(inner) : inner;
    }
    const list = (data && (data.audio_list || data.audioList)) || [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function parsePlayMode(resp: unknown): LoopMode | null {
  try {
    let data: any = resp;
    if (data && typeof data === 'object' && 'data' in data) data = (data as any).data;
    if (typeof data === 'string') data = JSON.parse(data);
    if (data && typeof data === 'object' && 'data' in data) {
      const inner = (data as any).data;
      data = typeof inner === 'string' ? JSON.parse(inner) : inner;
    }
    const mode = data?.play_mode;
    return LOOP_ORDER.includes(mode) ? mode : null;
  } catch {
    return null;
  }
}

function formatAddTime(t: string | number | undefined): string {
  if (t === undefined || t === null || t === '') return '';
  let ms: number;
  if (typeof t === 'number') ms = t < 1e12 ? t * 1000 : t;
  else if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    ms = n < 1e12 ? n * 1000 : n;
  } else {
    return String(t);
  }
  const d = new Date(ms);
  if (isNaN(d.getTime())) return String(t);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
.aud-player { position: relative; background:#2e2e3d; border-radius:12px; padding:16px; margin-top:8px; }

/* top controls row, single line: [record + "Click to record"] · Upload · Loop */
.aud-controls { display:flex; gap:10px; align-items:center; margin-bottom:14px; flex-wrap:nowrap; }
.aud-record-col { flex:0 1 auto; min-width:0; display:flex; align-items:center; gap:9px; }
.aud-record-btn { width:46px; height:46px; border-radius:50%; border:none; cursor:pointer;
  background:linear-gradient(180deg,#ececf8,#aaaac3); display:flex; align-items:center; justify-content:center;
  padding:0; transition:transform .12s; flex:0 0 auto; }
.aud-record-btn:hover { transform:scale(1.05); }
.aud-record-btn:active { transform:scale(.96); }
.aud-record-inner { width:40px; height:40px; border-radius:50%; background:#1d1d26;
  display:flex; align-items:center; justify-content:center; }
.aud-record-btn.recording .aud-record-inner { box-shadow:0 0 0 2px rgba(226,85,85,.6) inset; }
.aud-timer { font-size:12.5px; color:#c3c9e9; text-align:left; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; }

.aud-upload-btn { flex:0 0 auto; height:38px; border-radius:38px; border:none; cursor:pointer;
  background:linear-gradient(230deg,#6879e4,#495abf); color:#fff; font-size:13px; font-weight:500;
  display:flex; align-items:center; justify-content:center; gap:6px; padding:0 14px; transition:filter .12s;
  white-space:nowrap; }
.aud-upload-btn:hover { filter:brightness(1.08); }
.aud-loop-btn { flex:0 0 auto; margin-left:auto; width:38px; height:38px; border-radius:50%; border:none; cursor:pointer;
  background:linear-gradient(180deg,#96a8ee,#5d6fd8); display:flex; align-items:center; justify-content:center;
  transition:transform .12s; }
.aud-loop-btn:hover { transform:scale(1.06); }

/* List rendered as an inset tile: ~3 rows tall, then scrolls with a visible
   custom scrollbar. The floating kebab menu is portalled to <body>, so the
   tile's overflow never clips it. */
.aud-list { display:flex; flex-direction:column; max-height:186px; overflow-y:auto; overflow-x:hidden;
  padding:8px; background:#23232e; border:1px solid #3a3a48; border-radius:12px;
  box-shadow:inset 0 2px 6px rgba(0,0,0,.35);
  scrollbar-width:thin; scrollbar-color:#6879e4 #2e2e3d; }
.aud-list::-webkit-scrollbar { width:10px; }
.aud-list::-webkit-scrollbar-track { background:#2a2a36; border-radius:8px; margin:4px; }
.aud-list::-webkit-scrollbar-thumb { background:linear-gradient(180deg,#6879e4,#495abf);
  border-radius:8px; border:2px solid #2a2a36; }
.aud-list::-webkit-scrollbar-thumb:hover { background:linear-gradient(180deg,#7b8cf0,#5868cc); }
.aud-empty { padding:24px; text-align:center; color:#8a8ea3; font-size:13px; }

.aud-item-wrap { width:100%; border-radius:44px; margin-bottom:10px; padding:1.5px;
  background:#26262f; transition:background .15s; }
.aud-item-wrap.selected { background:linear-gradient(180deg,#96a8ee,#5d6fd8); }
.aud-item { position:relative; display:flex; align-items:center; height:44px; border-radius:44px;
  background:#1f1f1f; padding:0 18px; }
.aud-play { flex:0 0 auto; width:28px; height:28px; border:none; background:none; cursor:pointer;
  display:flex; align-items:center; justify-content:center; padding:0; }
.aud-play img { width:14px; height:16px; color:#c3c9e9; }
.aud-info { flex:1 1 auto; min-width:0; display:flex; align-items:baseline; margin-left:12px; overflow:hidden; }
.aud-name { flex:1 1 auto; min-width:0; overflow:hidden; white-space:nowrap; }
.aud-name-text { display:inline-block; font-size:15px; color:#c3c9e9; white-space:nowrap; will-change:transform; }
@keyframes aud-marquee { 0%,12% { transform:translateX(0); } 88%,100% { transform:translateX(var(--aud-shift,0)); } }
.aud-datetime { flex:0 0 auto; font-size:12px; color:#8a8ea3; margin-left:10px; transform:scale(.9); transform-origin:left center; white-space:nowrap; }
.aud-menu-wrap { position:relative; flex:0 0 auto; margin-left:8px; }
.aud-kebab { width:38px; height:20px; border-radius:20px; border:none; cursor:pointer; padding:0 6px;
  background:#c3c9e9; display:flex; align-items:center; justify-content:space-around; }
.aud-kebab span { width:5px; height:5px; border-radius:50%; background:#1f1f1f; display:block; }
.aud-kebab.selected { background:#fff; }
.aud-menu { width:104px; background:#fff; border-radius:12px;
  padding:8px; box-shadow:0 6px 20px rgba(0,0,0,.35); }
/* Portalled to <body> so the scrolling list never clips it. */
.aud-menu-floating { position:fixed; z-index:100000; }
.aud-menu-item { width:100%; display:flex; align-items:center; gap:6px; border:none; background:none;
  cursor:pointer; font-size:14px; color:#333; padding:6px 8px; border-radius:6px; }
.aud-menu-item:hover { background:rgba(0,0,0,.05); }
.aud-menu-item img { width:13px; height:13px; color:#4b4c4d; }
.aud-menu-del img { color:#000; }
.aud-menu-divider { height:1px; background:rgba(151,151,151,.4); margin:4px 0; }

/* rename modal */
.aud-modal-overlay { position:absolute; inset:0; background:rgba(0,0,0,.7); z-index:9999;
  display:flex; align-items:center; justify-content:center; border-radius:12px; }
.aud-modal { width:340px; max-width:90vw; background:#4a4a5b; border-radius:10px; box-shadow:0 0 2px #3d3d3d; overflow:hidden; }
.aud-modal-title { height:42px; line-height:42px; font-size:16px; color:#fff; text-align:center;
  border-bottom:1px solid rgba(151,151,151,.18); }
.aud-modal-content { padding:24px; }
.aud-modal-input { width:100%; height:30px; background:#757587; border:none; color:#d9d9d9; font-size:14px;
  padding:0 8px; outline:none; border-radius:4px; box-sizing:border-box; }
.aud-modal-footer { display:flex; height:42px; border-top:1px solid rgba(151,151,151,.18); }
.aud-modal-footer button { flex:1 1 0; border:none; background:none; cursor:pointer; font-size:15px; line-height:42px; }
.aud-modal-cancel { color:#ec5e5e; border-right:1px solid rgba(151,151,151,.18); }
.aud-modal-confirm { color:#7483e4; }

/* ── Light theme ─────────────────────────────────────────────────────────
   The player ships with dark surfaces; remap them to the app's light
   palette (surfaces #fff/#eef0f6, borders #d4d9e4, text #1a1d23/#5a6170).
   Accent gradients (record/upload/loop) read fine on both themes. */
html[data-theme="light"] .aud-player { background:#eef0f6; }
html[data-theme="light"] .aud-timer { color:#5a6170; }
html[data-theme="light"] .aud-list { background:#ffffff; border-color:#d4d9e4;
  box-shadow:inset 0 2px 6px rgba(60,75,120,.08); scrollbar-color:#6879e4 #e3e6ef; }
html[data-theme="light"] .aud-list::-webkit-scrollbar-track { background:#e3e6ef; }
html[data-theme="light"] .aud-list::-webkit-scrollbar-thumb { border-color:#e3e6ef; }
html[data-theme="light"] .aud-empty { color:#5a6170; }
html[data-theme="light"] .aud-item-wrap { background:#e2e5ef; }
html[data-theme="light"] .aud-item { background:#ffffff; box-shadow:0 1px 3px rgba(60,75,120,.1); }
html[data-theme="light"] .aud-name-text { color:#1a1d23; }
html[data-theme="light"] .aud-datetime { color:#5a6170; }
html[data-theme="light"] .aud-play span { background-color:#5a6170 !important; }
/* rename modal */
html[data-theme="light"] .aud-modal { background:#ffffff; box-shadow:0 8px 30px rgba(60,75,120,.25); }
html[data-theme="light"] .aud-modal-title { color:#1a1d23; border-bottom-color:#e0e3ec; }
html[data-theme="light"] .aud-modal-input { background:#f2f3f7; color:#1a1d23; border:1px solid #c4cbd6; }
html[data-theme="light"] .aud-modal-footer { border-top-color:#e0e3ec; }
`;
  const style = document.createElement('style');
  style.setAttribute('data-aud-player', '');
  style.textContent = css;
  document.head.appendChild(style);
}
