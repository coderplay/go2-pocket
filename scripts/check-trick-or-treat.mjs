import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/ui/trick-or-treat.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {TrickOrTreat}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const wrong=[{UNIQUE_ID:'wrong-downloaded',CUSTOM_NAME:'Trick or Treat (saved)'},{UNIQUE_ID:'other',CUSTOM_NAME:'UserAudio_01234'}];
const correct={UNIQUE_ID:'af9ba123-full-id',CUSTOM_NAME:'UserAudio_af9ba123.wav'};
let now=0,nextId=0;const timers=new Map();
const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout;
globalThis.setTimeout=(fn,ms)=>{const id=++nextId;timers.set(id,{at:now+ms,fn});return id};
globalThis.clearTimeout=id=>timers.delete(id);
const tick=ms=>{const end=now+ms;for(;;){const p=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!p)break;timers.delete(p[0]);now=p[1].at;p[1].fn()}now=end};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
function fixture(files=[...wrong,correct],overrides={}){
 const calls=[],states=[],errors=[];
 const options={now:()=>now,request:async(api,payload)=>{calls.push({api,payload});return api===1001?{audio_list:files}:api===1010?{play_mode:'list_loop'}:{}},available:()=>true,dance:()=>{calls.push({api:1022});return 77},stopDance:()=>calls.push({api:'stopDance'}),state:(...s)=>states.push(s),error:e=>errors.push(e),...overrides};
 return{demo:new TrickOrTreat(options),calls,states,errors,options};
}
const playCount=f=>f.calls.filter(c=>c.api===1002).length;
const active=f=>assert.equal(f.states.at(-1)[1],true);
const noStop=f=>assert.ok(!f.calls.some(c=>c.api===1003||c.api==='stopDance'));
const frame=(f,p,speed,ms=100)=>{tick(ms);f.demo.jointMotion(Array(12).fill(speed));f.demo.danceProgress(p)};
const finish=f=>{for(let i=0;i<14;i++)frame(f,0,0)};
try{
 let f=fixture();await f.demo.start();
 assert.equal(JSON.parse(f.calls.find(c=>c.api===1002).payload).unique_id,correct.UNIQUE_ID);
 assert.equal(JSON.parse(f.calls.find(c=>c.api===1007).payload).play_mode,'single_cycle');
 await f.demo.start();assert.equal(f.calls.filter(c=>c.api===1022).length,1,'dance dispatched only once');
 for(let i=0;i<20;i++)frame(f,0,0);active(f);noStop(f); // initial standing cannot complete an unobserved dance
 f.demo.playbackState({is_playing:true,current_audio_unique_id:correct.UNIQUE_ID});
 frame(f,1,.8);tick(5000);active(f);noStop(f); // the old three-second watchdog must not cut voice
 for(let i=0;i<10;i++)frame(f,0,.8);active(f);noStop(f); // zero flag while joints still dance is not completion
 frame(f,1,.8);
 for(let i=0;i<5;i++)frame(f,0,0);active(f);noStop(f); // brief stage pause ignored
 frame(f,.4,.8); // positive fractional values are activity, never completion
 f.demo.playbackState({is_playing:0,current_audio_unique_id:correct.UNIQUE_ID});tick(299);assert.equal(playCount(f),1);
 tick(1);await flush();assert.equal(playCount(f),2,'audio EOF explicitly replays the same recording');noStop(f);active(f);
 f.demo.playbackState({is_playing:1,current_audio_unique_id:correct.UNIQUE_ID});
 f.demo.playbackState({is_playing:false,current_audio_unique_id:correct.UNIQUE_ID});tick(100);
 f.demo.playbackState({is_playing:true,current_audio_unique_id:correct.UNIQUE_ID});tick(400);await flush();assert.equal(playCount(f),2,'native loop resumes without an overlapping restart');
 f.demo.playbackState({is_playing:true,current_audio_unique_id:'system-dance-music'});tick(300);await flush();assert.equal(playCount(f),3,'recover selected voice if another track interrupts it');noStop(f);
 finish(f);await flush();assert.equal(f.states.at(-1)[1],false);
 assert.ok(f.calls.some(c=>c.api===1003));assert.ok(!f.calls.some(c=>c.api==='stopDance'),'natural finish never interrupts dance');
 assert.equal(JSON.parse(f.calls.filter(c=>c.api===1007).at(-1).payload).play_mode,'list_loop');
 const count=playCount(f);tick(10000);await flush();assert.equal(playCount(f),count,'no late replay after finish');
 f=fixture(wrong);await f.demo.start();assert.match(f.errors[0],/not found/);assert.deepEqual(f.calls.map(c=>c.api),[1001]);
 f=fixture([correct,{UNIQUE_ID:'second',CUSTOM_NAME:'UserAudio_af9ba456.wav'}]);await f.demo.start();assert.match(f.errors[0],/More than one/);
 let release;
 f=fixture([],{request:()=>new Promise(r=>release=r)});let pending=f.demo.start();f.demo.cancel();release({audio_list:[correct]});await pending;assert.equal(f.calls.length,0);
 // Audio errors retry; neither an audio error nor absent telemetry may stop movement.
 f=fixture();let base=f.options.request,attempt=0;
 f.options.request=async(api,payload)=>{const result=await base(api,payload);if(api===1002&&attempt++===0)throw Error('audio timeout');return result};
 await f.demo.start();active(f);noStop(f);tick(1000);await flush();assert.equal(playCount(f),2);noStop(f);f.demo.cancel();assert.ok(f.calls.some(c=>c.api==='stopDance'));
 // A queued replay is fully cancelled by manual Stop/disconnect.
 f=fixture();await f.demo.start();f.demo.playbackState({is_playing:true,current_audio_unique_id:correct.UNIQUE_ID});f.demo.playbackState({is_playing:false,current_audio_unique_id:null});f.demo.cancel();tick(3000);await flush();assert.equal(playCount(f),1);
 // Correlate a refusal to this request; unrelated or missing IDs cannot cancel it.
 f=fixture();await f.demo.start();f.demo.danceResponse(undefined,1001);f.demo.danceResponse(78,1001);active(f);f.demo.danceResponse(77,1001);await flush();assert.equal(f.states.at(-1)[1],false);assert.ok(!f.calls.some(c=>c.api==='stopDance'));
 // Missing/invalid joint telemetry never proves a completed dance.
 f=fixture();await f.demo.start();frame(f,1,.8);for(let i=0;i<20;i++){tick(100);f.demo.danceProgress(0);f.demo.jointMotion([NaN])}active(f);noStop(f);f.demo.cancel();
 // A late audio ACK cannot restart an already-completed routine.
 f=fixture();base=f.options.request;f.options.request=(api,payload)=>api===1002?new Promise(r=>release=r):base(api,payload);
 pending=f.demo.start();await flush();frame(f,1,.8);finish(f);release({});await pending;await flush();tick(15000);assert.equal(f.errors.length,0);
 assert.equal(f.calls.filter(c=>c.api===1003).length,2,'late initial PLAY is followed by a second PAUSE');
 // Real Pro lowstate schema observed on 2026-10-23 has q but no dq.
 // Replay that schema with motion, a brief quiet phase, then settled angles.
 const observed=JSON.parse(readFileSync(new URL('./fixtures/go2-pro-q-only.json',import.meta.url),'utf8'));
 assert.equal('dq' in observed.motorExample,false);
 const idleQ=observed.angleSnapshot;
 const angleFrame=(f,p,q,ms=100)=>{tick(ms);f.demo.jointState(q.map(q=>({q,temperature:38,lost:15,reserve:[0,621]})));f.demo.danceProgress(p)};
 f=fixture();await f.demo.start();angleFrame(f,1,idleQ);
 for(let i=0;i<16;i++)angleFrame(f,0,idleQ.map(q=>q+(i%2)*.1));
 active(f);noStop(f); // even with progress=0, moving q-only joints must keep audio
 for(let i=0;i<5;i++)angleFrame(f,0,idleQ);active(f);noStop(f);
 angleFrame(f,1,idleQ.map(q=>q+.1));
 for(let i=0;i<16;i++)angleFrame(f,0,idleQ.map((q,j)=>q+(i%2?1:-1)*.00003*(j%3)));
 await flush();assert.equal(f.states.at(-1)[1],false,'q-only firmware can finish the routine');
 assert.ok(f.calls.some(c=>c.api===1003));assert.ok(!f.calls.some(c=>c.api==='stopDance'));
 // Duplicate receive timestamps and long gaps cannot create fake zero speeds.
 f=fixture();await f.demo.start();angleFrame(f,1,idleQ);
 for(let i=0;i<30;i++)angleFrame(f,0,idleQ,0);active(f);noStop(f);
 for(let i=0;i<5;i++)angleFrame(f,0,idleQ,1600);active(f);noStop(f);f.demo.cancel();await flush();
 // PAUSE and loop restoration must be ordered, not concurrent. Keep new
 // routines blocked until the old audio cleanup has completed.
 f=fixture();base=f.options.request;let pauseRelease;
 f.options.request=(api,payload)=>{const result=base(api,payload);return api===1003?new Promise(r=>pauseRelease=r):result};
 await f.demo.start();f.demo.cancel(false);await flush();
 assert.equal(f.calls.filter(c=>c.api===1007).length,1,'loop mode cannot restore before PAUSE acknowledgement');
 await f.demo.start();assert.equal(f.calls.filter(c=>c.api===1022).length,1);
 pauseRelease({});await flush();assert.equal(f.calls.filter(c=>c.api===1007).length,2);
 // The same ordering holds for a delayed replay, not just initial PLAY.
 f=fixture();base=f.options.request;let replayRelease,n=0;
 f.options.request=(api,payload)=>{const result=base(api,payload);return api===1002&&++n===2?new Promise(r=>replayRelease=r):result};
 await f.demo.start();f.demo.playbackState({is_playing:true,current_audio_unique_id:correct.UNIQUE_ID});
 f.demo.playbackState({is_playing:false,current_audio_unique_id:correct.UNIQUE_ID});tick(300);await flush();
 f.demo.cancel(false);await flush();assert.equal(f.calls.filter(c=>c.api===1003).length,1);
 replayRelease({});await flush();assert.equal(f.calls.filter(c=>c.api===1003).length,2);
 assert.equal(f.states.at(-1)[1],false);
 // A failed PAUSE cannot be hidden while native repeat is restored.
 f=fixture();base=f.options.request;
 f.options.request=async(api,payload)=>{const result=await base(api,payload);if(api===1003)throw Error('pause rejected');return result};
 await f.demo.start();f.demo.cancel(false);await flush();
 assert.equal(JSON.parse(f.calls.filter(c=>c.api===1007).at(-1).payload).play_mode,'no_cycle');
 assert.match(f.errors[0],/Could not confirm audio stopped/);
 await flush();
 assert.equal(timers.size,0);
 console.log('PASS: q-only Pro telemetry completion, motion/pause/gap guards, whole-dance audio repeat, ordered pause/loop restoration, late initial/replay isolation, pause failure reporting, exact clip and cancellation.');
}finally{globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;}
