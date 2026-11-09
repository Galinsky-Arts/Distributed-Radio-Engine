/** DRE-22 provisional per-listener full-play completion, no award issuance. */
export class ListenerCompletion {
  #completed=new Map();
  #max;
  constructor({maxCompletions=100000}={}) {
    if(!Number.isSafeInteger(maxCompletions)||maxCompletions<1||maxCompletions>1000000)throw new RangeError('Invalid completion capacity');
    this.#max=maxCompletions;
  }
  complete({listenerId,creatorId,occurrenceId,route,foreground,unmuted,startedAtMs,completedAtMs,requiredStartMs,requiredEndMs}) {
    for(const s of [listenerId,creatorId,occurrenceId])if(typeof s!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(s))throw new TypeError('Stable listener and occurrence IDs required');
    if(!['speaker','headphones'].includes(route))throw new TypeError('Supported output route required');
    if(![startedAtMs,completedAtMs,requiredStartMs,requiredEndMs].every(Number.isSafeInteger)||requiredStartMs<0||requiredEndMs<=requiredStartMs||startedAtMs<0||completedAtMs<startedAtMs)
      throw new RangeError('Invalid completion interval');
    if(foreground!==true||unmuted!==true||startedAtMs>requiredStartMs||completedAtMs<requiredEndMs)
      return Object.freeze({complete:false,grooveEligible:false,speakerPointsEligible:false});
    const key=JSON.stringify([listenerId,creatorId,occurrenceId]);
    const existing=this.#completed.get(key);
    if(existing) return Object.freeze({...existing,replayed:true});
    if(this.#completed.size>=this.#max)throw new RangeError('Completion capacity reached');
    const entry=Object.freeze({complete:true,grooveEligible:true,speakerPointsEligible:false,creatorId,occurrenceId});
    this.#completed.set(key,entry);return entry;
  }
  history(listenerId,creatorId){return Object.freeze([...this.#completed.entries()].filter(([k])=>{const x=JSON.parse(k);return x[0]===listenerId&&x[1]===creatorId}).map(([,v])=>v));}
}
