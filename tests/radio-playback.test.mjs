import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRadioPlayback,createWebRadioPlayback,createNativeRadioPlayback} from '../src/radio-playback.mjs';
import {ContractError} from '../src/contracts.mjs';

const program={stationId:'station',version:1,digest:'digest',durationMs:6000,timeline:[
  {ref:'opening',role:'opening',fromMs:0,toMs:1000},
  {ref:'song',role:'content',fromMs:1000,toMs:5000},
  {ref:'outro',role:'closing',fromMs:5000,toMs:6000}]};
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(options={}) {
  const seen=[], joins=[];
  let closed=0,stopped=0,clock=13500;
  const transport={connect:async({join})=>{
    joins.push(join);
    return {frames:(async function*(){yield {ciphertext:new Uint8Array([1,2,3])};})(),
      close:async()=>{closed++;}};
  }};
  const endpoint={writeCiphertext:async frame=>{seen.push(frame);},stop:async()=>{stopped++;}};
  const input={clientType:'web',station:{read:async()=>({program,startedAtMs:10000}),verify:async()=>true},
    transport,endpoint,now:()=>clock,operationTimeoutMs:200,...options};
  return {input,seen,joins,get closed(){return closed;},get stopped(){return stopped;},
    setClock:value=>{clock=value;}};
}

test('web and native facades join the live offset and never offer seek',async()=>{
  for(const factory of [createWebRadioPlayback,createNativeRadioPlayback]) {
    const f=fixture(),session=factory(f.input);
    const result=await session.start();
    assert.equal(f.joins[0].segmentRef,'song');
    assert.equal(f.joins[0].segmentOffsetMs,2500);
    assert.equal(result.seekable,false);
    assert.equal(result.onDemand,false);
    assert.deepEqual(Object.keys(session),['start','stop','recover','status']);
    assert.equal(f.closed,1);
    assert.equal(f.stopped,1);
    assert.equal(result.errorCode,'STATION_STREAM_ENDED');
    assert.equal(result.route.status,'unavailable');
    assert.equal(f.seen.length,1);
  }
});

test('station authentication precedes transport and endpoint delivery',async()=>{
  const f=fixture();f.input.station.verify=async()=>false;
  const result=await createRadioPlayback(f.input).start();
  assert.equal(result.errorCode,'STATION_AUTHENTICATION_FAILED');
  assert.equal(f.joins.length,0);
  assert.equal(f.seen.length,0);
});

test('duplicate start shares one connection and pulls only after endpoint acceptance',async()=>{
  const firstWrite=deferred(),secondPull=deferred();
  let pulls=0,writes=0,received;
  const f=fixture();
  f.input.transport.connect=async()=>({
    frames:{[Symbol.asyncIterator](){return this;},async next(){
      pulls++;
      if(pulls===1)return {done:false,value:{ciphertext:new Uint8Array([4,5])}};
      secondPull.resolve();return {done:true};
    }},close:async()=>{},
  });
  f.input.endpoint.writeCiphertext=async bytes=>{received=bytes;writes++;await firstWrite.promise;};
  const session=createRadioPlayback(f.input);
  const run=session.start();
  assert.equal(session.start(),run);
  await tick();
  assert.equal(pulls,1);
  assert.equal(writes,1);
  assert.deepEqual([...received],[4,5]);
  firstWrite.resolve();
  await secondPull.promise;
  await run;
  assert.equal(pulls,2);
});

test('frame size, shape and key material are rejected before delivery',async()=>{
  for(const frame of [{ciphertext:new Uint8Array(0)}, {ciphertext:new Uint8Array(5)},
    {ciphertext:new Uint8Array(1),key:'private'}, {plaintext:new Uint8Array(1)},
    {ciphertext:'not bytes'}, null]) {
    const f=fixture({maxFrameBytes:4});
    f.input.transport.connect=async()=>({frames:(async function*(){yield frame;})(),close:async()=>{}});
    const result=await createRadioPlayback(f.input).start();
    assert.equal(result.errorCode,'INVALID_CIPHERTEXT_FRAME');
    assert.equal(f.seen.length,0);
    assert.equal(result.route.status,'unavailable');
  }
});

test('stop fences blocked frame input and recovery rereads current station clock',async()=>{
  let activePull,connects=0,reads=0;
  const f=fixture();
  f.input.station.read=async()=>{reads++;return {program,startedAtMs:10000};};
  f.input.transport.connect=async({join})=>{
    connects++;f.joins.push(join);
    return {frames:{[Symbol.asyncIterator](){return this;},next(){
      activePull=deferred();return activePull.promise;
    }},close:async()=>{activePull?.resolve({done:true});}};
  };
  const session=createRadioPlayback(f.input),first=session.start();
  await tick();
  assert.equal(session.status().route.status,'recovering');
  assert.equal(session.status().evidence.status,'unavailable');
  assert.equal((await session.stop()).state,'stopped');
  await first;
  f.setClock(16700);
  const second=session.recover();
  await tick();
  assert.equal(connects,2);
  assert.equal(reads,2);
  assert.equal(f.joins[1].cycle,1);
  assert.equal(f.joins[1].segmentRef,'opening');
  assert.equal(f.joins[1].segmentOffsetMs,700);
  await session.stop();await second;
});

test('route ready requires successful endpoint acceptance and evidence stays distinct',async()=>{
  let release;
  const f=fixture();
  f.input.transport.connect=async()=>({frames:{[Symbol.asyncIterator](){return this;},next(){
    if(!release){release=deferred();return Promise.resolve({done:false,value:{ciphertext:new Uint8Array([1])}});}
    return release.promise;
  }},close:async()=>release.resolve({done:true})});
  f.input.endpoint.evidence=()=> 'unverified';
  const session=createRadioPlayback(f.input),run=session.start();await tick();
  assert.equal(session.status().route.status,'ready');
  assert.equal(session.status().evidence.status,'unverified');
  assert.equal(session.status().join.evidence.status,'unavailable');
  await session.stop();await run;
  assert.equal(session.status().evidence.status,'unavailable');
});

test('provider errors do not expose secrets in status',async()=>{
  const f=fixture();f.input.transport.connect=async()=>{throw new Error('token=secret /private/path');};
  const result=await createRadioPlayback(f.input).start();
  assert.equal(result.errorCode,'PLAYBACK_ADAPTER_FAILED');
  assert.doesNotMatch(JSON.stringify(result),/secret|private\/path/);
  f.input.transport.connect=async()=>{throw new ContractError('PRIVATE_ACCESS_TOKEN');};
  const second=await createRadioPlayback(f.input).start();
  assert.equal(second.errorCode,'PLAYBACK_ADAPTER_FAILED');
  assert.doesNotMatch(JSON.stringify(second),/PRIVATE_ACCESS_TOKEN/);
});

test('invalid adapters and resource bounds fail before opening a connection',()=>{
  for(const options of [{clientType:'unknown'},{maxFrameBytes:0},{maxFrameBytes:Infinity},
    {operationTimeoutMs:0},{operationTimeoutMs:60001},{station:{}},{transport:{}},{endpoint:{}}])
    assert.throws(()=>createRadioPlayback(fixture(options).input));
});

test('timeout seals session and closes a late connection without delivery',async()=>{
  const connecting=deferred();let closed=0;
  const f=fixture({operationTimeoutMs:10});f.input.transport.connect=()=>connecting.promise;
  const session=createRadioPlayback(f.input);
  const result=await session.start();
  assert.equal(result.sealed,true);
  assert.equal(result.route.status,'unavailable');
  connecting.resolve({frames:(async function*(){yield {ciphertext:new Uint8Array([1])};})(),
    close:async()=>{closed++;}});
  await tick();
  assert.equal(closed,1);
  assert.equal(f.seen.length,0);
  await assert.rejects(session.recover(),/Unsettled adapter/);
});

test('cleanup failure prevents a second connection',async()=>{
  const f=fixture();f.input.endpoint.stop=async()=>{throw new Error('failure');};
  const session=createRadioPlayback(f.input),result=await session.start();
  assert.equal(result.errorCode,'PLAYBACK_CLOSE_FAILED');
  assert.equal(result.sealed,true);
  await assert.rejects(session.start(),/disposal/);
});

test('aborted station read never opens a transport or delivers stale bytes',async()=>{
  const reading=deferred();const f=fixture();f.input.station.read=()=>reading.promise;
  const session=createRadioPlayback(f.input),run=session.start();
  await tick();const stop=session.stop();
  reading.resolve({program,startedAtMs:10000});await stop;await run;
  assert.equal(f.joins.length,0);
  assert.equal(f.seen.length,0);
  assert.equal(session.status().state,'stopped');
});

test('late connect during stop is closed exactly once before recovery',async()=>{
  const connecting=deferred();let closed=0;
  const f=fixture();f.input.transport.connect=()=>connecting.promise;
  const session=createRadioPlayback(f.input),run=session.start();await tick();
  const stopping=session.stop();
  connecting.resolve({frames:(async function*(){yield {ciphertext:new Uint8Array([1])};})(),
    close:async()=>{closed++;}});
  const result=await stopping;await run;
  assert.equal(result.state,'stopped');
  assert.equal(closed,1);
  assert.equal(f.seen.length,0);
});

test('uncooperative write times out, seals route and prevents unsafe reconnect',async()=>{
  const f=fixture({operationTimeoutMs:10});
  f.input.endpoint.writeCiphertext=()=>new Promise(()=>{});
  const session=createRadioPlayback(f.input),result=await session.start();
  assert.equal(result.sealed,true);
  assert.equal(result.errorCode,'PLAYBACK_ADAPTER_TIMEOUT');
  assert.equal(result.route.status,'unavailable');
  await assert.rejects(session.recover(),/Unsettled adapter/);
});

test('invalid asynchronous frame iterator and evidence state fail closed',async()=>{
  const f=fixture();f.input.transport.connect=async()=>({frames:[],close:async()=>{}});
  const badTransport=await createRadioPlayback(f.input).start();
  assert.equal(badTransport.errorCode,'INVALID_CIPHERTEXT_TRANSPORT');
  const second=fixture();second.input.endpoint.evidence=()=> 'calibrated-maybe';
  const badEvidence=await createRadioPlayback(second.input).start();
  assert.equal(badEvidence.errorCode,'INVALID_EVIDENCE_STATE');
  assert.equal(badEvidence.evidence.status,'unavailable');
});

test('public playback subpath exposes web/native facade without engine crypto imports',async()=>{
  const sdk=await import('@neophilism/distributed-radio-engine/playback');
  assert.equal(typeof sdk.createWebRadioPlayback,'function');
  assert.equal(typeof sdk.createNativeRadioPlayback,'function');
});

test('status observer sees playing before stream end and cannot prevent cleanup',async()=>{
  const states=[],f=fixture({onStatus:s=>{states.push(s.state);if(s.state==='playing')throw Error('UI failure');}});
  const result=await createRadioPlayback(f.input).start();
  assert.deepEqual(states,['connecting','playing','unavailable']);
  assert.equal(result.errorCode,'STATION_STREAM_ENDED');
  assert.equal(f.closed,1);assert.equal(f.stopped,1);
});
