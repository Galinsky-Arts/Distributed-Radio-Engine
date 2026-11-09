import test from 'node:test';import assert from 'node:assert/strict';import Stripe from 'stripe';
import {createStripeCheckoutAdapters,STRIPE_API_VERSION,STRIPE_CHECKOUT_QUOTE_MS} from '../src/stripe-checkout.mjs';
const now=()=>1_800_000_000_000,secret='whsec_fixture',accountId='acct_fixture';
const request=()=>({scope:{tenantId:'tenant',application:'distributed-radio',identityId:'merchant'},checkoutId:'checkout',buyerId:'buyer',productDigestHex:'a'.repeat(64),
 currency:{code:'USD',minorUnit:2},amountMinor:'1000',expiresAtMs:now()+STRIPE_CHECKOUT_QUOTE_MS,merchantAccountId:accountId,idempotencyKeyHex:'b'.repeat(64)});
async function fixture(change={}){
 const sdk=new Stripe('sk_test_fixture'),calls=[];let session;
 const client={accounts:{retrieve:async()=>({id:accountId})},webhooks:sdk.webhooks,checkout:{sessions:{
  create:async(body,options)=>{calls.push({body,options});session={id:'cs_test_fixture',object:'checkout.session',mode:'payment',livemode:false,
   status:'open',payment_status:'unpaid',client_reference_id:body.client_reference_id,metadata:body.metadata,
   amount_total:body.line_items[0].price_data.unit_amount,currency:body.line_items[0].price_data.currency,expires_at:body.expires_at,
   url:'https://checkout.stripe.com/c/pay/cs_test_fixture'};return structuredClone(session);},
  retrieve:async()=>structuredClone(session)
 }}};
 const adapters=await createStripeCheckoutAdapters({apiKey:'sk_test_fixture',webhookSecret:secret,merchantAccountId:accountId,
  publicOrigin:'https://app.example.test',authorizeMerchant:async()=>true,now,stripeClient:client,...change});
 return {adapters,calls,client,sdk,get session(){return session},setSession:value=>{session=value},
  event:()=>({id:'evt_fixture',object:'event',api_version:STRIPE_API_VERSION,livemode:false,type:'checkout.session.completed',created:now()/1000,data:{object:structuredClone(session)}}),
  signed(event){const payload=JSON.stringify(event);return {raw:new TextEncoder().encode(payload),signature:sdk.webhooks.generateTestHeaderString({payload,secret,timestamp:now()/1000})};}};
}
test('official SDK adapter creates card-only sandbox Checkout with immutable quote and stable idempotency',async()=>{
 const f=await fixture(),intent=await f.adapters.provider.createIntent(request());
 assert.equal(intent.providerPaymentId,'cs_test_fixture');assert.equal(intent.merchantAccountId,accountId);
 assert.equal(f.calls[0].options.idempotencyKey,'b'.repeat(64));assert.deepEqual(f.calls[0].body.payment_method_types,['card']);
 assert.equal(f.calls[0].body.expires_at,Math.floor(request().expiresAtMs/1000));assert.equal(f.calls[0].body.metadata.buyer_id,'buyer');
 assert.equal(f.calls[0].body.line_items[0].price_data.product_data.name,'Complete-work purchase');
 const order={...request(),providerId:'stripe-checkout',providerPaymentId:intent.providerPaymentId};
 assert.equal((await f.adapters.presentationForOrder(order)).url,'https://checkout.stripe.com/c/pay/cs_test_fixture');
 f.setSession({...f.session,url:'https://evil.example/steal'});await assert.rejects(f.adapters.presentationForOrder(order),/URL_INVALID/);
});
test('incompatible quote, exponent, amount and merchant authorization fail before external intent creation',async()=>{
 const f=await fixture();
 for(const change of [{expiresAtMs:now()+900000},{currency:{code:'USD',minorUnit:0}},{amountMinor:'999999999'},
  {merchantAccountId:'acct_other'},{idempotencyKeyHex:'bad'}])await assert.rejects(f.adapters.provider.createIntent({...request(),...change}));
 assert.equal(f.calls.length,0);const denied=await fixture({authorizeMerchant:async()=>false});
 await assert.rejects(denied.adapters.provider.createIntent(request()),/AUTHORIZATION_DENIED/);assert.equal(denied.calls.length,0);
});
test('official Stripe SDK verifies original raw webhook bytes and rechecks the configured account session',async()=>{
 const f=await fixture();await f.adapters.provider.createIntent(request());f.setSession({...f.session,status:'complete',payment_status:'paid'});
 const signed=f.signed(f.event()),event=await f.adapters.verifier.verify(signed.raw,signed.signature,now());
 assert.equal(event.status,'settled');assert.equal(event.amountMinor,'1000');assert.equal(event.buyerId,'buyer');
 assert.equal(event.providerPaymentId,'cs_test_fixture');assert.equal(event.merchantAccountId,accountId);
 assert.equal(event.scope.identityId,'merchant');assert.equal(event.customer,undefined);
 const altered=new TextEncoder().encode(new TextDecoder().decode(signed.raw)+' ');
 await assert.rejects(f.adapters.verifier.verify(altered,signed.signature,now()),/WEBHOOK_REJECTED/);
 await assert.rejects(f.adapters.verifier.verify(signed.raw,'t=1,v1=bad',now()),/WEBHOOK_REJECTED/);
});
test('signed but unpaid, live, wrong-version or mismatched merchant snapshots cannot settle',async()=>{
 const f=await fixture();await f.adapters.provider.createIntent(request());f.setSession({...f.session,status:'complete',payment_status:'paid'});
 const valid=f.event();for(const change of [{livemode:true},{api_version:'old'},{account:'acct_other'},
  {type:'payment_intent.succeeded'},{created:now()/1000+1}]){
  const signed=f.signed({...valid,...change});await assert.rejects(f.adapters.verifier.verify(signed.raw,signed.signature,now()),/WEBHOOK_REJECTED/);
 }
 const unpaid=f.signed({...valid,data:{object:{...valid.data.object,payment_status:'unpaid'}}});
 await assert.rejects(f.adapters.verifier.verify(unpaid.raw,unpaid.signature,now()),/WEBHOOK_REJECTED/);
 const signed=f.signed(valid);f.setSession({...f.session,amount_total:999});
 await assert.rejects(f.adapters.verifier.verify(signed.raw,signed.signature,now()),/WEBHOOK_REJECTED/);
});
test('configuration and provider failures expose stable errors without secrets or session URLs',async()=>{
 await assert.rejects(createStripeCheckoutAdapters({apiKey:'sk_live_forbidden',webhookSecret:secret,merchantAccountId:accountId,
  publicOrigin:'https://app.test',authorizeMerchant:async()=>true}),/TEST_KEY_REQUIRED/);
 const f=await fixture();f.client.checkout.sessions.create=async()=>{throw Error('private-token https://checkout.stripe.com/c/pay/private');};
 await assert.rejects(f.adapters.provider.createIntent(request()),error=>error.message==='STRIPE_CHECKOUT_UNAVAILABLE'&&!JSON.stringify(error).includes('private-token'));
});


test('actual durable DAE engine composes Stripe quote, hosted URL, raw settlement and replay',
 {skip:!process.env.AUDIO_ENGINE_MODULE&&'Actual DAE build required'},async t=>{
 const {pathToFileURL}=await import('node:url'),{mkdtempSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os'),{join}=await import('node:path');
 const core=await import(pathToFileURL(process.env.AUDIO_ENGINE_MODULE));
 const node=await import(new URL('./node/index.js',pathToFileURL(process.env.AUDIO_ENGINE_MODULE)));
 const dir=mkdtempSync(join(tmpdir(),'stripe-core-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const f=await fixture(),scope=request().scope,expiry=now()+86400000;
 const manager={...scope,deviceId:'device',expiresAtMs:expiry,permissions:['rights:write','commerce:manage']};
 const buyer={...manager,identityId:'buyer',permissions:['commerce:buy']};
 const rights=new core.RightsCatalog(scope);
 rights.add(manager,{id:'right',assetId:'recording',layer:'recording',uses:['sale','download'],territories:['US'],
  validFromMs:0,validUntilMs:expiry,authorizationEvidenceRef:'sha256:'+'a'.repeat(64),revoked:false},now());
 let store=new node.SqliteCommerceStore(join(dir,'checkout.sqlite'));
 t.after(()=>store.close());
 const open=()=>new core.CheckoutEngine(scope,rights,f.adapters.provider,f.adapters.verifier,store,STRIPE_CHECKOUT_QUOTE_MS);
 let engine=open();engine.registerProduct(manager,{id:'album',revision:1,assets:[{assetId:'recording',rightsLayers:['recording']}],
  currency:{code:'USD',minorUnit:2},priceMinor:'1000',validUntilMs:expiry},now());
 const order=await engine.createCheckout(buyer,{checkoutId:'checkout',productId:'album',productRevision:1,territory:'US'},now());
 assert.equal(order.expiresAtMs,now()+STRIPE_CHECKOUT_QUOTE_MS);
 assert.equal((await f.adapters.presentationForOrder(order)).url,f.session.url);
 f.setSession({...f.session,status:'complete',payment_status:'paid'});const event=f.signed(f.event());
 assert.equal((await engine.settle(event.raw,event.signature,now())).status,'settled');
 store.close();store=new node.SqliteCommerceStore(join(dir,'checkout.sqlite'));engine=open();
 assert.equal(engine.readOrder(buyer,'checkout',now()).status,'settled');
 assert.equal((await engine.settle(event.raw,event.signature,now())).status,'settled');assert.equal(f.calls.length,1);
});
