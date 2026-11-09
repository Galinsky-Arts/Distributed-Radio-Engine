import {id} from './contracts.mjs';
/** Authorized endpoint projection. Missing evidence is unavailable, never a measured zero. */
export function creatorReport({tenantId,applicationId,creatorId,events,verifyEvent,nowMs=Date.now(),maxEvents=10000}={}){
 for(const [key,value] of Object.entries({tenantId,applicationId,creatorId}))id(value,key);
 if(!Array.isArray(events)||typeof verifyEvent!=='function'||!Number.isSafeInteger(nowMs)||nowMs<0||
  !Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>10000||events.length>maxEvents)throw new TypeError('Bounded scoped report and source verifier required');
 const scope=Object.freeze({tenantId,applicationId,creatorId}),seen=new Set(),sources=new Set();
 const totals={speakerMicroPoints:null,grooveGrants:null,campaignDeliveries:null,paidMinorByCurrency:{}};
 const coverage={speaker:false,groove_grant:false,campaign:false,commerce:false};let observedAtMs=null;
 const quantity=value=>{if(typeof value!=='bigint'||value.toString().replace('-','').length>1000)throw new RangeError('Invalid exact report quantity');return value;};
 for(const raw of events){
  if(!raw||Object.entries(scope).some(([k,v])=>raw[k]!==v))throw new RangeError('Report source scope mismatch');
  const event={...scope,eventId:id(raw.eventId,'source event'),source:id(raw.source,'source'),kind:raw.kind,status:raw.status,observedAtMs:raw.observedAtMs};
  if(!Number.isSafeInteger(event.observedAtMs)||event.observedAtMs<0||event.observedAtMs>nowMs||
   typeof raw.proof!=='string'||!raw.proof.length||raw.proof.length>8192)throw new RangeError('Bounded current source evidence required');
  event.proof=raw.proof;
  if(event.kind==='speaker'){
   if(raw.status!=='verified'||quantity(raw.microPoints)<0n)throw new RangeError('Verified output contribution required');
   event.microPoints=raw.microPoints;
  }else if(event.kind==='groove_grant'){
   if(raw.status!=='settled')throw new RangeError('Settled Groove source required');
  }else if(event.kind==='commerce'){
   if(raw.status!=='settled'||typeof raw.currency!=='string'||!/^[A-Z]{3}$/.test(raw.currency))throw new RangeError('Settled currency source required');
   event.amountMinor=quantity(raw.amountMinor);event.currency=raw.currency;
  }else if(event.kind==='campaign'){
   if(raw.status!=='verified'||quantity(raw.deliveries)<0n)throw new RangeError('Verified campaign delivery source required');event.deliveries=raw.deliveries;
  }else throw new TypeError('Unsupported source event');
  let verified=false;try{const result=verifyEvent(Object.freeze(event),scope);
   if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});else verified=result===true;
  }catch{}
  if(!verified)throw new RangeError('Report source authentication failed');
  const key=JSON.stringify([event.source,event.eventId]);if(seen.has(key))throw new RangeError('Duplicate source event in report');
  seen.add(key);sources.add(event.source);coverage[event.kind]=true;observedAtMs=Math.max(observedAtMs??0,event.observedAtMs);
  if(event.kind==='speaker')totals.speakerMicroPoints=(totals.speakerMicroPoints??0n)+event.microPoints;
  else if(event.kind==='groove_grant')totals.grooveGrants=(totals.grooveGrants??0n)+1n;
  else if(event.kind==='campaign')totals.campaignDeliveries=(totals.campaignDeliveries??0n)+event.deliveries;
  else totals.paidMinorByCurrency[event.currency]=(totals.paidMinorByCurrency[event.currency]??0n)+event.amountMinor;
 }
 return Object.freeze({...scope,...totals,paidMinorByCurrency:Object.freeze(totals.paidMinorByCurrency),
  coverage:Object.freeze(coverage),sources:Object.freeze([...sources].sort()),verifiedEventCount:seen.size,observedAtMs});
}
