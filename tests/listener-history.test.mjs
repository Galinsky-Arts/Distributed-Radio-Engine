import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableListenerCompletion} from '../src/listener-history.mjs';
const scope={tenantId:'tenant',applicationId:'app',stationId:'station',listenerId:'listener'};
const entry={...scope,creatorId:'artist',occurrenceId:'occ1',programDigest:'digest',
  route:'headphones',foreground:true,unmuted:true,startedAtMs:100,
  completedAtMs:2000,requiredStartMs:100,requiredEndMs:2000,proof:'fixture'};
function setup(t,change={}) {
 const dir=mkdtempSync(join(tmpdir(),'listener-history-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'history.sqlite');
 const options={scope,verifyCompletion:()=>true,authorizeRead:()=>true,...change};
 const history=new DurableListenerCompletion(path,options);
 return {path,options,history};
}
test('authenticated headphone completion survives restart without speaker credit',t=>{
 const {path,options,history}=setup(t);
 assert.equal(history.complete(entry).grooveEligible,true);
 assert.equal(history.complete(entry).replayed,true);
 assert.equal(history.lifetimeCount({creatorId:'artist',proof:'fixture'}),1);
 assert.equal(history.history({creatorId:'artist',proof:'fixture'})[0].route,'headphones');
 history.close();
 const opened=new DurableListenerCompletion(path,options);
 assert.equal(opened.lifetimeCount({creatorId:'artist',proof:'fixture'}),1);
 assert.equal(opened.complete(entry).speakerPointsEarned,0n);
 opened.close();
});
test('forged completion, mute, background, partial and cross scope fail closed',t=>{
 const {history}=setup(t,{verifyCompletion:()=>false});
 assert.throws(()=>history.complete(entry),/denied/);
 for(const input of [{...entry,unmuted:false},{...entry,foreground:false},
   {...entry,startedAtMs:101},{...entry,completedAtMs:1999},
   {...entry,tenantId:'other'}])assert.throws(()=>history.complete(input));
 assert.equal(history.lifetimeCount({creatorId:'artist',proof:'fixture'}),0);
 history.close();
});
test('replay retargeting and changing output route cannot reroll an occurrence',t=>{
 const {history}=setup(t);
 history.complete(entry);
 assert.throws(()=>history.complete({...entry,route:'speaker'}),/Conflicting/);
 assert.throws(()=>history.complete({...entry,programDigest:'other'}),/Conflicting/);
 assert.equal(history.lifetimeCount({creatorId:'artist',proof:'fixture'}),1);
 history.close();
});
test('creator and listener scoped histories cannot be read without authorization',t=>{
 const {history}=setup(t,{authorizeRead:()=>false});
 history.complete(entry);
 assert.throws(()=>history.history({creatorId:'artist',proof:'fixture'}),/denied/);
 assert.throws(()=>history.lifetimeCount({creatorId:'artist',proof:'fixture'}),/denied/);
 history.close();
});
test('bounded pages and lifetime counter are separate from provisional rewards',t=>{
 const {history}=setup(t);
 for(const occurrenceId of ['a','b','c'])
   history.complete({...entry,occurrenceId});
 const page=history.history({creatorId:'artist',proof:'fixture',limit:2});
 assert.deepEqual(page.map(x=>x.occurrenceId),['a','b']);
 assert.deepEqual(history.history({creatorId:'artist',proof:'fixture',limit:2,afterOccurrenceId:'b'})
   .map(x=>x.occurrenceId),['c']);
 assert.equal(history.lifetimeCount({creatorId:'artist',proof:'fixture'}),3);
 assert.throws(()=>history.history({creatorId:'artist',proof:'fixture',limit:101}),/Bounded/);
 history.close();
});
test('async verifier failure cannot create a completion',async t=>{
 const {history}=setup(t,{verifyCompletion:()=>Promise.reject(new Error('private'))});
 assert.throws(()=>history.complete(entry),/denied/);
 history.close();
 await new Promise(resolve=>setImmediate(resolve));
});

test('future completion clocks and oversized history cursors fail closed',t=>{
 const {history}=setup(t,{now:()=>1999});t.after(()=>history.close());
 assert.throws(()=>history.complete(entry),/clock/);
 assert.throws(()=>history.history({creatorId:'artist',proof:'fixture',afterOccurrenceId:'x'.repeat(129)}),/Bounded/);
});
test('authoritative occurrence lookup is scoped and contains no verifier proof',t=>{
 const {history}=setup(t);t.after(()=>history.close());history.complete(entry);
 const result=history.readCompletion({creatorId:'artist',occurrenceId:'occ1',proof:'fixture'});
 assert.equal(result.route,'headphones');assert.equal(result.stationId,'station');assert.equal(result.proof,undefined);
 assert.equal(history.readCompletion({creatorId:'other',occurrenceId:'occ1',proof:'fixture'}),null);
});
