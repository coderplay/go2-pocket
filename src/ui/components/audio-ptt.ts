export interface AudioPttOptions {
  onPttStart: () => void;
  onPttEnd: () => void;
}

// Inline mic SVG (rendered via innerHTML) — avoids the broken-image
// placeholder an <img> shows when the sprite path doesn't resolve.
const MIC_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;

export class AudioPtt {
  element: HTMLButtonElement;
  private iconEl: HTMLSpanElement;
  private onPttStart: () => void;
  private onPttEnd: () => void;
  private isRecording = false;
  private globalPointerUpHandler: ((e: PointerEvent) => void) | null = null;

  constructor(options: AudioPttOptions) {
    this.onPttStart = options.onPttStart;
    this.onPttEnd = options.onPttEnd;

    this.element = document.createElement('button') as HTMLButtonElement;
    this.element.type = 'button';
    this.element.className = 'audio-ptt-btn nav-circle-icon';
    this.element.title = 'Hold to talk (PTT)';
    this.element.setAttribute('aria-label', 'Push to talk');

    this.iconEl = document.createElement('span');
    this.iconEl.style.cssText = 'display:flex;align-items:center;justify-content:center;width:20px;height:20px;color:#c3c9e9;';
    this.iconEl.innerHTML = MIC_SVG;

    this.element.style.cssText = `
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: rgba(26,29,35,0.95);
      border: 1.5px solid #3a3d45;
      margin-left: 4px;
      transition: all 0.15s;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      cursor: pointer;
      padding: 0;
    `;

    this.element.appendChild(this.iconEl);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.element.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return; // left button only
      e.preventDefault();
      this.startRecording();
    });

    // Handle both pointerup and pointercancel, but guard against multiple calls
    const handlePointerUp = () => {
      if (this.isRecording) {
        this.stopRecording();
      }
    };

    this.element.addEventListener('pointerup', handlePointerUp);
    this.element.addEventListener('pointercancel', handlePointerUp);

    // Also listen on document for global pointerup to catch releases outside the button
    this.globalPointerUpHandler = (e: PointerEvent) => {
      if (this.isRecording && e.pointerId !== undefined) {
        this.stopRecording();
      }
    };
    document.addEventListener('pointerup', this.globalPointerUpHandler);

    this.element.addEventListener('mouseenter', () => {
      if (!this.isRecording) {
        this.element.style.background = 'rgba(255,183,77,0.15)';
        this.element.style.transform = 'scale(1.05)';
      }
    });

    this.element.addEventListener('mouseleave', () => {
      if (!this.isRecording) {
        this.element.style.background = 'rgba(26,29,35,0.95)';
        this.element.style.transform = 'scale(1)';
      }
    });
  }

  private startRecording(): void {
    if (this.isRecording) return;
    this.isRecording = true;
    this.element.classList.add('ptt-recording');
    this.element.style.background = 'rgba(255,183,77,0.25)';
    this.element.style.boxShadow = '0 0 12px rgba(255,183,77,0.4), 0 2px 6px rgba(0,0,0,0.3)';
    this.iconEl.style.color = '#FFB74D';
    this.onPttStart();
  }

  private stopRecording(): void {
    if (!this.isRecording) return;
    this.isRecording = false;
    this.element.classList.remove('ptt-recording');
    this.element.style.background = 'rgba(26,29,35,0.95)';
    this.element.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    this.iconEl.style.color = '#c3c9e9';
    this.onPttEnd();
  }

  destroy(): void {
    this.stopRecording();
    if (this.globalPointerUpHandler) {
      document.removeEventListener('pointerup', this.globalPointerUpHandler);
    }
    this.element.remove();
  }
}
