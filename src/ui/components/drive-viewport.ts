type Point = { x: number; y: number };
interface ViewportOptions {
  mode: () => 'video' | 'three';
  video: () => HTMLVideoElement | null;
  zoomLidar: (factor: number) => void;
  resetLidar: () => void;
}

/** Display-only gestures. UI buttons, PiP and drive sticks never enter this path. */
export class DriveViewport {
  private events = new AbortController();
  private pointers = new Map<number, Point>();
  private origin: Point | null = null;
  private last: Point | null = null;
  private distance = 0;
  private moved = false;
  private started = 0;
  private scale = 1;
  private pan = { x: 0, y: 0 };
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private resizeObserver: ResizeObserver;
  private boundVideo: HTMLVideoElement | null = null;

  constructor(private root: HTMLElement, private options: ViewportOptions) {
    root.classList.remove('drive-actions-visible');
    const opts = { signal: this.events.signal };
    root.addEventListener('pointerdown', e => this.down(e), opts);
    root.addEventListener('pointermove', e => this.move(e), opts);
    root.addEventListener('pointerup', e => this.up(e), opts);
    root.addEventListener('pointercancel', e => this.up(e, true), opts);
    root.addEventListener('wheel', e => {
      if (this.options.mode() !== 'video' || !this.surface(e.target)) return;
      e.preventDefault(); this.zoom(Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
    }, { ...opts, passive: false });
    root.addEventListener('pointerdown', e => {
      if ((e.target as Element).closest('.pocket-quick-actions,.action-grid-btn,.action-popup')) this.showActions();
    }, { ...opts, capture: true });
    this.resizeObserver = new ResizeObserver(() => this.refresh());
    this.resizeObserver.observe(root);
  }

  private surface(target: EventTarget | null): boolean {
    const el = target as Element | null;
    if (!el || el.closest('button,input,select,a,.pip-camera,.joystick-box,.nav-bar,.action-popup,.settings-drawer-overlay')) return false;
    return el === this.root || el.id === 'three-canvas' || el.id === 'video-bg' || el.id === 'noise-bg';
  }

  private down(e: PointerEvent): void {
    if (!this.surface(e.target)) return;
    if (!this.pointers.size) {
      this.origin = this.last = { x: e.clientX, y: e.clientY };
      this.moved = false; this.started = performance.now();
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size > 1) { this.moved = true; this.distance = this.pinchDistance(); }
    // OrbitControls captures its own pointers on the lidar canvas.
    if (this.options.mode() === 'video') this.root.setPointerCapture(e.pointerId);
  }

  private pinchDistance(): number {
    const [a,b] = Array.from(this.pointers.values());
    return a && b ? Math.hypot(a.x-b.x, a.y-b.y) : 0;
  }

  private move(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    const p = { x: e.clientX, y: e.clientY };
    this.pointers.set(e.pointerId, p);
    if (this.origin && Math.hypot(p.x-this.origin.x,p.y-this.origin.y) > 8) this.moved = true;
    if (this.options.mode() !== 'video') return;
    if (this.pointers.size > 1) {
      const distance = this.pinchDistance();
      const [a,b] = Array.from(this.pointers.values());
      if (distance && this.distance) this.zoom(distance/this.distance, (a.x+b.x)/2, (a.y+b.y)/2);
      this.distance = distance;
    } else if (this.last && this.scale > 1) {
      this.pan.x += p.x-this.last.x; this.pan.y += p.y-this.last.y; this.refresh();
    }
    this.last = p;
  }

  private up(e: PointerEvent, cancelled = false): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
    if (!cancelled && !this.moved && !this.pointers.size && performance.now()-this.started < 450) this.showActions();
    if (!this.pointers.size) { this.origin = this.last = null; this.distance = 0; }
    else this.last = Array.from(this.pointers.values())[0];
  }

  private showActions(): void {
    this.root.classList.add('drive-actions-visible');
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.root.querySelector('.action-popup')) this.showActions();
      else this.root.classList.remove('drive-actions-visible');
    }, 4000);
  }

  zoom(factor: number, clientX?: number, clientY?: number): void {
    if (this.options.mode() === 'three') { this.options.zoomLidar(factor); return; }
    const next = Math.max(1, Math.min(4, this.scale * factor));
    const ratio = next / this.scale;
    const rect = this.root.getBoundingClientRect();
    const x = clientX === undefined ? 0 : clientX-rect.left-rect.width/2;
    const y = clientY === undefined ? 0 : clientY-rect.top-rect.height/2;
    this.pan.x = x-(x-this.pan.x)*ratio;
    this.pan.y = y-(y-this.pan.y)*ratio;
    this.scale = next; this.refresh();
  }

  reset(): void {
    if (this.options.mode() === 'three') { this.options.resetLidar(); return; }
    this.scale = 1; this.pan = { x:0,y:0 }; this.refresh();
  }

  refresh(): void {
    const video = this.options.video();
    if (!video) return;
    if (video !== this.boundVideo) {
      this.boundVideo = video;
      video.addEventListener('loadedmetadata', () => this.refresh(), { signal: this.events.signal });
    }
    if (this.options.mode() !== 'video') return;
    const w = this.root.clientWidth, h = this.root.clientHeight;
    const aspect = video.videoWidth && video.videoHeight ? video.videoWidth/video.videoHeight : w/h;
    const imageW = Math.min(w,h*aspect), imageH = Math.min(h,w/aspect);
    const maxX = Math.max(0,(imageW*this.scale-w)/2), maxY = Math.max(0,(imageH*this.scale-h)/2);
    this.pan.x = Math.max(-maxX,Math.min(maxX,this.pan.x));
    this.pan.y = Math.max(-maxY,Math.min(maxY,this.pan.y));
    video.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.scale})`;
  }

  destroy(): void {
    this.events.abort(); clearTimeout(this.hideTimer); this.resizeObserver.disconnect();
    for (const pointer of this.pointers.keys()) if (this.root.hasPointerCapture(pointer)) this.root.releasePointerCapture(pointer);
    this.pointers.clear(); this.root.classList.remove('drive-actions-visible');
  }
}
