import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createContributionPolicy,measureContribution,measureVerifiedContribution} from '../src/contribution-policy.mjs';

const policy=createContributionPolicy({version:1,thresholdDb:55,referenceDb:70,ceilingDb:90,
  maxWindowMs:10000,geometryId:'test-geometry',maxEvidenceAgeMs:5000});
const scope={tenantId:'tenant',applicationId:'app',stationId:'station',creatorId:'creator',occurrenceId:'occurrence'};
const claims={...scope,windowId:'window',physicalOutputId:'speaker',issuerId:'issuer',calibrationId:'calibration',
  geometryId:'test-geometry',weighting:'A',fromMs:1000,toMs:2000,calibratedAtMs:500,
  calibrationExpiresAtMs:10000,policyVersion:1,measuredDb:72,uncertaintyDb:2,
  route:'speaker',muted:false,proof:'explicit-test-proof'};
const base={policy,claims,scope,nowMs:3000,verifyEvidence:()=>true};
const measure=(change={})=>measureVerifiedContribution({...base,...change});

test('authenticated calibrated lower bound produces provisional creator-scoped units',()=>{
  const result=measure();
  assert.equal(result.points,1000000n);
  assert.equal(result.creatorId,'creator');
  assert.equal(result.windowId,'window');
  assert.equal(result.physicalOutputId,'speaker');
  assert.equal(result.provisional,true);
  assert.equal(result.spendable,false);
  assert.equal(result.unit,'micro-reference-seconds');
  assert.equal(result.proof,undefined);
  assert.equal(result.measuredDb,undefined);
});

test('evidence boolean and unsigned or asynchronous callbacks cannot authorize a sample',async()=>{
  assert.throws(()=>measure({verifyEvidence:undefined}),/verifier required/);
  for(const result of [false,1,'verified',undefined,{}])
    assert.throws(()=>measure({verifyEvidence:()=>result}),/authentication failed/);
  assert.throws(()=>measure({verifyEvidence:()=>Promise.reject(new Error('not synchronously verified'))}),
    /Synchronous/);
  await new Promise(resolve=>setImmediate(resolve));
});

test('verifier sees frozen canonical claims and complete validated policy',()=>{
  let checked=false;
  measure({claims:{...claims,ambientAudio:'never forwarded'},verifyEvidence:(record,configuration)=>{
    checked=true;
    assert.equal(Object.isFrozen(record),true);
    assert.equal(Object.isFrozen(configuration),true);
    assert.equal(record.ambientAudio,undefined);
    assert.equal(record.proof,'explicit-test-proof');
    assert.equal(configuration.ceilingDb,90);
    assert.equal(configuration.rounding,'lower-bound-integer-v1');
    assert.throws(()=>{record.creatorId='other';});
    return true;
  }});
  assert.equal(checked,true);
});

test('cross-tenant application station creator and occurrence are rejected before verification',()=>{
  for(const key of Object.keys(scope)) {
    let called=false;
    assert.throws(()=>measure({scope:{...scope,[key]:'other'},verifyEvidence:()=>{called=true;return true;}}),
      /scope mismatch/);
    assert.equal(called,false);
  }
});

test('stale future inverted overlong and uncalibrated windows are rejected',()=>{
  for(const change of [{toMs:3001},{fromMs:2000},{fromMs:2001},{calibratedAtMs:1001},
    {calibrationExpiresAtMs:1999},{fromMs:-1},{fromMs:NaN},{toMs:20000}])
    assert.throws(()=>measure({claims:{...claims,...change}}));
  assert.throws(()=>measure({nowMs:8001}),/Stale/);
  assert.throws(()=>measure({nowMs:-1}),/clock/);
  assert.equal(measure({nowMs:7000}).eligible,true);
});

test('calibration identity weighting geometry version and bounded proof are mandatory',()=>{
  for(const change of [{calibrationId:''},{geometryId:'other'},{weighting:'C'},
    {policyVersion:2},{proof:''},{proof:'x'.repeat(8193)}])
    assert.throws(()=>measure({claims:{...claims,...change}}));
  const uncalibrated=createContributionPolicy({version:1,thresholdDb:55,referenceDb:70,
    ceilingDb:90,maxWindowMs:10000});
  assert.throws(()=>measure({policy:uncalibrated}),/geometry required/);
});

test('upper uncertainty bound is safety gate even when lower bound is eligible',()=>{
  assert.equal(measure({claims:{...claims,measuredDb:89,uncertaintyDb:2}}).points,0n);
  assert.equal(measure({claims:{...claims,measuredDb:88,uncertaintyDb:2}}).eligible,true);
});

test('threshold must be exceeded; no headphone mute unavailable or slider credit',()=>{
  for(const change of [{measuredDb:57,uncertaintyDb:2},{route:'headphones'},
    {route:'unavailable'},{muted:true}]) {
    const result=measure({claims:{...claims,...change}});
    assert.equal(result.points,0n);
    assert.equal(result.eligible,false);
  }
  assert.throws(()=>measure({claims:{...claims,route:'volume-slider'}}));
});

test('invalid measurement and uncertainty are rejected rather than coerced',()=>{
  for(const change of [{measuredDb:NaN},{measuredDb:'72'},{measuredDb:121},
    {uncertaintyDb:-1},{uncertaintyDb:Infinity},{muted:0}])
    assert.throws(()=>measure({claims:{...claims,...change}}));
});

test('forged policy fields and unsupported rounding cannot evade validation',()=>{
  for(const change of [{thresholdDb:-1},{referenceDb:130},{ceilingDb:Infinity},
    {maxWindowMs:Infinity},{weighting:'C'},{rounding:'nearest'},{resolution:'raw-float'}])
    assert.throws(()=>measure({policy:{...policy,...change}}));
});

test('exact decade energy arithmetic remains exact and exceeds safe-number range',()=>{
  const wide=createContributionPolicy({version:1,thresholdDb:0,referenceDb:10,
    ceilingDb:120,maxWindowMs:60000});
  const sample={policy:wide,windowMs:60000,route:'speaker',evidence:'verified'};
  assert.equal(measureContribution({...sample,conservativeDb:10}).points,60000000n);
  assert.equal(measureContribution({...sample,conservativeDb:20}).points,600000000n);
  assert.equal(measureContribution({...sample,conservativeDb:120}).points,6000000000000000000n);
});

test('splitting an acoustic window cannot increase credited units through rounding',()=>{
  for(const conservativeDb of [55.001,60.123,69.999,70,72.999,80.999,90]) {
    const sample={policy,conservativeDb,route:'speaker',evidence:'verified'};
    const whole=measureContribution({...sample,windowMs:1000}).points;
    const pieces=measureContribution({...sample,windowMs:333}).points+
      measureContribution({...sample,windowMs:667}).points;
    assert.ok(pieces<=whole);
  }
});

test('millidecibel subresolution changes cannot increase potential contribution',()=>{
  const sample={policy,windowMs:1000,route:'speaker',evidence:'verified'};
  assert.equal(measureContribution({...sample,conservativeDb:70.1231}).points,
    measureContribution({...sample,conservativeDb:70.1239}).points);
});
