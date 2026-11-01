import { native } from './platform';

/** Give desktop browsers a real phone viewport, including its media queries. */
export function installDevicePreview(): boolean {
  if (native || window.parent !== window || !matchMedia('(hover: hover) and (pointer: fine)').matches) return false;

  document.body.classList.add('device-preview');
  const root = document.getElementById('app')!;
  root.replaceChildren();
  root.className = 'device-preview-shell';
  const header = document.createElement('header');
  header.className = 'device-preview-header';
  header.innerHTML = `<div><strong>iPhone preview</strong><span class="device-preview-size"></span></div><div class="device-preview-orientation" role="group" aria-label="Preview orientation"><button type="button" data-orientation="portrait">Portrait</button><button type="button" data-orientation="landscape">Landscape</button></div>`;
  const stage = document.createElement('main');
  stage.className = 'device-preview-stage';
  const holder = document.createElement('div');
  holder.className = 'device-preview-holder';
  const phone = document.createElement('div');
  phone.className = 'device-preview-phone';
  const frame = document.createElement('iframe');
  frame.name = 'go2-iphone-preview';
  frame.title = 'Go2 Pocket on iPhone';
  frame.allow = 'camera; microphone; autoplay';
  phone.appendChild(frame); holder.appendChild(phone); stage.appendChild(holder);
  root.append(header, stage);

  let landscape = false;
  let lastScreen = '';
  const layout = () => {
    const width = landscape ? 852 : 393;
    const height = landscape ? 393 : 852;
    const scale = Math.max(.1, Math.min(1, (stage.clientWidth - 40) / (width + 24), (stage.clientHeight - 32) / (height + 24)));
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    phone.style.transform = `scale(${scale})`;
    holder.style.width = `${(width + 24) * scale}px`;
    holder.style.height = `${(height + 24) * scale}px`;
    header.querySelector('.device-preview-size')!.textContent = `${width} × ${height} pt · ${Math.round(scale * 100)}% scale`;
    header.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
      button.setAttribute('aria-pressed', String((button.dataset.orientation === 'landscape') === landscape));
    });
  };
  header.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.addEventListener('click', () => {
    landscape = button.dataset.orientation === 'landscape';
    layout();
  }));
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.type !== 'go2-device-screen') return;
    const screen = event.data.screen;
    if (typeof screen !== 'string' || screen === lastScreen) return;
    const wasDriving = lastScreen === 'control';
    lastScreen = screen;
    if (screen === 'control' || wasDriving) {
      landscape = screen === 'control';
      layout();
    }
  });
  new ResizeObserver(layout).observe(stage);
  layout();
  frame.src = location.href;
  return true;
}
