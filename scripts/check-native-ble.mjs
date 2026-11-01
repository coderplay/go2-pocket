import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { cfb, gcm, decryptGcm, encode, checksum, MAGIC } from '../src/mobile/ble-protocol.ts';
await mkdir('output/checks',{recursive:true});
await build({entryPoints:['src/mobile/native-ble.ts'],bundle:true,platform:'node',format:'esm',outfile:'output/checks/native-ble.mjs',packages:'external'});
const testAndroid=process.env.GO2_TEST_PLATFORM==='android';
if(testAndroid) globalThis.CapacitorCustomPlatform={name:'android'};
const { NativeBle }=await import('../output/checks/native-ble.mjs');
globalThis.window=new EventTarget();
const key='000102030405060708090a0b0c0d0e0f';
const serial='B000000000000001';
const response=(op,data)=>{const b=[0x51,data.length+4,op,...data];return Uint8Array.from([...b,checksum(b)]);};
let notify; const writes=[]; const frames=[];
let rejectAuth = false, failCheckWrite = false, initializeOptions;
const send=(bytes)=>notify(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength));
const fake={
  async initialize(options){initializeOptions=options},async connect(){},async disconnect(){},async getMtu(){return 185},
  async getServices(){return [{uuid:'6e400001-b5a3-f393-e0a9-e50e24dcca9e',characteristics:[{uuid:'6e400002-b5a3-f393-e0a9-e50e24dcca9e',properties:{write:true}}]}]},
  async startNotifications(id,service,char,cb){notify=cb},
  async write(id,service,char,value){
    const raw=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
    const plain=decryptGcm(raw,key)||cfb(raw,true); const op=plain[2];writes.push(op);frames.push(plain);
    if(op===1){const f1=[...MAGIC,0xf1,3,0,0,0,0,0,16,...encode(serial)];send(Uint8Array.from([...f1,checksum(f1)]));return}
    if(op===0x0b){send(gcm(response(op,Uint8Array.of(0,0,0,0,0,0,0,5)),key));return}
    if(op===0x0c){
      if(failCheckWrite) throw new Error('Synthetic CHECK write failure');
      assert.equal(new DataView(plain.buffer,plain.byteOffset).getBigUint64(3,false),6n);
      send(gcm(response(op,[rejectAuth?0:1]),key));return
    }
    if(op===2){send(gcm(response(op,encode(serial)),key));return}
    if(op===7){send(gcm(response(op,[1,2,3,4,5,6]),key));return}
    send(gcm(response(op,[1]),key));
    if(op===6)send(gcm(response(8,[1]),key));
  },
};
const ble=new NativeBle(fake,false);
async function request(path,body){return (await ble.handle(new URL('http://localhost/ble-api'+path),new Request('http://localhost/ble-api'+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined}))).json()}
assert.equal((await request('/connect?address=synthetic-device')).connected,true);
assert.equal(initializeOptions.androidNeverForLocation,true);
assert.equal((await request('/v3/aes-key?key='+key)).armed,true);
assert.equal((await request('/info')).serial_number,serial);
assert.equal((await request('/info')).ap_mac,'01:02:03:04:05:06');
const configured=await request('/wifi',{ssid:'Test network',password:'not-a-real-password',ap_mode:false,country:'US'});
assert.equal(configured.success,true);assert.equal(configured.details.ready,true);
assert.deepEqual(writes.slice(-4),[3,4,5,6]);
assert.deepEqual(Array.from(frames.at(-4).slice(3,-1)),[2]);
assert.deepEqual(Array.from(frames.at(-1).slice(3,-1)),[85,83,1]);
const hotspot=await request('/wifi',{ssid:'Go2_Test',password:'SyntheticHotspot123',ap_mode:true,country:'US'});
assert.equal(hotspot.success,true);assert.equal(hotspot.details.ready,true);
assert.deepEqual(writes.slice(-4),[3,4,5,6]);
assert.deepEqual(Array.from(frames.at(-4).slice(3,-1)),[1]);
assert.deepEqual(Array.from(frames.at(-1).slice(3,-1)),[85,83,2]);
assert.equal(new TextDecoder().decode(frames.at(-3).slice(5,-1)),'Go2_Test');
assert.equal(new TextDecoder().decode(frames.at(-2).slice(5,-1)),'SyntheticHotspot123');
const before=writes.length;
const invalid=await request('/wifi',{ssid:'',password:'unused'});
assert.equal(typeof invalid.detail,'string');assert.equal(writes.length,before);
for (const password of ['', 'short', 'a'.repeat(64), '密码密码密码密码', 'contains\nnewline']) {
  const invalidAp=await request('/wifi',{ssid:'Go2_Test',password,ap_mode:true,country:'US'});
  assert.equal(typeof invalidAp.detail,'string');assert.equal(writes.length,before);
}
assert.equal((await request('/disconnect')).connected,false);
const ffeFake = {...fake,
  async getServices(){return [{uuid:'0000ffe0-0000-1000-8000-00805f9b34fb',characteristics:[{uuid:'0000ffe2-0000-1000-8000-00805f9b34fb',properties:{writeWithoutResponse:true}}]}]},
  async write(){throw new Error('FFE fixture requires writeWithoutResponse');},
  writeWithoutResponse:fake.write,
};
const ffeBle = new NativeBle(ffeFake,false);
async function ffeRequest(path,body){return (await ffeBle.handle(new URL('http://localhost/ble-api'+path),new Request('http://localhost/ble-api'+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined}))).json()}
assert.equal((await ffeRequest('/connect?address=synthetic-ffe')).protocol,'ffe0');
rejectAuth = true;
assert.match((await ffeRequest('/v3/aes-key?key='+key)).detail,/rejected/);
const afterRejected = writes.length;
assert.equal((await ffeRequest('/info')).ap_mac,null);
assert.equal(writes.length,afterRejected,'failed authentication must not allow subsequent GCM reads');
failCheckWrite = true; rejectAuth = false;
assert.match((await ffeRequest('/v3/aes-key?key='+key)).detail,/Synthetic CHECK write failure/);
failCheckWrite = false;
assert.equal((await ffeRequest('/v3/aes-key?key='+key)).armed,true);
assert.equal((await ffeRequest('/info')).ap_mac,'01:02:03:04:05:06');
assert.equal((await ffeRequest('/wifi',{ssid:'Go2_FFE_Test',password:'SyntheticHotspot123',ap_mode:true,country:'US'})).success,true);
await ffeRequest('/disconnect');
if(testAndroid) {
 const tiny=new NativeBle({...fake,async getMtu(){return 23}},false);
 const before=writes.length;
 const result=await (await tiny.handle(new URL('http://localhost/ble-api/connect?address=tiny-mtu'),new Request('http://localhost/ble-api/connect?address=tiny-mtu'))).json();
 assert.match(result.detail,/packet size is too small/);
 assert.equal(writes.length,before,'undersized Android MTU sends no authentication/configuration packets');
}
console.log(`PASS: mocked ${testAndroid?'Android':'iPhone'} BLE V3 handshake, timestamp, serial/MAC, home Wi-Fi and AP wire modes, SSID/password payloads, ACK+READY, invalid AP passwords write nothing, disconnect. No radio used.`);
console.log('PASS: FFE0 + V3 write-without-response transport, rejected authentication stays locked, CHECK write failure is reported, retry authenticates and AP configuration succeeds.');
