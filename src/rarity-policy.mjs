import {createHmac,createHash} from 'node:crypto';
/** DRE-21 positive-tail rarity weights, not a live grant or RNG. */
export function rarityWeights({tiers,base=2n,maxTiers=128}) {
  if(!Number.isSafeInteger(tiers)||tiers<1||tiers>maxTiers||!Number.isSafeInteger(maxTiers)||maxTiers<1||maxTiers>128)
    throw new RangeError('Invalid bounded tier count');
  if(typeof base!=='bigint'||base<2n||base>100n)throw new RangeError('Invalid rarity base');
  // Weight_i = base^(tiers-1-i) gives positive integer support to every tier.
  const weights=Array.from({length:tiers},(_,i)=>base**BigInt(tiers-1-i));
  const total=weights.reduce((a,b)=>a+b,0n);
  return Object.freeze({weights:Object.freeze(weights),total,hasPositiveTail:weights.every(w=>w>0n)});
}
export function selectRarityTier({weights,total},draw) {
  if(!Array.isArray(weights)||weights.length===0||typeof total!=='bigint'||total<=0n||typeof draw!=='bigint'||draw<0n||draw>=total)
    throw new RangeError('Invalid auditable draw');
  let cursor=0n;
  for(let i=0;i<weights.length;i++) {
    if(typeof weights[i]!=='bigint'||weights[i]<=0n)throw new RangeError('Nonpositive tier');
    cursor+=weights[i];if(draw<cursor)return i;
  }
  throw new RangeError('Weights and draw total inconsistent');
}

/**
 * Graduated completion eligibility. All unlocked tiers retain their original
 * positive weight; increasing lifetime completions never removes eligibility.
 * Completion counts must be supplied by an authenticated durable listener ledger.
 */
export function eligibleRarityWeights({minimumCompletions,completed,base=2n}) {
  if(!Array.isArray(minimumCompletions)||minimumCompletions.length<1||
     minimumCompletions.length>128||minimumCompletions.some(n=>!Number.isSafeInteger(n)||n<0)||
     !Number.isSafeInteger(completed)||completed<0||
     minimumCompletions.some((n,i)=>i>0&&n<minimumCompletions[i-1]))
    throw new RangeError('Invalid ordered lifetime eligibility policy');
  const original=rarityWeights({tiers:minimumCompletions.length,base});
  const weights=original.weights.map((weight,i)=>completed>=minimumCompletions[i]?weight:0n);
  const total=weights.reduce((sum,w)=>sum+w,0n);
  if(total===0n)throw new RangeError('Listener has no eligible tiers');
  return Object.freeze({weights:Object.freeze(weights),total,unlockedTiers:weights.filter(w=>w>0n).length,
    completionCount:completed,hasPositiveTail:weights[weights.length-1]>0n});
}

/**
 * Domain-bound deterministic issuer draw with unbiased rejection sampling.
 * Do not treat this as authentication of a listener or a durable award.
 * A protected server seed and trusted context are REQUIRED inputs, never a
 * client-supplied preference. Audit via seed commitment after reveal policy.
 */
export function auditedRarityDraw({policy,seed,issuerId,stationId,
  opportunityId,listenerId,sequence=0}) {
  if(!(seed instanceof Uint8Array)||seed.length<32||seed.length>128||
     ![issuerId,stationId,opportunityId,listenerId].every(
       v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v))||
     !Number.isSafeInteger(sequence)||sequence<0)
    throw new RangeError('Trusted issuer seed, identifiers and sequence required');
  if(!policy||!Array.isArray(policy.weights)||typeof policy.total!=='bigint'||
     policy.total<1n||policy.weights.length<1||policy.weights.length>128||
     policy.weights.some(w=>typeof w!=='bigint'||w<0n)||
     policy.weights.reduce((a,b)=>a+b,0n)!==policy.total)
    throw new RangeError('Invalid audited rarity weights');
  const context=JSON.stringify(['DRE-21-v1',issuerId,stationId,opportunityId,listenerId,sequence]);
  const total=policy.total;
  const bytes=Math.max(32,Math.ceil(total.toString(2).length/8));
  if(bytes>512)throw new RangeError('Rarity draw exceeds bounded numeric size');
  const range=1n<<BigInt(bytes*8),limit=range-range%total;
  for(let attempt=0;attempt<64;attempt++) {
    const blocks=[];
    for(let block=0;block<Math.ceil(bytes/32);block++) {
      blocks.push(createHmac('sha256',seed).update(context).update(':')
        .update(String(attempt)).update(':').update(String(block)).digest());
    }
    const raw=Buffer.concat(blocks).subarray(0,bytes);
    const sample=BigInt('0x'+raw.toString('hex'));
    if(sample>=limit)continue;
    const draw=sample%total,tier=selectRarityTier(policy,draw);
    const contextCommitment=createHash('sha256').update(context).digest('hex');
    const weightsCommitment=createHash('sha256')
      .update(JSON.stringify(policy.weights.map(weight=>weight.toString()))).digest('hex');
    return Object.freeze({tier,draw,seedCommitment:createHash('sha256').update(seed).digest('hex'),
      contextCommitment,weightsCommitment,policyTotal:total,
      algorithm:'DRE-21-HMAC-SHA256-rejection-v1'});
  }
  throw new RangeError('Bounded uniform draw unavailable');
}
