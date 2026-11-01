import {test} from 'node:test';import assert from 'node:assert/strict';
import {transitionOpportunity} from '../src/transition-opportunity.mjs';
const x={stationId:'radio',programVersion:1,completedItems:12,everyMin:3,everyMax:3,sequence:1};
test('same station occurrence yields same opportunity across clients',()=>{
 const a=transitionOpportunity(x),b=transitionOpportunity({...x});
 assert.deepEqual(a,b);assert.equal(a.eligible,true);assert.equal(a.opportunityId.length,64);
});
test('opportunity is absent outside shared outro cadence',()=>{
 const r=transitionOpportunity({...x,completedItems:11});
 assert.equal(r.eligible,false);assert.equal(r.opportunityId,null);
});
test('invalid cadence and counters fail',()=>{
 assert.throws(()=>transitionOpportunity({...x,everyMax:2}));
 assert.throws(()=>transitionOpportunity({...x,completedItems:-1}));
});

import {verifiedStationTransition} from '../src/transition-opportunity.mjs';
const program={
 stationId:'radio',digest:'digest',version:1,durationMs:5000,
 timeline:[{role:'opening',fromMs:0,toMs:500},{role:'content',fromMs:500,toMs:2000},
  {role:'closing',fromMs:2000,toMs:3000},{role:'opening',fromMs:4000,toMs:4500}],
 completions:[{occurrenceId:1,vestNotBeforeMs:3000}],
 opportunities:[{id:'shared-marker',atMs:3000,afterOccurrence:1}]
};
test('authorized compiled marker has identical global time/id across clients and reconnects',()=>{
 const config={program,cycle:5,completedOccurrenceId:1,stationStartedAtMs:100000,verifyProgram:()=>true};
 const a=verifiedStationTransition(config),b=verifiedStationTransition({...config});
 assert.deepEqual(a,b);
 assert.equal(a.atMs,128000);
 assert.equal(a.eligible,true);
 assert.notEqual(verifiedStationTransition({...config,cycle:6}).opportunityId,a.opportunityId);
});
test('unauthenticated or async approved-program claims cannot schedule an opportunity',async()=>{
 const c={program,cycle:0,completedOccurrenceId:1,stationStartedAtMs:1000};
 assert.throws(()=>verifiedStationTransition({...c,verifyProgram:()=>false}),/authentication/);
 assert.throws(()=>verifiedStationTransition({...c,verifyProgram:()=>Promise.reject(Error('private'))}),/authentication/);
 await new Promise(resolve=>setImmediate(resolve));
});
test('missing marker means no shared opportunity; no per-client reroll',()=>{
 const p={...program,opportunities:[]};
 const r=verifiedStationTransition({program:p,cycle:0,completedOccurrenceId:1,stationStartedAtMs:1000,
   verifyProgram:()=>true});
 assert.equal(r.eligible,false);assert.equal(r.opportunityId,null);assert.equal(r.atMs,null);
});
test('marker must be after completed outro and before next intro',()=>{
 const config={program,cycle:0,completedOccurrenceId:1,stationStartedAtMs:1000,verifyProgram:()=>true};
 for(const atMs of [2999,4001])assert.throws(()=>verifiedStationTransition({
   ...config,program:{...program,opportunities:[{id:'marker',atMs,afterOccurrence:1}]} }),/Opportunity/);
 assert.throws(()=>verifiedStationTransition({...config,
   program:{...program,opportunities:[...program.opportunities,...program.opportunities]}}),/Multiple/);
});
