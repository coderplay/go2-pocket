import { parseAudioList, parsePlayMode, type LoopMode } from './components/audio-player';

export const TRICK_OR_TREAT_RECORDING = 'UserAudio_af9ba';

interface DemoOptions {
  request: (api: number, payload: string) => Promise<unknown>;
  available: () => boolean;
  dance: () => number | undefined;
  stopDance: () => void;
  state: (label: string, busy: boolean) => void;
  error: (message: string) => void;
  now?: () => number;
}

interface DemoRun {
  cancelled: boolean;
  audioId?: string;
  dancing: boolean;
  danceRequest?: number;
  heardPlaying: boolean;
  audioState: 'starting' | 'playing' | 'stopped';
  replayInFlight: boolean;
  audioWarning: boolean;
  sawDance: boolean;
  idleSince: number | null;
  idleSamples: number;
  quietSince: number | null;
  motionAt: number | null;
  progressAt: number | null;
  previousLoop?: LoopMode;
  loopChanged: boolean;
  pendingAudio?: Promise<unknown>;
  angleSample?: { at: number; q: number[] };
}

/** Dance once; maintain the user's recording independently until confirmed done. */
export class TrickOrTreat {
  private run: DemoRun | null = null;
  private replayTimer: ReturnType<typeof setTimeout> | undefined;
  private stopping = false;

  constructor(private options: DemoOptions) {}
  private now(): number { return this.options.now?.() ?? performance.now(); }

  async start(): Promise<void> {
    if (this.run || this.stopping || !this.options.available()) return;
    const run: DemoRun = {
      cancelled: false, dancing: false, heardPlaying: false, audioState: 'starting',
      replayInFlight: false, audioWarning: false, sawDance: false, idleSince: null,
      idleSamples: 0, quietSince: null, motionAt: null, progressAt: null, loopChanged: false,
    };
    this.run = run;
    const check = () => {
      if (run.cancelled || this.run !== run || !this.options.available()) throw new Error('cancelled');
    };
    const request = async (api: number, payload = '{}') => {
      check();
      const reply = await (api === 1002 || api === 1007
        ? this.audioMutation(run, api, payload) : this.options.request(api, payload));
      check(); return reply;
    };
    this.options.state('Preparing…', true);
    try {
      const files = parseAudioList(await request(1001));
      const prefix = TRICK_OR_TREAT_RECORDING.toLowerCase();
      const matches = files.filter(f =>
        (typeof f.CUSTOM_NAME === 'string' && f.CUSTOM_NAME.toLowerCase().startsWith(prefix))
        || (typeof f.UNIQUE_ID === 'string' && (f.UNIQUE_ID.toLowerCase().startsWith(prefix)
          || f.UNIQUE_ID.toLowerCase().startsWith(prefix.replace('useraudio_', '')))));
      if (!matches.length) throw new Error(`Recording ${TRICK_OR_TREAT_RECORDING}… was not found on Go2.`);
      if (matches.length !== 1) throw new Error(`More than one recording matches ${TRICK_OR_TREAT_RECORDING}…`);
      const file = matches[0];
      if (!file.UNIQUE_ID) throw new Error('The selected recording has no playback ID.');
      const previousLoop = parsePlayMode(await request(1010));
      if (!previousLoop) throw new Error('Could not read the audio repeat setting. Try again.');
      run.previousLoop = previousLoop;
      run.loopChanged = true;
      await request(1007, JSON.stringify({ play_mode: 'single_cycle' }));
      run.audioId = file.UNIQUE_ID;
      run.replayInFlight = true;
      const playing = request(1002, JSON.stringify({ unique_id: run.audioId }));
      void playing.catch(() => {});
      run.danceRequest = this.options.dance();
      run.dancing = run.danceRequest !== undefined;
      if (!run.dancing) { await playing; throw new Error('Could not start Dance 1.'); }
      await playing;
      this.options.state('Playing…', true);
    } catch (error) {
      if (run.cancelled || this.run !== run) return;
      if (run.dancing) {
        // Audio failure must never interrupt a successfully dispatched dance.
        this.warnAudio(run, error);
        run.audioState = 'stopped';
        this.queueReplay(1000);
        this.options.state('Playing…', true);
      } else {
        this.cancel(false);
        this.options.error(error instanceof Error ? error.message : 'Could not play Trick or Treat.');
      }
    } finally {
      run.replayInFlight = false;
    }
  }

  playbackState(state: { is_playing?: boolean | 0 | 1; current_audio_unique_id?: string | null }): void {
    const run = this.run;
    if (!run?.audioId) return;
    const id = state.current_audio_unique_id;
    const playing = state.is_playing === true || state.is_playing === 1;
    const stopped = state.is_playing === false || state.is_playing === 0;
    if (playing && id === run.audioId) {
      run.heardPlaying = true; run.audioState = 'playing';
      clearTimeout(this.replayTimer); this.replayTimer = undefined;
    } else if ((stopped && run.heardPlaying && (!id || id === run.audioId))
      || (playing && !!id && id !== run.audioId)) {
      // Native repeat can briefly report EOF. Give it a chance to resume; if it
      // does not, explicitly replay the same full ID without touching movement.
      run.audioState = 'stopped';
      this.queueReplay(300);
    }
  }

  private queueReplay(delay: number): void {
    const run = this.run;
    if (!run?.audioId || this.replayTimer !== undefined) return;
    this.replayTimer = setTimeout(() => {
      this.replayTimer = undefined;
      if (this.run !== run || run.cancelled || !this.options.available() || run.audioState === 'playing') return;
      if (run.replayInFlight) { this.queueReplay(300); return; }
      void this.replay(run);
    }, delay);
  }

  private async replay(run: DemoRun): Promise<void> {
    if (this.run !== run || !this.options.available()) return;
    run.replayInFlight = true; run.audioState = 'starting';
    try {
      await this.audioMutation(run, 1002, JSON.stringify({ unique_id: run.audioId }));
    } catch (error) {
      if (this.run === run && !run.cancelled) {
        run.audioState = 'stopped'; this.warnAudio(run, error);
      }
    } finally {
      run.replayInFlight = false;
      if (this.run === run && !run.cancelled && run.audioState === 'stopped') this.queueReplay(1000);
    }
  }

  private audioMutation(run: DemoRun, api: number, payload: string): Promise<unknown> {
    const pending = this.options.request(api, payload);
    run.pendingAudio = pending;
    const clear = () => { if (run.pendingAudio === pending) run.pendingAudio = undefined; };
    void pending.then(clear, clear);
    return pending;
  }

  private warnAudio(run: DemoRun, error: unknown): void {
    if (run.audioWarning) return;
    run.audioWarning = true;
    this.options.error(error instanceof Error ? `Audio retrying: ${error.message}` : 'Audio retrying. Dance 1 continues.');
  }

  danceResponse(id: number | undefined, code: number | undefined): void {
    const run = this.run;
    if (!run || id === undefined || run.danceRequest === undefined || id !== run.danceRequest || code === undefined || code === 0) return;
    this.cancel(false);
    this.options.error('Go2 refused Dance 1.');
  }

  danceProgress(progress: unknown): void {
    const run = this.run;
    if (!run?.dancing || typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1) return;
    const now = this.now();
    if (run.progressAt !== null && now - run.progressAt >= 1500) {
      run.idleSince = null; run.idleSamples = 0;
    }
    run.progressAt = now;
    if (progress > 0) {
      run.sawDance = true; run.idleSince = null; run.idleSamples = 0;
    } else if (run.sawDance) {
      run.idleSince ??= now; run.idleSamples++;
      this.finishIfSettled(run);
    }
    // Missing or transient status is not proof of completion. No duration-based
    // watchdog stops the voice or sends StopMove during the dance.
  }

  jointMotion(speeds: unknown): void {
    const run = this.run;
    if (!run?.dancing) return;
    if (!Array.isArray(speeds) || speeds.length < 12
      || !speeds.slice(0, 12).every(v => typeof v === 'number' && Number.isFinite(v))) {
      run.motionAt = null; run.quietSince = null; return;
    }
    const values = speeds.slice(0, 12) as number[];
    const now = this.now();
    if (run.motionAt === null || now - run.motionAt >= 1500) run.quietSince = null;
    run.motionAt = now;
    const rms = Math.sqrt(values.reduce((sum, v) => sum + v*v, 0) / values.length);
    if (rms > 0.12 || values.some(v => Math.abs(v) > 0.35)) run.quietSince = null;
    else run.quietSince ??= now;
    this.finishIfSettled(run);
  }

  jointState(motors: unknown): void {
    const run = this.run;
    if (!run?.dancing) return;
    if (!Array.isArray(motors) || motors.length < 12) {
      run.angleSample = undefined; this.jointMotion(null); return;
    }
    const joints = motors.slice(0, 12);
    const speeds = joints.map(m => m?.dq);
    if (speeds.every(v => typeof v === 'number' && Number.isFinite(v))) {
      run.angleSample = undefined; this.jointMotion(speeds); return;
    }
    // This Go2 Pro's WebRTC lowstate contains q, temperature, lost and
    // reserve, but omits dq. Estimate velocity from actual joint angles;
    // absent dq must never silently become a permanent completion blocker.
    const q = joints.map(m => m?.q);
    if (!q.every(v => typeof v === 'number' && Number.isFinite(v))) {
      run.angleSample = undefined; this.jointMotion(null); return;
    }
    const now = this.now(), previous = run.angleSample;
    if (!previous || now - previous.at >= 1500 || now < previous.at) {
      run.angleSample = { at: now, q }; this.jointMotion(null); return;
    }
    const elapsed = now - previous.at;
    // Batched WebRTC messages can arrive at the same instant. A short window
    // avoids dividing tiny angle jitter by zero or a near-zero receive time.
    if (elapsed < 80) return;
    run.angleSample = { at: now, q };
    this.jointMotion(q.map((angle, i) => (angle - previous.q[i]) * 1000 / elapsed));
  }

  private finishIfSettled(run: DemoRun): void {
    const now = this.now();
    if (run.sawDance && run.idleSince !== null && run.idleSamples >= 3 && run.quietSince !== null
      && run.motionAt !== null && run.progressAt !== null
      && now - run.idleSince >= 1200 && now - run.quietSince >= 1200
      && now - run.motionAt < 1500 && now - run.progressAt < 1500) this.cancel(false);
  }

  cancel(stopDance = true): void {
    const run = this.run;
    if (!run) return;
    run.cancelled = true; this.run = null;
    clearTimeout(this.replayTimer); this.replayTimer = undefined;
    if (run.dancing && stopDance) this.options.stopDance();
    this.stopping = true;
    this.options.state('Stopping…', true);
    void this.stopAudio(run).finally(() => {
      this.stopping = false;
      this.options.state('Trick or Treat', false);
    });
  }

  private async stopAudio(run: DemoRun): Promise<void> {
    const pending = run.pendingAudio;
    const pause = () => this.options.request(1003, JSON.stringify({ unique_id: run.audioId }));
    // Pause immediately, then pause again after an already-sent play request
    // settles. Otherwise a delayed PLAY can undo the first PAUSE.
    let paused = false;
    if (run.audioId) {
      try { await pause(); paused = true; } catch { /* retry below */ }
    }
    if (pending) {
      await pending.catch(() => {});
      paused = false;
    }
    if (run.audioId && !paused) {
      try { await pause(); paused = true; } catch {
        // Don't leave autonomous repeat enabled when PAUSE was refused/lost.
        try { await this.options.request(1007, JSON.stringify({ play_mode: 'no_cycle' })); } catch { /* disconnected */ }
        if (this.options.available()) this.options.error('Could not confirm audio stopped. Use Sound & voice to pause it.');
        return;
      }
    }
    // Restore only after PAUSE has succeeded; never race it against loop mode.
    if (run.loopChanged && run.previousLoop) {
      try { await this.options.request(1007, JSON.stringify({ play_mode: run.previousLoop })); } catch {
        if (this.options.available()) this.options.error('Audio stopped, but the repeat setting could not be restored.');
      }
    }
  }
}
