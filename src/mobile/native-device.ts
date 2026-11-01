import { Capacitor, registerPlugin } from '@capacitor/core';

export const android = Capacitor.getPlatform() === 'android';
export const phoneName = android ? 'phone' : 'iPhone';
export const wifiSettings = android ? 'Settings → Network & internet → Internet' : 'iPhone Settings → Wi-Fi';

export const robotNetwork = registerPlugin<{
  scan(options: { family: string; sn: string; timeout: number }): Promise<{ robots: { ip: string; sn: string }[] }>;
  prepare(): Promise<{ ip: string }>;
  release(): Promise<void>;
  setDriving(options: { active: boolean }): Promise<void>;
}>('RobotDiscovery');

/** Keep robot HTTP and WebRTC on Wi-Fi even when its AP has no internet. */
export async function prepareRobotNetwork(): Promise<void> {
  if (android) await robotNetwork.prepare();
}

export async function releaseRobotNetwork(): Promise<void> {
  if (android) await robotNetwork.release();
}

export function usableDriveViewport(width: number, height: number, isAndroid: boolean): boolean {
  // Android can ignore orientation locks on a foldable's inner screen.
  // The large inner display has room for both sticks in either orientation.
  return width >= height || (isAndroid && width >= 600 && height >= 500);
}
