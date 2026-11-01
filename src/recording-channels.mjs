import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,statSync,lstatSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
import {id,assertObject} from './contracts.mjs';

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
  grantGroove({tenantId,applicationId,grooveId,listenerId,grantId,recordingId,creatorId,revision}) {
    for(const value of [tenantId,applicationId,grooveId,listenerId,grantId,recordingId,creatorId])id(value,'Groove grant identity');
    if(!Number.isSafeInteger(revision)||revision<1)throw new RangeError('Expected publication revision required');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const current=this.getGroove({tenantId,applicationId,grooveId});
      const old=this.#db.prepare('SELECT * FROM radio_groove_grants WHERE tenant_id=? AND application_id=? AND grant_id=?')
        .get(tenantId,applicationId,grantId);
      if(old) {
        if(old.listener_id!==listenerId||old.groove_id!==grooveId)throw new RangeError('Conflicting authenticated grant replay');
        if(!current||old.recording_id!==current.recordingId||
            old.creator_id!==current.creatorId||old.revision>current.revision)
          throw new RangeError('Corrupt immutable entitlement binding');
        this.#db.exec('COMMIT');
        return Object.freeze({tenantId,applicationId,grantId,listenerId,grooveId,
          recordingId:old.recording_id,creatorId:old.creator_id,revision:old.revision});
      }
      if(!current?.active)throw new RangeError('Active authorized Groove required');
      if(current.revision!==revision||current.recordingId!==recordingId||current.creatorId!==creatorId)
        throw new RangeError('Stale authorized Groove grant revision');
      const existing=this.#db.prepare('SELECT grant_id FROM radio_groove_grants WHERE tenant_id=? AND application_id=? AND listener_id=? AND groove_id=?')
        .get(tenantId,applicationId,listenerId,grooveId);
      if(existing)throw new RangeError('Listener entitlement already issued under another grant');
      this.#db.prepare('INSERT INTO radio_groove_grants VALUES(?,?,?,?,?,?,?,?)')
        .run(tenantId,applicationId,grantId,listenerId,grooveId,current.recordingId,current.creatorId,current.revision);
      this.#db.exec('COMMIT');
      return Object.freeze({tenantId,applicationId,grantId,listenerId,grooveId,
        recordingId:current.recordingId,creatorId:current.creatorId,revision:current.revision});
    } catch(error) {try{this.#db.exec('ROLLBACK');}catch{}throw error;}
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
  close(){this.#db.close();}
}
