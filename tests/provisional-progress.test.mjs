import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ProvisionalProgress} from '../src/provisional-progress.mjs';

const scope={tenantId:'tenant',applicationId:'app',stationId:'station',principalId:'listener',playbackSessionId:'session'};
const sample={...scope,cycleId:'cycle',creatorId:'creator',occurrenceId:'occurrence',windowId:'window',
  points:100n,unit:'micro-reference-seconds',policyVersion:1,programDigest:'digest',cycleStartedAtMs:1000,contentFromMs:1500,
  contentToMs:4500,outroToMs:5000,joinedAtMs:1000,fromMs:1500,toMs:2500,proof:'test-proof'};
const create=change=>new ProvisionalProgress({scope,verifyWindow:()=>true,...change});

test('authenticated windows accumulate only nonspendable progress',()=>{
  const p=create();p.addWindow(sample);
  const result=p.addWindow({...sample,windowId:'second',fromMs:2500,toMs:3500,points:50n});
  assert.equal(result.provisionalPoints,150n);
  assert.equal(result.acceptedWindows,2);
  assert.equal(result.spendablePoints,0n);assert.equal(result.settled,false);
  assert.equal(result.creatorId,'creator');assert.equal(result.occurrenceId,'occurrence');
});
test('client verification booleans do not replace a trusted window verifier',()=>{
  assert.throws(()=>new ProvisionalProgress(),/scope/);
  assert.throws(()=>new ProvisionalProgress({scope}),/verifier/);
  const p=create({verifyWindow:()=>false});
  assert.equal(p.addWindow({...sample,verified:true}).provisionalPoints,0n);
  assert.equal(p.preview('cycle').state,'empty');
});
test('replay counts once and contradictory authenticated replay preserves first value',()=>{
  const p=create();p.addWindow(sample);
  assert.equal(p.addWindow(sample).provisionalPoints,100n);
  assert.throws(()=>p.addWindow({...sample,points:900n}),/Conflicting replay/);
  assert.equal(p.preview('cycle').provisionalPoints,100n);
});
test('overlapping differently identified decision windows cannot double preview',()=>{
  const p=create();p.addWindow(sample);
  assert.throws(()=>p.addWindow({...sample,windowId:'other',fromMs:2000,toMs:3000}),/Overlapping/);
  assert.equal(p.preview('cycle').acceptedWindows,1);
});
test('abandon is terminal and authenticated replay cannot resurrect a cycle',()=>{
  const p=create();p.addWindow(sample);
  assert.equal(p.abandon('cycle').provisionalPoints,0n);
  assert.equal(p.addWindow(sample).provisionalPoints,0n);
  assert.equal(p.preview('cycle').state,'forfeited');
  assert.equal(p.preview('cycle').reason,'INTERRUPTED');
  assert.equal(p.preview('cycle').acceptedWindows,0);
});
test('interruption before first evidence also leaves a replay tombstone',()=>{
  for(const reason of ['STOPPED','PAUSED','SEEKED','MUTED','ROUTE_CHANGED']) {
    const p=create();p.abandon('cycle',reason);
    assert.equal(p.addWindow(sample).state,'forfeited');
    assert.equal(p.preview('cycle').reason,reason);
  }
});
test('late joins cannot start an eligible cycle and are not reset by earlier timestamps',()=>{
  const p=create();
  assert.equal(p.addWindow({...sample,joinedAtMs:1001}).reason,'LATE_JOIN');
  assert.equal(p.addWindow(sample).provisionalPoints,0n);
  assert.equal(p.preview('cycle').state,'forfeited');
});
test('changing scope creator occurrence or timeline cannot retarget a running cycle',()=>{
  for(const key of Object.keys(scope)) {
    const p=create();
    assert.throws(()=>p.addWindow({...sample,[key]:'other'}),/scope mismatch/);
  }
  for(const change of [{creatorId:'other'},{occurrenceId:'other'},{programDigest:'other'},{policyVersion:2},{outroToMs:6000}]) {
    const p=create();p.addWindow(sample);
    assert.throws(()=>p.addWindow({...sample,...change}),/mismatch/);
    assert.equal(p.preview('cycle').provisionalPoints,100n);
  }
});
test('outro interstitial and invalid duration windows do not earn preview',()=>{
  for(const change of [{fromMs:1499},{toMs:4501},{toMs:1500},{fromMs:-1},
    {contentToMs:5000},{outroToMs:4500},{cycleStartedAtMs:1600}])
    assert.throws(()=>create().addWindow({...sample,...change}));
});
test('proof unit policy and integer amounts are validated without coercion',()=>{
  for(const change of [{proof:''},{proof:'x'.repeat(8193)},{points:-1n},{points:10n**31n},
    {points:100},{unit:'decibels'},{policyVersion:0},{windowId:''}])
    assert.throws(()=>create().addWindow({...sample,...change}));
});
test('frozen verifier input omits arbitrary raw measurement fields',()=>{
  let checked=false;
  const p=create({verifyWindow:(event,context)=>{
    checked=true;assert.equal(Object.isFrozen(event),true);assert.equal(Object.isFrozen(context),true);
    assert.equal(event.ambientAudio,undefined);assert.equal(event.proof,'test-proof');
    return true;
  }});
  const result=p.addWindow({...sample,ambientAudio:'private'});
  assert.equal(checked,true);assert.equal(result.proof,undefined);assert.equal(result.ambientAudio,undefined);
});
test('rejected conflicting input does not poison a previously authenticated decision',()=>{
  const p=create({verifyWindow:event=>event.proof==='test-proof'});p.addWindow(sample);
  assert.equal(p.addWindow({...sample,points:999n,proof:'forged'}).provisionalPoints,100n);
});
test('async truthy and throwing verifiers cannot produce progress or leak exceptions',async()=>{
  for(const verifyWindow of [()=>Promise.reject(new Error('secret')),
    ()=>({verified:true}),()=>{throw new Error('secret');}]) {
    const p=create({verifyWindow});
    assert.equal(p.addWindow(sample).provisionalPoints,0n);
  }
  await new Promise(resolve=>setImmediate(resolve));
});
test('window and terminal-cycle resource bounds reject before unbounded growth',()=>{
  const p=create({maxCycles:1,maxWindowsPerCycle:1,maxTotalWindows:1});p.addWindow(sample);
  assert.throws(()=>p.addWindow({...sample,windowId:'two',fromMs:2500,toMs:3500}),/capacity/);
  p.abandon('cycle');
  assert.throws(()=>p.addWindow({...sample,cycleId:'other'}),/capacity/);
  assert.throws(()=>p.abandon('unknown'),/capacity/);
  assert.equal(p.preview('cycle').provisionalPoints,0n);
});
test('constructor bounds and interruption reasons fail closed',()=>{
  for(const change of [{maxCycles:0},{maxCycles:10001},{maxWindowsPerCycle:10001},{maxTotalWindows:100001}])
    assert.throws(()=>create(change));
  assert.throws(()=>create().abandon('cycle','OTHER'));
});
test('creator-specific separate cycles keep exact large totals independent',()=>{
  const p=create();p.addWindow({...sample,points:10n**24n});
  const other=p.addWindow({...sample,cycleId:'other',creatorId:'other',occurrenceId:'other',points:20n});
  assert.equal(other.provisionalPoints,20n);
  assert.equal(p.preview('cycle').provisionalPoints,10n**24n);
});

