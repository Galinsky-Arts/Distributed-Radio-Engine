import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {VestingGate,vestingKey} from '../src/vesting.mjs';
import {SqliteVestingStore} from '../src/sqlite-vesting-store.mjs';

const scope={tenantId:'tenant',applicationId:'app',principalId:'listener'};
const sample={...scope,stationId:'station',occurrenceId:'run1',creatorId:'artist',programDigest:'digest',
  contentRef:'content',outroRef:'outro',startedAtMs:100,completedAtMs:1000,
  requiredStartMs:100,contentEndMs:900,outroEndMs:1000,points:50n,unit:'micro-reference-seconds',
  policyVersion:1,playbackContinuous:true,interruptions:false,proof:'test-proof'};
function memory(t,options={}) {
  const store=new SqliteVestingStore(':memory:',{allowMemory:true});t.after(()=>store.close());
  return {store,gate:new VestingGate({scope,verifyCompletion:()=>true,store,now:()=>1000,...options})};
}
function file(t) {
  const directory=mkdtempSync(join(tmpdir(),'radio-vesting-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  return join(directory,'receipts.sqlite');
}
const gate=store=>new VestingGate({scope,verifyCompletion:()=>true,store,now:()=>1000});

test('vest only after the entire matched outro without claiming wallet credit',t=>{
  const {gate:g}=memory(t);
  assert.equal(g.vest({...sample,completedAtMs:999}).reason,'incomplete-cycle');
  const result=g.vest(sample);
  assert.equal(result.accepted,true);
  assert.equal(result.record.walletSettlement,'pending');
  assert.equal(result.record.outroRef,'outro');
  assert.equal(result.record.proof,undefined);
});
test('late join and authenticated interruption persist a terminal forfeiture',t=>{
  for(const change of [{startedAtMs:101},{interruptions:true},{playbackContinuous:false}]) {
    const {gate:g}=memory(t);
    assert.equal(g.vest({...sample,...change}).reason,'forfeited');
    assert.equal(g.vest(sample).accepted,false);
    assert.equal(g.vest(sample).reason,'forfeited');
    assert.equal(g.get('artist','run1').points,0n);
  }
});
test('idempotent duplicates do not vest twice and conflicting amounts fail',t=>{
  const {gate:g}=memory(t);
  assert.equal(g.vest(sample).accepted,true);
  assert.equal(g.vest(sample).reason,'already-vested');
  assert.throws(()=>g.vest({...sample,points:900n}),/Conflicting/);
  assert.equal(g.get('artist','run1').points,50n);
});
test('same logical occurrence cannot mint again under another station',t=>{
  const {gate:g}=memory(t);g.vest(sample);
  assert.throws(()=>g.vest({...sample,stationId:'other-station'}),/Conflicting/);
  assert.equal(g.get('artist','run1').points,50n);
});
test('different creators and listeners have separate occurrence keys',t=>{
  const {gate:g,store}=memory(t);g.vest(sample);
  assert.equal(g.vest({...sample,creatorId:'other-artist'}).accepted,true);
  const other=new VestingGate({scope:{...scope,principalId:'other'},verifyCompletion:()=>true,store,now:()=>1000});
  assert.equal(other.vest({...sample,principalId:'other'}).accepted,true);
  assert.equal(g.get('artist','run1').points,50n);
});
test('scope malformed timings units and unauthenticated flags cannot create receipt',t=>{
  const {gate:g}=memory(t);
  for(const change of [{tenantId:'other'},{applicationId:'other'},{principalId:'other'},
    {startedAtMs:1001},{requiredStartMs:-1},{contentEndMs:1000},{outroEndMs:900},
    {points:-1n},{points:1},{unit:'decibels'},{proof:''},{outroRef:''}])
    assert.throws(()=>g.vest({...sample,...change}));
  assert.equal(g.get('artist','run1'),null);
  const denied=memory(t,{verifyCompletion:()=>false}).gate;
  assert.equal(denied.vest({...sample,evidenceContinuous:true}).reason,'unauthenticated');
  assert.equal(denied.get('artist','run1'),null);
});
test('verifier binds exact frozen completion and omits arbitrary private fields',t=>{
  let called=false;
  const {gate:g}=memory(t,{verifyCompletion:(event,context)=>{
    called=true;assert.equal(Object.isFrozen(event),true);assert.equal(Object.isFrozen(context),true);
    assert.equal(event.privateKey,undefined);assert.equal(event.outroRef,'outro');
    assert.equal(event.programDigest,'digest');assert.equal(event.points,50n);return true;
  }});
  g.vest({...sample,privateKey:'private'});
  assert.equal(called,true);
});
test('future/stale first completions reject while a stored exact retry remains idempotent',t=>{
  let now=999;
  const {gate:g}=memory(t,{now:()=>now,maxDecisionAgeMs:100});
  assert.throws(()=>g.vest(sample),/clock/);
  now=1101;assert.equal(g.vest(sample).reason,'stale-completion');
  now=1000;assert.equal(g.vest(sample).accepted,true);
  now=999999;assert.equal(g.vest(sample).reason,'already-vested');
});
test('receipt survives close/reopen and has private file permissions',t=>{
  const path=file(t);let store=new SqliteVestingStore(path);
  assert.equal(gate(store).vest(sample).accepted,true);store.close();
  assert.equal(statSync(path).mode&0o077,0);
  store=new SqliteVestingStore(path);
  assert.equal(gate(store).vest(sample).reason,'already-vested');
  assert.equal(gate(store).get('artist','run1').points,50n);store.close();
});
test('forfeiture survives restart and cannot be replaced by a later complete replay',t=>{
  const path=file(t);let store=new SqliteVestingStore(path);
  gate(store).vest({...sample,interruptions:true});store.close();
  store=new SqliteVestingStore(path);
  assert.equal(gate(store).vest(sample).reason,'forfeited');store.close();
});
test('concurrent independent database connections settle only one receipt',t=>{
  const path=file(t),first=new SqliteVestingStore(path),second=new SqliteVestingStore(path);
  assert.equal(gate(first).vest(sample).accepted,true);
  assert.equal(gate(second).vest(sample).accepted,false);
  first.close();second.close();
});
test('failed insert rolls back so a repaired bounded retry can vest',t=>{
  const path=file(t),store=new SqliteVestingStore(path),db=new DatabaseSync(path);
  db.exec("CREATE TRIGGER fail_receipt AFTER INSERT ON radio_vesting_receipts BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END");
  assert.throws(()=>gate(store).vest(sample),/injected storage failure/);
  assert.equal(gate(store).get('artist','run1'),null);
  db.exec('DROP TRIGGER fail_receipt');
  assert.equal(gate(store).vest(sample).accepted,true);
  db.close();store.close();
});
test('store validates receipt before committing and refuses scoped key mismatch',t=>{
  const {store}=memory(t);
  const record={...sample,decision:'vested',walletSettlement:'pending'};
  assert.throws(()=>store.claim(vestingKey(sample),record),/Corrupt/);
  assert.equal(store.get(vestingKey(sample)),null);
  const valid=gate(store).vest(sample).record;
  assert.throws(()=>store.claim('wrong',valid),/scope/);
  assert.equal(store.get('wrong'),null);
});
test('volatile and unsupported-schema stores fail explicitly',t=>{
  assert.throws(()=>new SqliteVestingStore(':memory:'),/opt-in/);
  assert.throws(()=>new VestingGate(),/scope/);
  const path=file(t),store=new SqliteVestingStore(path);store.close();
  const db=new DatabaseSync(path);db.exec('UPDATE radio_vesting_schema SET version=2');db.close();
  assert.throws(()=>new SqliteVestingStore(path),/Unsupported/);
});
test('multi-process racing replay produces exactly one vested receipt',async t=>{
  const path=file(t);
  const run=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[new URL('./fixtures/vesting-race-worker.mjs',import.meta.url).pathname,path],
      {stdio:['ignore','pipe','pipe']});
    let output='',error='';child.stdout.on('data',x=>{output+=x;});child.stderr.on('data',x=>{error+=x;});
    child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(output)):reject(new Error(error)));
  });
  const results=await Promise.all([run(),run(),run(),run()]);
  assert.equal(results.filter(x=>x.accepted).length,1);
  const store=new SqliteVestingStore(path);assert.equal(gate(store).get('artist','run1').points,50n);store.close();
});
test('async completion verifiers cannot issue a receipt or leak rejection',async t=>{
  const {gate:g}=memory(t,{verifyCompletion:()=>Promise.reject(new Error('private token'))});
  assert.equal(g.vest(sample).reason,'unauthenticated');
  await new Promise(resolve=>setImmediate(resolve));
});

