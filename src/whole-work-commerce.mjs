import {createHash} from 'node:crypto';
import {id} from './contracts.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity=value=>Object.freeze({principalId:id(value?.principalId,'buyer'),tenantId:id(value?.tenantId,'tenant'),applicationId:id(value?.applicationId,'application')});
/** DRE-24 complete-work adapter over the actual DAE checkout and entitlement APIs.
 * Provider verification, storage and key enrollment are never reimplemented here.
 */
export class WholeWorkCommerce{
 #scope;#coreScope;#checkout;#entitlements;#digest;#resolveWork;#verifyWork;#buyer;#merchant;#approve;#read;#fulfill;#now;#territory;#registry;#registered=new Map();#present;#paymentOrigins;
 constructor({scope,checkout,entitlements,commerceDigest,resolveCompleteWork,verifyCompleteWork,
  resolveBuyer,resolveMerchant,authorizePurchase,authorizeRead,verifyFulfillment,recordingRegistry,presentPendingOrder=null,paymentOrigins=[],territory,now=Date.now}={}){
  this.#scope=Object.freeze({tenantId:id(scope?.tenantId,'tenant'),applicationId:id(scope?.applicationId,'application'),merchantId:id(scope?.merchantId,'merchant')});
  if(!['createCheckout','readOrder','registerProduct','settle'].every(k=>typeof checkout?.[k]==='function')||
   typeof entitlements?.grant!=='function'||typeof recordingRegistry?.reserve!=='function'||typeof recordingRegistry?.get!=='function'||![commerceDigest,resolveCompleteWork,verifyCompleteWork,resolveBuyer,resolveMerchant,
    authorizePurchase,authorizeRead,verifyFulfillment,now].every(fn=>typeof fn==='function')||!/^[A-Z]{2}$/.test(territory))
   throw new TypeError('DAE checkout/entitlement, complete-work, identity and transaction adapters required');
  if((presentPendingOrder!==null&&typeof presentPendingOrder!=='function')||!Array.isArray(paymentOrigins)||paymentOrigins.length>8)throw new TypeError('Approved payment presentation origins required');
  this.#paymentOrigins=Object.freeze(paymentOrigins.map(value=>{try{const u=new URL(value);if(u.protocol!=='https:'||u.origin!==value||u.username||u.password)throw Error();return value;}catch{throw new TypeError('HTTPS payment origin required');}}));
  this.#present=presentPendingOrder;
  this.#coreScope=Object.freeze({tenantId:this.#scope.tenantId,application:'distributed-radio',identityId:this.#scope.merchantId});
  this.#checkout=checkout;this.#entitlements=entitlements;this.#digest=commerceDigest;this.#resolveWork=resolveCompleteWork;
  this.#verifyWork=verifyCompleteWork;this.#buyer=resolveBuyer;this.#merchant=resolveMerchant;this.#approve=authorizePurchase;
  this.#read=authorizeRead;this.#fulfill=verifyFulfillment;this.#registry=recordingRegistry;this.#territory=territory;this.#now=now;
 }
 #time(){const now=this.#now();if(!Number.isSafeInteger(now)||now<0)throw new RangeError('Invalid commerce clock');return now;}
 #identity(input){const actor=identity(input);if(actor.tenantId!==this.#scope.tenantId||actor.applicationId!==this.#scope.applicationId)throw new RangeError('Commerce actor scope mismatch');return actor;}
 async #actor(input){const actor=structuredClone(await this.#buyer(input));
  if(actor?.tenantId!==input.tenantId||actor.application!=='distributed-radio'||actor.identityId!==input.principalId)throw new RangeError('Buyer identity mismatch');return actor;}
 async #manager(){const actor=structuredClone(await this.#merchant(this.#scope));
  if(actor?.tenantId!==this.#coreScope.tenantId||actor.application!==this.#coreScope.application||actor.identityId!==this.#coreScope.identityId)
   throw new RangeError('Merchant identity mismatch');return actor;}
 async #work(productId,version,register=false){
  id(productId,'complete product');if(!Number.isSafeInteger(version)||version<1)throw new RangeError('Product revision required');
  const work=structuredClone(await this.#resolveWork(Object.freeze({...this.#scope,productId,version})));
  if(!work||!['complete-album','complete-show','complete-documentary'].includes(work.kind)||
   !Array.isArray(work.completeAssetIds)||work.completeAssetIds.length<1||work.completeAssetIds.length>512||
   new Set(work.completeAssetIds).size!==work.completeAssetIds.length||work.product?.id!==productId||work.product.revision!==version||
   !Array.isArray(work.product.assets)||work.product.assets.length!==work.completeAssetIds.length||
   new Set(work.product.assets.map(x=>x.assetId)).size!==work.product.assets.length||
   !work.product.assets.every(x=>work.completeAssetIds.includes(x.assetId)))throw new RangeError('Complete work only; partial or standalone items denied');
  id(work.creatorId,'creator');for(const asset of work.completeAssetIds)id(asset,'complete asset');
  if(await this.#verifyWork(structuredClone(work),this.#scope)!==true)throw new RangeError('Complete-work authorization denied');
  const digest=await this.#digest({domain:'DAE-COMPLETE-PRODUCT-v1',scope:this.#coreScope,product:work.product});
  if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))throw new RangeError('Invalid core product digest');
  if(register){
   const manager=await this.#manager(),old=this.#registered.get(productId);
   if(old?.version===version&&old.digest!==digest)throw new RangeError('Immutable product revision changed');
   if(old?.version!==version){
    if(!old&&this.#registered.size>=4096)throw new RangeError('Complete-work cache capacity reached');
    this.#checkout.registerProduct(manager,work.product,this.#time());this.#registered.set(productId,{version,digest});
   }
  }
  const recordings=work.product.assets.filter(asset=>Array.isArray(asset.rightsLayers)&&asset.rightsLayers.some(layer=>['recording','spoken-work'].includes(layer)));
  if(recordings.length<1)throw new RangeError('Complete audio work requires recording assets');
  for(const asset of recordings){
   const record={tenantId:this.#scope.tenantId,applicationId:this.#scope.applicationId,recordingId:asset.assetId,
    creatorId:work.creatorId,entryId:asset.assetId,channel:'paid'};
   if(register)this.#registry.reserve(record);
   else {
    const existing=this.#registry.get(record);
    if(!existing||['creatorId','entryId','channel'].some(k=>existing[k]!==record[k]))throw new RangeError('Immutable paid recording identity mismatch');
   }
  }
  return {work,digest};
 }
 #boundOrder(order,buyerId){
  if(!order||order.scope?.tenantId!==this.#coreScope.tenantId||order.scope?.application!==this.#coreScope.application||
   order.scope?.identityId!==this.#coreScope.identityId||order.buyerId!==buyerId||!['reserved','pending','settled'].includes(order.status))
   throw new RangeError('Checkout response binding mismatch');
 }
 async #receipt(order){
  this.#boundOrder(order,order.buyerId);
  const result={principalId:order.buyerId,tenantId:this.#scope.tenantId,applicationId:this.#scope.applicationId,
   checkoutId:order.checkoutId,productId:order.productId,state:'PENDING',receiptId:null,fulfillmentPending:false,checkoutUrl:null};
  if(order.status!=='settled'){
   if(order.status==='pending'&&this.#present){
    const presentation=await this.#present(structuredClone(order));
    if(presentation!==null){
     let url;try{url=new URL(presentation.url);}catch{throw new RangeError('Invalid payment presentation');}
     if(!this.#paymentOrigins.includes(url.origin)||url.username||url.password||presentation.url.length>4096)throw new RangeError('Unapproved payment presentation');
     result.checkoutUrl=presentation.url;
    }
   }
   return Object.freeze(result);
  }
  const {work,digest}=await this.#work(order.productId,order.productRevision);
  if(digest!==order.productDigestHex||!order.settlementEventId||await this.#fulfill(structuredClone(order),structuredClone(work),this.#time())!==true)
   return Object.freeze({...result,fulfillmentPending:true});
  const manager=await this.#manager();
  // Source-deduplicated grant retries recover a crash after provider settlement.
  const grant=this.#entitlements.grant(manager,{grantId:hash(['DRE-purchase-grant-v1',this.#coreScope,order.checkoutId]),
   subjectId:order.buyerId,resources:work.product.assets.map(asset=>({resourceId:asset.assetId,uses:['download']})),
   source:{kind:'purchase',recordId:order.checkoutId},expiresAtMs:null,
   authorizationEvidenceRef:'sha256:'+hash(['DRE-settled-order-v1',order.scope,order.checkoutId,order.productDigestHex,order.settlementEventId])},this.#time());
  if(grant.subjectId!==order.buyerId||grant.source?.kind!=='purchase'||grant.source?.recordId!==order.checkoutId||
   grant.scope?.tenantId!==this.#coreScope.tenantId||grant.scope?.identityId!==this.#coreScope.identityId||grant.scope?.application!==this.#coreScope.application||
   grant.resources?.length!==work.product.assets.length||!work.product.assets.every(asset=>grant.resources.some(r=>r.resourceId===asset.assetId&&r.uses.length===1&&r.uses[0]==='download')))
   throw new RangeError('Fulfillment grant binding mismatch');
  return Object.freeze({...result,state:grant.revokedAtMs===null?'COMPLETE':'FAILED',receiptId:grant.revokedAtMs===null?grant.grantId:null});
 }
 async startCheckout(input){
  const actor=this.#identity(input),productId=id(input.productId,'productId'),operationId=id(input.operationId,'idempotency key');
  if(operationId.length<20||typeof input.proof!=='string'||!input.proof||input.proof.length>8192||
    !Number.isSafeInteger(input.productRevision)||input.productRevision<1)throw new TypeError('Explicit transaction proof, revision and stable operation ID required');
  const buyer=await this.#actor(actor),checkoutId='checkout:'+hash([this.#scope,actor.principalId,operationId]);
  const previous=this.#checkout.readOrder(buyer,checkoutId,this.#time());
  if(previous){
   this.#boundOrder(previous,actor.principalId);
   if(previous.productId!==productId||previous.productRevision!==input.productRevision)throw new RangeError('Checkout operation conflict');
  }
  const work=previous&&previous.status!=='reserved'?null:(await this.#work(productId,input.productRevision,true)).work;
  const approval=Object.freeze({...actor,productId,productRevision:input.productRevision,operationId,
   amountMinor:previous?.amountMinor??work.product.priceMinor,currency:Object.freeze({...previous?.currency??work.product.currency})});
  if(await this.#approve(approval,input.proof)!==true)throw new RangeError('Purchase transaction not authorized');
  if(previous&&previous.status!=='reserved')return this.#receipt(previous);
  const order=await this.#checkout.createCheckout(buyer,{checkoutId,productId,productRevision:input.productRevision,territory:this.#territory},this.#time());
  this.#boundOrder(order,actor.principalId);return this.#receipt(order);
 }
 async getReceipt(input){
  const actor=this.#identity(input),checkoutId=id(input.checkoutId,'checkoutId');
  if(await this.#read(actor,checkoutId)!==true)throw new RangeError('Receipt read denied');
  const order=this.#checkout.readOrder(await this.#actor(actor),checkoutId,this.#time());
  if(!order)return null;this.#boundOrder(order,actor.principalId);return this.#receipt(order);
 }
 async settle(raw,providerAuthentication){
  // Actual provider raw-webhook verification is mandatory in the bound DAE engine.
  const order=await this.#checkout.settle(raw,providerAuthentication,this.#time());
  this.#boundOrder(order,order.buyerId);return this.#receipt(order);
 }
}
