import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { inner, cfb, probe, gcm, decryptGcm, parseRemote, encode } from '../src/mobile/ble-protocol.ts';
import { nativeRoute } from '../src/mobile/routes.ts';

// Compare the port's bytes with independent Node/OpenSSL AES implementations.
const secret = Buffer.from('000102030405060708090a0b0c0d0e0f','hex');
const nonce = Uint8Array.from({length:12},(_,i) => i+1);
const payload = inner(4,encode('Home WiFi'),[1,1]);
assert.equal(payload.reduce((a,b) => a+b,0)&255,0);
const cfbNative = createCipheriv('aes-128-cfb',Buffer.from('df98b715d5c6ed2b25817b6f2554124a','hex'),Buffer.from('2841ae97419c2973296a0d4bdfe19a4f','hex'));
const encryptedCFB = Buffer.concat([cfbNative.update(payload),cfbNative.final()]);
assert.deepEqual(Buffer.from(cfb(payload)),encryptedCFB);
assert.deepEqual(cfb(encryptedCFB,true),payload);
const wrapped = gcm(payload,secret.toString('hex'),nonce);
const nativeGCM = createCipheriv('aes-128-gcm',secret,nonce);
const encryptedGCM = Buffer.concat([nativeGCM.update(payload),nativeGCM.final()]);
assert.deepEqual(Buffer.from(wrapped.slice(14,30)),nativeGCM.getAuthTag());
assert.deepEqual(Buffer.from(wrapped.slice(31,-1)),encryptedGCM);
assert.equal(wrapped.reduce((a,b) => a+b,0)&255,0);
assert.deepEqual(decryptGcm(wrapped,secret.toString('hex')),payload);
const corrupt = wrapped.slice();corrupt[15]^=1;
assert.equal(decryptGcm(corrupt,secret.toString('hex')),null);
assert.equal(decryptGcm(wrapped.slice(0,32),secret.toString('hex')),null);
assert.equal(probe(0xf1).reduce((a,b) => a+b,0)&255,0);

const frame = new Uint8Array(20);const view = new DataView(frame.buffer);
view.setFloat32(0,.5,true);view.setFloat32(4,-.25,true);view.setFloat32(8,.75,true);view.setFloat32(12,-.5,true);
frame[16]=2;frame[17]=1;frame[18]=91;frame[19]=190;
const remote=parseRemote(frame);
assert.equal(remote.lx,.5);assert.equal(remote.ly,-.5);assert.equal(remote.rx,-.25);assert.equal(remote.ry,.75);
assert.equal(remote.buttons.L1,true);assert.equal(remote.buttons.A,true);assert.equal(remote.rssi,-66);
view.setFloat32(0,NaN,true);assert.throws(()=>parseRemote(frame));

const headers=new Headers({'X-Robot-Host':'192.168.1.203:9991','Content-Type':'text/plain'});
const robot=nativeRoute('/robot-api/con_notify',headers);
assert.equal(robot.url,'http://192.168.1.203:9991/con_notify');assert.equal(robot.headers['x-robot-host'],undefined);
assert.throws(()=>nativeRoute('/robot-api/con_notify',new Headers({'X-Robot-Host':'example.com:9991'})));
assert.throws(()=>nativeRoute('/robot-api/con_notify',new Headers({'X-Robot-Host':'192.168.999.1:9991'})));
const cloud=nativeRoute('/unitree-api/device/list',new Headers({'X-Unitree-Region':'cn','Token':'test-token'}));
assert.equal(cloud.url,'https://robot-api.unitree.com/device/list');assert.equal(cloud.headers['x-unitree-region'],undefined);
assert.equal(cloud.headers.token,'test-token');
assert.equal(nativeRoute('/models/Go2.glb',new Headers()),null);
console.log('PASS: independent AES-CFB/GCM vectors, tamper rejection, remote axes/buttons, native routing isolation.');
