import forge from 'node-forge';
const KEY = 'df98b715d5c6ed2b25817b6f2554124a';
const IV = '2841ae97419c2973296a0d4bdfe19a4f';
export const MAGIC = [0, 0x55, 0x54, 0x32, 0x35];
export const encode = (s: string): Uint8Array => new TextEncoder().encode(s);
export const decode = (b: Uint8Array): string => new TextDecoder().decode(b).replace(/\0+$/, '').trim();
const binary = (b: Uint8Array) => Array.from(b, n => String.fromCharCode(n)).join('');
const bytes = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0));
export function checksum(b: number[] | Uint8Array): number { return (-Array.from(b).reduce((a, n) => a+n, 0)) & 255; }
export function inner(op: number, payload: Uint8Array = new Uint8Array(), chunk?: [number, number]): Uint8Array {
  const p = [0x52, payload.length + (chunk ? 6 : 4), op, ...(chunk || []), ...payload];
  if (p[1] > 255) throw new Error('BLE frame too long');
  return Uint8Array.from([...p, checksum(p)]);
}
export function cfb(raw: Uint8Array, decrypt = false): Uint8Array {
  const cipher = decrypt ? forge.cipher.createDecipher('AES-CFB', forge.util.hexToBytes(KEY))
    : forge.cipher.createCipher('AES-CFB', forge.util.hexToBytes(KEY));
  cipher.start({ iv: forge.util.hexToBytes(IV) });
  cipher.update(forge.util.createBuffer(binary(raw), 'raw'));
  cipher.finish(); return bytes(cipher.output.getBytes());
}
export function probe(op: number): Uint8Array { const b = [...MAGIC, op]; return Uint8Array.from([...b, checksum(b)]); }
export function gcm(raw: Uint8Array, hexKey: string, nonce = crypto.getRandomValues(new Uint8Array(12))): Uint8Array {
  const cipher = forge.cipher.createCipher('AES-GCM', forge.util.hexToBytes(hexKey));
  cipher.start({ iv: binary(nonce), tagLength: 128 }); cipher.update(forge.util.createBuffer(binary(raw)));
  cipher.finish(); const tag = bytes(cipher.mode.tag.getBytes()); const encrypted = bytes(cipher.output.getBytes());
  const b = [12, ...nonce, 16, ...tag, encrypted.length, ...encrypted];
  return Uint8Array.from([...b, checksum(b)]);
}
export function decryptGcm(raw: Uint8Array, hexKey: string): Uint8Array | null {
  if (raw.length < 33 || raw[0] !== 12 || raw[13] !== 16) return null;
  const n = raw[30]; if (31+n+1 > raw.length || n < 4) return null;
  const cipher = forge.cipher.createDecipher('AES-GCM', forge.util.hexToBytes(hexKey));
  cipher.start({ iv: binary(raw.slice(1, 13)), tagLength: 128,
    tag: forge.util.createBuffer(binary(raw.slice(14, 30))) });
  cipher.update(forge.util.createBuffer(binary(raw.slice(31, 31+n))));
  return cipher.finish() ? bytes(cipher.output.getBytes()) : null;
}
export const BUTTONS = ['R1','L1','Start','Select','R2','L2','F1','F2','A','B','X','Y','Up','Right','Down','Left'];
export function parseRemote(raw: Uint8Array) {
  if (raw.length !== 20) throw new Error('Remote frame must be 20 bytes');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const [lx, rx, ry, ly] = [0,4,8,12].map(o => view.getFloat32(o, true));
  if (![lx, rx, ry, ly].every(v => Number.isFinite(v) && Math.abs(v) <= 1.2)) throw new Error('Invalid remote axes');
  return { lx, ly, rx, ry, buttons: Object.fromEntries(BUTTONS.map((b,i) => [b, !!(raw[16+(i>>3)] & (1<<(i%8)))])),
    battery: raw[18], rssi: view.getInt8(19) };
}
