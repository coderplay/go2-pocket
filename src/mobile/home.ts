export const icons: Record<string, string> = {
  home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
  control: '<rect x="3" y="6" width="18" height="13" rx="4"/><path d="M7 10v5m-2-2h4m7-2h.01m2 4h.01"/>',
  mapping: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16m6-14v16"/>',
  tools: '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  bt: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
  audio: '<path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  status: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  errors: '<path d="m12 3 10 18H2zM12 9v5m0 3v.1"/>',
  services: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6h.1M7 17h.1"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  connect: '<path d="M5 8a10 10 0 0 1 14 0M8 12a6 6 0 0 1 8 0m-5 4a2 2 0 0 1 2 0m-1 4h.01"/>',
};
export const icon = (key: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[key] || icons.tools}</svg>`;
const robotMark = `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 25 4 5-3 5m8-10-3 5 3 5" opacity=".45"/><rect x="5" y="14" width="25" height="12" rx="4"/><path d="m10 26-3 4 3 5m17-9 5 4-3 5"/><rect x="27" y="12" width="9" height="11" rx="3" fill="var(--pocket-accent)"/><path d="M12 14v-3m-2 0h7"/><circle cx="32" cy="17.5" r="1.4" fill="currentColor" stroke="none"/></svg>`;
export type MobileNavigate = (screen: string) => void;

export function renderHome(parent: HTMLElement, navigate: MobileNavigate, connected: boolean,
    preview: boolean, battery: number): void {
  const home = document.createElement('main'); home.className = 'pocket-home';
  home.innerHTML = `
    <header class="pocket-header">
      <div class="pocket-brand"><span class="pocket-logo">${robotMark}</span><div>Go2 <b>Pocket</b><small>Your robot companion</small></div></div>
      <button class="pocket-avatar" aria-label="Account" data-go="account">${icon('account')}<span>Account</span></button>
    </header>
    <div class="pocket-intro"><div class="pocket-eyebrow">A LITTLE ROBOT. A BIG WORLD.</div><h1>Go places.<br><span>Together.</span></h1><p>Good company for your next adventure.</p></div>
    <div class="pocket-home-grid"><div class="pocket-main-card">
      <section class="pocket-robot-card" aria-label="Your Go2 Pro">
        <div class="pocket-robot-top"><span>UNITREE</span><span class="pocket-status ${connected ? 'online' : ''}"><i></i>${preview ? 'Preview' : connected ? 'Connected' : 'Not connected'}</span></div>
        <div class="pocket-hero-art" role="img" aria-label="Unitree Go2 robot"></div>
        <div class="pocket-robot-bottom"><div><small>YOUR ROBOT</small><strong>Go2 Pro</strong></div><span class="pocket-edition">02</span></div>
      </section>
      <button class="pocket-primary" data-go="${connected || preview ? 'control' : 'connection'}">${icon(connected || preview ? 'control' : 'connect')}<span>${connected || preview ? 'Open controls' : 'Connect Go2'}<small>${connected || preview ? 'Drive, see and talk.' : 'Let’s get your robot ready.'}</small></span>${icon('arrow')}</button>
      <div class="pocket-telemetry"><div><small>Battery</small><strong>${connected && battery > 0 ? battery+'<em>%</em>' : '—'}</strong></div><div><small>Connection</small><strong>${preview ? 'Preview only' : connected ? 'Connected' : 'Not connected'}</strong></div></div>
      ${connected ? '<button class="pocket-disconnect" data-go="disconnect">Disconnect Go2</button>' : ''}
    </div><section class="pocket-shortcuts">
      <div class="pocket-section-heading"><h2>Make it yours.</h2><button data-go="tools">View all ${icon('arrow')}</button></div>
      <div class="pocket-feature-grid">
        <button data-go="mapping"><span class="feature-icon mint">${icon('mapping')}</span><strong>Maps</strong><small>See the space around Go2.</small>${icon('arrow')}</button>
        <button data-go="audio"><span class="feature-icon peach">${icon('audio')}</span><strong>Sound & voice</strong><small>Talk, record and play.</small>${icon('arrow')}</button>
        <button data-go="bt"><span class="feature-icon lilac">${icon('bt')}</span><strong>Wi-Fi setup</strong><small>Connect your robot.</small>${icon('arrow')}</button>
        <button data-go="status"><span class="feature-icon sand">${icon('status')}</span><strong>Robot health</strong><small>Check how Go2 is doing.</small>${icon('arrow')}</button>
      </div>
      <p class="pocket-home-note">Everything you need. A little closer.</p>
      ${!connected && !preview ? '<button class="pocket-preview-link" data-preview>Take a look around first →</button>' : ''}
    </section></div>`;
  home.querySelectorAll<HTMLElement>('[data-go]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.go!)));
  home.querySelector('[data-preview]')?.addEventListener('click', () => { location.search = '?preview=1'; });
  parent.appendChild(home);
}

export function renderTools(parent: HTMLElement, navigate: MobileNavigate, connected = false): void {
  const page = document.createElement('main'); page.className = 'pocket-tools';
  page.innerHTML = `<div class="pocket-eyebrow">A PLACE FOR EVERYTHING.</div><h1>More possibilities.</h1><p class="pocket-subtitle">Simple things first. More when you need it.</p>`;
  const sections = [
    { title: 'Everyday', rows: [
      ['control','control','Drive & actions','See through Go2’s camera and move around.'],
      ['mapping','mapping','Maps & navigation','Create maps and choose where to go.'],
      ['audio','audio','Sound & voice','Play sounds, record and talk.'],
      ['status','status','Robot health','Battery, joints and sensors.'],
      ['bt','bt','Bluetooth & Wi-Fi','Set up Wi-Fi or connect a remote.'],
    ] },
    { title: 'Your setup', rows: [
      ['account','account','Your account','Devices, sharing and updates.'],
      ['settings','tools','Robot settings','Lights, volume and connections.'],
      ['app-settings','tools','App settings','Appearance and display options.'],
    ] },
    { title: 'Advanced tools', advanced: true, rows: [
      ['errors','errors','Diagnostics','Read robot alerts and error details.'],
      ['services','services','System services','Manage the robot’s internal services.'],
    ] },
  ];
  for (const section of sections) {
    const wrap = document.createElement(section.advanced ? 'details' : 'section');
    wrap.className = section.advanced ? 'pocket-advanced' : 'pocket-tool-section';
    const heading = document.createElement(section.advanced ? 'summary' : 'h2');
    heading.textContent = section.title; wrap.appendChild(heading);
    const list = document.createElement('div'); list.className = 'pocket-tool-list'; wrap.appendChild(list);
    for (const [route,glyph,title,desc] of section.rows) {
      const button = document.createElement('button'); button.className = 'pocket-tool-row';
      button.innerHTML = `${icon(glyph)}<span><strong>${title}</strong><small>${desc}</small></span>${icon('arrow')}`;
      button.addEventListener('click', () => navigate(route)); list.appendChild(button);
    }
    page.appendChild(wrap);
  }
  if (connected) {
    const disconnect = document.createElement('button');
    disconnect.className = 'pocket-disconnect'; disconnect.textContent = 'Disconnect Go2';
    disconnect.addEventListener('click', () => navigate('disconnect')); page.appendChild(disconnect);
  }
  parent.appendChild(page);
}
