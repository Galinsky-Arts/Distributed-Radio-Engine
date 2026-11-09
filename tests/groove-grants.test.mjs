import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {compileEditorialRevision} from '../src/editorial.mjs';import {compileRadioProgram} from '../src/program.mjs';
import {verifiedStationTransition} from '../src/transition-opportunity.mjs';import {GrooveGrantIssuer,radioOccurrenceId} from '../src/groove-grants.mjs';
import {RecordingChannelRegistry} from '../src/recording-channels.mjs';import {GrooveCatalog} from '../src/groove-catalog.mjs';
import {DurableListenerCompletion} from '../src/listener-history.mjs';
function setup(t){
 const dir=mkdtempSync(join(tmpdir(),'groove-issuer-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'channels.sqlite'),historyPath=join(dir,'history.sqlite');
 const scope={tenantId:'tenant',applicationId:'app',stationId:'station',listenerId:'listener'};
 const revision=compileEditorialRevision({...scope,version:1,program:[{kind:'identification',ref:'intro'},
  {kind:'media',ref:'song'},{kind:'identification',ref:'outro'},{kind:'marker',ref:'shared'}]});
 const program=compileRadioProgram({revision,approval:{digest:revision.digest,stationId:'station',version:1},
  durations:{intro:1000,song:1000,outro:1000},verifyPublishingRight:()=>true});
 const opportunity=verifiedStationTransition({program,cycle:0,completedOccurrenceId:1,stationStartedAtMs:1000,verifyProgram:()=>true});
 const registry=new RecordingChannelRegistry(path);t.after(()=>registry.close());
 const catalog=new GrooveCatalog({registry,scope:{tenantId:'tenant',applicationId:'app',principalId:'artist'},authorizeCatalog:()=>true});
 catalog.put({grooveId:'groove',recordingId:'bonus',creatorId:'artist',exclusive:true});
 registry.configureGrooveStock({tenantId:'tenant',applicationId:'app',grooveId:'groove',creatorId:'artist',capacity:1},()=>true);
 const history=new DurableListenerCompletion(historyPath,{scope,now:()=>4000,verifyCompletion:()=>true,authorizeRead:()=>true});t.after(()=>history.close());
 const completion={...scope,creatorId:'artist',occurrenceId:radioOccurrenceId({...scope,...opportunity}),programDigest:program.digest,
  route:'headphones',foreground:true,unmuted:true,startedAtMs:1000,completedAtMs:4000,requiredStartMs:1000,requiredEndMs:4000,proof:'fixture'};
 const options={scope,registry,history,policy:{version:1,creatorId:'artist',grooveIds:['groove'],minimumCompletions:[1]},
  seed:new Uint8Array(32).fill(7),issuerId:'issuer',verifyOpportunity:o=>o.opportunityId===opportunity.opportunityId,
  verifyPolicy:()=>true,authorizeAccess:(_request,_scope,proof)=>proof==='fixture',territory:'US',now:()=>4000,
  resolveRights:()=>({tenantId:'tenant',assetRef:'bonus',uses:['reward'],territories:['US'],validFrom:'1970-01-01T00:00:00Z',validUntil:'2030-01-01T00:00:00Z'}),
  deliverToEndpoint:async()=>true};
 return {dir,path,historyPath,scope,program,opportunity,registry,catalog,history,completion,options,issuer:new GrooveGrantIssuer(options)};
}
const claim=f=>f.issuer.claim({opportunity:f.opportunity,proof:'fixture'});
test('actual headphone completion yields one durable Groove at the shared transition without speaker points',t=>{
 const f=setup(t);const completed=f.history.complete(f.completion);assert.equal(completed.speakerPointsEarned,0n);
 const result=claim(f);assert.equal(result.state,'granted');assert.equal(result.atMs,4000);
 assert.equal(claim(f).grant.grantId,result.grant.grantId);
 const reopened=new RecordingChannelRegistry(f.path);t.after(()=>reopened.close());
 const recovered=new GrooveGrantIssuer({...f.options,registry:reopened});
 assert.equal(recovered.claim({opportunity:f.opportunity,proof:'fixture'}).grant.grantId,result.grant.grantId);
 assert.equal(recovered.receipt({opportunityId:f.opportunity.opportunityId,proof:'fixture'}).state,'granted');
 assert.doesNotMatch(JSON.stringify(result),/privateKey|plaintext|playbackToken/);
});
test('matching full outro is mandatory; future opportunities and cross-listener history fail closed',t=>{
 const f=setup(t);assert.throws(()=>claim(f),/completion required/);
 assert.throws(()=>new GrooveGrantIssuer({...f.options,scope:{...f.scope,listenerId:'other'}}),/Scoped durable/);
 f.history.complete(f.completion);
 assert.throws(()=>new GrooveGrantIssuer({...f.options,now:()=>3999}).claim({opportunity:f.opportunity,proof:'fixture'}),/future/);
 assert.throws(()=>f.issuer.claim({opportunity:f.opportunity,proof:'forged'}),/access denied/);
});
test('failed opportunity commit rolls back the entitlement and stock, allowing one safe retry',t=>{
 const f=setup(t);f.history.complete(f.completion);const db=new DatabaseSync(f.path);t.after(()=>db.close());
 db.exec("CREATE TRIGGER fail_opportunity BEFORE INSERT ON radio_groove_opportunities BEGIN SELECT RAISE(ABORT,'opportunity failed'); END");
 assert.throws(()=>claim(f),/opportunity failed/);
 assert.equal(f.registry.readGrooveEntitlements({...f.scope}).length,0);
 db.exec('DROP TRIGGER fail_opportunity');assert.equal(claim(f).state,'granted');
});
test('delivery needs current rights and a scoped endpoint acknowledgment, never a raw media URL',async t=>{
 const f=setup(t);f.history.complete(f.completion);const result=claim(f);
 assert.deepEqual(await f.issuer.deliver({grantId:result.grant.grantId,deviceId:'device',proof:'fixture'}),
  {grantId:result.grant.grantId,deviceId:'device',delivered:true});
 const denied=new GrooveGrantIssuer({...f.options,resolveRights:()=>null});
 await assert.rejects(denied.deliver({grantId:result.grant.grantId,deviceId:'device',proof:'fixture'}),/rights required/);
 await assert.rejects(f.issuer.deliver({grantId:result.grant.grantId,deviceId:'device',proof:'other'}),/access denied/);
 const failed=new GrooveGrantIssuer({...f.options,deliverToEndpoint:async()=>false});
 await assert.rejects(failed.deliver({grantId:result.grant.grantId,deviceId:'device',proof:'fixture'}),/not acknowledged/);
});
test('stock-exhaustion outcomes persist across capacity changes instead of rerolling',t=>{
 const f=setup(t);f.history.complete(f.completion);
 f.registry.configureGrooveStock({...f.scope,grooveId:'groove',creatorId:'artist',capacity:0},()=>true);
 assert.equal(claim(f).state,'stock-exhausted');
 f.registry.configureGrooveStock({...f.scope,grooveId:'groove',creatorId:'artist',capacity:1},()=>true);
 assert.equal(claim(f).state,'stock-exhausted');
 assert.equal(f.registry.readGrooveEntitlements({...f.scope}).length,0);
});

import {spawn} from 'node:child_process';
test('four independent listener processes compete for one Groove entitlement without exceeding stock',async t=>{
 const f=setup(t),listeners=['a','b','c','d'];
 for(const listenerId of listeners){
  const scope={...f.scope,listenerId};
  const history=new DurableListenerCompletion(f.historyPath,{scope,verifyCompletion:()=>true,authorizeRead:()=>true,now:()=>4000});
  history.complete({...f.completion,...scope});history.close();
 }
 const run=listenerId=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[new URL('./fixtures/groove-race-worker.mjs',import.meta.url).pathname,f.path,f.historyPath,listenerId,JSON.stringify(f.opportunity)],{stdio:['ignore','pipe','pipe']});
  let output='',error='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{error+=data;});
  child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(output)):reject(Error(error)));
 });
 const results=await Promise.all(listeners.map(run));assert.equal(results.filter(x=>x.state==='granted').length,1);
 assert.equal(results.filter(x=>x.state==='stock-exhausted').length,3);
 assert.equal(listeners.reduce((sum,listenerId)=>sum+f.registry.readGrooveEntitlements({...f.scope,listenerId}).length,0),1);
});
