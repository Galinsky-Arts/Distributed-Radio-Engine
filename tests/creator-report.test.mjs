import {test} from 'node:test';import assert from 'node:assert/strict';import {creatorReport} from '../src/creator-report.mjs';
const scope={tenantId:'tenant',applicationId:'app',creatorId:'artist'};
const e=(eventId,kind,rest={})=>({...scope,eventId,kind,source:'radio',observedAtMs:1000,proof:'fixture',...rest});
const report=events=>creatorReport({...scope,events,verifyEvent:()=>true,nowMs:2000});
test('authenticated source and currency separation preserve exact big numbers',()=>{
 const result=report([e('one','speaker',{status:'verified',microPoints:9007199254740993n}),
  e('two','commerce',{status:'settled',currency:'USD',amountMinor:50n}),e('three','commerce',{status:'settled',currency:'EUR',amountMinor:20n})]);
 assert.equal(result.speakerMicroPoints,9007199254740993n);assert.equal(result.paidMinorByCurrency.USD,50n);
 assert.equal(result.paidMinorByCurrency.EUR,20n);assert.equal(result.grooveGrants,null);assert.equal(result.coverage.groove_grant,false);
});
test('source flags alone, cross-tenant data and duplicate events cannot create a report',()=>{
 assert.throws(()=>creatorReport({...scope,events:[],nowMs:2000}),/verifier/);
 assert.throws(()=>report([e('one','speaker',{status:'unverified',microPoints:2n})]));
 assert.throws(()=>report([e('one','groove_grant',{status:'settled',tenantId:'other'})]),/scope/);
 const a=e('one','groove_grant',{status:'settled'});assert.throws(()=>report([a,a]),/Duplicate/);
 assert.throws(()=>creatorReport({...scope,events:[a],verifyEvent:()=>false,nowMs:2000}),/authentication/);
});
test('empty or absent measurements remain unavailable and raw private fields never enter verifier/report',()=>{
 const empty=report([]);assert.equal(empty.speakerMicroPoints,null);assert.equal(empty.grooveGrants,null);
 let called=false;const result=creatorReport({...scope,events:[e('one','campaign',{status:'verified',deliveries:0n,rawAmbientAudio:'private'})],
  verifyEvent:event=>{called=true;assert.equal(event.rawAmbientAudio,undefined);return true;},nowMs:2000});
 assert.equal(called,true);assert.equal(result.campaignDeliveries,0n);assert.equal(result.proof,undefined);assert.equal(result.rawAmbientAudio,undefined);
});
test('future timestamps, malformed amounts and asynchronous verifiers fail closed',async()=>{
 assert.throws(()=>report([e('one','commerce',{status:'settled',amountMinor:1,currency:'USD'})]));
 assert.throws(()=>report([e('one','groove_grant',{status:'settled',observedAtMs:2001})]),/current/);
 assert.throws(()=>creatorReport({...scope,events:[e('one','groove_grant',{status:'settled'})],verifyEvent:()=>Promise.reject(Error('private')),nowMs:2000}),/authentication/);
 await new Promise(resolve=>setImmediate(resolve));
});
