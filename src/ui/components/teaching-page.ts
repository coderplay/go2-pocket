// G1 Demo Teaching — port of the native Explorer feature
// (com.unitree.g1_d.ui.teaching.*). Lets the operator record arm/body
// trajectories on the G1 and play them back, with the same safety warnings
// the app shows. All robot I/O is delegated to the host via TeachingCallbacks;
// this component owns only the UI + the list/create/play flow.

export interface TeachAction {
  name: string;
  id: number;
  time: number; // duration in seconds
}

export interface TeachingCallbacks {
  /** api 7107 — returns the recorded-action list (already unwrapped to [1]). */
  getList: () => Promise<TeachAction[]>;
  /** api 7108 — play an action by name. Resolves with the robot status code (0 = ok). */
  play: (name: string) => Promise<number>;
  /** api 7113 — stop playback / exit teach mode. */
  stopPlay: () => void;
  /** sport api 7101 {data:1} — enter damping (emergency relax). */
  damp: () => void;
  /** api 7109 — rename. Resolves with status code. */
  rename: (oldName: string, newName: string) => Promise<number>;
  /** api 7112 — delete a saved action. */
  remove: (name: string) => Promise<number>;
  /** api 7110 {action_name} — begin recording; host also starts the 1 Hz
   *  keepalive heartbeat. Resolves with the robot status code (0 = ok). */
  startRecord: (name: string) => Promise<number>;
  /** api 7110 (no param) — finalize recording; host stops the heartbeat.
   *  Resolves with the robot status code (0 = ok). */
  stopRecord: () => Promise<number>;
  /** api 7111 {pause} — pause/resume recording. */
  pauseRecord: (pause: boolean) => void;
  /** api 7112 {action_name} — discard the in-progress recording. */
  deleteRecord: (name: string) => void;
}

// Exact strings from the app (res/values/strings.xml, teaching_*).
const TXT = {
  listTitle: 'Demo Teaching',
  create: 'Create teaching',
  maxTip: 'Up to 15 actions can be created',
  recordSafety:
    'Safety: Before teaching, keep the robot standing under control. Ensure smooth trajectories, stable balance, and avoid self-collision or singularities.',
  recordConfirm: 'Confirm you understand the safety rules?',
  playTip:
    'Ensure personnel safety and keep sufficient space for the robot. Operators should hold the remote controller or app, and perform emergency stops if needed.',
  dampTip: 'Enter damping mode?',
  saveTip: 'Save the current teaching action?',
  nameExist: 'Filename already exists.',
  err7404: 'Ensure the robot is in a balanced standing',
  start: 'Start Teaching',
  stop: 'End Teaching',
  pause: 'Pause',
  resume: 'Continue',
  play: 'Play',
  stopPlay: 'Stop',
  damp: 'E-Stop',
} as const;

const MAX_ACTIONS = 15;
const MAX_RECORD_SECS = 180; // app caps a single take at 3 minutes
const ACK_KEY = 'teach_safety_ack';

let stylesInjected = false;

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export class TeachingPage {
  readonly element: HTMLElement;
  private cb: TeachingCallbacks;
  private onBack: () => void;

  private view: 'list' | 'create' | 'play' = 'list';
  private actions: TeachAction[] = [];

  // create state
  private recording = false;     // actively capturing (UI: stop button + timer)
  private recordSaving = false;  // stop sent, waiting for the robot's id==0 save signal ("Finalizing…")
  private recordPaused = false;
  private recordName = '';
  private recordSecs = 0;
  private recordTimer = 0;
  private saveFallback = 0;      // timeout that offers Save anyway if id==0 never arrives

  // play state
  private playName = '';
  private playing = false;
  private playSecs = 0;
  private playDuration = 0;
  private playTimer = 0;

  // Mirrors the app's stateLiveData (init 0): a state id equal to the last one
  // is ignored. This is what stops the constantly-streamed idle id:0 from
  // instantly aborting playback — only a 0 *after* a non-zero state counts.
  private lastActionId = 0;

  private bodyEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private badgeEl!: HTMLElement;

  constructor(parent: HTMLElement, onBack: () => void, cb: TeachingCallbacks) {
    this.onBack = onBack;
    this.cb = cb;
    injectStyles();

    this.element = document.createElement('div');
    this.element.className = 'teach-page';
    this.element.innerHTML = `
      <div class="page-header">
        <button class="page-back-btn teach-back"><img src="/sprites/nav-bar-left-icon.png" alt="Back" /></button>
        <h2 class="teach-title">${TXT.listTitle}</h2>
        <span class="page-header-badge teach-badge"></span>
      </div>
      <div class="teach-body"></div>
    `;
    this.bodyEl = this.element.querySelector('.teach-body')!;
    this.titleEl = this.element.querySelector('.teach-title')!;
    this.badgeEl = this.element.querySelector('.teach-badge')!;
    this.element.querySelector('.teach-back')!.addEventListener('click', () => this.handleBack());
    parent.appendChild(this.element);

    this.renderList();
    void this.refreshList();
  }

  // ── host → page state pushes ────────────────────────────────────────────

  /** rt/arm/action/state { id }. Interpreted per current view. The robot
   *  streams this continuously; dedupe against the last id like the app so a
   *  repeated value (e.g. idle 0) doesn't re-fire transitions. */
  setActionState(id: number): void {
    if (id === this.lastActionId) return;
    this.lastActionId = id;
    if (this.view === 'create') {
      // Mirror the app: id==0 after stop means "recording saved" → offer Save.
      if (id === 0 && (this.recordSaving || this.recording)) {
        this.recording = false;
        this.recordSaving = false;
        this.clearSaveFallback();
        this.stopRecordTimer();
        this.promptSave();
      }
    } else if (this.view === 'play') {
      if (id === 0) {
        // playback ended / stopped → leave the player
        this.exitPlay();
      } else if (id === 100) {
        // running — start the countdown from the action's duration
        this.playing = true;
        this.startPlayTimer();
        this.renderPlay();
      }
    }
  }

  setError(msg: string): void {
    this.confirm(msg, { confirmText: 'OK', hideCancel: true });
  }

  async refreshList(): Promise<void> {
    try {
      const list = await this.cb.getList();
      this.actions = Array.isArray(list) ? list : [];
    } catch {
      this.actions = [];
    }
    if (this.view === 'list') this.renderList();
  }

  destroy(): void {
    this.stopRecordTimer();
    this.stopPlayTimer();
    this.clearSaveFallback();
    this.element.remove();
  }

  // ── navigation ──────────────────────────────────────────────────────────

  private handleBack(): void {
    if (this.view === 'create') {
      if (this.recording) { void this.cb.stopRecord(); }
      this.recording = false;
      this.recordSaving = false;
      this.stopRecordTimer();
      this.clearSaveFallback();
      this.view = 'list';
      this.renderList();
      void this.refreshList();
      return;
    }
    if (this.view === 'play') {
      this.cb.stopPlay();
      this.exitPlay();
      return;
    }
    this.onBack();
  }

  // ── LIST view ───────────────────────────────────────────────────────────

  private renderList(): void {
    this.view = 'list';
    this.titleEl.textContent = TXT.listTitle;
    this.badgeEl.textContent = `${this.actions.length}/${MAX_ACTIONS}`;
    this.bodyEl.innerHTML = '';

    const createBtn = document.createElement('button');
    createBtn.className = 'teach-create-btn';
    createBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>${TXT.create}</span>`;
    createBtn.addEventListener('click', () => {
      if (this.actions.length >= MAX_ACTIONS) { this.toast(TXT.maxTip); return; }
      this.enterCreate();
    });
    this.bodyEl.appendChild(createBtn);

    const list = document.createElement('div');
    list.className = 'teach-list';
    if (this.actions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'teach-empty';
      empty.textContent = 'No recorded actions yet.';
      list.appendChild(empty);
    } else {
      this.actions.forEach((a, i) => list.appendChild(this.buildListItem(a, i)));
    }
    this.bodyEl.appendChild(list);
  }

  private buildListItem(a: TeachAction, index: number): HTMLElement {
    const item = document.createElement('div');
    item.className = 'teach-item';

    const playBtn = document.createElement('button');
    playBtn.className = 'teach-item-play';
    playBtn.title = TXT.play;
    playBtn.innerHTML = `<svg width="16" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    playBtn.addEventListener('click', () => this.confirmPlay(a));
    item.appendChild(playBtn);

    const info = document.createElement('div');
    info.className = 'teach-item-info';
    const name = document.createElement('div');
    name.className = 'teach-item-name';
    name.textContent = a.name;
    const meta = document.createElement('div');
    meta.className = 'teach-item-meta';
    meta.textContent = fmtDuration(a.time);
    info.appendChild(name);
    info.appendChild(meta);
    info.addEventListener('click', () => this.confirmPlay(a));
    item.appendChild(info);

    const more = document.createElement('button');
    more.className = 'teach-item-more';
    more.innerHTML = `<span></span><span></span><span></span>`;
    more.addEventListener('click', (e) => { e.stopPropagation(); this.openMore(a, index, more); });
    item.appendChild(more);

    return item;
  }

  private openMore(a: TeachAction, index: number, anchor: HTMLElement): void {
    document.querySelector('.teach-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'teach-menu';
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${Math.max(8, r.right - 130)}px`;
    menu.innerHTML = `
      <button class="teach-menu-item teach-menu-rename">Rename</button>
      <div class="teach-menu-divider"></div>
      <button class="teach-menu-item teach-menu-del">Delete</button>
    `;
    menu.querySelector('.teach-menu-rename')!.addEventListener('click', () => { menu.remove(); this.promptRename(a, index); });
    menu.querySelector('.teach-menu-del')!.addEventListener('click', () => { menu.remove(); this.confirmDelete(a, index); });
    document.body.appendChild(menu);
    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node) && e.target !== anchor) {
        menu.remove();
        document.removeEventListener('mousedown', close, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  }

  private promptRename(a: TeachAction, index: number): void {
    this.input('Rename', a.name, 30, async (newName) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === a.name) return;
      if (this.actions.some((x, i) => i !== index && x.name === trimmed)) {
        this.confirm(TXT.nameExist, { confirmText: 'OK', hideCancel: true });
        return;
      }
      const code = await this.cb.rename(a.name, trimmed);
      if (code === 0) { a.name = trimmed; this.renderList(); }
    });
  }

  private confirmDelete(a: TeachAction, index: number): void {
    this.confirm(`Delete "${a.name}"?`, {
      onConfirm: async () => {
        const code = await this.cb.remove(a.name);
        if (code === 0) { this.actions.splice(index, 1); this.renderList(); }
      },
    });
  }

  // ── CREATE / record view ────────────────────────────────────────────────

  private enterCreate(): void {
    // First-time safety acknowledgement (mirrors BaseApplication.createTeachTip).
    if (localStorage.getItem(ACK_KEY) === '1') {
      this.openCreate();
    } else {
      this.confirm(TXT.recordConfirm, {
        onConfirm: () => { localStorage.setItem(ACK_KEY, '1'); this.openCreate(); },
      });
    }
  }

  private openCreate(): void {
    this.view = 'create';
    this.lastActionId = 0; // fresh "VM": ignore the idle 0 until recording flips it to -1
    this.recording = false;
    this.recordSaving = false;
    this.clearSaveFallback();
    this.recordPaused = false;
    this.recordSecs = 0;
    this.titleEl.textContent = TXT.create;
    this.badgeEl.textContent = '';
    this.renderCreate();
  }

  private renderCreate(): void {
    this.bodyEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'teach-record';

    const safety = document.createElement('div');
    safety.className = 'teach-safety';
    safety.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span>${TXT.recordSafety}</span>`;
    wrap.appendChild(safety);

    const timer = document.createElement('div');
    timer.className = 'teach-timer' + (this.recording ? (this.recordPaused ? ' paused' : ' recording') : '');
    timer.textContent = fmtDuration(this.recordSecs);
    wrap.appendChild(timer);

    if (this.recording && this.recordPaused) {
      const pausedTag = document.createElement('div');
      pausedTag.className = 'teach-paused-tag';
      pausedTag.textContent = 'Paused';
      wrap.appendChild(pausedTag);
    }

    const controls = document.createElement('div');
    controls.className = 'teach-record-controls';

    if (this.recordSaving) {
      // "Finalizing…" — waiting for the robot's id==0 save confirmation.
      const saving = document.createElement('div');
      saving.className = 'teach-saving';
      saving.innerHTML = `<div class="teach-spinner"></div><span>Finalizing…</span>`;
      controls.appendChild(saving);
      wrap.appendChild(controls);
      this.bodyEl.appendChild(wrap);
      return;
    }

    const startBtn = document.createElement('button');
    startBtn.className = 'teach-big-btn' + (this.recording ? ' stop' : ' start');
    startBtn.innerHTML = this.recording
      ? `<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg><span>${TXT.stop}</span>`
      : `<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg><span>${TXT.start}</span>`;
    startBtn.addEventListener('click', () => this.toggleRecord());
    controls.appendChild(startBtn);

    if (this.recording) {
      const pauseBtn = document.createElement('button');
      pauseBtn.className = 'teach-pause-btn';
      pauseBtn.innerHTML = this.recordPaused
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>${TXT.resume}</span>`
        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg><span>${TXT.pause}</span>`;
      pauseBtn.addEventListener('click', () => this.togglePause());
      controls.appendChild(pauseBtn);
    }

    wrap.appendChild(controls);
    this.bodyEl.appendChild(wrap);
  }

  private async toggleRecord(): Promise<void> {
    if (this.recording) {
      // Finalize — follow the app exactly: stop capture, show "Finalizing…",
      // and wait for the robot to push id==0 on rt/arm/action/state before
      // offering Save/Discard (handled in setActionState). The robot has
      // already written the take under its timestamp name; End just stops it.
      // The app trusts that push unconditionally; we add a timeout fallback so
      // a dropped push can't leave the user stuck on the spinner.
      this.recording = false;
      this.recordSaving = true;
      this.stopRecordTimer();
      this.renderCreate();
      void this.cb.stopRecord();
      this.clearSaveFallback();
      this.saveFallback = window.setTimeout(() => {
        if (this.recordSaving) { this.recordSaving = false; this.promptSave(); }
      }, 2500);
      return;
    }
    this.recordName = nowStamp();
    this.recordSecs = 0;
    this.recordPaused = false;
    const code = await this.cb.startRecord(this.recordName);
    if (code !== 0) {
      this.confirm(code === 7404 ? TXT.err7404 : `Could not start teaching (code ${code})`, {
        confirmText: 'OK', hideCancel: true,
      });
      return;
    }
    this.recording = true;
    this.startRecordTimer();
    this.renderCreate();
  }

  private togglePause(): void {
    this.recordPaused = !this.recordPaused;
    this.cb.pauseRecord(this.recordPaused);
    this.renderCreate();
  }

  private promptSave(): void {
    this.renderCreate();
    this.confirm(TXT.saveTip, {
      confirmText: 'Save',
      cancelText: 'Discard',
      onConfirm: () => {
        this.toast('Saved');
        this.view = 'list';
        this.renderList();
        void this.refreshList();
        // The robot may take a moment to flush the take to disk before it
        // appears in the list — re-fetch shortly after to be sure it shows.
        setTimeout(() => { if (this.view === 'list') void this.refreshList(); }, 900);
      },
      onCancel: () => {
        this.cb.deleteRecord(this.recordName);
        this.view = 'list';
        this.renderList();
        void this.refreshList();
      },
    });
  }

  private startRecordTimer(): void {
    this.stopRecordTimer();
    this.recordTimer = window.setInterval(() => {
      // Mirror TeachCreateViewModel.startHeart$2: only advance while not
      // paused and below the 180 s cap. The heartbeat keeps running either way.
      if (this.recordPaused || this.recordSecs >= MAX_RECORD_SECS) return;
      this.recordSecs++;
      const t = this.element.querySelector('.teach-timer');
      if (t) t.textContent = fmtDuration(this.recordSecs);
    }, 1000);
  }

  private stopRecordTimer(): void {
    if (this.recordTimer) { clearInterval(this.recordTimer); this.recordTimer = 0; }
  }

  private clearSaveFallback(): void {
    if (this.saveFallback) { clearTimeout(this.saveFallback); this.saveFallback = 0; }
  }

  // ── PLAY view ───────────────────────────────────────────────────────────

  private confirmPlay(a: TeachAction): void {
    this.confirm(TXT.playTip, {
      confirmText: 'Continue',
      onConfirm: () => this.enterPlay(a),
    });
  }

  private async enterPlay(a: TeachAction): Promise<void> {
    this.view = 'play';
    this.lastActionId = 0; // fresh "VM": idle 0 deduped until the action runs (99/100)
    this.playName = a.name;
    this.playDuration = a.time;
    this.playSecs = a.time;
    this.playing = false;
    this.titleEl.textContent = a.name;
    this.badgeEl.textContent = '';
    this.renderPlay();
    const code = await this.cb.play(a.name);
    if (code !== 0) {
      this.confirm(code === 7404 ? TXT.err7404 : `Could not play (code ${code})`, {
        confirmText: 'OK', hideCancel: true,
        onConfirm: () => { this.cb.stopPlay(); this.exitPlay(); },
      });
    }
  }

  private renderPlay(): void {
    this.bodyEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'teach-play';

    const timer = document.createElement('div');
    timer.className = 'teach-timer' + (this.playing ? ' recording' : '');
    timer.textContent = fmtDuration(this.playSecs);
    wrap.appendChild(timer);

    const controls = document.createElement('div');
    controls.className = 'teach-record-controls';

    const playBtn = document.createElement('button');
    playBtn.className = 'teach-big-btn ' + (this.playing ? 'stop' : 'start');
    playBtn.innerHTML = this.playing
      ? `<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg><span>${TXT.stopPlay}</span>`
      : `<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>${TXT.play}</span>`;
    playBtn.addEventListener('click', () => {
      if (this.playing) { this.cb.stopPlay(); }
      else { void this.enterPlay({ name: this.playName, id: 0, time: this.playDuration }); }
    });
    controls.appendChild(playBtn);

    wrap.appendChild(controls);
    this.bodyEl.appendChild(wrap);

    // Damping = emergency relax, parked at the bottom-right and styled like an
    // e-stop so it reads as the safety control it is.
    const dampBtn = document.createElement('button');
    dampBtn.className = 'teach-damp-estop';
    dampBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>${TXT.damp}</span>`;
    dampBtn.addEventListener('click', () => {
      this.confirm(TXT.dampTip, { onConfirm: () => this.cb.damp() });
    });
    this.bodyEl.appendChild(dampBtn);
  }

  private exitPlay(): void {
    this.playing = false;
    this.stopPlayTimer();
    this.view = 'list';
    this.renderList();
    void this.refreshList();
  }

  private startPlayTimer(): void {
    this.stopPlayTimer();
    this.playSecs = this.playDuration;
    this.playTimer = window.setInterval(() => {
      if (this.playSecs > 0) this.playSecs--;
      const t = this.element.querySelector('.teach-timer');
      if (t) t.textContent = fmtDuration(this.playSecs);
    }, 1000);
  }

  private stopPlayTimer(): void {
    if (this.playTimer) { clearInterval(this.playTimer); this.playTimer = 0; }
  }

  // ── shared overlays ─────────────────────────────────────────────────────

  private confirm(
    message: string,
    opts: {
      confirmText?: string; cancelText?: string; hideCancel?: boolean;
      onConfirm?: () => void; onCancel?: () => void;
    } = {},
  ): void {
    const overlay = document.createElement('div');
    overlay.className = 'teach-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'teach-modal';
    modal.innerHTML = `<div class="teach-modal-msg"></div>`;
    (modal.querySelector('.teach-modal-msg') as HTMLElement).textContent = message;

    const footer = document.createElement('div');
    footer.className = 'teach-modal-footer';
    if (!opts.hideCancel) {
      const cancel = document.createElement('button');
      cancel.className = 'teach-modal-cancel';
      cancel.textContent = opts.cancelText ?? 'Cancel';
      cancel.addEventListener('click', () => { overlay.remove(); opts.onCancel?.(); });
      footer.appendChild(cancel);
    }
    const ok = document.createElement('button');
    ok.className = 'teach-modal-confirm';
    ok.textContent = opts.confirmText ?? 'Confirm';
    ok.addEventListener('click', () => { overlay.remove(); opts.onConfirm?.(); });
    footer.appendChild(ok);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    this.element.appendChild(overlay);
  }

  private input(title: string, value: string, maxLen: number, onOk: (v: string) => void): void {
    const overlay = document.createElement('div');
    overlay.className = 'teach-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'teach-modal';
    modal.innerHTML = `
      <div class="teach-modal-title">${title}</div>
      <input class="teach-modal-input" type="text" maxlength="${maxLen}" />
      <div class="teach-modal-footer">
        <button class="teach-modal-cancel">Cancel</button>
        <button class="teach-modal-confirm">Confirm</button>
      </div>
    `;
    const inp = modal.querySelector('.teach-modal-input') as HTMLInputElement;
    inp.value = value;
    modal.querySelector('.teach-modal-cancel')!.addEventListener('click', () => overlay.remove());
    modal.querySelector('.teach-modal-confirm')!.addEventListener('click', () => { overlay.remove(); onOk(inp.value); });
    overlay.appendChild(modal);
    this.element.appendChild(overlay);
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  }

  private toast(msg: string): void {
    const t = document.createElement('div');
    t.className = 'teach-toast';
    t.textContent = msg;
    this.element.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
.teach-page { position:absolute; inset:0; display:flex; flex-direction:column; background:#1b1c22; color:#e7e9f1; }
.teach-body { flex:1 1 auto; overflow-y:auto; padding:16px; }
.teach-badge { margin-left:auto; font-size:13px; color:#8a8ea3; }

.teach-create-btn { width:100%; height:48px; border:none; border-radius:12px; cursor:pointer;
  background:linear-gradient(230deg,#6879e4,#495abf); color:#fff; font-size:15px; font-weight:600;
  display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:16px; transition:filter .12s; }
.teach-create-btn:hover { filter:brightness(1.08); }

.teach-list { display:flex; flex-direction:column; gap:10px; }
.teach-empty { padding:48px 16px; text-align:center; color:#7c8096; font-size:14px; }

.teach-item { display:flex; align-items:center; gap:12px; height:60px; padding:0 14px;
  background:#262732; border:1px solid #33343f; border-radius:12px; }
.teach-item-play { flex:0 0 auto; width:38px; height:38px; border-radius:50%; border:none; cursor:pointer;
  background:linear-gradient(180deg,#96a8ee,#5d6fd8); color:#fff; display:flex; align-items:center; justify-content:center; }
.teach-item-info { flex:1 1 auto; min-width:0; cursor:pointer; }
.teach-item-name { font-size:15px; color:#e7e9f1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.teach-item-meta { font-size:12px; color:#8a8ea3; margin-top:2px; }
.teach-item-more { flex:0 0 auto; width:34px; height:34px; border:none; background:none; cursor:pointer;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; }
.teach-item-more span { width:4px; height:4px; border-radius:50%; background:#8a8ea3; }

.teach-menu { position:fixed; z-index:100000; width:130px; background:#fff; border-radius:10px;
  padding:6px; box-shadow:0 6px 20px rgba(0,0,0,.35); }
.teach-menu-item { width:100%; border:none; background:none; cursor:pointer; text-align:left;
  font-size:14px; color:#333; padding:8px 10px; border-radius:6px; }
.teach-menu-item:hover { background:rgba(0,0,0,.05); }
.teach-menu-del { color:#e2444a; }
.teach-menu-divider { height:1px; background:rgba(0,0,0,.08); margin:2px 0; }

.teach-record, .teach-play { display:flex; flex-direction:column; align-items:center; gap:28px; padding-top:8px; }
.teach-safety { display:flex; gap:10px; padding:14px 16px; background:rgba(255,183,77,.08);
  border:1px solid rgba(255,183,77,.3); border-radius:12px; color:#ffcf7a; font-size:13px; line-height:1.5; }
.teach-safety svg { flex:0 0 auto; margin-top:2px; }
.teach-timer { font-size:46px; font-weight:300; letter-spacing:2px; color:#c3c9e9; font-variant-numeric:tabular-nums; }
.teach-timer.recording { color:#ff6b6b; }
.teach-timer.paused { color:#ffb56b; }
.teach-paused-tag { margin-top:-18px; font-size:13px; font-weight:600; letter-spacing:1px; color:#ffb56b; text-transform:uppercase; }

.teach-record-controls { display:flex; align-items:center; gap:18px; }
.teach-saving { display:flex; flex-direction:column; align-items:center; gap:14px; color:#c3c9e9; font-size:14px; height:120px; justify-content:center; }
.teach-spinner { width:40px; height:40px; border-radius:50%; border:3px solid rgba(120,130,200,.25); border-top-color:#7b8cf0; animation:teach-spin .8s linear infinite; }
@keyframes teach-spin { to { transform:rotate(360deg); } }
.teach-big-btn { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px;
  width:120px; height:120px; border-radius:50%; border:none; cursor:pointer; font-size:14px; font-weight:600; color:#fff;
  transition:transform .12s; }
.teach-big-btn:active { transform:scale(.96); }
.teach-big-btn.start { background:linear-gradient(180deg,#6879e4,#495abf); }
.teach-big-btn.stop { background:linear-gradient(180deg,#ff6b6b,#d63d44); }
.teach-pause-btn { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px;
  width:84px; height:84px; border-radius:50%; border:1px solid #3a3d49; cursor:pointer; font-size:13px; font-weight:500;
  background:#2a2b36; color:#c3c9e9; transition:background .12s; }
.teach-pause-btn:hover { background:#33343f; }
.teach-damp-estop { position:absolute; right:20px; bottom:20px; z-index:5;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px;
  width:88px; height:88px; border-radius:50%; border:none; cursor:pointer;
  font-size:13px; font-weight:700; letter-spacing:.5px; color:#fff;
  background:radial-gradient(circle at 50% 38%, #ff5b5b, #d0202a);
  box-shadow:0 6px 18px rgba(208,32,42,.45), inset 0 -3px 8px rgba(0,0,0,.25);
  transition:transform .1s, filter .12s; }
.teach-damp-estop:hover { filter:brightness(1.07); }
.teach-damp-estop:active { transform:scale(.95); }

.teach-modal-overlay { position:absolute; inset:0; background:rgba(0,0,0,.6); z-index:9999;
  display:flex; align-items:center; justify-content:center; }
.teach-modal { width:340px; max-width:88vw; background:#2c2d3a; border-radius:14px; overflow:hidden;
  box-shadow:0 10px 40px rgba(0,0,0,.5); }
.teach-modal-title { padding:18px 20px 0; font-size:16px; font-weight:600; color:#fff; }
.teach-modal-msg { padding:24px 20px; font-size:14px; line-height:1.6; color:#d7dae6; text-align:center; }
.teach-modal-input { margin:14px 20px; width:calc(100% - 40px); height:38px; box-sizing:border-box;
  background:#1f2029; border:1px solid #3a3d49; border-radius:8px; color:#fff; font-size:14px; padding:0 10px; outline:none; }
.teach-modal-footer { display:flex; border-top:1px solid #3a3d49; }
.teach-modal-footer button { flex:1 1 0; height:48px; border:none; background:none; cursor:pointer; font-size:15px; font-weight:500; }
.teach-modal-cancel { color:#9aa0b4; border-right:1px solid #3a3d49; }
.teach-modal-confirm { color:#7b8cf0; font-weight:600; }

.teach-toast { position:absolute; bottom:40px; left:50%; transform:translateX(-50%); z-index:10001;
  background:rgba(0,0,0,.85); color:#fff; padding:10px 18px; border-radius:20px; font-size:13px; }

/* Light theme */
html[data-theme="light"] .teach-page { background:#f2f3f7; color:#1a1d23; }
html[data-theme="light"] .teach-item { background:#fff; border-color:#d4d9e4; }
html[data-theme="light"] .teach-item-name { color:#1a1d23; }
html[data-theme="light"] .teach-timer { color:#3d4c8c; }
html[data-theme="light"] .teach-big-btn.start { color:#fff; }
html[data-theme="light"] .teach-pause-btn { background:#fff; border-color:#d4d9e4; color:#3d4c8c; }
html[data-theme="light"] .teach-modal { background:#fff; }
html[data-theme="light"] .teach-modal-title, html[data-theme="light"] .teach-modal-msg { color:#1a1d23; }
html[data-theme="light"] .teach-modal-input { background:#f2f3f7; border-color:#c4cbd6; color:#1a1d23; }
html[data-theme="light"] .teach-modal-footer, html[data-theme="light"] .teach-modal-cancel { border-color:#e0e3ec; }
`;
  const style = document.createElement('style');
  style.setAttribute('data-teach-page', '');
  style.textContent = css;
  document.head.appendChild(style);
}
