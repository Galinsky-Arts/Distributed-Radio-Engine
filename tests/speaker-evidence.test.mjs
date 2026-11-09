import assert from 'node:assert/strict';
import {test} from 'node:test';
import {aggregateSpeakerEvidence} from '../src/speaker-evidence.mjs';

const scope={tenantId:'tenant',applicationId:'app',stationId:'station',creatorId:'creator',occurrenceId:'occurrence'};
const options={scope,fromMs:1000,toMs:4000,policyVersion:1,verifyEvidence:()=>true};
const a={...scope,physicalOutputId:'speaker-one',issuerId:'test-issuer',windowId:'window-one',
  route:'speaker',status:'verified',outputKind:'physical',microPoints:100n,
  fromMs:1000,toMs:2000,policyVersion:1,unit:'micro-reference-seconds',proof:'test-proof'};
const aggregate=(entries,change={})=>aggregateSpeakerEvidence(entries,{...options,...change});

test('one physical output fanout counts once across client windows and issuers',()=>{
  const result=aggregate([a,a,{...a,issuerId:'other-issuer',windowId:'other-window'}]);
  assert.equal(result.microPoints,100n);
  assert.equal(result.verifiedOutputs,1);
  assert.equal(result.acceptedWindows,1);
  assert.equal(result.duplicateWindows,2);
  assert.equal(result.provisional,true);
  assert.equal(result.spendable,false);
});
test('independent physical outputs add and nonoverlapping windows accumulate',()=>{
  const result=aggregate([a,{...a,physicalOutputId:'speaker-two',windowId:'window-two'},
    {...a,fromMs:2000,toMs:3000,windowId:'window-three'}]);
  assert.equal(result.microPoints,300n);
  assert.equal(result.verifiedOutputs,2);
  assert.equal(result.acceptedWindows,3);
});
test('unverified headphone aggregate-field and component declarations do not contribute',()=>{
  const result=aggregate([{...a,status:'unverified'},{...a,route:'headphone'},
    {...a,outputKind:'aggregate',componentOutputIds:['speaker-one'],declaredSpeakerCount:1000},
    {...a,outputKind:'declared-speaker-count'}]);
  assert.equal(result.microPoints,0n);
  assert.equal(result.verifiedOutputs,0);
  assert.equal(result.excluded.route,2);
  assert.equal(result.excluded.aggregate,2);
});
test('missing verifier or client self-verified flag cannot authorize contribution',()=>{
  assert.throws(()=>aggregate([a],{verifyEvidence:undefined}),/verifier required/);
  assert.equal(aggregate([a],{verifyEvidence:()=>false}).microPoints,0n);
  assert.equal(aggregate([{...a,verified:true}],{verifyEvidence:()=>1}).microPoints,0n);
});
test('invalid IDs proof units values and window bounds are excluded',()=>{
  for(const change of [{physicalOutputId:''},{issuerId:''},{windowId:''},{microPoints:-1n},
    {microPoints:100},{microPoints:10n**31n},{unit:'decibels'},{policyVersion:2},
    {fromMs:999},{toMs:4001},{fromMs:2000},{proof:''},{proof:'x'.repeat(8193)}]) {
    const result=aggregate([{...a,...change}]);
    assert.equal(result.microPoints,0n);
    assert.equal(result.excluded.invalid,1);
  }
});
test('cross-scope evidence is excluded before the verifier sees it',()=>{
  for(const key of Object.keys(scope)) {
    let calls=0;
    const result=aggregate([{...a,[key]:'other'}],{verifyEvidence:()=>{calls++;return true;}});
    assert.equal(result.microPoints,0n);assert.equal(calls,0);
    assert.equal(result.excluded.scope,1);
  }
});
test('conflicting authentic duplicates and partial overlaps fail independent of order',()=>{
  for(const change of [{microPoints:200n},{fromMs:1500,toMs:2500,windowId:'overlap'}]) {
    assert.throws(()=>aggregate([a,{...a,...change}]),/Conflicting|Overlapping/);
    assert.throws(()=>aggregate([{...a,...change},a]),/Conflicting|Overlapping/);
  }
});
test('one issuer window ID cannot identify different physical measurements',()=>{
  assert.throws(()=>aggregate([a,{...a,physicalOutputId:'other-speaker'}]),/issuer window identity/);
});
test('unauthenticated conflicts cannot invalidate accepted evidence',()=>{
  const result=aggregate([a,{...a,microPoints:999n,proof:'forged'}],
    {verifyEvidence:record=>record.proof==='test-proof'});
  assert.equal(result.microPoints,100n);assert.equal(result.excluded.authentication,1);
});
test('verifier authenticates only frozen canonical records and bounded context',()=>{
  let calls=0;
  const result=aggregate([{...a,ambientRecording:'private'}],{verifyEvidence:(record,context)=>{
    calls++;
    assert.equal(Object.isFrozen(record),true);assert.equal(Object.isFrozen(context),true);
    assert.equal(Object.isFrozen(context.scope),true);assert.equal(record.ambientRecording,undefined);
    assert.equal(context.policyVersion,1);assert.equal(record.proof,'test-proof');
    return true;
  }});
  assert.equal(calls,1);assert.equal(result.proof,undefined);assert.equal(result.microPoints,100n);
});
test('async truthy and throwing verifiers fail closed without leaking provider messages',async()=>{
  for(const verifyEvidence of [()=>Promise.reject(new Error('private secret')),
    ()=>({verified:true}),()=>{throw new Error('private secret');}]) {
    const result=aggregate([a],{verifyEvidence});
    assert.equal(result.microPoints,0n);assert.equal(result.excluded.authentication,1);
    assert.equal(result.secret,undefined);
  }
  await new Promise(resolve=>setImmediate(resolve));
});
test('adjudication bounds are validated before evidence processing',()=>{
  for(const change of [{fromMs:-1},{toMs:1000},{toMs:100000},{policyVersion:0},
    {maxEntries:0},{maxEntries:10001},{maxEntries:1}]) {
    assert.throws(()=>aggregate([a,a],change));
  }
  assert.throws(()=>aggregateSpeakerEvidence([a]));
});
test('aggregation is deterministic under order permutations and exact beyond safe integer',()=>{
  const values=[a,{...a,physicalOutputId:'b',windowId:'b',microPoints:10n**24n},
    {...a,physicalOutputId:'c',windowId:'c',microPoints:10n**24n}];
  const expected=aggregate(values);
  assert.deepEqual(aggregate([...values].reverse()),expected);
  assert.equal(expected.microPoints,2n*10n**24n+100n);
});
test('accepted duplicate and excluded census reconciles to all submitted entries',()=>{
  const entries=[a,a,{...a,status:'unverified'},{...a,proof:'forged'},
    {...a,physicalOutputId:'speaker-two',windowId:'two'},null];
  const result=aggregate(entries,{verifyEvidence:record=>record.proof==='test-proof'});
  const excluded=Object.values(result.excluded).reduce((sum,n)=>sum+n,0);
  assert.equal(result.acceptedWindows+result.duplicateWindows+excluded,entries.length);
});


import {createContributionPolicy,measureVerifiedContribution} from '../src/contribution-policy.mjs';
test('calibrated policy decisions compose into independently deduplicated speaker totals',()=>{
  const scope={tenantId:'tenant',applicationId:'app',stationId:'station',creatorId:'creator',occurrenceId:'occurrence'};
  const policy=createContributionPolicy({version:1,thresholdDb:50,referenceDb:60,ceilingDb:80,maxWindowMs:1000,geometryId:'geometry'});
  const decisions=new Map();
  const entries=['output-a','output-b'].map((physicalOutputId,i)=>{
    const decision=measureVerifiedContribution({policy,scope,nowMs:2000,verifyEvidence:()=>true,
      claims:{...scope,physicalOutputId,windowId:'window-'+i,issuerId:'issuer',calibrationId:'calibration',
        geometryId:'geometry',weighting:'A',fromMs:1000,toMs:2000,calibratedAtMs:0,calibrationExpiresAtMs:3000,
        policyVersion:1,measuredDb:60,uncertaintyDb:0,route:'speaker',muted:false,proof:'fixture'}});
    decisions.set(physicalOutputId,decision);
    return {...decision,issuerId:'issuer',route:'speaker',status:'verified',outputKind:'physical',
      microPoints:decision.points,proof:'fixture'};
  });
  const result=aggregateSpeakerEvidence([...entries,entries[0]],{scope,fromMs:1000,toMs:2000,policyVersion:1,
    verifyEvidence:e=>decisions.get(e.physicalOutputId)?.points===e.microPoints});
  assert.equal(result.microPoints,2000000n);assert.equal(result.verifiedOutputs,2);
  assert.equal(result.duplicateWindows,1);assert.equal(result.spendable,false);
});
