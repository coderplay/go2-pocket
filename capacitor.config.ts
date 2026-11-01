import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.mzhou.go2pocket', appName: 'Go2 Pocket', webDir: 'dist',
  ios: { contentInset: 'never', backgroundColor: '#f5f5f0', allowsInlineMediaPlayback: true },
  android: { backgroundColor: '#f5f6f2', adjustMarginsForEdgeToEdge: 'auto' },
  plugins: { CapacitorHttp: { enabled: false }, Keyboard: { resize: 'body' } },
};
export default config;
