import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readBundledWav} from '../src/ui/bundled-audio.ts';
const source = await readFile(new URL('../public/audio/trick-or-treat.wav', import.meta.url));
const bytes = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
const response = (status, body=bytes) => ({status,ok:status>=200&&status<300,arrayBuffer:async()=>body});
assert.deepEqual(await readBundledWav(response(200),false,'http:'),bytes);
assert.deepEqual(await readBundledWav(response(0),true,'capacitor:'),bytes,
  'native iOS local-media status 0 must not reject a valid recording');
for (const [status,native,protocol] of [[404,true,'capacitor:'],[500,true,'capacitor:'],[0,false,'http:'],[0,true,'https:']]) {
  await assert.rejects(readBundledWav(response(status),native,protocol),/could not be loaded/);
}
for (const body of [new ArrayBuffer(0),new TextEncoder().encode('<html>fallback</html>').buffer,bytes.slice(0,60)]) {
  await assert.rejects(readBundledWav(response(0,body),true,'capacitor:'),/valid WAV/);
}
assert.equal(new DataView(bytes).getUint16(22,true),1,'approved source stays mono');
console.log('PASS: bundled recording loads on HTTP and native iOS status 0; HTTP failures, HTML and truncated WAV are rejected.');
