import {assertObject,id} from './contracts.mjs';

const SCOPE=['tenantId','applicationId','stationId','creatorId','occurrenceId'];
const UNIT='micro-reference-seconds';
const compare=(a,b)=>a<b?-1:a>b?1:0;

/**
 * DRE-13: one bounded, scope-bound adjudication over independently authenticated
 * physical-output windows. A status string or declared speaker count is never
 * evidence. Verification/calibration stay at the explicit trusted DAE endpoint.
 * This function is pure; cross-call durable replay/vesting belongs to DRE-15/16.
 */
export function aggregateSpeakerEvidence(entries, options) {
  if(!Array.isArray(entries))throw new TypeError('Evidence array required');
  assertObject(options,'adjudication options');
  const {scope,fromMs,toMs,policyVersion,verifyEvidence,maxEntries=10000}=options;
  assertObject(scope,'adjudication scope');
  const checkedScope=Object.freeze(Object.fromEntries(SCOPE.map(key=>[key,id(scope[key],key)])));
  if(!Number.isSafeInteger(fromMs)||fromMs<0||!Number.isSafeInteger(toMs)||toMs<=fromMs||
      toMs-fromMs>60000||!Number.isSafeInteger(policyVersion)||policyVersion<1)
    throw new RangeError('Invalid adjudication window or policy');
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>10000||entries.length>maxEntries)
    throw new RangeError('Evidence census exceeds bounded adjudication');
  if(typeof verifyEvidence!=='function')throw new TypeError('Authenticated physical evidence verifier required');
  const context=Object.freeze({scope:checkedScope,fromMs,toMs,policyVersion,unit:UNIT});
  const accepted=[],excluded={invalid:0,scope:0,route:0,aggregate:0,authentication:0};
  for(const entry of entries) {
    let normalized;
    try {
      assertObject(entry,'physical evidence');
      if(entry.outputKind!=='physical') {excluded.aggregate++;continue;}
      if(entry.route!=='speaker'||entry.status!=='verified') {excluded.route++;continue;}
      const fields=[...SCOPE,'physicalOutputId','issuerId','windowId'];
      normalized=Object.fromEntries(fields.map(key=>[key,id(entry[key],key)]));
      if(SCOPE.some(key=>normalized[key]!==checkedScope[key])) {excluded.scope++;continue;}
      if(!Number.isSafeInteger(entry.fromMs)||!Number.isSafeInteger(entry.toMs)||
          entry.fromMs<fromMs||entry.toMs>toMs||entry.toMs<=entry.fromMs||
          entry.policyVersion!==policyVersion||entry.unit!==UNIT||
          typeof entry.microPoints!=='bigint'||entry.microPoints<0n||entry.microPoints>10n**30n||
          typeof entry.proof!=='string'||!entry.proof.length||entry.proof.length>8192) {
        excluded.invalid++;continue;
      }
      Object.assign(normalized,{fromMs:entry.fromMs,toMs:entry.toMs,policyVersion,unit:UNIT,
        microPoints:entry.microPoints,route:'speaker',status:'verified',outputKind:'physical',proof:entry.proof});
      Object.freeze(normalized);
    } catch {excluded.invalid++;continue;}
    let authenticated=false;
    try {
      const result=verifyEvidence(normalized,context);
      if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});
      else authenticated=result===true;
    } catch {/* Verifier errors may contain private provider data; do not expose them. */}
    if(!authenticated) {excluded.authentication++;continue;}
    accepted.push(normalized);
  }

  const windowsByOutput=new Map(),issuedIds=new Map();
  let microPoints=0n,acceptedWindows=0,duplicateWindows=0;
  // Sorting makes interval conflicts and output totals independent of input order.
  accepted.sort((a,b)=>compare(a.physicalOutputId,b.physicalOutputId)||
    a.fromMs-b.fromMs||a.toMs-b.toMs||compare(a.issuerId,b.issuerId)||compare(a.windowId,b.windowId));
  for(const entry of accepted) {
    const issuedKey=entry.issuerId+'\u0000'+entry.windowId;
    const identity=[entry.physicalOutputId,entry.fromMs,entry.toMs,entry.microPoints.toString()].join('\u0000');
    if(issuedIds.has(issuedKey)&&issuedIds.get(issuedKey)!==identity)
      throw new RangeError('Conflicting authenticated issuer window identity');
    issuedIds.set(issuedKey,identity);
    const previous=windowsByOutput.get(entry.physicalOutputId);
    if(previous&&entry.fromMs===previous.fromMs&&entry.toMs===previous.toMs) {
      if(entry.microPoints!==previous.microPoints)
        throw new RangeError('Conflicting authenticated evidence for one physical output');
      duplicateWindows++;continue;
    }
    if(previous&&entry.fromMs<previous.toMs)
      throw new RangeError('Overlapping authenticated physical-output windows');
    windowsByOutput.set(entry.physicalOutputId,entry);
    microPoints+=entry.microPoints;
    acceptedWindows++;
  }
  return Object.freeze({microPoints,verifiedOutputs:windowsByOutput.size,acceptedWindows,duplicateWindows,
    excluded:Object.freeze(excluded),scope:checkedScope,fromMs,toMs,policyVersion,unit:UNIT,
    provisional:true,spendable:false});
}

