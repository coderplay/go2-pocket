export interface JoystickOutput { x: number; y: number }
export type JoystickCallback = (output: JoystickOutput) => void;

/** One captured pointer per stick; supports two independent thumbs on iPhone. */
export class Joystick {
  private box: HTMLElement;
  private knob: HTMLElement;
  private pointer: number | null = null;
  private events = new AbortController();
  constructor(parent: HTMLElement, private onChange: JoystickCallback, private onStop?: () => void) {
    this.box = document.createElement('div'); this.box.className = 'joystick-box';
    this.box.setAttribute('role','group'); this.box.setAttribute('aria-label','Touch joystick');
    this.box.innerHTML = '<img class="joystick-bg" src="/sprites/joystick_bg.png" draggable="false" alt=""><div class="joystick-knob"><img src="/sprites/joystick-active2.png" draggable="false" alt=""></div>';
    this.knob = this.box.querySelector('.joystick-knob')!; parent.appendChild(this.box);
    const options = { signal: this.events.signal };
    this.box.addEventListener('pointerdown', e => {
      if (this.pointer !== null || this.box.classList.contains('disable')) return;
      e.preventDefault(); this.pointer = e.pointerId;
      this.box.setPointerCapture(e.pointerId); this.update(e.clientX,e.clientY);
    }, options);
    this.box.addEventListener('pointermove', e => {
      if (e.pointerId !== this.pointer) return; e.preventDefault(); this.update(e.clientX,e.clientY);
    }, options);
    for (const name of ['pointerup','pointercancel','lostpointercapture'] as const) {
      this.box.addEventListener(name,e => { if (e.pointerId === this.pointer) this.release(); }, options);
    }
    window.addEventListener('blur', () => this.release(), options);
    window.addEventListener('pagehide', () => this.release(), options);
  }
  private update(x: number,y: number): void {
    const rect = this.box.getBoundingClientRect();
    const max = Math.max(1,rect.width/2-32);
    let dx = x-rect.left-rect.width/2, dy = y-rect.top-rect.height/2;
    const distance = Math.hypot(dx,dy); if (distance > max) { dx *= max/distance; dy *= max/distance; }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.onChange({ x:dx/max,y:-dy/max });
  }
  release(): void {
    if (this.pointer === null) return;
    const pointer = this.pointer; this.pointer = null;
    if (this.box.hasPointerCapture(pointer)) this.box.releasePointerCapture(pointer);
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.onChange({ x:0,y:0 }); this.onStop?.();
  }
  setDisabled(disabled: boolean): void { if (disabled) this.release(); this.box.classList.toggle('disable',disabled); }
  destroy(): void { this.release(); this.events.abort(); this.box.remove(); }
}
