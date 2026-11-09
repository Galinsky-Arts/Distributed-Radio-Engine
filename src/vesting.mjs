import {assertObject,id} from './contracts.mjs';

const SCOPE=['tenantId','applicationId','principalId'];
const IDS=['stationId','occurrenceId','creatorId','programDigest','contentRef','outroRef'];
const TIMES=['startedAtMs','completedAtMs','requiredStartMs','contentEndMs','outroEndMs'];
const UNIT='micro-reference-seconds';
const RECEIPT_FIELDS=[...SCOPE,...IDS,...TIMES,'policyVersion','unit','decision','points','walletSettlement'];
const sameReceipt=(a,b)=>RECEIPT_FIELDS.every(key=>a[key]===b[key]);

// The occurrence identity is global within tenant/application/listener/creator,
// not station-local. A re-presented occurrence cannot vest twice across stations.
export function vestingKey(record) {
  return JSON.stringify([...SCOPE,'creatorId','occurrenceId'].map(key=>id(record[key],key)));
}

export class VestingGate {
  #scope; #verify; #store; #now; #maxAge;
  constructor({scope,verifyCompletion,store,now=Date.now,maxDecisionAgeMs=86400000}={}) {
    assertObject(scope,'vesting scope');
    this.#scope=Object.freeze(Object.fromEntries(SCOPE.map(key=>[key,id(scope[key],key)])));
    if(typeof verifyCompletion!=='function'||typeof store?.claim!=='function'||typeof store?.get!=='function')
      throw new TypeError('Authenticated completion verifier and atomic receipt store required');
    if(typeof now!=='function'||!Number.isSafeInteger(maxDecisionAgeMs)||maxDecisionAgeMs<1||maxDecisionAgeMs>86400000)
      throw new RangeError('Invalid completion clock/age bound');
    this.#verify=verifyCompletion;this.#store=store;this.#now=now;this.#maxAge=maxDecisionAgeMs;
  }
  vest(input) {
    assertObject(input,'completion evidence');
    const event={};
    for(const key of [...SCOPE,...IDS])event[key]=id(input[key],key);
    if(SCOPE.some(key=>event[key]!==this.#scope[key]))throw new RangeError('Vesting scope mismatch');
    for(const key of TIMES) {
      if(!Number.isSafeInteger(input[key])||input[key]<0)throw new RangeError('Invalid occurrence interval');
      event[key]=input[key];
    }
    if(event.requiredStartMs>=event.contentEndMs||event.contentEndMs>=event.outroEndMs||
        event.startedAtMs>event.completedAtMs||event.outroEndMs-event.requiredStartMs>6*60*60*1000)
      throw new RangeError('Invalid occurrence interval');
    if(typeof input.points!=='bigint'||input.points<0n||input.points>10n**36n||
        input.unit!==UNIT||!Number.isSafeInteger(input.policyVersion)||input.policyVersion<1||
        typeof input.playbackContinuous!=='boolean'||typeof input.interruptions!=='boolean'||
        typeof input.proof!=='string'||!input.proof.length||input.proof.length>8192)
      throw new RangeError('Invalid authenticated completion units/proof');
    Object.assign(event,{points:input.points,unit:UNIT,policyVersion:input.policyVersion,
      playbackContinuous:input.playbackContinuous,interruptions:input.interruptions,proof:input.proof});
    Object.freeze(event);
    let authenticated=false;
    try {
      const result=this.#verify(event,this.#scope);
      if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});
      else authenticated=result===true;
    } catch {/* Never expose private verifier exception messages. */}
    if(!authenticated)return Object.freeze({accepted:false,reason:'unauthenticated',record:null});
    const key=vestingKey(event);
    const existing=this.#store.get(key);
    if(existing?.decision==='forfeited')
      return Object.freeze({accepted:false,reason:'forfeited',record:existing});
    const now=this.#now();
    if(!Number.isSafeInteger(now)||now<0||event.completedAtMs>now)
      throw new RangeError('Invalid authoritative completion clock');
    const interrupted=event.startedAtMs>event.requiredStartMs||event.interruptions||!event.playbackContinuous;
    const decision=interrupted?'forfeited':'vested';
    const record=Object.freeze({...Object.fromEntries([...SCOPE,...IDS,...TIMES].map(k=>[k,event[k]])),
      policyVersion:event.policyVersion,unit:UNIT,decision,points:interrupted?0n:event.points,
      walletSettlement:interrupted?'not-applicable':'pending'});
    if(existing) {
      if(!sameReceipt(existing,record))
        throw new RangeError('Conflicting authenticated occurrence replay');
      return Object.freeze({accepted:false,reason:'already-vested',record:existing});
    }
    if(!interrupted&&event.completedAtMs<event.outroEndMs)
      return Object.freeze({accepted:false,reason:'incomplete-cycle',record:null});
    if(now-event.outroEndMs>this.#maxAge)
      return Object.freeze({accepted:false,reason:'stale-completion',record:null});
    const claimed=this.#store.claim(key,record);
    if(!claimed||typeof claimed.inserted!=='boolean'||!claimed.record)
      throw new TypeError('Invalid atomic receipt store result');
    if(!claimed.inserted) {
      if(claimed.record.decision==='forfeited')
        return Object.freeze({accepted:false,reason:'forfeited',record:claimed.record});
      if(!sameReceipt(claimed.record,record))
        throw new RangeError('Conflicting authenticated occurrence replay');
    }
    return Object.freeze({accepted:claimed.inserted&&decision==='vested',
      reason:decision==='forfeited'?'forfeited':claimed.inserted?'vested':'already-vested',record:claimed.record});
  }
  get(creatorId,occurrenceId) {
    return this.#store.get(vestingKey({...this.#scope,creatorId,occurrenceId}));
  }
}

