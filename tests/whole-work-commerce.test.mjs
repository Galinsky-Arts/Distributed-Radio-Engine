import test from 'node:test';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {RecordingChannelRegistry} from '../src/recording-channels.mjs';
import {WholeWorkCommerce} from '../src/whole-work-commerce.mjs';
const modulePath=process.env.AUDIO_ENGINE_MODULE,options={skip:!modulePath&&'Set AUDIO_ENGINE_MODULE to the pinned actual DAE build'};
async function fixture(t){
 const core=await import(pathToFileURL(modulePath)),node=await import(new URL('./node/index.js',pathToFileURL(modulePath)));
 const dir=mkdtempSync(join(tmpdir(),'radio-commerce-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'business.sqlite');
 const scope={tenantId:'tenant',applicationId:'app',merchantId:'merchant'},coreScope={tenantId:'tenant',application:'distributed-radio',identityId:'merchant'};
 const manager={...coreScope,deviceId:'device',expiresAtMs:100000,permissions:['rights:write','commerce:manage','entitlements:manage']};
 const buyer={...manager,identityId:'buyer',permissions:['commerce:buy','assets:read']};let now=1000,event,allow=true,fulfillment=true;
 const rights=new core.RightsCatalog(coreScope);
 for(const assetId of ['one','two'])rights.add(manager,{id:'right-'+assetId,assetId,layer:'recording',uses:['sale','download'],territories:['US'],validFromMs:0,validUntilMs:100000,authorizationEvidenceRef:'sha256:'+'a'.repeat(64),revoked:false},1);
 let work={kind:'complete-album',creatorId:'artist',completeAssetIds:['one','two'],product:{id:'album',revision:1,
  assets:[{assetId:'one',rightsLayers:['recording']},{assetId:'two',rightsLayers:['recording']}],currency:{code:'USD',minorUnit:2},priceMinor:'1000',validUntilMs:100000}};
 const registry=new RecordingChannelRegistry(join(dir,'channels.sqlite'));t.after(()=>registry.close());
 const requests=[];const provider={providerId:'fixture-provider',merchantAccountId:'account',createIntent:async request=>{
  requests.push(request);return {providerId:'fixture-provider',merchantAccountId:'account',providerPaymentId:'payment:'+request.checkoutId,currency:request.currency,amountMinor:request.amountMinor};
 }};
 const verifier={verify:async(_raw,auth)=>{if(auth!=='fixture-auth'||!event)throw Error('provider verification failed');return structuredClone(event);}};
 let checkoutStore,entitlementStore,engine,ledger,commerce;
 const open=()=>{
  checkoutStore=new node.SqliteCommerceStore(path);entitlementStore=new node.SqliteEntitlementStore(path);
  engine=new core.CheckoutEngine(coreScope,rights,provider,verifier,checkoutStore);ledger=new core.EntitlementLedger(coreScope,entitlementStore);
  commerce=new WholeWorkCommerce({scope,recordingRegistry:registry,checkout:engine,entitlements:ledger,commerceDigest:core.commerceDigest,
   resolveCompleteWork:async()=>work,verifyCompleteWork:async()=>true,resolveBuyer:async actor=>({...buyer,identityId:actor.principalId}),
   resolveMerchant:async()=>manager,authorizePurchase:async(_request,proof)=>allow&&proof==='fixture-consent',
   authorizeRead:async()=>true,verifyFulfillment:async()=>fulfillment,territory:'US',now:()=>now});
 };
 open();t.after(()=>{checkoutStore.close();entitlementStore.close();});
 const input={tenantId:'tenant',applicationId:'app',principalId:'buyer',productId:'album',productRevision:1,operationId:'operation-000000000000000001',proof:'fixture-consent'};
 return {input,requests,registry,get commerce(){return commerce},get ledger(){return ledger},buyer,
  changeWork:change=>{work=change},get work(){return structuredClone(work)},deny:()=>{allow=false},
  pauseFulfillment:()=>{fulfillment=false},resumeFulfillment:()=>{fulfillment=true},
  async prepareSettlement(checkoutId){
   const order=engine.readOrder(buyer,checkoutId,now);now=1500;
   event={scope:coreScope,eventId:'settlement',providerId:provider.providerId,merchantAccountId:'account',checkoutId,
    buyerId:'buyer',productDigestHex:order.productDigestHex,providerPaymentId:order.providerPaymentId,currency:order.currency,
    amountMinor:order.amountMinor,occurredAtMs:now,status:'settled'};
  },reopen(){checkoutStore.close();entitlementStore.close();open();}};
}
test('actual DAE durable checkout, provider settlement and whole-album entitlement compose without song selection',options,async t=>{
 const f=await fixture(t),pending=await f.commerce.startCheckout(f.input);assert.equal(pending.state,'PENDING');
 assert.equal(f.requests.length,1);assert.equal((await f.commerce.startCheckout(f.input)).checkoutId,pending.checkoutId);assert.equal(f.requests.length,1);
 await f.prepareSettlement(pending.checkoutId);const complete=await f.commerce.settle(new Uint8Array([1]),'fixture-auth');
 assert.equal(complete.state,'COMPLETE');assert.ok(complete.receiptId);
 assert.equal(f.ledger.access(f.buyer,'one','download',1500).allowed,true);assert.equal(f.ledger.access(f.buyer,'two','download',1500).allowed,true);
 assert.equal(f.ledger.access(f.buyer,'one','stream',1500).allowed,false);
 f.reopen();const receipt=await f.commerce.getReceipt({...f.input,checkoutId:pending.checkoutId});
 assert.equal(receipt.receiptId,complete.receiptId);assert.equal(f.requests.length,1);
});
test('provider-settled payment remains fulfillment-pending until verified rights allow a retry',options,async t=>{
 const f=await fixture(t),pending=await f.commerce.startCheckout(f.input);await f.prepareSettlement(pending.checkoutId);f.pauseFulfillment();
 const paid=await f.commerce.settle(new Uint8Array([1]),'fixture-auth');assert.equal(paid.fulfillmentPending,true);assert.equal(paid.state,'PENDING');
 assert.equal(f.ledger.access(f.buyer,'one','download',1500).allowed,false);f.resumeFulfillment();
 const receipt=await f.commerce.getReceipt({...f.input,checkoutId:pending.checkoutId});assert.equal(receipt.state,'COMPLETE');assert.equal(f.requests.length,1);
});
test('partial works, standalone singles and unapproved purchases never reach the provider',options,async t=>{
 const f=await fixture(t),work=f.work;f.changeWork({...work,kind:'single'});
 await assert.rejects(f.commerce.startCheckout(f.input),/Complete work only/);
 f.changeWork({...work,completeAssetIds:['one']});await assert.rejects(f.commerce.startCheckout(f.input),/Complete work only/);
 f.changeWork(work);f.deny();await assert.rejects(f.commerce.startCheckout(f.input),/not authorized/);assert.equal(f.requests.length,0);
});
test('wrong buyer scope and forged provider authentication cannot produce a purchase receipt',options,async t=>{
 const f=await fixture(t);await assert.rejects(f.commerce.startCheckout({...f.input,tenantId:'other'}),/scope mismatch/);
 const pending=await f.commerce.startCheckout(f.input);await f.prepareSettlement(pending.checkoutId);
 await assert.rejects(f.commerce.settle(new Uint8Array([1]),'forged'),/verification failed/);
 assert.equal((await f.commerce.getReceipt({...f.input,checkoutId:pending.checkoutId})).state,'PENDING');
 await assert.rejects(f.commerce.getReceipt({...f.input,principalId:'other',checkoutId:pending.checkoutId}),/BUYER_MISMATCH/);
});

test('changed catalog bytes cannot expand fulfillment from an immutable settled quote',options,async t=>{
 const f=await fixture(t),pending=await f.commerce.startCheckout(f.input);await f.prepareSettlement(pending.checkoutId);
 f.changeWork({...f.work,product:{...f.work.product,priceMinor:'9000'}});
 const result=await f.commerce.settle(new Uint8Array([1]),'fixture-auth');
 assert.equal(result.state,'PENDING');assert.equal(result.fulfillmentPending,true);
 assert.equal(f.ledger.access(f.buyer,'one','download',1500).allowed,false);
});

test('paid complete works cannot reuse bonus recordings or change recording creator identity',options,async t=>{
 const f=await fixture(t);
 f.registry.reserve({tenantId:'tenant',applicationId:'app',recordingId:'one',creatorId:'artist',entryId:'bonus',channel:'groove'});
 await assert.rejects(f.commerce.startCheckout(f.input),/another identity or channel/);assert.equal(f.requests.length,0);
});

test('settled fulfillment cannot silently reassign a recording to another creator',options,async t=>{
 const f=await fixture(t),pending=await f.commerce.startCheckout(f.input);await f.prepareSettlement(pending.checkoutId);
 f.changeWork({...f.work,creatorId:'different-creator'});
 await assert.rejects(f.commerce.settle(new Uint8Array([1]),'fixture-auth'),/paid recording identity/);
 assert.equal(f.ledger.access(f.buyer,'one','download',1500).allowed,false);
});

for(const kind of ['complete-show','complete-documentary'])test('neutral whole-work settlement supports '+kind,options,async t=>{
 const f=await fixture(t);f.changeWork({...f.work,kind});const pending=await f.commerce.startCheckout(f.input);
 await f.prepareSettlement(pending.checkoutId);const settled=await f.commerce.settle(new Uint8Array([1]),'fixture-auth');
 assert.equal(settled.state,'COMPLETE');assert.equal(f.ledger.access(f.buyer,'one','download',1500).allowed,true);
 assert.equal(f.ledger.access(f.buyer,'two','download',1500).allowed,true);assert.equal(f.ledger.access(f.buyer,'one','stream',1500).allowed,false);
});
