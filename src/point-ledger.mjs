import {assertObject,id} from './contracts.mjs';
const SCOPE=['tenantId','applicationId','principalId'];
const UNIT='micro-reference-seconds';
const RECEIPT_FIELDS=[...SCOPE,'creatorId','stationId','occurrenceId','programDigest','contentRef','outroRef',
  'startedAtMs','completedAtMs','requiredStartMs','contentEndMs','outroEndMs','policyVersion','unit','decision','walletSettlement','points'];
export const pointWalletKey=(scope,creatorId)=>JSON.stringify([...SCOPE.map(k=>id(scope[k],k)),id(creatorId,'creatorId')]);
const authenticated=(verifier,...args)=>{
  try {
    const result=verifier(...args);
    if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});
    else return result===true;
  } catch {}
  return false;
};
const amount=value=>{
  if(typeof value!=='bigint'||value<0n||value.toString().length>1000)throw new RangeError('Invalid exact point quantity/resource bound');
  return value;
};
function proof(value) {
  if(typeof value!=='string'||!value.length||value.length>8192)throw new RangeError('Bounded authorization proof required');
  return value;
}

/** Bind a credit to the immutable authoritative DRE-15 receipt store. */
export function createStoredVestingVerifier({receiptStore,authorizeReceiptAccess}) {
  if(typeof receiptStore?.get!=='function'||typeof authorizeReceiptAccess!=='function')
    throw new TypeError('Authoritative receipt store and access authorizer required');
  return (receipt,authorization,scope)=>{
    if(!authenticated(authorizeReceiptAccess,receipt,scope,authorization))return false;
    const key=JSON.stringify([...SCOPE.map(k=>receipt[k]),receipt.creatorId,receipt.occurrenceId]);
    const stored=receiptStore.get(key);
    return !!stored&&RECEIPT_FIELDS.every(key=>stored[key]===receipt[key]);
  };
}

/** Scope-bound wallet facade. The store supplies durable atomic ledger writes. */
export class CreatorPointLedger {
  #scope;#store;#verify;#authorize;#now;
  constructor({scope,store,verifyVestingReceipt,authorizeOperation,now=Date.now}={}) {
    assertObject(scope,'wallet scope');
    this.#scope=Object.freeze(Object.fromEntries(SCOPE.map(k=>[k,id(scope[k],k)])));
    if(typeof store?.apply!=='function'||typeof store?.balance!=='function'||typeof store?.entries!=='function'||
       typeof verifyVestingReceipt!=='function'||typeof authorizeOperation!=='function'||typeof now!=='function')
      throw new TypeError('Atomic wallet store, receipt verifier and operation authorizer required');
    this.#store=store;this.#verify=verifyVestingReceipt;this.#authorize=authorizeOperation;this.#now=now;
  }
  #apply(creatorId,operation) {
    const nowMs=this.#now();
    if(!Number.isSafeInteger(nowMs)||nowMs<0)throw new RangeError('Invalid ledger clock');
    return this.#store.apply(pointWalletKey(this.#scope,creatorId),Object.freeze(operation),nowMs);
  }
  creditVesting({operationId,receipt,proof:authorization}) {
    id(operationId,'operationId');assertObject(receipt,'vesting receipt');proof(authorization);
    const checked={};
    const identifiers=[...SCOPE,'creatorId','stationId','occurrenceId','programDigest','contentRef','outroRef'];
    for(const key of identifiers)checked[key]=id(receipt[key],key);
    if(SCOPE.some(key=>checked[key]!==this.#scope[key]))throw new RangeError('Receipt wallet scope mismatch');
    for(const key of ['startedAtMs','completedAtMs','requiredStartMs','contentEndMs','outroEndMs']) {
      if(!Number.isSafeInteger(receipt[key])||receipt[key]<0)throw new RangeError('Invalid receipt timeline');
      checked[key]=receipt[key];
    }
    if(receipt.unit!==UNIT||receipt.decision!=='vested'||receipt.walletSettlement!=='pending'||
       !Number.isSafeInteger(receipt.policyVersion)||receipt.policyVersion<1||
       checked.startedAtMs>checked.requiredStartMs||checked.completedAtMs<checked.outroEndMs||
       checked.requiredStartMs>=checked.contentEndMs||checked.contentEndMs>=checked.outroEndMs)
      throw new RangeError('Accepted full-outro vesting receipt required');
    Object.assign(checked,{policyVersion:receipt.policyVersion,unit:UNIT,decision:'vested',
      walletSettlement:'pending',points:amount(receipt.points)});
    Object.freeze(checked);
    if(!authenticated(this.#verify,checked,authorization,this.#scope))throw new RangeError('Vesting receipt authentication failed');
    const sourceId=JSON.stringify([...SCOPE.map(k=>checked[k]),checked.creatorId,checked.occurrenceId]);
    const sourceBinding=JSON.stringify({...checked,points:checked.points.toString()});
    return this.#apply(checked.creatorId,{kind:'vest',operationId,amount:checked.points.toString(),
      sourceId,sourceBinding,referenceId:null,metadata:checked.programDigest});
  }
  spend({creatorId,operationId,amount:quantity,offerId,proof:authorization}) {
    for(const [key,value] of Object.entries({creatorId,operationId,offerId}))id(value,key);
    amount(quantity);if(quantity===0n)throw new RangeError('Positive spend amount required');
    proof(authorization);
    const operation=Object.freeze({kind:'spend',operationId,amount:quantity.toString(),
      sourceId:null,sourceBinding:null,referenceId:null,metadata:offerId});
    if(!authenticated(this.#authorize,operation,Object.freeze({...this.#scope,creatorId}),authorization))
      throw new RangeError('Wallet operation authorization failed');
    return this.#apply(creatorId,operation);
  }
  reverse({creatorId,operationId,originalOperationId,reason,proof:authorization}) {
    for(const [key,value] of Object.entries({creatorId,operationId,originalOperationId,reason}))id(value,key);
    proof(authorization);
    const operation=Object.freeze({kind:'reverse',operationId,amount:null,
      sourceId:null,sourceBinding:null,referenceId:originalOperationId,metadata:reason});
    if(!authenticated(this.#authorize,operation,Object.freeze({...this.#scope,creatorId}),authorization))
      throw new RangeError('Wallet reversal authorization failed');
    return this.#apply(creatorId,operation);
  }
  balance(creatorId) {return this.#store.balance(pointWalletKey(this.#scope,creatorId));}
  entries(creatorId,options) {return this.#store.entries(pointWalletKey(this.#scope,creatorId),options);}
  audit(creatorId,options) {
    if(typeof this.#store.audit!=='function')throw new TypeError('Ledger audit adapter required');
    return this.#store.audit(pointWalletKey(this.#scope,creatorId),options);
  }
}

