import {assertObject,id} from './contracts.mjs';

// floor(10^(1/10000) * 10^30), derived at 100-digit Decimal precision.
// Fractional factors round down; exact decimal decades are handled separately.
const SCALE=10n**30n;
const STEP=1000230285020824752683594255671n;
const UNIT='micro-reference-seconds';

/** DRE-12 arithmetic configuration, never a loudness/safety recommendation. */
export function createContributionPolicy(input) {
  assertObject(input,'contribution policy');
  const {version,thresholdDb,referenceDb,ceilingDb,maxWindowMs,
    geometryId=null,maxEvidenceAgeMs=60000}=input;
  if (!Number.isSafeInteger(version)||version<1) throw new RangeError('Version required');
  if (![thresholdDb,referenceDb,ceilingDb].every(Number.isFinite) || thresholdDb < 0 ||
      thresholdDb > referenceDb || referenceDb > ceilingDb || ceilingDb > 120)
    throw new RangeError('Unsafe threshold/reference/ceiling ordering');
  if (!Number.isSafeInteger(maxWindowMs)||maxWindowMs<1||maxWindowMs>60000 ||
      !Number.isSafeInteger(maxEvidenceAgeMs)||maxEvidenceAgeMs<1||maxEvidenceAgeMs>60000)
    throw new RangeError('Invalid evidence window');
  if(geometryId!==null)id(geometryId,'reference measurement geometry');
  return Object.freeze({version,thresholdDb,referenceDb,ceilingDb,maxWindowMs,
    geometryId,maxEvidenceAgeMs,weighting:'A',resolution:'millidecibel-floor',
    rounding:'lower-bound-integer-v1',unit:UNIT});
}

function checkedPolicy(value) {
  if(!value||value.unit!==UNIT)throw new TypeError('Policy required');
  const checked=createContributionPolicy(value);
  for(const field of ['weighting','resolution','rounding'])
    if(value[field]!==checked[field])throw new TypeError('Unsupported contribution policy');
  return checked;
}

function factor(exponent) {
  let result=SCALE,base=STEP;
  while(exponent>0) {
    if(exponent%2===1)result=result*base/SCALE;
    exponent=Math.floor(exponent/2);
    if(exponent>0)base=base*base/SCALE;
  }
  return result;
}

function energyUnits(policy,windowMs,conservativeDb) {
  const delta=Math.floor(conservativeDb*1000)-Math.ceil(policy.referenceDb*1000);
  const decades=Math.floor(delta/10000),remainder=delta-decades*10000;
  let numerator=factor(remainder)*BigInt(windowMs)*1000n,denominator=SCALE;
  if(decades>=0)numerator*=10n**BigInt(decades);
  else denominator*=10n**BigInt(-decades);
  return numerator/denominator;
}

/** Pure potential arithmetic, NOT an authenticated grant. */
export function measureContribution({policy,windowMs,conservativeDb,route,evidence}) {
  policy=checkedPolicy(policy);
  if (!Number.isSafeInteger(windowMs)||windowMs<=0||windowMs>policy.maxWindowMs)
    throw new RangeError('Invalid duration');
  if (route!=='speaker'||evidence!=='verified'||!Number.isFinite(conservativeDb)||
      conservativeDb<=policy.thresholdDb||conservativeDb>policy.ceilingDb)
    return Object.freeze({points:0n,eligible:false,policyVersion:policy.version});
  return Object.freeze({points:energyUnits(policy,windowMs,conservativeDb),
    eligible:true,policyVersion:policy.version});
}

/**
 * Scope-bound calibrated measurement boundary. The callback is an explicit
 * trusted DAE verifier, not a client boolean or a new signature protocol.
 * It verifies the exact frozen claims AND full policy. Output stays provisional.
 */
export function measureVerifiedContribution({policy,claims,scope,nowMs,verifyEvidence}) {
  policy=checkedPolicy(policy);
  assertObject(claims,'measurement claims');assertObject(scope,'measurement scope');
  if(typeof verifyEvidence!=='function')throw new TypeError('Authenticated evidence verifier required');
  if(!Number.isSafeInteger(nowMs)||nowMs<0)throw new RangeError('Invalid verification clock');
  const names=['tenantId','applicationId','stationId','creatorId','occurrenceId'];
  const checked={};
  for(const name of [...names,'windowId','physicalOutputId','issuerId','calibrationId'])
    checked[name]=id(claims[name],name);
  for(const name of names)
    if(id(scope[name],name)!==checked[name])throw new RangeError('Evidence scope mismatch');
  if(!policy.geometryId)throw new RangeError('Calibrated reference geometry required');
  checked.geometryId=id(claims.geometryId,'measurement geometry');
  if(checked.geometryId!==policy.geometryId||claims.weighting!==policy.weighting)
    throw new RangeError('Measurement geometry or weighting mismatch');
  for(const key of ['fromMs','toMs','calibratedAtMs','calibrationExpiresAtMs']) {
    if(!Number.isSafeInteger(claims[key])||claims[key]<0)throw new RangeError('Invalid measurement timing');
    checked[key]=claims[key];
  }
  const duration=checked.toMs-checked.fromMs;
  if(!Number.isSafeInteger(duration)||duration<1||duration>policy.maxWindowMs||checked.toMs>nowMs||
      nowMs-checked.toMs>policy.maxEvidenceAgeMs||checked.calibratedAtMs>checked.fromMs||
      checked.calibrationExpiresAtMs<checked.toMs)
    throw new RangeError('Stale, uncalibrated or invalid evidence window');
  if(claims.policyVersion!==policy.version)throw new RangeError('Measurement policy mismatch');
  if(!Number.isFinite(claims.measuredDb)||!Number.isFinite(claims.uncertaintyDb)||
      claims.measuredDb<0||claims.measuredDb>120||claims.uncertaintyDb<0||claims.uncertaintyDb>120)
    throw new RangeError('Invalid calibrated measurement bounds');
  if(!['speaker','headphones','unavailable'].includes(claims.route)||typeof claims.muted!=='boolean')
    throw new RangeError('Invalid playback measurement route');
  Object.assign(checked,{weighting:claims.weighting,policyVersion:claims.policyVersion,
    measuredDb:claims.measuredDb,uncertaintyDb:claims.uncertaintyDb,route:claims.route,muted:claims.muted});
  if(typeof claims.proof!=='string'||claims.proof.length<1||claims.proof.length>8192)
    throw new RangeError('Bounded evidence proof required');
  checked.proof=claims.proof;
  Object.freeze(checked);
  const authenticated=verifyEvidence(checked,policy);
  if(authenticated && typeof authenticated.then==='function') {
    Promise.resolve(authenticated).catch(()=>{});
    throw new TypeError('Synchronous evidence verification required');
  }
  if(authenticated!==true)throw new RangeError('Evidence authentication failed');
  const low=checked.measuredDb-checked.uncertaintyDb;
  const high=checked.measuredDb+checked.uncertaintyDb;
  let result;
  if(checked.route!=='speaker'||checked.muted||high>policy.ceilingDb)
    result={points:0n,eligible:false,policyVersion:policy.version};
  else result=measureContribution({policy,windowMs:duration,conservativeDb:low,route:'speaker',evidence:'verified'});
  return Object.freeze({...result,...Object.fromEntries(names.map(k=>[k,checked[k]])),
    windowId:checked.windowId,physicalOutputId:checked.physicalOutputId,fromMs:checked.fromMs,toMs:checked.toMs,
    unit:UNIT,provisional:true,spendable:false});
}

