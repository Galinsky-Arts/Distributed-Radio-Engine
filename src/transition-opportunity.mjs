import {createHash} from 'node:crypto';
/** Shared server occurrence opportunities, independent of individual listener joins. */
export function transitionOpportunity({stationId,programVersion,completedItems,everyMin,everyMax,sequence}) {
  if(typeof stationId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(stationId))throw new TypeError('Station required');
  if(![programVersion,completedItems,everyMin,everyMax,sequence].every(Number.isSafeInteger)||
     programVersion<1||completedItems<0||everyMin<1||everyMax<everyMin||everyMax>10000||sequence<0)
    throw new RangeError('Invalid transition cadence');
  const range=everyMax-everyMin+1;
  const hash=createHash('sha256').update([stationId,programVersion,sequence].join(':')).digest();
  const cadence=everyMin+(hash.readUInt32BE(0)%range);
  const eligible=completedItems>0 && completedItems%cadence===0;
  const id=createHash('sha256').update([stationId,programVersion,completedItems,'outro-transition'].join(':')).digest('hex');
  return Object.freeze({opportunityId:eligible?id:null,eligible,cadence,afterOutro:true,beforeNextIntro:true});
}

/**
 * Authoritative DRE-06 transition marker projection. The verifier is an
 * externally trusted source of the exact approved program, never a client flag.
 * This only publishes shared timing metadata; no reward is minted here.
 */
export function verifiedStationTransition({program,cycle,completedOccurrenceId,
  stationStartedAtMs,verifyProgram}={}) {
  if(!program||typeof program!=='object'||Array.isArray(program)||
     typeof verifyProgram!=='function')throw new TypeError('Approved station program verifier required');
  const {stationId,digest,version,durationMs,timeline,completions,opportunities}=program;
  const validId=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
  if(!validId(stationId)||!validId(digest)||!Number.isSafeInteger(version)||version<1||
     !Number.isSafeInteger(durationMs)||durationMs<1||
     !Number.isSafeInteger(cycle)||cycle<0||
     !Number.isSafeInteger(completedOccurrenceId)||completedOccurrenceId<1||
     !Number.isSafeInteger(stationStartedAtMs)||stationStartedAtMs<0||
     !Array.isArray(timeline)||!Array.isArray(completions)||!Array.isArray(opportunities)||
     timeline.length>10000||completions.length>10000||opportunities.length>10000)
    throw new RangeError('Invalid station transition schedule');
  const normalized=Object.freeze({stationId,digest,version,durationMs,
    timeline:Object.freeze(timeline.map(row=>Object.freeze({
      role:row?.role,fromMs:row?.fromMs,toMs:row?.toMs}))),
    completions:Object.freeze(completions.map(row=>Object.freeze({
      occurrenceId:row?.occurrenceId,vestNotBeforeMs:row?.vestNotBeforeMs}))),
    opportunities:Object.freeze(opportunities.map(row=>Object.freeze({
      id:row?.id,atMs:row?.atMs,afterOccurrence:row?.afterOccurrence})))});
  // A user-supplied program snapshot never authenticates itself.
  let verified=false;
  try {
    const result=verifyProgram(normalized);
    if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});
    else verified=result===true;
  } catch {}
  if(!verified)throw new RangeError('Approved program authentication failed');
  if(normalized.timeline.some(row=>!['opening','content','closing','sponsor'].includes(row.role)||
       !Number.isSafeInteger(row.fromMs)||!Number.isSafeInteger(row.toMs)||
       row.fromMs<0||row.toMs<=row.fromMs||row.toMs>durationMs))
    throw new RangeError('Invalid approved timeline boundary');
  let cursor=0;
  for(const segment of normalized.timeline) {
    if(segment.fromMs!==cursor)throw new RangeError('Approved timeline has gap or overlap');
    cursor=segment.toMs;
  }
  if(cursor!==durationMs)throw new RangeError('Approved timeline duration mismatch');
  const completion=normalized.completions.filter(row=>row.occurrenceId===completedOccurrenceId);
  if(completion.length!==1||!Number.isSafeInteger(completion[0].vestNotBeforeMs)||
     completion[0].vestNotBeforeMs<0||completion[0].vestNotBeforeMs>durationMs)
    throw new RangeError('Unrecognized completed occurrence');
  if(normalized.timeline.filter(row=>row.role==='closing'&&
       row.toMs===completion[0].vestNotBeforeMs).length!==1)
    throw new RangeError('Completed occurrence lacks matching closing identification');
  const markers=normalized.opportunities.filter(row=>row.afterOccurrence===completedOccurrenceId);
  if(markers.length>1)throw new RangeError('Multiple transition opportunities for one occurrence');
  if(markers.length===0)return Object.freeze({eligible:false,opportunityId:null,atMs:null,
    stationId,programVersion:version,programDigest:digest,cycle,completedOccurrenceId});
  const marker=markers[0];
  if(!validId(marker.id)||!Number.isSafeInteger(marker.atMs)||
     marker.atMs<completion[0].vestNotBeforeMs||marker.atMs>durationMs)
    throw new RangeError('Opportunity must follow the complete closing identification');
  const nextIntro=normalized.timeline.find(row=>row.role==='opening'&&row.fromMs>=completion[0].vestNotBeforeMs);
  if(nextIntro&&marker.atMs>nextIntro.fromMs)
    throw new RangeError('Opportunity must precede next opening identification');
  const atMs=stationStartedAtMs+cycle*durationMs+marker.atMs;
  if(!Number.isSafeInteger(atMs))throw new RangeError('Station epoch overflow');
  const opportunityId=createHash('sha256').update(JSON.stringify([
    stationId,digest,version,cycle,completedOccurrenceId,marker.id,marker.atMs
  ])).digest('hex');
  return Object.freeze({eligible:true,opportunityId,atMs,
    stationId,programVersion:version,programDigest:digest,cycle,
    completedOccurrenceId,afterOutro:true,beforeNextIntro:true});
}
