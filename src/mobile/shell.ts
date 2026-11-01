import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { icon } from './home';
import { native, preview } from './platform';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { StatusBar } from '@capacitor/status-bar';
import type { App } from '../ui/app';
import { App as NativeApp } from '@capacitor/app';
import { android, robotNetwork, usableDriveViewport } from './native-device';

export function installShell(app: App): void {
  const nav = document.createElement('nav'); nav.className = 'pocket-tabbar'; nav.setAttribute('aria-label','Main navigation');
  nav.innerHTML = [['home','Home'],['control','Drive'],['mapping','Maps'],['tools','More']].map(([screen,label]) =>
    `<button data-tab="${screen}" aria-label="${label}">${icon(screen)}<span>${label}</span></button>`).join('');
  nav.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.addEventListener('click', () => {
    if (native) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    app.mobileNavigate(button.dataset.tab!);
  }));
  document.body.appendChild(nav);
  const banner = document.createElement('div'); banner.className = 'pocket-preview-banner';
  banner.innerHTML = 'Preview · No robot connected <a href="/">Exit preview</a>';
  banner.hidden = !preview; document.body.appendChild(banner);
  const rotate = document.createElement('section'); rotate.className = 'pocket-rotate-prompt';
  rotate.setAttribute('aria-label', 'Landscape controls');
  rotate.innerHTML = `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="5" aria-hidden="true"><rect x="19" y="30" width="62" height="38" rx="7"/><path d="M44 12a38 38 0 0 1 42 23m-1-15 2 16-16-1M56 87A38 38 0 0 1 14 64m1 15-2-16 16 1"/></svg><h1>Turn your phone<br>sideways.</h1><p>Hold with both hands.<br>One thumb on each stick.</p><button>Back to Home</button>`;
  rotate.querySelector('button')!.addEventListener('click', () => app.mobileNavigate('home'));
  document.body.appendChild(rotate);
  let lastDriving: boolean | null = null;
  let displayQueue: Promise<void> = Promise.resolve();
  const updateOrientation = () => {
    const driving = app.mobileScreen === 'control';
    const portrait = !usableDriveViewport(innerWidth, innerHeight, android);
    document.getElementById('app')!.inert = driving && portrait;
    rotate.hidden = !driving || !portrait;
  };
  const update = () => {
    const screen = app.mobileScreen;
    document.body.dataset.screen = screen;
    const driving = screen === 'control';
    if (lastDriving !== driving) {
      lastDriving = driving;
      if (native) {
        displayQueue = displayQueue.then(async () => {
          const active = app.mobileScreen === 'control';
          if (android) {
            // The native window owns both orientation and bars. The orientation
            // plugin's lock() ack does not mean the rotated layout is ready.
            await robotNetwork.setDriving({ active }).catch(() => {});
          } else {
            await ScreenOrientation.lock({ orientation: active ? 'landscape' : 'portrait' }).catch(() => {});
            await (active ? StatusBar.hide() : StatusBar.show()).catch(() => {});
          }
        });
      } else if (driving && window.parent === window && !document.fullscreenElement) {
        void document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (!driving && document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => {});
      }
    }
    const selected = app.mobileTab;
    nav.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
      const active = button.dataset.tab === selected;
      button.classList.toggle('selected', active); button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    document.querySelectorAll<HTMLVideoElement>('video').forEach(video => { video.playsInline = true; video.setAttribute('playsinline',''); });
    updateOrientation();
    if (window.name === 'go2-iphone-preview' && window.parent !== window) {
      window.parent.postMessage({ type: 'go2-device-screen', screen }, location.origin);
    }
  };
  window.addEventListener('resize', updateOrientation);
  window.addEventListener('go2-screen', update);
  const suspend = () => app.mobileSuspend();
  window.addEventListener('go2-suspend', suspend);
  window.addEventListener('go2-remote-lost', suspend);
  window.addEventListener('pagehide', suspend);
  window.addEventListener('blur', suspend);
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
  window.addEventListener('orientationchange', suspend);
  if (android) {
    void NativeApp.addListener('backButton', () => {
      suspend();
      if (['landing', 'hub'].includes(app.mobileScreen)) void NativeApp.exitApp();
      else app.mobileNavigate('home');
    });
  }
  update();
}
