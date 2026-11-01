/** DRE-19 separate bonus-recording catalog, not points or paid commerce. */
export class GrooveCatalog {
  #registry; #scope; #authorize; #authorizeGrant; #authorizeRead;
  constructor({registry,scope,authorizeCatalog,authorizeGrant,authorizeRead}={}) {
    if(typeof registry?.reserve!=='function'||typeof registry?.getGroove!=='function'||typeof registry?.publishGroove!=='function'||typeof registry?.withdrawGroove!=='function'||!scope||![scope.tenantId,scope.applicationId,scope.principalId].every(x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x))||typeof authorizeCatalog!=='function')
      throw new TypeError('Shared channel registry, scope and creator authorizer required');
    this.#registry=registry;this.#scope=Object.freeze({tenantId:scope.tenantId,applicationId:scope.applicationId,principalId:scope.principalId});this.#authorize=authorizeCatalog;this.#authorizeGrant=authorizeGrant;this.#authorizeRead=authorizeRead;
  }
  put({grooveId,recordingId,creatorId,exclusive,channel='groove'}) {
    for(const id of [grooveId,recordingId,creatorId]) if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new TypeError('Stable identifiers required');
    if(channel!=='groove'||exclusive!==true) throw new TypeError('Grooves require app-exclusive bonus channel');
    const original=this.#registry.getGroove({...this.#scope,grooveId});
    if(original && (original.recordingId!==recordingId || original.creatorId!==creatorId))
      throw new Error('Cannot reassign existing groove identity');
    const item=Object.freeze({grooveId,recordingId,creatorId,channel:'groove',exclusive:true});
    let result;
    try {result=this.#authorize(Object.freeze({action:'publish',...item}),this.#scope);}
    catch {throw new TypeError('Creator catalog authorization denied');}
    if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw new TypeError('Synchronous creator authorization required');}
    if(result!==true)throw new TypeError('Creator catalog authorization denied');
    this.#registry.reserve({tenantId:this.#scope.tenantId,applicationId:this.#scope.applicationId,recordingId,creatorId,entryId:grooveId,channel:'groove'});
    return this.#registry.publishGroove({...this.#scope,grooveId,recordingId,creatorId});
  }
  grant({grooveId,listenerId,grantId,proof}={}) {
    for(const value of [grooveId,listenerId,grantId])
      if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value))
        throw new TypeError('Stable grant identifiers required');
    if(typeof proof!=='string'||!proof.length||proof.length>8192)
      throw new TypeError('Bounded issuer proof required');
    if(typeof this.#authorizeGrant!=='function')throw new TypeError('Authenticated Groove grant issuer required');
    const item=this.#registry.getGroove({...this.#scope,grooveId});
    if(!item?.active)throw new RangeError('Active authorized Groove required');
    const request=Object.freeze({action:'grant',grooveId,listenerId,grantId,
      recordingId:item.recordingId,creatorId:item.creatorId,revision:item.revision,proof});
    let authorized;
    try {authorized=this.#authorizeGrant(request,this.#scope);}
    catch {throw new TypeError('Groove grant authorization denied');}
    if(authorized&&typeof authorized.then==='function'){
      Promise.resolve(authorized).catch(()=>{});throw new TypeError('Synchronous issuer authorization required');
    }
    if(authorized!==true)throw new TypeError('Groove grant authorization denied');
    return this.#registry.grantGroove({...this.#scope,grooveId,listenerId,grantId});
  }
  remove(grooveId){
    const item=this.#registry.getGroove({...this.#scope,grooveId});
    if(!item?.active)return false;
    let result;
    try {result=this.#authorize(Object.freeze({action:'withdraw',...item}),this.#scope);}
    catch {throw new TypeError('Creator withdrawal authorization denied');}
    if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw new TypeError('Synchronous creator authorization required');}
    if(result!==true)throw new TypeError('Creator withdrawal authorization denied');
    return this.#registry.withdrawGroove({...this.#scope,grooveId,creatorId:item.creatorId});
  }
  entitlements(listenerId,{proof}={}) {
    if(typeof listenerId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(listenerId))
      throw new TypeError('Stable listener identity required');
    if(typeof proof!=='string'||!proof.length||proof.length>8192)
      throw new TypeError('Bounded entitlement authorization required');
    if(typeof this.#authorizeRead!=='function')throw new TypeError('Authenticated entitlement reader required');
    const request=Object.freeze({action:'entitlements',listenerId,proof});
    let authorized;
    try {authorized=this.#authorizeRead(request,this.#scope);}
    catch {throw new TypeError('Entitlement read authorization denied');}
    if(authorized&&typeof authorized.then==='function'){
      Promise.resolve(authorized).catch(()=>{});throw new TypeError('Synchronous entitlement authorization required');
    }
    if(authorized!==true)throw new TypeError('Entitlement read authorization denied');
    return this.#registry.readGrooveEntitlements({...this.#scope,listenerId});
  }
}

