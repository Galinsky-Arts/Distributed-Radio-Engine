import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {rewardPrice,createRewardPricePolicy,createOfferPriceSnapshot} from '../src/reward-ladder.mjs';
const policy=createRewardPricePolicy({creatorId:'creator',version:1,basePoints:100n});
test('default planned formula starts gently and accelerates with exact ceiling',()=>{
  assert.equal(rewardPrice({policy,level:0}).points,100n);
  assert.equal(rewardPrice({policy,level:1}).points,107n);
  assert.equal(rewardPrice({policy,level:2}).points,115n);
  assert.equal(rewardPrice({policy,level:3}).points,126n);
  assert.equal(rewardPrice({policy,level:3}).spendAuthorized,false);
  assert.equal(rewardPrice({policy,level:3}).unit,'micro-reference-seconds');
});
test('55 independent 1100-digit Decimal reference prices match exact integer bounds',async()=>{
  const {cases}=JSON.parse(await readFile(new URL('./fixtures/reward-price-golden.json',import.meta.url),'utf8'));
  assert.equal(cases.length,55);
  for(const sample of cases) {
    const quote=rewardPrice({policy,level:sample.level});
    assert.equal(quote.kind,'quoted');
    assert.equal(quote.points,BigInt(sample.points),'tier '+sample.level);
  }
});
test('tiers beyond64 are valid and very large tiers retain an exact symbolic formula',()=>{
  assert.equal(rewardPrice({policy,level:65n}).kind,'quoted');
  const quote=rewardPrice({policy,level:10n**100n});
  assert.equal(quote.kind,'symbolic');assert.equal(quote.points,null);
  assert.equal(quote.formula.tier,(10n**100n).toString());
  assert.equal(quote.spendAuthorized,false);
});
test('materialization series and precision bounds never return a guessed price',()=>{
  const limited=rewardPrice({policy,level:100,maxMaterializedDigits:10});
  assert.equal(limited.kind,'symbolic');assert.equal(limited.reason,'materialization-budget');
  const series=rewardPrice({policy,level:10,maxSeriesTerms:1});
  assert.equal(series.kind,'symbolic');assert.equal(series.reason,'series-budget');
  assert.equal(rewardPrice({policy,level:0,maxMaterializedDigits:3}).points,100n);
});
test('zero-acceleration configured override uses exact rational ceiling',()=>{
  const linear=createRewardPricePolicy({creatorId:'creator',version:2,basePoints:1n,
    gentleNumerator:1n,gentleDenominator:3n,accelerationNumerator:0n});
  assert.equal(rewardPrice({policy:linear,level:1}).points,2n);
  assert.equal(rewardPrice({policy:linear,level:3}).points,2n);
});
test('policy and quote inputs cannot silently fall back to old capped multiplier semantics',()=>{
  for(const change of [{level:-1},{level:1.5},{level:Number.MAX_SAFE_INTEGER+1},
    {level:1,maxLevel:64},{level:1,multiplierNumerator:2n},
    {level:1,maxMaterializedDigits:1001},{level:1,maxSeriesTerms:0}])
    assert.throws(()=>rewardPrice({policy,...change}));
  for(const change of [{basePoints:0n},{gentleNumerator:-1n},{accelerationDenominator:0n}])
    assert.throws(()=>createRewardPricePolicy({creatorId:'creator',version:1,basePoints:100n,...change}));
  assert.throws(()=>rewardPrice({policy:{...policy,formulaVersion:'other'},level:1}));
  assert.throws(()=>rewardPrice({policy,basePoints:999n,level:1}),/ambiguous/);
  assert.throws(()=>rewardPrice({basePoints:100n,level:1,acceleration:2n}),/Unsupported/);
  assert.throws(()=>createRewardPricePolicy({creatorId:'creator',version:1,basePoints:100n,gentleGrowth:1n}),/Unsupported/);
});
test('creator-approved offer snapshots retain old price through future policy changes',()=>{
  const snapshot=createOfferPriceSnapshot({offerId:'offer',offerVersion:1,policy,level:2,
    verifyApproval:(record,p)=>record.creatorId==='creator'&&p.version===1});
  const later=createRewardPricePolicy({creatorId:'creator',version:2,basePoints:500n});
  assert.equal(snapshot.points,115n);assert.equal(snapshot.policyVersion,1);
  assert.notEqual(rewardPrice({policy:later,level:2}).points,snapshot.points);
  assert.equal(Object.isFrozen(snapshot),true);
  assert.equal(snapshot.spendAuthorized,false);
});
test('creator overrides are explicit immutable snapshots with exact approval',()=>{
  const snapshot=createOfferPriceSnapshot({offerId:'offer',offerVersion:2,policy,level:1000,
    overridePoints:777n,verifyApproval:(record,p)=>record.points===777n&&record.pricing==='creator-override'&&p.creatorId==='creator'});
  assert.equal(snapshot.points,777n);assert.equal(snapshot.pricing,'creator-override');
  assert.throws(()=>createOfferPriceSnapshot({offerId:'offer',offerVersion:2,policy,level:1,
    overridePoints:777n,verifyApproval:()=>1}),/approval/);
});
test('symbolic quotes cannot become executable offers and async/failed approvals fail closed',async()=>{
  assert.throws(()=>createOfferPriceSnapshot({offerId:'offer',offerVersion:1,policy,level:1000000,
    verifyApproval:()=>true}),/Symbolic/);
  assert.throws(()=>createOfferPriceSnapshot({offerId:'offer',offerVersion:1,policy,level:1,
    verifyApproval:()=>Promise.reject(new Error('secret'))}),/Synchronous/);
  assert.throws(()=>createOfferPriceSnapshot({offerId:'offer',offerVersion:1,policy,level:1,
    verifyApproval:()=>{throw new Error('private-token');}}),/Creator offer approval failed/);
  await new Promise(resolve=>setImmediate(resolve));
});
test('illustrative1000-output all-day reference arithmetic cannot reach high tiers',()=>{
  const referenceUnitsPerDay=1000000n*86400n;
  const illustrative1000Outputs=1000n*referenceUnitsPerDay;
  assert.ok(rewardPrice({policy,level:65}).points>illustrative1000Outputs);
  // This is an arithmetic fixture, never verified physical outputs or safety advice.
});
test('configured rational policies and near-integer boundaries match independent precision1100 fixtures',async()=>{
  const {cases}=JSON.parse(await readFile(new URL('./fixtures/reward-policy-golden.json',import.meta.url),'utf8'));
  assert.equal(cases.length,122);
  for(const sample of cases) {
    const configured=createRewardPricePolicy({creatorId:'creator',version:1,basePoints:BigInt(sample.base),
      gentleNumerator:BigInt(sample.gn),gentleDenominator:BigInt(sample.gd),
      accelerationNumerator:BigInt(sample.an),accelerationDenominator:BigInt(sample.ad)});
    const quote=rewardPrice({policy:configured,level:sample.level});
    assert.equal(quote.kind,'quoted');
    assert.equal(quote.points,BigInt(sample.points));
  }
  assert.equal(cases.at(-2).points,'2');
  assert.equal(cases.at(-1).points,'3');
});

