import {assertObject,id} from './contracts.mjs';

const SCOPE=['tenantId','applicationId','stationId','principalId','playbackSessionId'];
const TIMELINE=['cycleStartedAtMs','contentFromMs','contentToMs','outroToMs','joinedAtMs'];
const UNIT='micro-reference-seconds';

/**
 * DRE-14 bounded ephemeral preview. No persistence, settlement or earn/spend API.
 * Caller flags cannot authorize points; an explicit trusted producer verifies
 * the exact canonical aggregate/window and its playback/occurrence binding.
 */
export class ProvisionalProgress {
  #cycles=new Map();
  #scope;
  #verify;
  #maxCycles;
  #maxWindows;
  #maxTotalWindows;
  #windows=0;
  constructor({scope,verifyWindow,maxCycles=1000,maxWindowsPerCycle=10000,maxTotalWindows=100000}={}) {
    assertObject(scope,'preview scope');
    this.#scope=Object.freeze(Object.fromEntries(SCOPE.map(key=>[key,id(scope[key],key)])));
    if(typeof verifyWindow!=='function')throw new TypeError('Authenticated window verifier required');
    for(const [value,max] of [[maxCycles,10000],[maxWindowsPerCycle,10000],[maxTotalWindows,100000]])
      if(!Number.isSafeInteger(value)||value<1||value>max)throw new RangeError('Invalid preview resource bounds');
    this.#verify=verifyWindow;this.#maxCycles=maxCycles;this.#maxWindows=maxWindowsPerCycle;
    this.#maxTotalWindows=maxTotalWindows;
  }
  addWindow(input) {
    assertObject(input,'preview window');
    const event={};
    for(const key of [...SCOPE,'cycleId','creatorId','occurrenceId','windowId','programDigest'])
      event[key]=id(input[key],key);
    if(SCOPE.some(key=>event[key]!==this.#scope[key]))throw new RangeError('Preview scope mismatch');
    if(typeof input.points!=='bigint'||input.points<0n||input.points>10n**30n)
      throw new RangeError('Points must be bounded nonnegative integer units');
    if(input.unit!==UNIT||!Number.isSafeInteger(input.policyVersion)||input.policyVersion<1)
      throw new RangeError('Unsupported preview unit/policy');
    for(const key of [...TIMELINE,'fromMs','toMs']) {
      if(!Number.isSafeInteger(input[key])||input[key]<0)throw new RangeError('Invalid preview timeline');
      event[key]=input[key];
    }
    if(event.cycleStartedAtMs>event.contentFromMs||event.contentFromMs>=event.contentToMs||
        event.contentToMs>=event.outroToMs||event.outroToMs-event.cycleStartedAtMs>6*60*60*1000||
        event.fromMs<event.contentFromMs||event.toMs>event.contentToMs||event.toMs<=event.fromMs||
        event.toMs-event.fromMs>60000)
      throw new RangeError('Preview window is outside content or has invalid duration');
    if(typeof input.proof!=='string'||!input.proof.length||input.proof.length>8192)
      throw new RangeError('Bounded producer proof required');
    Object.assign(event,{points:input.points,unit:UNIT,policyVersion:input.policyVersion,proof:input.proof});
    Object.freeze(event);
    const current=this.#cycles.get(event.cycleId);
    // Terminal cycles cannot be resurrected, even by authenticated replay.
    if(current?.state==='forfeited')return this.preview(event.cycleId);
    let verified=false;
    try {
      const result=this.#verify(event,this.#scope);
      if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});
      else verified=result===true;
    } catch {/* Private adapter errors are never exposed in public progress. */}
    if(!verified)return this.preview(event.cycleId);
    const timeline=TIMELINE.map(key=>event[key]);
    const binding=JSON.stringify([event.creatorId,event.occurrenceId,event.programDigest,event.policyVersion,...timeline]);
    if(current&&current.binding!==binding)throw new RangeError('Cycle creator occurrence or timeline mismatch');
    if(!current&&this.#cycles.size>=this.#maxCycles)throw new RangeError('Preview cycle capacity reached');
    if(event.joinedAtMs>event.cycleStartedAtMs) {
      this.#cycles.set(event.cycleId,{state:'forfeited',reason:'LATE_JOIN',creatorId:event.creatorId,
        occurrenceId:event.occurrenceId,programDigest:event.programDigest,policyVersion:event.policyVersion,binding,windows:new Map(),total:0n});
      return this.preview(event.cycleId);
    }
    const entry=current??{state:'active',reason:null,creatorId:event.creatorId,
      occurrenceId:event.occurrenceId,programDigest:event.programDigest,policyVersion:event.policyVersion,binding,windows:new Map(),total:0n};
    const signature=JSON.stringify([event.fromMs,event.toMs,event.points.toString()]);
    const prior=entry.windows.get(event.windowId);
    if(prior) {
      if(prior.signature!==signature)throw new RangeError('Conflicting replay for authenticated window');
      return this.preview(event.cycleId);
    }
    if(entry.windows.size>=this.#maxWindows||this.#windows>=this.#maxTotalWindows)
      throw new RangeError('Preview window capacity reached');
    for(const window of entry.windows.values())
      if(event.fromMs<window.toMs&&event.toMs>window.fromMs)
        throw new RangeError('Overlapping preview decision windows');
    entry.windows.set(event.windowId,{fromMs:event.fromMs,toMs:event.toMs,signature});
    entry.total+=event.points;
    this.#windows++;
    this.#cycles.set(event.cycleId,entry);
    return this.preview(event.cycleId);
  }
  preview(cycleId) {
    id(cycleId,'cycleId');
    const entry=this.#cycles.get(cycleId);
    return Object.freeze({...this.#scope,cycleId,creatorId:entry?.creatorId??null,
      occurrenceId:entry?.occurrenceId??null,policyVersion:entry?.policyVersion??null,
      programDigest:entry?.programDigest??null,
      state:entry?.state??'empty',reason:entry?.reason??null,
      provisionalPoints:entry?.state==='active'?entry.total:0n,
      acceptedWindows:entry?.windows.size??0,unit:UNIT,spendablePoints:0n,settled:false});
  }
  abandon(cycleId,reason='INTERRUPTED') {
    id(cycleId,'cycleId');
    if(!['INTERRUPTED','STOPPED','PAUSED','SEEKED','MUTED','ROUTE_CHANGED'].includes(reason))
      throw new RangeError('Unknown cycle interruption');
    let entry=this.#cycles.get(cycleId);
    if(!entry) {
      if(this.#cycles.size>=this.#maxCycles)throw new RangeError('Preview cycle capacity reached');
      entry={creatorId:null,occurrenceId:null,policyVersion:null,windows:new Map(),total:0n};
      this.#cycles.set(cycleId,entry);
    }
    if(entry.state!=='forfeited') {
      this.#windows-=entry.windows.size;
      entry.windows.clear();
      entry.total=0n;
      entry.state='forfeited';entry.reason=reason;
    }
    return this.preview(cycleId);
  }
}

