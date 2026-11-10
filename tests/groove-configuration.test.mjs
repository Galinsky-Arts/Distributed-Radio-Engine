import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {RecordingChannelRegistry} from '../src/recording-channels.mjs';
const base={tenantId:'tenant',applicationId:'app',creatorId:'artist',stationId:'station',operationId:'operation-00000000000001',version:1,expectedPreviousVersion:0,everyMin:2,everyMax:5,rarityBase:2,
 recordings:[{grooveId:'bonus',recordingId:'alternate',minimumCompletions:0,stock:20,exclusive:true,channel:'groove'}]};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'groove-config-')),path=join(dir,'registry.sqlite');let registry=new RecordingChannelRegistry(path);t.after(()=>{registry.close();rmSync(dir,{recursive:true,force:true});});return {get registry(){return registry},reopen(){registry.close();registry=new RecordingChannelRegistry(path);}};}
test('catalog, stock and policy publish atomically and operation retry survives restart',t=>{
 const f=fixture(t),receipt=f.registry.publishGrooveConfiguration(base,()=>true);assert.equal(receipt.committed,true);
 assert.equal(f.registry.get({...base,recordingId:'alternate'}).channel,'groove');assert.equal(f.registry.readGrooveConfiguration(base).version,1);
 f.reopen();assert.deepEqual(f.registry.publishGrooveConfiguration(base,()=>true),receipt);
 assert.throws(()=>f.registry.publishGrooveConfiguration({...base,everyMin:3},()=>true),/operation conflict/);
});
test('a later channel conflict rolls back all earlier reservations and configuration',t=>{
 const f=fixture(t);f.registry.reserve({...base,recordingId:'paid',entryId:'album',channel:'paid'});
 assert.throws(()=>f.registry.publishGrooveConfiguration({...base,recordings:[...base.recordings,{...base.recordings[0],grooveId:'other',recordingId:'paid'}]},()=>true),/channel conflict/);
 assert.equal(f.registry.get({...base,recordingId:'alternate'}),null);assert.equal(f.registry.readGrooveConfiguration(base),null);
});
test('invalid cadence, gates, duplicate catalog and denied or revoked authority commit nothing',t=>{
 const f=fixture(t);for(const change of [{everyMax:0},{recordings:[base.recordings[0],base.recordings[0]]},{recordings:[{...base.recordings[0],channel:'paid'}]}])assert.throws(()=>f.registry.publishGrooveConfiguration({...base,...change},()=>true));
 assert.throws(()=>f.registry.publishGrooveConfiguration(base,()=>false),/authorization/);
 assert.throws(()=>f.registry.publishGrooveConfiguration(base,async()=>true),/authorization/);
 let calls=0;assert.throws(()=>f.registry.publishGrooveConfiguration(base,()=>++calls===1),/revoked/);
 assert.equal(f.registry.get({...base,recordingId:'alternate'}),null);
});
test('stale versions, creator reassignment and stock below grants fail without losing existing policy',t=>{
 const f=fixture(t);f.registry.publishGrooveConfiguration(base,()=>true);
 assert.throws(()=>f.registry.publishGrooveConfiguration({...base,operationId:base.operationId+'2'},()=>true),/Stale/);
 f.registry.grantGroove({...base,grooveId:'bonus',listenerId:'listener',grantId:'grant',recordingId:'alternate',revision:1});
 const next={...base,operationId:base.operationId+'2',version:2,expectedPreviousVersion:1};
 assert.throws(()=>f.registry.publishGrooveConfiguration({...next,creatorId:'other'},()=>true),/creator/);
 assert.throws(()=>f.registry.publishGrooveConfiguration({...next,recordings:[{...base.recordings[0],stock:0}]},()=>true),/Stock below/);
 assert.equal(f.registry.readGrooveConfiguration(base).version,1);
 assert.equal(f.registry.publishGrooveConfiguration(next,()=>true).version,2);
});
