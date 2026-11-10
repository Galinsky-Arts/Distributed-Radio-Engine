import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,statSync,lstatSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
import {id,assertObject} from './contracts.mjs';
import {eligibleRarityWeights} from './rarity-policy.mjs';
import {transitionOpportunity} from './transition-opportunity.mjs';

/** Shared atomic ownership across Groove/points/paid catalogs at one endpoint.
 * Internal persistence only: caller must authenticate creator rights first.
 * Reservations are permanent identities; withdrawal cannot erase entitlements.
 */
export class RecordingChannelRegistry {
  #db;
  constructor(path,{allowMemory=false}={}) {
    if(path===':memory:') {if(!allowMemory)throw new TypeError('Volatile test registry requires explicit opt-in');}
    else {
      if(typeof path!=='string'||!isAbsolute(path))throw new TypeError('Absolute registry path required');
      const parent=statSync(dirname(path));
      if(!parent.isDirectory()||(parent.mode&0o077)!==0)throw new Error('Private endpoint registry directory required');
      try {const fd=openSync(path,'wx',0o600);closeSync(fd);}catch(error){if(error.code!=='EEXIST')throw error;}
      const file=lstatSync(path);
      if(!file.isFile()||file.isSymbolicLink()||(file.mode&0o077)!==0)throw new Error('Private ordinary registry file required');
    }
    const db=new DatabaseSync(path);
    try {
      db.exec('PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
      db.exec('CREATE TABLE IF NOT EXISTS radio_channel_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL)');
      db.exec('INSERT OR IGNORE INTO radio_channel_schema VALUES(1,1)');
      if(db.prepare('SELECT version FROM radio_channel_schema WHERE id=1').get().version!==1)
        throw new Error('Unsupported recording-channel schema');
      db.exec("CREATE TABLE IF NOT EXISTS radio_recording_channels(tenant_id TEXT NOT NULL,application_id TEXT NOT NULL,recording_id TEXT NOT NULL,creator_id TEXT NOT NULL,channel TEXT NOT NULL CHECK(channel IN ('groove','points','paid')),entry_id TEXT NOT NULL,PRIMARY KEY(tenant_id,application_id,recording_id),UNIQUE(tenant_id,application_id,channel,entry_id)) STRICT");
      db.exec("CREATE TABLE IF NOT EXISTS radio_groove_publications(tenant_id TEXT NOT NULL,application_id TEXT NOT NULL,groove_id TEXT NOT NULL,recording_id TEXT NOT NULL,creator_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),active INTEGER NOT NULL CHECK(active IN (0,1)),PRIMARY KEY(tenant_id,application_id,groove_id)) STRICT");
      db.exec("CREATE TABLE IF NOT EXISTS radio_groove_grants(tenant_id TEXT NOT NULL,application_id TEXT NOT NULL,grant_id TEXT NOT NULL,listener_id TEXT NOT NULL,groove_id TEXT NOT NULL,recording_id TEXT NOT NULL,creator_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),PRIMARY KEY(tenant_id,application_id,grant_id),UNIQUE(tenant_id,application_id,listener_id,groove_id)) STRICT");
      db.exec('CREATE TABLE IF NOT EXISTS radio_groove_stock(tenant_id TEXT NOT NULL,application_id TEXT NOT NULL,groove_id TEXT NOT NULL,capacity INTEGER NOT NULL CHECK(capacity>=0),issued INTEGER NOT NULL CHECK(issued>=0 AND issued<=capacity),PRIMARY KEY(tenant_id,application_id,groove_id)) STRICT');
      db.exec('CREATE TABLE IF NOT EXISTS radio_groove_opportunities(tenant_id TEXT NOT NULL,application_id TEXT NOT NULL,station_id TEXT NOT NULL,listener_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,binding TEXT NOT NULL,result_json TEXT NOT NULL CHECK(json_valid(result_json)),PRIMARY KEY(tenant_id,application_id,station_id,listener_id,opportunity_id)) STRICT');
      db.exec('COMMIT');
    } catch(error){try{db.exec('ROLLBACK');}catch{}db.close();throw error;}
    this.#db=db;
  }
  reserve(input) {
    assertObject(input,'recording channel');
    const record={};
    for(const key of ['tenantId','applicationId','recordingId','creatorId','entryId'])record[key]=id(input[key],key);
    if(!['groove','points','paid'].includes(input.channel))throw new TypeError('Explicit reward/commerce channel required');
    record.channel=input.channel;Object.freeze(record);
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const old=this.get(record);
      if(old) {
        if(['creatorId','channel','entryId'].some(key=>old[key]!==record[key]))
          throw new RangeError('Recording already reserved in another identity or channel');
        this.#db.exec('COMMIT');return Object.freeze({created:false,record:old});
      }
      this.#db.prepare('INSERT INTO radio_recording_channels VALUES(?,?,?,?,?,?)')
        .run(record.tenantId,record.applicationId,record.recordingId,record.creatorId,record.channel,record.entryId);
      this.#db.exec('COMMIT');return Object.freeze({created:true,record});
    } catch(error){try{this.#db.exec('ROLLBACK');}catch{}throw error;}
  }
  get({tenantId,applicationId,recordingId}) {
    for(const value of [tenantId,applicationId,recordingId])id(value,'recording scope');
    const row=this.#db.prepare('SELECT * FROM radio_recording_channels WHERE tenant_id=? AND application_id=? AND recording_id=?')
      .get(tenantId,applicationId,recordingId);
    return row?Object.freeze({tenantId:row.tenant_id,applicationId:row.application_id,recordingId:row.recording_id,
      creatorId:row.creator_id,channel:row.channel,entryId:row.entry_id}):null;
  }
  getGroove({tenantId,applicationId,grooveId}) {
    for(const value of [tenantId,applicationId,grooveId])id(value,'Groove scope');
    const row=this.#db.prepare('SELECT * FROM radio_groove_publications WHERE tenant_id=? AND application_id=? AND groove_id=?')
      .get(tenantId,applicationId,grooveId);
    return row?Object.freeze({tenantId:row.tenant_id,applicationId:row.application_id,
      grooveId:row.groove_id,recordingId:row.recording_id,creatorId:row.creator_id,
      revision:row.revision,active:row.active===1,channel:'groove',exclusive:true}):null;
  }
  publishGroove({tenantId,applicationId,grooveId,recordingId,creatorId}) {
    for(const value of [tenantId,applicationId,grooveId,recordingId,creatorId])id(value,'Groove identity');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const reserved=this.get({tenantId,applicationId,recordingId});
      if(reserved&&(reserved.channel!=='groove'||reserved.entryId!==grooveId||reserved.creatorId!==creatorId))
        throw new RangeError('Recording already reserved in another identity or channel');
      if(!reserved)this.#db.prepare('INSERT INTO radio_recording_channels VALUES(?,?,?,?,?,?)')
        .run(tenantId,applicationId,recordingId,creatorId,'groove',grooveId);
      const old=this.getGroove({tenantId,applicationId,grooveId});
      if(old&&(old.recordingId!==recordingId||old.creatorId!==creatorId))
        throw new RangeError('Cannot reassign permanent Groove identity');
      if(!old) this.#db.prepare('INSERT INTO radio_groove_publications VALUES(?,?,?,?,?,1,1)')
        .run(tenantId,applicationId,grooveId,recordingId,creatorId);
      else if(!old.active) this.#db.prepare('UPDATE radio_groove_publications SET revision=revision+1,active=1 WHERE tenant_id=? AND application_id=? AND groove_id=?')
        .run(tenantId,applicationId,grooveId);
      const published=this.getGroove({tenantId,applicationId,grooveId});
      this.#db.exec('COMMIT');return published;
    } catch(error) {try{this.#db.exec('ROLLBACK');}catch{}throw error;}
  }
  withdrawGroove({tenantId,applicationId,grooveId,creatorId,expectedRevision}) {
    for(const value of [tenantId,applicationId,grooveId,creatorId])id(value,'Groove withdrawal');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const old=this.getGroove({tenantId,applicationId,grooveId});
      if(old&&(old.creatorId!==creatorId||old.revision!==expectedRevision))throw new RangeError('Stale authorized Groove revision');
      if(old?.active)this.#db.prepare('UPDATE radio_groove_publications SET revision=revision+1,active=0 WHERE tenant_id=? AND application_id=? AND groove_id=?')
        .run(tenantId,applicationId,grooveId);
      this.#db.exec('COMMIT');return !!old?.active;
    } catch(error) {try{this.#db.exec('ROLLBACK');}catch{}throw error;}
  }
  /** Atomic, immutable entitlement snapshot. Caller verifies the issuer beforehand. */
  grantGroove(input) {return this.#grantGroove(input);}
  #grantGroove({tenantId,applicationId,grooveId,listenerId,grantId,recordingId,creatorId,revision},withinTransaction=false) {
    for(const value of [tenantId,applicationId,grooveId,listenerId,grantId,recordingId,creatorId])id(value,'Groove grant identity');
    if(!Number.isSafeInteger(revision)||revision<1)throw new RangeError('Expected publication revision required');
    if(!withinTransaction)this.#db.exec('BEGIN IMMEDIATE');
    try {
      const current=this.getGroove({tenantId,applicationId,grooveId});
      const old=this.#db.prepare('SELECT * FROM radio_groove_grants WHERE tenant_id=? AND application_id=? AND grant_id=?')
        .get(tenantId,applicationId,grantId);
      if(old) {
        if(old.listener_id!==listenerId||old.groove_id!==grooveId)throw new RangeError('Conflicting authenticated grant replay');
        if(!current||old.recording_id!==current.recordingId||
            old.creator_id!==current.creatorId||old.revision>current.revision)
          throw new RangeError('Corrupt immutable entitlement binding');
        if(!withinTransaction)this.#db.exec('COMMIT');
        return Object.freeze({tenantId,applicationId,grantId,listenerId,grooveId,
          recordingId:old.recording_id,creatorId:old.creator_id,revision:old.revision});
      }
      if(!current?.active)throw new RangeError('Active authorized Groove required');
      if(current.revision!==revision||current.recordingId!==recordingId||current.creatorId!==creatorId)
        throw new RangeError('Stale authorized Groove grant revision');
      const existing=this.#db.prepare('SELECT grant_id FROM radio_groove_grants WHERE tenant_id=? AND application_id=? AND listener_id=? AND groove_id=?')
        .get(tenantId,applicationId,listenerId,grooveId);
      if(existing)throw new RangeError('Listener entitlement already issued under another grant');
      const budget=this.#db.prepare('SELECT capacity,issued FROM radio_groove_stock WHERE tenant_id=? AND application_id=? AND groove_id=?').get(tenantId,applicationId,grooveId);
      if(budget) {
        if(budget.issued>=budget.capacity)throw new RangeError('Groove stock exhausted');
        this.#db.prepare('UPDATE radio_groove_stock SET issued=issued+1 WHERE tenant_id=? AND application_id=? AND groove_id=?').run(tenantId,applicationId,grooveId);
      }
      this.#db.prepare('INSERT INTO radio_groove_grants VALUES(?,?,?,?,?,?,?,?)')
        .run(tenantId,applicationId,grantId,listenerId,grooveId,current.recordingId,current.creatorId,current.revision);
      if(!withinTransaction)this.#db.exec('COMMIT');
      return Object.freeze({tenantId,applicationId,grantId,listenerId,grooveId,
        recordingId:current.recordingId,creatorId:current.creatorId,revision:current.revision});
    } catch(error) {if(!withinTransaction){try{this.#db.exec('ROLLBACK');}catch{}}throw error;}
  }
  readGrooveEntitlements({tenantId,applicationId,listenerId,limit=100,afterGrantId=null}) {
    for(const value of [tenantId,applicationId,listenerId])id(value,'Entitlement scope');
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new RangeError('Entitlement page limit exceeded');
    if(afterGrantId!==null)id(afterGrantId,'entitlement cursor');
    return Object.freeze(this.#db.prepare('SELECT grant_id,groove_id,recording_id,creator_id,revision FROM radio_groove_grants WHERE tenant_id=? AND application_id=? AND listener_id=? AND grant_id>? ORDER BY grant_id LIMIT ?')
      .all(tenantId,applicationId,listenerId,afterGrantId??'',limit).map(row=>{
        const catalog=this.getGroove({tenantId,applicationId,grooveId:row.groove_id});
        if(!catalog||catalog.recordingId!==row.recording_id||
            catalog.creatorId!==row.creator_id||row.revision>catalog.revision)
          throw new RangeError('Corrupt immutable entitlement binding');
        return Object.freeze({grantId:row.grant_id,grooveId:row.groove_id,
          recordingId:row.recording_id,creatorId:row.creator_id,revision:row.revision});
      }));
  }
  configureGrooveStock({tenantId,applicationId,grooveId,creatorId,capacity},authorize) {
    for(const value of [tenantId,applicationId,grooveId,creatorId])id(value,'Groove stock scope');
    if(!Number.isSafeInteger(capacity)||capacity<0||capacity>1000000||typeof authorize!=='function')throw new RangeError('Invalid Groove stock budget');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const current=this.getGroove({tenantId,applicationId,grooveId});
      if(!current?.active||current.creatorId!==creatorId||authorize(current)!==true)throw new RangeError('Groove stock authorization denied');
      const issued=this.#db.prepare('SELECT COUNT(*) AS count FROM radio_groove_grants WHERE tenant_id=? AND application_id=? AND groove_id=?').get(tenantId,applicationId,grooveId).count;
      if(capacity<issued)throw new RangeError('Groove capacity below issued entitlements');
      this.#db.prepare('INSERT INTO radio_groove_stock VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,application_id,groove_id) DO UPDATE SET capacity=excluded.capacity,issued=excluded.issued').run(tenantId,applicationId,grooveId,capacity,issued);
      this.#db.exec('COMMIT');return Object.freeze({capacity,issued,remaining:capacity-issued});
    }catch(error){try{this.#db.exec('ROLLBACK');}catch{}throw error;}
  }
  /** Atomic creator endpoint configuration; public relays cannot call this authority. */
  publishGrooveConfiguration(input,authorize) {
    const scope={};for(const key of ['tenantId','applicationId','creatorId','stationId','operationId'])scope[key]=id(input?.[key],key);
    if(scope.operationId.length<20||typeof authorize!=='function'||!Number.isSafeInteger(input.version)||input.version<1||
      input.expectedPreviousVersion!==input.version-1||!Array.isArray(input.recordings)||input.recordings.length<1||input.recordings.length>32||
      !Number.isSafeInteger(input.rarityBase)||input.rarityBase<2||input.rarityBase>100)throw new RangeError('Invalid versioned Groove configuration');
    const recordings=input.recordings.map(item=>{
      if(!item||Object.keys(item).sort().join(',')!=='channel,exclusive,grooveId,minimumCompletions,recordingId,stock'||item.channel!=='groove'||item.exclusive!==true||
        !Number.isSafeInteger(item.stock)||item.stock<0||item.stock>1000000||!Number.isSafeInteger(item.minimumCompletions)||item.minimumCompletions<0)
        throw new RangeError('Separate bounded Groove catalog required');
      return {grooveId:id(item.grooveId,'groove'),recordingId:id(item.recordingId,'recording'),minimumCompletions:item.minimumCompletions,stock:item.stock,exclusive:true,channel:'groove'};
    });
    if(new Set(recordings.map(x=>x.grooveId)).size!==recordings.length||new Set(recordings.map(x=>x.recordingId)).size!==recordings.length)throw new RangeError('Duplicate bonus recording identity');
    eligibleRarityWeights({minimumCompletions:recordings.map(x=>x.minimumCompletions),completed:Number.MAX_SAFE_INTEGER,base:BigInt(input.rarityBase)});
    transitionOpportunity({stationId:scope.stationId,programVersion:input.version,completedItems:0,everyMin:input.everyMin,everyMax:input.everyMax,sequence:0});
    const command=Object.freeze({...scope,version:input.version,everyMin:input.everyMin,everyMax:input.everyMax,rarityBase:input.rarityBase,
      recordings:Object.freeze(recordings.map(Object.freeze))}),binding=JSON.stringify(command);
    const allow=()=>{try{const result=authorize(command);if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});return false;}return result===true;}catch{return false;}};
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.exec('CREATE TABLE IF NOT EXISTS radio_groove_configs(tenant_id TEXT NOT NULL,application_id TEXT NOT NULL,station_id TEXT NOT NULL,creator_id TEXT NOT NULL,version INTEGER NOT NULL,configuration TEXT NOT NULL,PRIMARY KEY(tenant_id,application_id,station_id)) STRICT');
      this.#db.exec('CREATE TABLE IF NOT EXISTS radio_groove_config_operations(tenant_id TEXT NOT NULL,application_id TEXT NOT NULL,creator_id TEXT NOT NULL,operation_id TEXT NOT NULL,binding TEXT NOT NULL,PRIMARY KEY(tenant_id,application_id,creator_id,operation_id)) STRICT');
      if(!allow())throw new RangeError('Groove configuration authorization denied');
      const previous=this.#db.prepare('SELECT binding FROM radio_groove_config_operations WHERE tenant_id=? AND application_id=? AND creator_id=? AND operation_id=?').get(scope.tenantId,scope.applicationId,scope.creatorId,scope.operationId);
      if(previous){if(previous.binding!==binding)throw new RangeError('Groove configuration operation conflict');this.#db.exec('COMMIT');return Object.freeze({...scope,version:input.version,committed:true});}
      const old=this.#db.prepare('SELECT creator_id,version FROM radio_groove_configs WHERE tenant_id=? AND application_id=? AND station_id=?').get(scope.tenantId,scope.applicationId,scope.stationId);
      if((old?.version??0)!==input.expectedPreviousVersion||(old&&old.creator_id!==scope.creatorId))throw new RangeError('Stale Groove configuration version or creator');
      for(const item of recordings){
        const reserved=this.get({...scope,recordingId:item.recordingId});
        if(reserved&&(reserved.channel!=='groove'||reserved.entryId!==item.grooveId||reserved.creatorId!==scope.creatorId))throw new RangeError('Recording channel conflict');
        const current=this.getGroove({...scope,grooveId:item.grooveId});
        if(current&&(current.recordingId!==item.recordingId||current.creatorId!==scope.creatorId))throw new RangeError('Immutable Groove identity conflict');
        const issued=this.#db.prepare('SELECT COUNT(*) AS n FROM radio_groove_grants WHERE tenant_id=? AND application_id=? AND groove_id=?').get(scope.tenantId,scope.applicationId,item.grooveId).n;
        if(item.stock<issued)throw new RangeError('Stock below issued entitlements');
        if(!reserved)this.#db.prepare('INSERT INTO radio_recording_channels VALUES(?,?,?,?,?,?)').run(scope.tenantId,scope.applicationId,item.recordingId,scope.creatorId,'groove',item.grooveId);
        if(!current)this.#db.prepare('INSERT INTO radio_groove_publications VALUES(?,?,?,?,?,1,1)').run(scope.tenantId,scope.applicationId,item.grooveId,item.recordingId,scope.creatorId);
        else if(!current.active)this.#db.prepare('UPDATE radio_groove_publications SET revision=revision+1,active=1 WHERE tenant_id=? AND application_id=? AND groove_id=?').run(scope.tenantId,scope.applicationId,item.grooveId);
        this.#db.prepare('INSERT INTO radio_groove_stock VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,application_id,groove_id) DO UPDATE SET capacity=excluded.capacity,issued=excluded.issued').run(scope.tenantId,scope.applicationId,item.grooveId,item.stock,issued);
      }
      if(!allow())throw new RangeError('Groove configuration authorization revoked');
      this.#db.prepare('INSERT INTO radio_groove_configs VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,application_id,station_id) DO UPDATE SET version=excluded.version,configuration=excluded.configuration').run(scope.tenantId,scope.applicationId,scope.stationId,scope.creatorId,input.version,binding);
      this.#db.prepare('INSERT INTO radio_groove_config_operations VALUES(?,?,?,?,?)').run(scope.tenantId,scope.applicationId,scope.creatorId,scope.operationId,binding);
      this.#db.exec('COMMIT');return Object.freeze({...scope,version:input.version,committed:true});
    }catch(error){if(this.#db.isTransaction)this.#db.exec('ROLLBACK');throw error;}
  }
  readGrooveConfiguration({tenantId,applicationId,stationId}) {
    for(const value of [tenantId,applicationId,stationId])id(value,'configuration scope');
    if(!this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='radio_groove_configs'").get())return null;
    const row=this.#db.prepare('SELECT configuration FROM radio_groove_configs WHERE tenant_id=? AND application_id=? AND station_id=?').get(tenantId,applicationId,stationId);
    return row?Object.freeze(JSON.parse(row.configuration)):null;
  }
  readGrooveOpportunity({tenantId,applicationId,stationId,listenerId,opportunityId}) {
    const params=[tenantId,applicationId,stationId,listenerId,opportunityId];for(const value of params)id(value,'opportunity scope');
    const row=this.#db.prepare('SELECT binding,result_json FROM radio_groove_opportunities WHERE tenant_id=? AND application_id=? AND station_id=? AND listener_id=? AND opportunity_id=?').get(...params);
    return row?Object.freeze({binding:row.binding,result:Object.freeze(JSON.parse(row.result_json))}):null;
  }
  /** Outcome tombstone, stock and entitlement are one transaction. No reroll. */
  claimGrooveOpportunity(input,authorize) {
    const {tenantId,applicationId,stationId,listenerId,opportunityId,binding,grooveId,grantId,creatorId,audit}=input;
    for(const value of [tenantId,applicationId,stationId,listenerId,opportunityId,grooveId,grantId,creatorId])id(value,'opportunity identity');
    if(typeof binding!=='string'||!/^sha256:[a-f0-9]{64}$/.test(binding)||typeof authorize!=='function')throw new TypeError('Bounded immutable opportunity binding required');
    if(!audit||!Number.isSafeInteger(audit.tier)||audit.tier<0||audit.tier>127||
      !Number.isSafeInteger(audit.policyVersion)||audit.policyVersion<1||!Number.isSafeInteger(audit.atMs)||audit.atMs<0||
      !['seedCommitment','weightsCommitment','contextCommitment'].every(k=>typeof audit[k]==='string'&&/^[a-f0-9]{64}$/.test(audit[k])))
      throw new TypeError('Bounded grant audit projection required');
    const safeAudit=Object.fromEntries(['tier','policyVersion','atMs','seedCommitment','weightsCommitment','contextCommitment'].map(k=>[k,audit[k]]));
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const old=this.readGrooveOpportunity(input);
      if(old) {
        if(old.binding!==binding)throw new RangeError('Conflicting opportunity replay');
        this.#db.exec('COMMIT');return old.result;
      }
      const current=this.getGroove({tenantId,applicationId,grooveId});
      if(!current?.active||current.creatorId!==creatorId||authorize(current)!==true)throw new RangeError('Groove grant authorization denied');
      const owned=this.#db.prepare('SELECT grant_id FROM radio_groove_grants WHERE tenant_id=? AND application_id=? AND listener_id=? AND groove_id=?').get(tenantId,applicationId,listenerId,grooveId);
      const budget=this.#db.prepare('SELECT capacity,issued FROM radio_groove_stock WHERE tenant_id=? AND application_id=? AND groove_id=?').get(tenantId,applicationId,grooveId);
      let grant=null,state;
      if(owned)state='already-owned';
      else if(!budget||budget.issued>=budget.capacity)state='stock-exhausted';
      else {
        grant=this.#grantGroove({tenantId,applicationId,grooveId,listenerId,grantId,
          recordingId:current.recordingId,creatorId,revision:current.revision},true);
        state='granted';
      }
      const result=Object.freeze({opportunityId,stationId,listenerId,creatorId,grooveId,state,grant,...safeAudit});
      this.#db.prepare('INSERT INTO radio_groove_opportunities VALUES(?,?,?,?,?,?,?)').run(tenantId,applicationId,stationId,listenerId,opportunityId,binding,JSON.stringify(result));
      this.#db.exec('COMMIT');return result;
    }catch(error){try{this.#db.exec('ROLLBACK');}catch{}throw error;}
  }
  readGrooveGrant({tenantId,applicationId,listenerId,grantId}) {
    for(const value of [tenantId,applicationId,listenerId,grantId])id(value,'grant scope');
    const row=this.#db.prepare('SELECT * FROM radio_groove_grants WHERE tenant_id=? AND application_id=? AND listener_id=? AND grant_id=?').get(tenantId,applicationId,listenerId,grantId);
    return row?Object.freeze({tenantId,applicationId,listenerId,grantId,grooveId:row.groove_id,
      recordingId:row.recording_id,creatorId:row.creator_id,revision:row.revision}):null;
  }
  close(){this.#db.close();}
}
