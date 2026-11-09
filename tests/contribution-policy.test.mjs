import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createContributionPolicy,measureContribution} from '../src/contribution-policy.mjs';
const policy=createContributionPolicy({version:1,thresholdDb:55,referenceDb:70,ceilingDb:90,maxWindowMs:10000});
const sample={policy,windowMs:1000,conservativeDb:70,route:'speaker',evidence:'verified'};
test('reference acoustic energy earns fixed point units',()=>assert.equal(measureContribution(sample).points,1000000n));
test('headphones, missing evidence and subthreshold audio earn zero',()=>{
  for(const update of [{route:'headphones'},{evidence:'unverified'},{conservativeDb:54}])
    assert.equal(measureContribution({...sample,...update}).points,0n);
});
test('loudness is energy-equivalent, not additive decibels',()=>{
  const result=measureContribution({...sample,conservativeDb:80});
  assert.equal(result.points,10000000n);
});
test('invalid windows and unsafe policies fail',()=>{
  assert.throws(()=>measureContribution({...sample,windowMs:10001}));
  assert.throws(()=>createContributionPolicy({version:1,thresholdDb:90,referenceDb:70,ceilingDb:100,maxWindowMs:1000}));
});
