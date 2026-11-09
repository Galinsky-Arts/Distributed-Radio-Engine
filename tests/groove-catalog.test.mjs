import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,chmodSync,symlinkSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GrooveCatalog,createGrooveRightsAuthorizer} from '../src/groove-catalog.mjs';
import {RecordingChannelRegistry} from '../src/recording-channels.mjs';
const scope={tenantId:'tenant',applicationId:'app',principalId:'publisher'};
const a={grooveId:'bonus',recordingId:'takeA',creatorId:'artist',exclusive:true};
function setup(t,authorizeCatalog=()=>true) {
 const registry=new RecordingChannelRegistry(':memory:',{allowMemory:true});
 t.after(()=>registry.close());
 return {registry,catalog:new GrooveCatalog({registry,scope,authorizeCatalog})};
}
test('Groove identity still rejects nonexclusive wrong-channel and retargeted recordings',t=>{
 const {catalog:c}=setup(t);c.put(a);
 assert.throws(()=>c.put({...a,exclusive:false}));
 assert.throws(()=>c.put({...a,channel:'points'}));
 assert.throws(()=>c.put({...a,grooveId:'other'}),/already/);
 assert.throws(()=>c.put({...a,recordingId:'takeB'}),/reassign/);
});
test('caller flags or missing authorizer cannot publish a Groove identity',t=>{
 const {registry,catalog:c}=setup(t,()=>false);
 assert.throws(()=>c.put(a),/authorization denied/);
 assert.equal(registry.get({tenantId:'tenant',applicationId:'app',recordingId:'takeA'}),null);
 assert.throws(()=>new GrooveCatalog(),/registry/);
});
test('shared points or paid reservations prevent Groove channel collision',t=>{
 for(const channel of ['points','paid']) {
  const {registry,catalog:c}=setup(t);
  registry.reserve({tenantId:'tenant',applicationId:'app',recordingId:'takeA',creatorId:'artist',entryId:'other',channel});
  assert.throws(()=>c.put(a),/already reserved/);
 }
});
test('Groove reservation cannot later become paid points or another creator identity',t=>{
 const {registry,catalog:c}=setup(t);c.put(a);
 for(const change of [{channel:'paid'},{channel:'points'},{creatorId:'other'},{entryId:'other'}])
  assert.throws(()=>registry.reserve({tenantId:'tenant',applicationId:'app',recordingId:'takeA',
   creatorId:'artist',entryId:'bonus',channel:'groove',...change}),/already reserved/);
});
test('withdrawal retains channel reservation and distinct alternate takes use distinct IDs',t=>{
 const {registry,catalog:c}=setup(t);c.put(a);c.remove('bonus');
 assert.equal(registry.get({tenantId:'tenant',applicationId:'app',recordingId:'takeA'}).channel,'groove');
 assert.throws(()=>registry.reserve({tenantId:'tenant',applicationId:'app',recordingId:'takeA',
  creatorId:'artist',entryId:'sale',channel:'paid'}));
 assert.equal(c.put({...a,grooveId:'bonusB',recordingId:'takeB'}).recordingId,'takeB');
});
test('persistent shared channel registry survives restart across catalog instances',t=>{
 const dir=mkdtempSync(join(tmpdir(),'groove-channel-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'channels.sqlite');
 let registry=new RecordingChannelRegistry(path);
 new GrooveCatalog({registry,scope,authorizeCatalog:()=>true}).put(a);registry.close();
 registry=new RecordingChannelRegistry(path);
 assert.throws(()=>registry.reserve({tenantId:'tenant',applicationId:'app',recordingId:'takeA',
  creatorId:'artist',entryId:'sale',channel:'paid'}),/already reserved/);
 registry.close();
});
test('independent connections see one immutable identity and scope separation',t=>{
 const dir=mkdtempSync(join(tmpdir(),'groove-channel-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'channels.sqlite'),one=new RecordingChannelRegistry(path),two=new RecordingChannelRegistry(path);
 const record={tenantId:'tenant',applicationId:'app',recordingId:'takeA',creatorId:'artist',entryId:'bonus',channel:'groove'};
 assert.equal(one.reserve(record).created,true);
 assert.equal(two.reserve(record).created,false);
 assert.throws(()=>two.reserve({...record,channel:'paid'}),/already reserved/);
 assert.equal(two.reserve({...record,applicationId:'other',channel:'paid'}).created,true);
 one.close();two.close();
});
test('entry ID cannot silently become another recording and failed transaction rolls back',t=>{
 const {registry,catalog:c}=setup(t);c.put(a);
 assert.throws(()=>registry.reserve({tenantId:'tenant',applicationId:'app',recordingId:'takeB',
  creatorId:'artist',entryId:'bonus',channel:'groove'}));
 assert.equal(registry.get({tenantId:'tenant',applicationId:'app',recordingId:'takeB'}),null);
 assert.equal(registry.reserve({tenantId:'tenant',applicationId:'app',recordingId:'takeB',
  creatorId:'artist',entryId:'bonusB',channel:'groove'}).created,true);
});
test('unimplemented grant persistence cannot issue or fabricate entitlement reads',t=>{
 const {catalog:c}=setup(t);c.put(a);
 assert.throws(()=>c.grant({listenerId:'listener',grooveId:'bonus',grantId:'grant',proof:'test'}),/issuer required/);
 assert.throws(()=>c.entitlements('listener',{proof:'test'}),/reader required/);
});
test('asynchronous creator authorization cannot bypass the publication gate',async t=>{
 const {catalog:c}=setup(t,()=>Promise.reject(new Error('private')));
 assert.throws(()=>c.put(a),/Synchronous/);
 await new Promise(resolve=>setImmediate(resolve));
});
test('withdrawal requires the same explicit creator authority as publication',t=>{
 const {catalog:c}=setup(t,operation=>operation.action==='publish');c.put(a);
 assert.throws(()=>c.remove('bonus'),/withdrawal authorization/);
 assert.equal(c.put(a).recordingId,'takeA');
});
test('authorization exceptions are sanitized rather than exposing provider credentials',t=>{
 const {catalog:c}=setup(t,()=>{throw new Error('private-credential');});
 assert.throws(()=>c.put(a),error=>error.message==='Creator catalog authorization denied');
});
test('nonprivate files symlink files and unsupported schemas fail closed',t=>{
 const dir=mkdtempSync(join(tmpdir(),'groove-channel-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'channels.sqlite');let registry=new RecordingChannelRegistry(path);registry.close();
 chmodSync(path,0o644);assert.throws(()=>new RecordingChannelRegistry(path),/Private ordinary/);chmodSync(path,0o600);
 const alias=join(dir,'alias.sqlite');symlinkSync(path,alias);
 assert.throws(()=>new RecordingChannelRegistry(alias),/Private ordinary/);
 const db=new DatabaseSync(path);db.exec('UPDATE radio_channel_schema SET version=2');db.close();
 assert.throws(()=>new RecordingChannelRegistry(path),/Unsupported/);
});


test('durable publication revisions survive restart and withdrawals',t=>{
 const dir=mkdtempSync(join(tmpdir(),'groove-durable-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'channels.sqlite');
 let registry=new RecordingChannelRegistry(path);
 let c=new GrooveCatalog({registry,scope,authorizeCatalog:()=>true});
 assert.equal(c.put(a).revision,1);assert.equal(c.put(a).revision,1);
 assert.equal(c.remove('bonus'),true);assert.equal(c.remove('bonus'),false);
 registry.close();
 registry=new RecordingChannelRegistry(path);
 c=new GrooveCatalog({registry,scope,authorizeCatalog:()=>true});
 assert.equal(registry.getGroove({...scope,grooveId:'bonus'}).active,false);
 assert.equal(registry.getGroove({...scope,grooveId:'bonus'}).revision,2);
 assert.equal(c.put(a).revision,3);
 assert.equal(registry.getGroove({...scope,grooveId:'bonus'}).active,true);
 assert.throws(()=>c.put({...a,recordingId:'takeB'}),/reassign/);
 registry.close();
});
test('publication/withdrawal require creator authority and isolate scope',t=>{
 const {registry,catalog:c}=setup(t,operation=>operation.action==='publish');
 assert.equal(c.put(a).active,true);
 assert.throws(()=>c.remove('bonus'),/authorization denied/);
 assert.equal(registry.getGroove({...scope,grooveId:'bonus'}).active,true);
 assert.equal(registry.getGroove({...scope,applicationId:'other',grooveId:'bonus'}),null);
});
test('registry will not publish without the matching reserved recording identity',t=>{
 const {registry}=setup(t);
 const opened=registry.publishGroove({...scope,grooveId:'bonus',recordingId:'takeA',creatorId:'artist'});
 assert.equal(opened.active,true);
 assert.equal(registry.get({...scope,recordingId:'takeA'}).channel,'groove');
 assert.throws(()=>registry.publishGroove({...scope,grooveId:'bonus',recordingId:'takeA',creatorId:'other'}),/already reserved/);
 assert.equal(registry.getGroove({...scope,grooveId:'bonus'}).creatorId,'artist');
});

test('authorized grant survives catalog withdrawal/restart and remains immutable',t=>{
 const dir=mkdtempSync(join(tmpdir(),'groove-grants-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'channels.sqlite');
 let registry=new RecordingChannelRegistry(path);
 let catalog=new GrooveCatalog({registry,scope,authorizeCatalog:()=>true,
  authorizeGrant:()=>true,authorizeRead:()=>true});
 catalog.put(a);
 const grant={listenerId:'fan',grooveId:'bonus',grantId:'award1',proof:'fixture'};
 const accepted=catalog.grant(grant);
 assert.equal(accepted.recordingId,'takeA');
 assert.equal(catalog.grant(grant).revision,1);
 assert.throws(()=>catalog.grant({...grant,grantId:'award2'}),/already issued/);
 catalog.remove('bonus');
 assert.throws(()=>catalog.grant({...grant,listenerId:'fan2',grantId:'award3'}),/Active/);
 assert.equal(catalog.entitlements('fan',{proof:'fixture'}).length,1);
 registry.close();
 registry=new RecordingChannelRegistry(path);
 catalog=new GrooveCatalog({registry,scope,authorizeCatalog:()=>true,
  authorizeGrant:()=>true,authorizeRead:()=>true});
 assert.equal(catalog.entitlements('fan',{proof:'fixture'})[0].grantId,'award1');
 catalog.put(a);
 assert.equal(catalog.entitlements('fan',{proof:'fixture'})[0].revision,1);
 registry.close();
});
test('issuer and reader denials cannot create or expose grants',t=>{
 const {registry,catalog}=setup(t);
 catalog.put(a);
 const denied=new GrooveCatalog({registry,scope,authorizeCatalog:()=>true,
   authorizeGrant:()=>false,authorizeRead:()=>false});
 assert.throws(()=>denied.grant({grooveId:'bonus',listenerId:'fan',grantId:'award',proof:'fixture'}),/denied/);
 assert.throws(()=>denied.entitlements('fan',{proof:'fixture'}),/denied/);
 assert.equal(registry.readGrooveEntitlements({...scope,listenerId:'fan'}).length,0);
});
test('grant replay binds listener and groove identity and prevents scope confusion',t=>{
 const {registry}=setup(t);
 const c=new GrooveCatalog({registry,scope,authorizeCatalog:()=>true,
   authorizeGrant:()=>true,authorizeRead:()=>true});
 c.put(a);
 c.grant({grooveId:'bonus',listenerId:'fan',grantId:'award',proof:'fixture'});
 assert.throws(()=>registry.grantGroove({...scope,grooveId:'bonus',listenerId:'other',grantId:'award',recordingId:'takeA',creatorId:'artist',revision:1}),/Conflicting/);
 assert.deepEqual(c.entitlements('other',{proof:'fixture'}),[]);
});

test('independent SQLite connections cannot double-issue one Groove entitlement',t=>{
 const dir=mkdtempSync(join(tmpdir(),'groove-race-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'channels.sqlite');
 const one=new RecordingChannelRegistry(path),two=new RecordingChannelRegistry(path);
 const config=registry=>new GrooveCatalog({registry,scope,authorizeCatalog:()=>true,
   authorizeGrant:()=>true,authorizeRead:()=>true});
 const a1=config(one),a2=config(two);
 a1.put(a);
 const issued=a1.grant({grooveId:'bonus',listenerId:'fan',grantId:'first',proof:'fixture'});
 assert.equal(a2.grant({grooveId:'bonus',listenerId:'fan',grantId:'first',proof:'fixture'}).grantId,issued.grantId);
 assert.throws(()=>a2.grant({grooveId:'bonus',listenerId:'fan',grantId:'second',proof:'fixture'}),/already issued/);
 assert.equal(a2.entitlements('fan',{proof:'fixture'}).length,1);
 one.close();two.close();
});
test('asynchronous or throwing issuer and reader callbacks fail closed and sanitize secrets',async t=>{
 const {registry,catalog:c}=setup(t);c.put(a);
 const issue=new GrooveCatalog({registry,scope,authorizeCatalog:()=>true,
   authorizeGrant:()=>Promise.reject(new Error('private-issuer-token')),
   authorizeRead:()=>{throw new Error('private-reader-token');}});
 assert.throws(()=>issue.grant({grooveId:'bonus',listenerId:'fan',grantId:'award',proof:'fixture'}),/Synchronous issuer/);
 assert.throws(()=>issue.entitlements('fan',{proof:'fixture'}),error=>error.message==='Entitlement read authorization denied');
 assert.equal(registry.readGrooveEntitlements({...scope,listenerId:'fan'}).length,0);
 await new Promise(resolve=>setImmediate(resolve));
});

test('stale authorized publication revision cannot grant or withdraw a republished item',t=>{
 const {registry,catalog:c}=setup(t);c.put(a);
 const prior=registry.getGroove({...scope,grooveId:'bonus'});
 c.remove('bonus');c.put(a);
 assert.equal(registry.getGroove({...scope,grooveId:'bonus'}).revision,3);
 assert.throws(()=>registry.grantGroove({...scope,grooveId:'bonus',listenerId:'fan',
   grantId:'stale',recordingId:'takeA',creatorId:'artist',revision:prior.revision}),/Stale/);
 assert.throws(()=>registry.withdrawGroove({...scope,grooveId:'bonus',
   creatorId:'artist',expectedRevision:prior.revision}),/Stale/);
 assert.equal(registry.readGrooveEntitlements({...scope,listenerId:'fan'}).length,0);
 assert.equal(registry.getGroove({...scope,grooveId:'bonus'}).active,true);
});

test('trusted DRE-05 rights adapter requires reward rights, territory and valid window',t=>{
 const record={tenantId:'tenant',assetRef:'takeA',uses:['reward'],
  territories:['US'],validFrom:'2026-01-01T00:00:00Z',
  validUntil:'2027-01-01T00:00:00Z'};
 const authorizeCreator=()=>true;
 const build=(rights=record,at=Date.parse('2026-06-01T00:00:00Z'))=>
   createGrooveRightsAuthorizer({authorizeCreator,resolveRights:()=>rights,
     territory:'US',now:()=>at});
 const {registry}=setup(t);
 const c=new GrooveCatalog({registry,scope,authorizeCatalog:build()});
 assert.equal(c.put(a).active,true);
 const denied=new GrooveCatalog({registry,scope,authorizeCatalog:build({...record,uses:['sale']})});
 assert.throws(()=>denied.put({...a,grooveId:'other',recordingId:'takeB'}),/denied/);
 const wrongTerritory=new GrooveCatalog({registry,scope,authorizeCatalog:build({...record,territories:['GB']})});
 assert.throws(()=>wrongTerritory.put(a),/denied/);
 const expired=new GrooveCatalog({registry,scope,authorizeCatalog:build(record,Date.parse('2028-01-01T00:00:00Z'))});
 assert.throws(()=>expired.put(a),/denied/);
});
test('rights adapter rejects mismatched trusted asset, forged scope and async creator authority',async()=>{
 const record={tenantId:'tenant',assetRef:'takeB',uses:['reward'],territories:['US'],
   validFrom:'2026-01-01T00:00:00Z',validUntil:'2027-01-01T00:00:00Z'};
 const operation={action:'publish',recordingId:'takeA',creatorId:'artist'};
 const authorizer=createGrooveRightsAuthorizer({authorizeCreator:()=>true,
   resolveRights:()=>record,territory:'US',now:()=>Date.parse('2026-06-01T00:00:00Z')});
 assert.equal(authorizer(operation,scope),false);
 const asyncAuth=createGrooveRightsAuthorizer({authorizeCreator:()=>Promise.reject(new Error('private')),
   resolveRights:()=>record,territory:'US',now:()=>Date.parse('2026-06-01T00:00:00Z')});
 assert.equal(asyncAuth(operation,scope),false);
 await new Promise(resolve=>setImmediate(resolve));
});

test('entitlement reads use bounded stable cursor pages with authorized query parameters',t=>{
 const {registry}=setup(t);
 let seen;
 const c=new GrooveCatalog({registry,scope,authorizeCatalog:()=>true,
   authorizeGrant:()=>true,authorizeRead:request=>{seen=request;return true;}});
 for(const name of ['a','b','c']) {
   c.put({grooveId:name,recordingId:'take'+name,creatorId:'artist',exclusive:true});
   c.grant({grooveId:name,listenerId:'fan',grantId:name,proof:'fixture'});
 }
 const page=c.entitlements('fan',{proof:'fixture',limit:2});
 assert.deepEqual(page.map(x=>x.grantId),['a','b']);
 assert.equal(seen.limit,2);
 assert.deepEqual(c.entitlements('fan',{proof:'fixture',limit:2,afterGrantId:'b'}).map(x=>x.grantId),['c']);
 assert.equal(seen.afterGrantId,'b');
 for(const limit of [0,101,1.5])assert.throws(()=>c.entitlements('fan',{proof:'fixture',limit}),/pagination/);
 assert.throws(()=>registry.readGrooveEntitlements({...scope,listenerId:'fan',limit:101}),/limit/);
});

test('catalog publication is atomic with permanent channel reservation across failed collisions',t=>{
 const {registry,catalog:c}=setup(t);
 const first=c.put(a);
 assert.equal(first.active,true);
 assert.throws(()=>registry.publishGroove({...scope,grooveId:'bonus2',recordingId:'takeA',creatorId:'artist'}),/already reserved/);
 assert.equal(registry.getGroove({...scope,grooveId:'bonus2'}),null);
 assert.equal(registry.get({...scope,recordingId:'takeA'}).entryId,'bonus');
 assert.equal(c.put(a).revision,1);
});

test('corrupt persisted grant identity fails closed instead of exposing false entitlement',t=>{
 const dir=mkdtempSync(join(tmpdir(),'groove-corrupt-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'channels.sqlite');let registry=new RecordingChannelRegistry(path);
 const c=new GrooveCatalog({registry,scope,authorizeCatalog:()=>true,
   authorizeGrant:()=>true,authorizeRead:()=>true});
 c.put(a);c.grant({grooveId:'bonus',listenerId:'fan',grantId:'award',proof:'fixture'});
 registry.close();
 const db=new DatabaseSync(path);
 db.prepare("UPDATE radio_groove_grants SET recording_id='forged' WHERE grant_id='award'").run();
 db.close();
 registry=new RecordingChannelRegistry(path);
 assert.throws(()=>registry.readGrooveEntitlements({...scope,listenerId:'fan'}),/Corrupt/);
 assert.throws(()=>registry.grantGroove({...scope,grooveId:'bonus',listenerId:'fan',
   grantId:'award',recordingId:'takeA',creatorId:'artist',revision:1}),/Corrupt/);
 registry.close();
});
