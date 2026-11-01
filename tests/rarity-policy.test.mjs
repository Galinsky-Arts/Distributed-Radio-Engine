import {test} from 'node:test';import assert from 'node:assert/strict';
import {rarityWeights,selectRarityTier,eligibleRarityWeights,auditedRarityDraw} from '../src/rarity-policy.mjs';
test('every rare tier retains strictly positive probability',()=>{
 const x=rarityWeights({tiers:8});assert.ok(x.hasPositiveTail);
 assert.equal(x.weights.at(-1),1n);assert.equal(selectRarityTier(x,x.total-1n),7);
});
test('draw is deterministic for an audited uniform integer',()=>{
 const x=rarityWeights({tiers:4,base:2n});
 assert.equal(selectRarityTier(x,0n),0);assert.equal(selectRarityTier(x,x.total-1n),3);
});
test('invalid large tiers and draws fail closed',()=>{
 assert.throws(()=>rarityWeights({tiers:129}));
 const x=rarityWeights({tiers:3});
 assert.throws(()=>selectRarityTier(x,x.total));
});

test('completion thresholds unlock rare tiers monotonically with positive tail',()=>{
 const values=[0,2,5,10];
 const early=eligibleRarityWeights({minimumCompletions:values,completed:1});
 const later=eligibleRarityWeights({minimumCompletions:values,completed:10});
 assert.deepEqual(early.weights.slice(1),[0n,0n,0n]);
 assert.ok(later.weights.every(w=>w>0n));
 assert.equal(later.hasPositiveTail,true);
 assert.equal(selectRarityTier(later,later.total-1n),3);
 assert.throws(()=>eligibleRarityWeights({minimumCompletions:[10],completed:0}),/no eligible/);
 assert.throws(()=>eligibleRarityWeights({minimumCompletions:[2,1],completed:10}),/ordered/);
});
test('seeded issuer audit draw is deterministic and bound to each opportunity and listener',()=>{
 const policy=eligibleRarityWeights({minimumCompletions:Array(32).fill(0),completed:20,base:10n});
 const seed=new Uint8Array(32).fill(7);
 const input={policy,seed,issuerId:'issuer',stationId:'radio',
   opportunityId:'occurrence1',listenerId:'listener',sequence:0};
 const one=auditedRarityDraw(input),two=auditedRarityDraw(input);
 assert.deepEqual(one,two);
 assert.ok(one.draw>=0n&&one.draw<policy.total);
 assert.equal(one.seedCommitment.length,64);
 assert.notEqual(auditedRarityDraw({...input,listenerId:'other'}).draw,one.draw);
 assert.notEqual(auditedRarityDraw({...input,opportunityId:'other'}).draw,one.draw);
 assert.equal('seed' in one,false);
});
test('trusted seed, valid policy totals and scoped identity are mandatory',()=>{
 const policy=rarityWeights({tiers:3});
 const input={policy,seed:new Uint8Array(32).fill(1),issuerId:'issuer',
   stationId:'radio',opportunityId:'occ',listenerId:'fan'};
 assert.throws(()=>auditedRarityDraw({...input,seed:new Uint8Array(4)}),/seed/);
 assert.throws(()=>auditedRarityDraw({...input,listenerId:''}),/seed/);
 assert.throws(()=>auditedRarityDraw({...input,policy:{...policy,total:1n}}),/weights/);
});

test('auditable draw does not expose raw listener IDs or protected issuer seeds',()=>{
 const seed=new Uint8Array(32).fill(3),policy=rarityWeights({tiers:4});
 const evidence=auditedRarityDraw({policy,seed,issuerId:'issuer',stationId:'radio',
   opportunityId:'occ',listenerId:'private-listener'});
 assert.equal(evidence.listenerId,undefined);
 assert.equal(evidence.seed,undefined);
 assert.equal(evidence.contextCommitment.length,64);
 assert.equal(evidence.weightsCommitment.length,64);
});
