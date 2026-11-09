import {id} from './contracts.mjs';
import {pointWalletKey} from './point-ledger.mjs';
import {requirePublishingRights} from './rights.mjs';
const scopeFields=['tenantId','applicationId','principalId'];
const exactTrue=(fn,...args)=>{
  try { const result=fn(...args);if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});
    else return result===true;
  }catch{}return false;
};
const proof=value=>{if(typeof value!=='string'||value.length<1||value.length>8192)throw new TypeError('Bounded authorization proof required');return value;};
const clock=now=>{const value=now();if(!Number.isSafeInteger(value)||value<0)throw new RangeError('Invalid reward clock');return value;};
const key=(scope,creatorId)=>JSON.stringify([scope.tenantId,scope.applicationId,creatorId]);

/** Authorized endpoint facade. No raw media, payment, key or network authority. */
export class PointRewards {
  #scope;#store;#creator;#redeem;#price;#registry;#rights;#territory;#now;
  constructor({scope,store,authorizeCreator,authorizeRedemption,verifyPriceSnapshot,
    recordingRegistry,resolveRights,territory,now=Date.now}={}) {
    if(!scope)throw new TypeError('Reward scope required');
    this.#scope=Object.freeze(Object.fromEntries(scopeFields.map(k=>[k,id(scope[k],k)])));
    if(!['publishPointOffer','pointOffer','redeemPointOffer'].every(k=>typeof store?.[k]==='function')||
      ![authorizeCreator,authorizeRedemption,verifyPriceSnapshot,resolveRights,now].every(fn=>typeof fn==='function')||
      typeof recordingRegistry?.reserve!=='function'||!/^([A-Z]{2})$/.test(territory))
      throw new TypeError('Atomic wallet, authority, channel, rights and price adapters required');
    this.#store=store;this.#creator=authorizeCreator;this.#redeem=authorizeRedemption;this.#price=verifyPriceSnapshot;
    this.#registry=recordingRegistry;this.#rights=resolveRights;this.#territory=territory;this.#now=now;
  }
  #right(offer,nowMs) {
    if(offer.kind!=='recording')return true;
    try {
      const record=this.#rights(Object.freeze({...this.#scope,creatorId:offer.creatorId,recordingId:offer.recordingId}));
      if(record&&typeof record.then==='function'){Promise.resolve(record).catch(()=>{});return false;}
      return requirePublishingRights(record,{tenantId:this.#scope.tenantId,assetRef:offer.recordingId,
        use:'reward',territory:this.#territory,at:nowMs})===true;
    }catch{return false;}
  }
  publish({offerId,expectedVersion,kind,recordingId=null,title,stock,expiresAtMs,priceSnapshot,proof:authorization}={}) {
    id(offerId,'offerId');proof(authorization);
    if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||!Number.isSafeInteger(expectedVersion+1)||
      !['recording','coupon','fan-reward'].includes(kind)||typeof title!=='string'||!title.trim()||title.length>200||
      !Number.isSafeInteger(stock)||stock<0||stock>1000000||!Number.isSafeInteger(expiresAtMs)||expiresAtMs<=clock(this.#now))
      throw new RangeError('Invalid versioned reward offer');
    if(kind==='recording')id(recordingId,'recordingId');else if(recordingId!==null)throw new TypeError('Unexpected recording identity');
    if(!priceSnapshot||priceSnapshot.offerId!==offerId||priceSnapshot.offerVersion!==expectedVersion+1||
      typeof priceSnapshot.points!=='bigint'||priceSnapshot.points<1n||priceSnapshot.points.toString().length>1000||
      priceSnapshot.unit!=='micro-reference-seconds'||priceSnapshot.spendAuthorized!==false)
      throw new TypeError('Immutable approved DRE-17 price snapshot required');
    const creatorId=id(priceSnapshot.creatorId,'creatorId');
    // Authenticate the exact frozen price source before projecting its integer cost.
    const snapshot=Object.freeze({...priceSnapshot});
    if(!exactTrue(this.#price,snapshot,this.#scope))throw new RangeError('Reward price authentication denied');
    const offer=Object.freeze({offerId,version:expectedVersion+1,creatorId,kind,recordingId,title,
      stock,expiresAtMs,points:snapshot.points.toString(),unit:snapshot.unit});
    const authorize=()=>exactTrue(this.#creator,offer,this.#scope,authorization)&&this.#right(offer,clock(this.#now));
    if(!authorize())throw new RangeError('Reward publication denied');
    // Permanent channel reservation can precede publication safely: an interrupted
    // publication leaves only an unused reservation, never a cross-channel reward.
    if(recordingId)this.#registry.reserve({tenantId:this.#scope.tenantId,applicationId:this.#scope.applicationId,
      creatorId,recordingId,entryId:offerId,channel:'points'});
    return this.#store.publishPointOffer(key(this.#scope,creatorId),offer,expectedVersion,authorize);
  }
  redeem({creatorId,offerId,offerVersion,operationId,proof:authorization}={}) {
    for(const [k,v] of Object.entries({creatorId,offerId,operationId}))id(v,k);
    proof(authorization);
    if(!Number.isSafeInteger(offerVersion)||offerVersion<1)throw new RangeError('Offer version required');
    const nowMs=clock(this.#now),request=Object.freeze({creatorId,offerId,offerVersion,operationId});
    return this.#store.redeemPointOffer(pointWalletKey(this.#scope,creatorId),key(this.#scope,creatorId),request,nowMs,
      offer=>offer.creatorId===creatorId&&this.#right(offer,clock(this.#now))&&
        exactTrue(this.#redeem,request,offer,this.#scope,authorization)&&offer.expiresAtMs>clock(this.#now));
  }
}
