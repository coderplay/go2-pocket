/** Capacitor iOS serves media with URLResponse rather than HTTPURLResponse.
 * WKWebView fetch therefore reports status 0 even when all WAV bytes arrived.
 * Accept that only for the native local scheme, and validate the file bytes. */
export async function readBundledWav(
  response: Pick<Response, 'ok' | 'status' | 'arrayBuffer'>,
  native: boolean,
  protocol: string,
): Promise<ArrayBuffer> {
  if (!response.ok && !(native && protocol === 'capacitor:' && response.status === 0)) {
    throw new Error('The saved recording could not be loaded.');
  }
  const bytes = await response.arrayBuffer();
  const view = new DataView(bytes);
  if (bytes.byteLength < 44 || view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57415645
      || view.getUint32(4, true) + 8 !== bytes.byteLength) {
    throw new Error('The saved recording is not a valid WAV file.');
  }
  return bytes;
}
