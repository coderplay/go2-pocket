import './ui/styles.css';
import './mobile/mobile.css';
import './mobile/device-preview.css';
import { installDevicePreview } from './mobile/device-preview';
import { installPlatform } from './mobile/platform';
import { installShell } from './mobile/shell';

async function main() {
  if (installDevicePreview()) return;
  await installPlatform();
  if (!localStorage.getItem('unitree_region')) localStorage.setItem('unitree_region','cn');
  if (!localStorage.getItem('go2ui.theme')) localStorage.setItem('go2ui.theme','light');
  if (!localStorage.getItem('unitree_ui.consoleLog.enabled')) localStorage.setItem('unitree_ui.consoleLog.enabled','false');
  const { App } = await import('./ui/app');
  const root = document.getElementById('app');
  if (root) installShell(new App(root));
}
void main().catch(error => { console.error(error); document.getElementById('app')!.textContent = 'Unable to start. Please reopen the app.'; });
