import {createHash} from 'node:crypto';
import {id} from './contracts.mjs';
import {eligibleRarityWeights,auditedRarityDraw} from './rarity-policy.mjs';
import {requirePublishingRights} from './rights.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const authenticated=(fn,...args)=>{
 try{const result=fn(...args);if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});else return result===true;}catch{}
 return false;
};
const authorization=value=>{if(typeof value!=='string'||!value.length||value.length>8192)throw new TypeError('Bounded endpoint authorization required');return value;};
const integer=(n,min=0)=>{if(!Number.isSafeInteger(n)||n<min)throw new RangeError('Invalid shared occurrence integer');return n;};
/** Stable scope-bound broadcast occurrence identity, never proof of playback. */
export function radioOccurrenceId(value){
 return hash(['DRE-occurrence-v1',...['tenantId','applicationId','stationId','programDigest'].map(k=>id(value[k],k)),
  integer(value.programVersion,1),integer(value.cycle),integer(value.completedOccurrenceId,1)]);
}
function opportunity(value,scope){
 if(!value||value.eligible!==true||value.stationId!==scope.stationId||value.afterOutro!==true||value.beforeNextIntro!==true)
  throw new RangeError('Verified shared station opportunity required');
 return Object.freeze({eligible:true,opportunityId:id(value.opportunityId,'opportunityId'),stationId:scope.stationId,
  programDigest:id(value.programDigest,'programDigest'),programVersion:integer(value.programVersion,1),cycle:integer(value.cycle),
  completedOccurrenceId:integer(value.completedOccurrenceId,1),atMs:integer(value.atMs),afterOutro:true,beforeNextIntro:true});
}

/** Listener-scoped authorized endpoint. No radio mutation, speaker credit or media keys. */
export class GrooveGrantIssuer{
 #scope;#registry;#history;#verifyOpportunity;#verifyPolicy;#access;#rights;#territory;#now;#ttl;#seed;#issuer;#policy;#deliver;
 constructor({scope,registry,history,policy,seed,issuerId,verifyOpportunity,verifyPolicy,authorizeAccess,
  resolveRights,deliverToEndpoint,territory,now=Date.now,opportunityTtlMs=60000}={}){
  this.#scope=Object.freeze(Object.fromEntries(['tenantId','applicationId','stationId','listenerId'].map(k=>[k,id(scope?.[k],k)])));
  if(!['readGrooveOpportunity','claimGrooveOpportunity','getGroove','readGrooveGrant'].every(k=>typeof registry?.[k]==='function')||
   typeof history?.matchesScope!=='function'||!history.matchesScope(this.#scope)||
   !['readCompletion','lifetimeCount'].every(k=>typeof history[k]==='function')||
   ![verifyOpportunity,verifyPolicy,authorizeAccess,resolveRights,deliverToEndpoint,now].every(fn=>typeof fn==='function')||
   !/^[A-Z]{2}$/.test(territory)||!(seed instanceof Uint8Array)||seed.length<32||seed.length>128||
   !Number.isSafeInteger(opportunityTtlMs)||opportunityTtlMs<1||opportunityTtlMs>300000)
   throw new TypeError('Scoped durable history, grant store, protected issuer seed and endpoint verifiers required');
  if(!policy||!Number.isSafeInteger(policy.version)||policy.version<1||!Array.isArray(policy.grooveIds)||
   policy.grooveIds.length<1||policy.grooveIds.length>128||new Set(policy.grooveIds).size!==policy.grooveIds.length||
   !Array.isArray(policy.minimumCompletions)||policy.minimumCompletions.length!==policy.grooveIds.length)
   throw new TypeError('Approved versioned Groove tier policy required');
  const base=policy.base??2n;
  // Validate all ordered thresholds and arithmetic before retaining the policy.
  eligibleRarityWeights({minimumCompletions:policy.minimumCompletions,completed:Number.MAX_SAFE_INTEGER,base});
  this.#policy=Object.freeze({version:policy.version,creatorId:id(policy.creatorId,'creatorId'),
   grooveIds:Object.freeze(policy.grooveIds.map(x=>id(x,'grooveId'))),
   minimumCompletions:Object.freeze([...policy.minimumCompletions]),base});
  this.#registry=registry;this.#history=history;this.#verifyOpportunity=verifyOpportunity;this.#verifyPolicy=verifyPolicy;
  this.#access=authorizeAccess;this.#rights=resolveRights;this.#territory=territory;this.#now=now;this.#ttl=opportunityTtlMs;
  this.#deliver=deliverToEndpoint;this.#seed=new Uint8Array(seed);this.#issuer=id(issuerId,'issuerId');
  if(!authenticated(verifyPolicy,this.#policy,this.#scope))throw new RangeError('Groove policy authorization denied');
 }
 #time(){return integer(this.#now());}
 #allow(action,proof,details){
  authorization(proof);
  if(!authenticated(this.#access,Object.freeze({action,...details}),this.#scope,proof))throw new RangeError('Groove access denied');
 }
 #right(record){
  try{
   const rights=this.#rights(Object.freeze({...this.#scope,creatorId:record.creatorId,recordingId:record.recordingId}));
   if(rights&&typeof rights.then==='function'){Promise.resolve(rights).catch(()=>{});return false;}
   return requirePublishingRights(rights,{tenantId:this.#scope.tenantId,assetRef:record.recordingId,use:'reward',territory:this.#territory,at:this.#time()})===true;
  }catch{return false;}
 }
 receipt({opportunityId,proof}={}){
  id(opportunityId,'opportunityId');this.#allow('read-opportunity',proof,{opportunityId});
  return this.#registry.readGrooveOpportunity({...this.#scope,opportunityId})?.result??null;
 }
 claim({opportunity:raw,proof}={}){
  const shared=opportunity(raw,this.#scope);this.#allow('claim-opportunity',proof,{opportunityId:shared.opportunityId});
  if(!authenticated(this.#verifyOpportunity,shared,this.#scope,proof)||!authenticated(this.#verifyPolicy,this.#policy,this.#scope))
   throw new RangeError('Shared opportunity or policy authorization denied');
  const binding='sha256:'+hash(['DRE-Groove-binding-v1',this.#scope,this.#issuer,shared,
   {...this.#policy,base:this.#policy.base.toString()}]);
  const old=this.#registry.readGrooveOpportunity({...this.#scope,opportunityId:shared.opportunityId});
  if(old){if(old.binding!==binding)throw new RangeError('Conflicting opportunity replay');return old.result;}
  const nowMs=this.#time();if(shared.atMs>nowMs||nowMs-shared.atMs>this.#ttl)throw new RangeError('Opportunity is future or stale');
  const occurrenceId=radioOccurrenceId({...this.#scope,...shared});
  const completion=this.#history.readCompletion({creatorId:this.#policy.creatorId,occurrenceId,proof});
  if(!completion||completion.stationId!==shared.stationId||completion.programDigest!==shared.programDigest||
   completion.completedAtMs>nowMs||completion.requiredEndMs>shared.atMs)
   throw new RangeError('Matching full-outro listener completion required');
  const completed=this.#history.lifetimeCount({creatorId:this.#policy.creatorId,proof});
  const weights=eligibleRarityWeights({...this.#policy,completed});
  const draw=auditedRarityDraw({policy:weights,seed:this.#seed,issuerId:this.#issuer,stationId:this.#scope.stationId,
   opportunityId:shared.opportunityId,listenerId:this.#scope.listenerId,sequence:0});
  const grooveId=this.#policy.grooveIds[draw.tier];
  const grantId=hash(['DRE-Groove-grant-v1',this.#scope,shared.opportunityId,grooveId]);
  return this.#registry.claimGrooveOpportunity({...this.#scope,opportunityId:shared.opportunityId,binding,grooveId,grantId,
   creatorId:this.#policy.creatorId,audit:{tier:draw.tier,seedCommitment:draw.seedCommitment,
    weightsCommitment:draw.weightsCommitment,contextCommitment:draw.contextCommitment,policyVersion:this.#policy.version,atMs:shared.atMs}},
   record=>this.#right(record)&&authenticated(this.#verifyPolicy,this.#policy,this.#scope)&&
    this.#time()>=shared.atMs&&this.#time()-shared.atMs<=this.#ttl);
 }
 /** Delivery runs only at the already authorized endpoint. Return no keys/URLs. */
 async deliver({grantId,deviceId,proof}={}){
  id(grantId,'grantId');id(deviceId,'deviceId');this.#allow('deliver-groove',proof,{grantId,deviceId});
  const grant=this.#registry.readGrooveGrant({...this.#scope,grantId});
  if(!grant||!this.#right(grant))throw new RangeError('Current entitled recording rights required');
  const delivered=await this.#deliver(Object.freeze({...grant,deviceId}),proof);
  if(delivered!==true)throw new RangeError('Endpoint delivery not acknowledged');
  return Object.freeze({grantId,deviceId,delivered:true});
 }
}
