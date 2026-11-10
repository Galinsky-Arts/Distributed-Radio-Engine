import test from 'node:test';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {createWebRadioPlayback} from '../src/radio-playback.mjs';
const options={skip:!process.env.AUDIO_ENGINE_MODULE&&'Actual DAE build required'};
for(const kind of ['music','documentary'])test(`DRE-27 ${kind} ciphertext transport composes actual DAE chunk authentication`,options,async()=>{
 const core=await import(pathToFileURL(process.env.AUDIO_ENGINE_MODULE));
 // Synthetic endpoint data. This is neither an acoustic trial nor a key-agreement protocol.
 const plaintext=Uint8Array.from({length:512},(_,i)=>(i+kind.length)%251),context={tenantId:'tenant',application:'distributed-radio',parentMessageId:kind};
 const encrypted=await core.encryptAttachment(plaintext,{...context,filename:'private-'+kind+'.bin',mediaType:'application/octet-stream'});
 const run=async(tamper=false)=>{
  const reader=await core.EndpointAttachmentReader.open(encrypted.privateManifest,context),accepted=[];let index=0;
  const program={stationId:'station',version:1,digest:'digest',durationMs:3000,timeline:[{ref:'intro',role:'opening',fromMs:0,toMs:1000},{ref:'recording',role:'content',fromMs:1000,toMs:2000},{ref:'outro',role:'closing',fromMs:2000,toMs:3000}]};
  const transport={connect:async({join})=>{assert.equal(join.stationId,'station');return {frames:(async function*(){for(const bytes of encrypted.ciphertextChunks){const ciphertext=new Uint8Array(bytes);if(tamper)ciphertext[0]^=1;yield {ciphertext};}})(),close:async()=>{}};}};
  const endpoint={writeCiphertext:async bytes=>{const chunk=await reader.decryptChunk(index++,bytes);accepted.push(chunk);},stop:async()=>reader.close(),evidence:()=> 'unavailable'};
  const playback=createWebRadioPlayback({station:{read:async()=>({program,startedAtMs:1000}),verify:async()=>true},transport,endpoint,now:()=>1000});
  const status=await playback.start();return {status,accepted};
 };
 const good=await run();assert.deepEqual(new Uint8Array(Buffer.concat(good.accepted)),plaintext);assert.equal(good.status.onDemand,false);assert.equal(good.status.evidence.status,'unavailable');
 assert.equal(good.status.errorCode,'STATION_STREAM_ENDED');const bad=await run(true);assert.equal(bad.accepted.length,0);assert.equal(bad.status.state,'unavailable');
});
