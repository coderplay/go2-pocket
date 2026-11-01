/** Region selector for the Go2 cloud account. */
import { cloudApi, REGIONS } from '../../api/unitree-cloud';

export function buildCloudPrefsRow(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'cloud-prefs-row';
  const label = document.createElement('span');
  label.className = 'cloud-prefs-label';
  label.textContent = 'Region';
  const group = document.createElement('div');
  group.className = 'cloud-prefs-group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Account region');
  const render = (): void => {
    group.replaceChildren();
    for (const region of REGIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cloud-prefs-pill';
      const active = cloudApi.region === region;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.textContent = region === 'cn' ? 'China' : 'International';
      button.addEventListener('click', () => {
        cloudApi.setRegion(region);
        render();
      });
      group.appendChild(button);
    }
  };
  render();
  row.append(label, group);
  return row;
}
