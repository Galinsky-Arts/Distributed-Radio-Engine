import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createContributionPolicy,measureContribution} from '../src/contribution-policy.mjs';

test('independent 100-digit Decimal fixtures bound credited energy conservatively',async()=>{
  const {cases}=JSON.parse(await readFile(new URL('./fixtures/contribution-golden.json',import.meta.url),'utf8'));
  const policy=createContributionPolicy({version:1,thresholdDb:55,referenceDb:70,
    ceilingDb:90,maxWindowMs:10000});
  for(const example of cases) {
    const result=measureContribution({policy,conservativeDb:example.milliDb/1000,
      windowMs:example.windowMs,route:'speaker',evidence:'verified'}).points;
    const exact=BigInt(example.mathematicalFloor);
    assert.ok(result<=exact,JSON.stringify(example));
    // Binary representation may move one millidecibel down at a boundary;
    // explicit quantization permits that conservative loss, never extra credit.
    assert.ok(exact-result <= exact/4000n+1n,JSON.stringify(example));
  }
  assert.equal(cases.length,768);
});
