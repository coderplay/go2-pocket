export interface AudioMonitorOptions {
  onStart: () => void;
  onStop: () => void;
}

// Inline SVGs (rendered via innerHTML) — avoids the broken-image placeholder
// that an <img src="/sprites/…"> shows when the asset path doesn't resolve in
// the embedding context. Sized 20×20, stroke follows the button's color.
const SPEAKER_ON_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
const SPEAKER_OFF_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

export class AudioMonitor {
  element: HTMLButtonElement;
  private iconWrap: HTMLSpanElement;
  private isListening = false;
  private onStart: () => void;
  private onStop: () => void;

  constructor(options: AudioMonitorOptions) {
    this.onStart = options.onStart;
    this.onStop = options.onStop;

    this.element = document.createElement('button') as HTMLButtonElement;
    this.element.type = 'button';
    this.element.className = 'audio-monitor-btn nav-circle-icon';
    this.element.title = 'Click to listen to robot audio (currently OFF)';
    this.element.setAttribute('aria-label', 'Listen to robot audio');

    this.iconWrap = document.createElement('span');
    this.iconWrap.style.cssText = 'display:flex;align-items:center;justify-content:center;width:20px;height:20px;color:#c3c9e9;';

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

    this.element.appendChild(this.iconWrap);
    this.updateIcon();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.element.addEventListener('click', (e: MouseEvent) => {
      e.preventDefault();
      this.toggleListening();
    });

    this.element.addEventListener('mouseenter', () => {
      this.element.style.background = 'rgba(76,175,80,0.15)';
      this.element.style.transform = 'scale(1.05)';
    });

    this.element.addEventListener('mouseleave', () => {
      if (!this.isListening) {
        this.element.style.background = 'rgba(26,29,35,0.95)';
        this.element.style.transform = 'scale(1)';
      }
    });
  }

  private toggleListening(): void {
    if (this.isListening) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  private updateIcon(): void {
    if (this.isListening) {
      this.iconWrap.innerHTML = SPEAKER_ON_SVG;
      this.iconWrap.style.color = '#4CAF50';
      this.element.title = 'Click to mute robot audio (currently ON)';
    } else {
      this.iconWrap.innerHTML = SPEAKER_OFF_SVG;
      this.iconWrap.style.color = '#c3c9e9';
      this.element.title = 'Click to listen to robot audio (currently OFF)';
    }
  }

  private startListening(): void {
    if (this.isListening) return;
    this.isListening = true;
    this.element.classList.add('audio-monitor-listening');
    this.updateIcon();
    this.element.style.background = 'rgba(76,175,80,0.25)';
    this.element.style.boxShadow = '0 0 12px rgba(76,175,80,0.4), 0 2px 6px rgba(0,0,0,0.3)';
    this.element.style.transform = 'scale(1)';
    this.onStart();
  }

  private stopListening(): void {
    if (!this.isListening) return;
    this.isListening = false;
    this.element.classList.remove('audio-monitor-listening');
    this.updateIcon();
    this.element.style.background = 'rgba(26,29,35,0.95)';
    this.element.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    this.onStop();
  }

  destroy(): void {
    this.stopListening();
    this.element.remove();
  }
}
