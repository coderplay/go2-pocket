export interface NativeRoute { url: string; headers: Record<string, string> }

/** Resolve only known proxy routes. Never forward proxy credentials to arbitrary hosts. */
export function nativeRoute(path: string, rawHeaders: Headers): NativeRoute | null {
  const headers = Object.fromEntries(rawHeaders.entries());
  if (path.startsWith('/robot-api/')) {
    const host = headers['x-robot-host'] || '';
    if (!/^(?:\d{1,3}\.){3}\d{1,3}:(9991|8081)$/.test(host)) {
      throw new Error('Enter a valid robot IPv4 address using port 9991 or 8081.');
    }
    if (host.split(':')[0].split('.').some(v => Number(v) > 255)) throw new Error('Invalid IP address.');
    delete headers['x-robot-host'];
    return { url: `http://${host}${path.slice('/robot-api'.length)}`, headers };
  }
  if (path.startsWith('/unitree-api/')) {
    const host = headers['x-unitree-region'] === 'cn' ? 'robot-api.unitree.com' : 'global-robot-api.unitree.com';
    delete headers['x-unitree-region'];
    delete headers.cookie;
    headers['User-Agent'] = 'okhttp/4.11.0';
    headers['Accept-Encoding'] = 'identity';
    return { url: `https://${host}${path.slice('/unitree-api'.length)}`, headers };
  }
  return null;
}
