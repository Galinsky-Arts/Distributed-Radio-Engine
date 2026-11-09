import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {PointRewards} from '../src/point-rewards.mjs';
import {SqlitePointStore} from '../src/sqlite-point-store.mjs';
import {RecordingChannelRegistry} from '../src/recording-channels.mjs';
import {createRewardPricePolicy,createOfferPriceSnapshot} from '../src/reward-ladder.mjs';
import {pointWalletKey} from '../src/point-ledger.mjs';
const scope={tenantId:'tenant',applicationId:'app',principalId:'listener'};
const price=(version=1,cost=30n)=>createOfferPriceSnapshot({offerId:'offer',offerVersion:version,
 policy:createRewardPricePolicy({creatorId:'artist',version,basePoints:cost}),level:0n,verifyApproval:()=>true});
const publication=(change={})=>({offerId:'offer',expectedVersion:0,kind:'recording',recordingId:'recording',title:'Bonus take',stock:1,
 expiresAtMs:10000,priceSnapshot:price(),proof:'approved',...change});
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'radio-rewards-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'wallet.sqlite'),registry=new RecordingChannelRegistry(join(dir,'channels.sqlite'));
 const store=new SqlitePointStore(path);t.after(()=>{store.close();registry.close();});
 let rights=true;
 const options={scope,store,recordingRegistry:registry,authorizeCreator:()=>true,authorizeRedemption:()=>true,
  verifyPriceSnapshot:s=>s.offerId==='offer',territory:'US',now:()=>2000,
  resolveRights:()=>({tenantId:'tenant',assetRef:'recording',uses:['reward'],territories:['US'],
   validFrom:'1970-01-01T00:00:00Z',validUntil:'2030-01-01T00:00:00Z',revoked:!rights})};
 const rewards=new PointRewards(options),wallet=pointWalletKey(scope,'artist');
 store.apply(wallet,{kind:'vest',operationId:'credit',amount:'100',sourceId:JSON.stringify(['tenant','app','listener','artist','occurrence']),
  sourceBinding:'fixture-only',referenceId:null,metadata:'digest'},1000);
 return {dir,path,store,registry,options,rewards,wallet,revoke(){rights=false;}};
}
const redeem=(r,change={})=>r.redeem({creatorId:'artist',offerId:'offer',offerVersion:1,operationId:'redeem',proof:'consent',...change});
test('approved immutable pricing atomically debits stock and issues one persistent entitlement',t=>{
 const f=fixture(t);f.rewards.publish(publication());
 const result=redeem(f.rewards);assert.equal(result.applied,true);assert.equal(result.receipt.points,'30');
 assert.equal(f.store.balance(f.wallet).balance,70n);assert.equal(redeem(f.rewards).applied,false);
 assert.equal(redeem(f.rewards,{operationId:'another'}).applied,false);
 const second=new SqlitePointStore(f.path);t.after(()=>second.close());
 assert.equal(redeem(new PointRewards({...f.options,store:second})).applied,false);
 assert.equal(second.balance(f.wallet).balance,70n);assert.equal(second.audit(f.wallet).consistent,true);
});
test('failed entitlement insertion restores stock and balance for a safe retry',t=>{
 const f=fixture(t);f.rewards.publish(publication());const db=new DatabaseSync(f.path);t.after(()=>db.close());
 db.exec("CREATE TRIGGER fail_grant BEFORE INSERT ON radio_point_entitlements BEGIN SELECT RAISE(ABORT,'grant failed'); END");
 assert.throws(()=>redeem(f.rewards),/grant failed/);assert.equal(f.store.balance(f.wallet).balance,100n);
 assert.equal(f.store.pointOffer(JSON.stringify(['tenant','app','artist']),'offer').stock,1);
 db.exec('DROP TRIGGER fail_grant');assert.equal(redeem(f.rewards).applied,true);
});
test('changed offers, rights revocation, authority denial and wrong creators cannot debit',t=>{
 const f=fixture(t);f.rewards.publish(publication());
 assert.throws(()=>redeem(f.rewards,{offerVersion:2}),/changed/);
 assert.throws(()=>redeem(f.rewards,{creatorId:'other'}),/denied/);
 const denied=new PointRewards({...f.options,authorizeRedemption:()=>false});
 assert.throws(()=>redeem(denied),/denied/);f.revoke();assert.throws(()=>redeem(f.rewards),/denied/);
 assert.equal(f.store.balance(f.wallet).balance,100n);
});
test('stock exhaustion and insufficient balances cannot create entitlements',t=>{
 const f=fixture(t);f.rewards.publish(publication({priceSnapshot:price(1,101n)}));
 assert.throws(()=>redeem(f.rewards),/Insufficient/);assert.equal(f.store.balance(f.wallet).balance,100n);
 f.rewards.publish(publication({expectedVersion:1,stock:0,priceSnapshot:price(2)}));
 assert.throws(()=>redeem(f.rewards,{offerVersion:2}),/exhausted/);
});
test('recording channel reservation excludes paid/bonus reuse and identity edits',t=>{
 const f=fixture(t);f.registry.reserve({tenantId:'tenant',applicationId:'app',creatorId:'artist',recordingId:'recording',entryId:'groove',channel:'groove'});
 assert.throws(()=>f.rewards.publish(publication()),/another identity or channel/);
 assert.equal(f.store.pointOffer(JSON.stringify(['tenant','app','artist']),'offer'),null);
});
test('price approval, resource bounds and creator consent fail closed',async t=>{
 const f=fixture(t);
 for(const change of [{expectedVersion:-1},{stock:1000001},{kind:'paid-single'},{expiresAtMs:2000},
  {priceSnapshot:{...price(),spendAuthorized:true}},{proof:''}])assert.throws(()=>f.rewards.publish(publication(change)));
 const denied=new PointRewards({...f.options,verifyPriceSnapshot:()=>Promise.reject(Error('private'))});
 assert.throws(()=>denied.publish(publication()),/authentication/);
 await new Promise(resolve=>setImmediate(resolve));
});

import {spawn} from 'node:child_process';
test('independent processes compete for one stock item without overspend or partial grants',async t=>{
 const f=fixture(t);f.rewards.publish(publication());
 const viewers=['a','b','c','d'];
 for(const principalId of viewers)f.store.apply(pointWalletKey({...scope,principalId},'artist'),{
  kind:'vest',operationId:'credit',amount:'100',sourceId:JSON.stringify(['tenant','app',principalId,'artist','occurrence']),
  sourceBinding:'fixture-only',referenceId:null,metadata:'digest'},1000);
 const run=principalId=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[new URL('./fixtures/reward-race-worker.mjs',import.meta.url).pathname,f.path,principalId],
   {stdio:['ignore','pipe','pipe']});let output='',error='';
  child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{error+=chunk});
  child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(output)):reject(Error(error)));
 });
 const results=await Promise.all(viewers.map(run));assert.equal(results.filter(x=>x.applied).length,1);
 assert.equal(viewers.reduce((n,principalId)=>n+f.store.balance(pointWalletKey({...scope,principalId},'artist')).balance,0n),370n);
 assert.equal(f.store.pointOffer(JSON.stringify(['tenant','app','artist']),'offer').stock,0);
});

test('ordinary wallet reversal cannot refund a reward debit while retaining its entitlement',t=>{
 const f=fixture(t);f.rewards.publish(publication());redeem(f.rewards);
 assert.throws(()=>f.store.apply(f.wallet,{kind:'reverse',operationId:'refund',amount:null,sourceId:null,
  sourceBinding:null,referenceId:'redeem',metadata:'refund'},3000),/entitlement reconciliation/);
 assert.equal(f.store.balance(f.wallet).balance,70n);
});
