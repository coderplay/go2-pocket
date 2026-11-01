import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { nativeRoute } from './routes';
import { robotNetwork as Discovery } from './native-device';

export const native = Capacitor.isNativePlatform();
export const preview = new URLSearchParams(location.search).get('preview') === '1';

export async function installPlatform(): Promise<void> {
  document.body.dataset.platform = Capacitor.getPlatform();
  const browserFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    const path = url.pathname + url.search;
    if (preview && (url.pathname === '/scan' || /^\/(robot-api|ble-api|unitree-api)\//.test(path))) {
      return Response.json({ detail: 'Preview does not connect to a robot. Leave preview to connect.' }, { status: 409 });
    }
    if (!native || url.origin !== location.origin) return browserFetch(input, init);
    const req = new Request(input, init);
    if (url.pathname === '/scan') {
      const result = await Discovery.scan({ family: url.searchParams.get('family') || 'Go2',
        sn: url.searchParams.get('sn') || '', timeout: Number(url.searchParams.get('timeout') || 3000) });
      return Response.json(result);
    }
    if (path.startsWith('/ble-api/')) {
      const { nativeBle } = await import('./native-ble');
      return nativeBle.handle(url, req);
    }
    const route = nativeRoute(path, req.headers);
    if (!route) return browserFetch(input, init);
    if (req.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    // Native responses are always fetched as bytes: cloud replies can be encrypted binary.
    const pending = CapacitorHttp.request({ url: route.url, method: req.method, headers: route.headers,
      data: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.text(),
      responseType: 'arraybuffer', connectTimeout: 10_000, readTimeout: 30_000 });
    let abortHandler: () => void = () => {};
    try {
      const response = await Promise.race([pending, new Promise<never>((_, reject) => {
        abortHandler = () => reject(new DOMException('Aborted', 'AbortError'));
        req.signal.addEventListener('abort', abortHandler, { once: true });
      })]);
      const headers = new Headers(response.headers);
      // iOS Capacitor prioritizes application/json over responseType=arraybuffer.
      // JSON responses therefore arrive parsed, whereas binary/text bodies are base64.
      const bytes = (headers.get('content-type') || '').toLowerCase().includes('application/json')
        || typeof response.data !== 'string'
        ? new TextEncoder().encode(JSON.stringify(response.data))
        : Uint8Array.from(atob(response.data), c => c.charCodeAt(0));
      // URLSession decompresses before returning the bytes to JavaScript.
      headers.delete('content-encoding'); headers.delete('content-length');
      return new Response(req.method === 'HEAD' || [204, 205, 304].includes(response.status) ? null : bytes,
        { status: response.status, headers });
    } finally { req.signal.removeEventListener('abort', abortHandler); }
  };
  if (native) {
    await NativeApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) window.dispatchEvent(new Event('go2-suspend'));
    });
  }
}
