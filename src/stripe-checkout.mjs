import Stripe from 'stripe';
import {id} from './contracts.mjs';
export const STRIPE_API_VERSION=Stripe.API_VERSION;
export const STRIPE_CHECKOUT_QUOTE_MS=31*60_000;
const exponents=Object.freeze({USD:2,EUR:2,GBP:2,CAD:2,AUD:2,JPY:0});
export class StripeAdapterError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new StripeAdapterError(code);};
function clientFor(apiKey){
 if(typeof apiKey!=='string'||!/^([sr]k)_test_[A-Za-z0-9]+$/.test(apiKey))fail('STRIPE_TEST_KEY_REQUIRED');
 return new Stripe(apiKey,{apiVersion:STRIPE_API_VERSION,timeout:10000,maxNetworkRetries:2,httpClient:Stripe.createFetchHttpClient()});
}
function publicOrigin(value){
 let url;try{url=new URL(value);}catch{fail('STRIPE_HTTPS_RETURN_ORIGIN_REQUIRED');}if(url.protocol!=='https:'||url.origin!==value||url.username||url.password)fail('STRIPE_HTTPS_RETURN_ORIGIN_REQUIRED');return url.origin;
}
function currency(value){
 if(!value||!Object.hasOwn(exponents,value.code)||value.minorUnit!==exponents[value.code])fail('STRIPE_CURRENCY_PROFILE_UNSUPPORTED');
 return {code:value.code,minorUnit:value.minorUnit};
}
function amount(value){
 if(typeof value!=='string'||!/^[1-9][0-9]{0,7}$/.test(value))fail('STRIPE_AMOUNT_OUT_OF_SUPPORTED_RANGE');return Number(value);
}
function scope(value){
 if(!value||value.application!=='distributed-radio')fail('STRIPE_SCOPE_INVALID');
 return {tenantId:id(value.tenantId,'tenant'),application:'distributed-radio',identityId:id(value.identityId,'merchant identity')};
}
function metadataFor(request){
 const checked=scope(request.scope);
 return {dre_version:'1',tenant_id:checked.tenantId,application:checked.application,merchant_identity:checked.identityId,
  checkout_id:id(request.checkoutId,'checkout'),buyer_id:id(request.buyerId,'buyer'),product_digest:request.productDigestHex,
  quote_expires_ms:String(request.expiresAtMs)};
}
function sessionFacts(session){
 if(!session||session.object!=='checkout.session'||typeof session.id!=='string'||!/^cs_test_[A-Za-z0-9]+$/.test(session.id)||
   session.livemode!==false||session.mode!=='payment'||!Number.isSafeInteger(session.amount_total)||session.amount_total<1||
   typeof session.currency!=='string'||!Number.isSafeInteger(session.expires_at))fail('STRIPE_SESSION_BINDING_INVALID');
 const m=session.metadata;
 if(!m||m.dre_version!=='1'||m.application!=='distributed-radio'||typeof m.product_digest!=='string'||!/^[a-f0-9]{64}$/.test(m.product_digest)||
  typeof m.quote_expires_ms!=='string'||!/^\d{1,16}$/.test(m.quote_expires_ms))fail('STRIPE_SESSION_BINDING_INVALID');
 const expiresAtMs=Number(m.quote_expires_ms);
 if(!Number.isSafeInteger(expiresAtMs)||Math.floor(expiresAtMs/1000)!==session.expires_at||session.client_reference_id!==m.checkout_id)
  fail('STRIPE_SESSION_BINDING_INVALID');
 const code=session.currency.toUpperCase();if(!Object.hasOwn(exponents,code))fail('STRIPE_CURRENCY_PROFILE_UNSUPPORTED');
 return {scope:{tenantId:id(m.tenant_id,'tenant'),application:'distributed-radio',identityId:id(m.merchant_identity,'merchant identity')},
  checkoutId:id(m.checkout_id,'checkout'),buyerId:id(m.buyer_id,'buyer'),productDigestHex:m.product_digest,
  providerPaymentId:session.id,currency:{code,minorUnit:exponents[code]},amountMinor:String(session.amount_total),expiresAtMs};
}
const binding=f=>JSON.stringify(f);
const sameScope=(a,b)=>['tenantId','application','identityId'].every(key=>a?.[key]===b?.[key]);
/** Read-only configuration probe. Never returns a key or account contact data. */
export async function inspectStripeSandboxAccount({apiKey,stripeClient}={}){
 const client=stripeClient??clientFor(apiKey);
 try{const account=await client.accounts.retrieve();if(typeof account?.id!=='string'||!/^acct_[A-Za-z0-9]+$/.test(account.id))fail('STRIPE_ACCOUNT_INVALID');
  return Object.freeze({accountId:account.id,sdkVersion:'23.1.0',apiVersion:STRIPE_API_VERSION,mode:'test'});
 }catch{fail('STRIPE_ACCOUNT_UNAVAILABLE');}
}
/** Sandbox-only adapter. API, raw signatures and hosted payment UI belong to Stripe. */
export async function createStripeCheckoutAdapters({apiKey,webhookSecret,merchantAccountId,publicOrigin:origin,
 authorizeMerchant,now=Date.now,stripeClient}={}){
 if(typeof webhookSecret!=='string'||!webhookSecret.startsWith('whsec_')||webhookSecret.length>512||
  typeof authorizeMerchant!=='function'||typeof now!=='function'||!/^acct_[A-Za-z0-9]+$/.test(merchantAccountId))fail('STRIPE_CONFIGURATION_REQUIRED');
 const base=publicOrigin(origin),client=stripeClient??clientFor(apiKey);
 const account=await inspectStripeSandboxAccount({stripeClient:client});if(account.accountId!==merchantAccountId)fail('STRIPE_ACCOUNT_MISMATCH');
 const at=()=>{const n=now();if(!Number.isSafeInteger(n)||n<0)fail('STRIPE_CLOCK_INVALID');return n;};
 async function retrieve(sessionId){try{return await client.checkout.sessions.retrieve(sessionId);}catch{fail('STRIPE_SESSION_UNAVAILABLE');}}
 function matchesOrder(facts,order){
  return sameScope(facts.scope,order.scope)&&facts.checkoutId===order.checkoutId&&facts.buyerId===order.buyerId&&
   facts.productDigestHex===order.productDigestHex&&facts.providerPaymentId===order.providerPaymentId&&facts.amountMinor===order.amountMinor&&
   facts.currency.code===order.currency.code&&facts.currency.minorUnit===order.currency.minorUnit&&facts.expiresAtMs===order.expiresAtMs;
 }
 const provider=Object.freeze({providerId:'stripe-checkout',merchantAccountId,
  async createIntent(input){
   const request=structuredClone(input),checkedCurrency=currency(request.currency),unitAmount=amount(request.amountMinor),time=at();
   if(request.merchantAccountId!==merchantAccountId||typeof request.productDigestHex!=='string'||!/^[a-f0-9]{64}$/.test(request.productDigestHex)||
    typeof request.idempotencyKeyHex!=='string'||!/^[a-f0-9]{64}$/.test(request.idempotencyKeyHex)||
    !Number.isSafeInteger(request.expiresAtMs)||request.expiresAtMs-time<30*60_000+30_000||request.expiresAtMs-time>24*60*60_000)
    fail('STRIPE_QUOTE_BINDING_INVALID');
   let authorized=false;try{authorized=await authorizeMerchant(Object.freeze(request),account)===true;}catch{}
   if(!authorized)fail('STRIPE_MERCHANT_AUTHORIZATION_DENIED');
   const metadata=metadataFor(request);let session;
   try{session=await client.checkout.sessions.create({mode:'payment',payment_method_types:['card'],
    line_items:[{quantity:1,price_data:{currency:checkedCurrency.code.toLowerCase(),unit_amount:unitAmount,
     product_data:{name:'Complete-work purchase'}}}],client_reference_id:request.checkoutId,metadata,
    expires_at:Math.floor(request.expiresAtMs/1000),success_url:base+'/checkout/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url:base+'/checkout/cancel'}, {idempotencyKey:request.idempotencyKeyHex});
   }catch{fail('STRIPE_CHECKOUT_UNAVAILABLE');}
   const facts=sessionFacts(session);
   if(!sameScope(facts.scope,scope(request.scope))||facts.checkoutId!==request.checkoutId||facts.buyerId!==request.buyerId||
    facts.productDigestHex!==request.productDigestHex||facts.amountMinor!==request.amountMinor||
    facts.currency.code!==checkedCurrency.code||facts.currency.minorUnit!==checkedCurrency.minorUnit||facts.expiresAtMs!==request.expiresAtMs)
    fail('STRIPE_SESSION_BINDING_INVALID');
   return Object.freeze({providerId:'stripe-checkout',merchantAccountId,providerPaymentId:session.id,currency:checkedCurrency,amountMinor:request.amountMinor});
  }});
 const verifier=Object.freeze({async verify(raw,authentication,nowMs){
  try{
   if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>65536||typeof authentication!=='string'||authentication.length>4096||
    !Number.isSafeInteger(nowMs)||nowMs<0)fail('STRIPE_WEBHOOK_REJECTED');
   // Official SDK checks the original raw bytes and signature. Never parse first.
   const event=client.webhooks.constructEvent(Buffer.from(raw),authentication,webhookSecret,300,undefined,nowMs);
   if(event.livemode!==false||event.api_version!==STRIPE_API_VERSION||event.type!=='checkout.session.completed'||
    (event.account!==undefined&&event.account!==merchantAccountId)||!Number.isSafeInteger(event.created)||event.created*1000>nowMs)
    fail('STRIPE_WEBHOOK_REJECTED');
   const signed=event.data?.object;
   if(signed?.status!=='complete'||signed.payment_status!=='paid')fail('STRIPE_WEBHOOK_REJECTED');
   const signedFacts=sessionFacts(signed),fresh=await retrieve(signedFacts.providerPaymentId);
   if(fresh.status!=='complete'||fresh.payment_status!=='paid'||binding(sessionFacts(fresh))!==binding(signedFacts))fail('STRIPE_WEBHOOK_REJECTED');
   return Object.freeze({scope:signedFacts.scope,eventId:id(event.id,'Stripe event'),providerId:'stripe-checkout',merchantAccountId,
    checkoutId:signedFacts.checkoutId,buyerId:signedFacts.buyerId,productDigestHex:signedFacts.productDigestHex,
    providerPaymentId:signedFacts.providerPaymentId,currency:signedFacts.currency,amountMinor:signedFacts.amountMinor,
    occurredAtMs:event.created*1000,status:'settled'});
  }catch{fail('STRIPE_WEBHOOK_REJECTED');}
 }});
 async function presentationForOrder(order){
  if(order?.providerId!=='stripe-checkout'||order.merchantAccountId!==merchantAccountId||typeof order.providerPaymentId!=='string')fail('STRIPE_ORDER_BINDING_INVALID');
  const session=await retrieve(order.providerPaymentId);if(!matchesOrder(sessionFacts(session),order))fail('STRIPE_ORDER_BINDING_INVALID');
  if(session.status!=='open'||session.payment_status!=='unpaid'||order.expiresAtMs<=at())return null;
  if(typeof session.url!=='string'||session.url.length>4096)fail('STRIPE_CHECKOUT_URL_INVALID');
  let url;try{url=new URL(session.url);}catch{fail('STRIPE_CHECKOUT_URL_INVALID');}if(url.origin!=='https://checkout.stripe.com'||url.username||url.password)fail('STRIPE_CHECKOUT_URL_INVALID');
  return Object.freeze({url:session.url});
 }
 return Object.freeze({provider,verifier,presentationForOrder,...account});
}
