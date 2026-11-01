import assert from 'node:assert/strict';
import {build} from 'esbuild';

for (const platform of ['android','ios','web']) {
  const calls=[];
  globalThis.__androidCheckCalls=calls;
  const result=await build({entryPoints:['src/mobile/native-device.ts'],bundle:true,platform:'node',format:'esm',write:false,
    plugins:[{name:'native-platform-fixture',setup(b){b.onResolve({filter:/^@capacitor\/core$/},()=>({path:'fixture',namespace:'native-check'}));
      b.onLoad({filter:/.*/,namespace:'native-check'},()=>({contents:`export const Capacitor={getPlatform:()=>${JSON.stringify(platform)}}; export const registerPlugin=()=>({prepare:async()=>{globalThis.__androidCheckCalls.push('prepare')},release:async()=>{globalThis.__androidCheckCalls.push('release')}});`,loader:'js'}));}}]});
  const m=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
  await m.prepareRobotNetwork();await m.releaseRobotNetwork();
  assert.deepEqual(calls,platform==='android'?['prepare','release']:[]);
  assert.equal(m.usableDriveViewport(412,892,platform==='android'),false,'cover screen needs landscape');
  assert.equal(m.usableDriveViewport(892,412,platform==='android'),true);
  assert.equal(m.usableDriveViewport(760,820,platform==='android'),platform==='android','inner display can keep full controls without an orientation lock');
  assert.equal(m.usableDriveViewport(350,750,platform==='android'),false);
  assert.equal(m.phoneName,platform==='android'?'phone':'iPhone');
}
delete globalThis.__androidCheckCalls;
console.log('PASS: Android Wi-Fi preparation/release is isolated from iOS/web, cover/inner-screen controls and platform-specific help.');
