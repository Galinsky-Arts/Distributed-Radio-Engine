import {DatabaseSync} from 'node:sqlite';
import {statSync,lstatSync,openSync,closeSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
import {assertObject,id} from './contracts.mjs';

const SCOPE=['tenantId','applicationId','stationId','listenerId'];
const ERR='Authenticated listener completion denied';
function decision(verify,record,scope) {
  try {
    const result=verify(record,scope);
    if(result&&typeof result.then==='function') {
      Promise.resolve(result).catch(()=>{});
      return false;
    }
    return result===true;
  } catch {return false;}
}
/**
 * DRE-22 durable, scope-bound completed-listen history.
 * Trust originates only in an injected approved playback/identity verifier.
 * The SQLite store cannot determine whether physical audio actually played.
 */
export class DurableListenerCompletion {
  #db;#scope;#verify;#read;
  constructor(path,{scope,verifyCompletion,authorizeRead,allowMemory=false}={}) {
    assertObject(scope,'listener scope');
    this.#scope=Object.freeze(Object.fromEntries(SCOPE.map(k=>[k,id(scope[k],k)])));
    if(typeof verifyCompletion!=='function'||typeof authorizeRead!=='function')
      throw new TypeError('Trusted listener completion and history authorizers required');
    if(path===':memory:') {
      if(!allowMemory)throw new TypeError('Volatile completion history requires test opt-in');
    } else {
      if(typeof path!=='string'||!isAbsolute(path))
        throw new TypeError('Private absolute listener-history path required');
      const parent=statSync(dirname(path));
      if(!parent.isDirectory()||(parent.mode&0o077)!==0)
        throw new TypeError('Private listener-history directory required');
      try {const fd=openSync(path,'wx',0o600);closeSync(fd);}
      catch(error){if(error.code!=='EEXIST')throw error;}
      const file=lstatSync(path);
      if(!file.isFile()||file.isSymbolicLink()||(file.mode&0o077)!==0)
        throw new TypeError('Private ordinary listener-history file required');
    }
    const db=new DatabaseSync(path);
    try {
      db.exec('PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
      db.exec('CREATE TABLE IF NOT EXISTS radio_listener_history_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL)');
      db.exec('INSERT OR IGNORE INTO radio_listener_history_schema VALUES(1,1)');
      if(db.prepare('SELECT version FROM radio_listener_history_schema WHERE id=1').get().version!==1)
        throw new TypeError('Unsupported listener-history schema');
      db.exec("CREATE TABLE IF NOT EXISTS radio_listener_completions(tenant_id TEXT NOT NULL,application_id TEXT NOT NULL,station_id TEXT NOT NULL,listener_id TEXT NOT NULL,creator_id TEXT NOT NULL,occurrence_id TEXT NOT NULL,program_digest TEXT NOT NULL,route TEXT NOT NULL CHECK(route IN ('speaker','headphones')),started_ms INTEGER NOT NULL,completed_ms INTEGER NOT NULL,required_start_ms INTEGER NOT NULL,required_end_ms INTEGER NOT NULL,PRIMARY KEY(tenant_id,application_id,listener_id,creator_id,occurrence_id)) STRICT");
      db.exec('COMMIT');
    } catch(error){try{db.exec('ROLLBACK');}catch{}db.close();throw error;}
    this.#db=db;this.#verify=verifyCompletion;this.#read=authorizeRead;
  }
  complete(input) {
    assertObject(input,'completed listener playback');
    const record={};
    for(const k of [...SCOPE,'creatorId','occurrenceId','programDigest'])record[k]=id(input[k],k);
    if(SCOPE.some(k=>record[k]!==this.#scope[k]))throw new RangeError('Listener completion scope mismatch');
    if(!['speaker','headphones'].includes(input.route)||input.foreground!==true||
       input.unmuted!==true||typeof input.proof!=='string'||!input.proof.length||
       input.proof.length>8192)throw new RangeError('Qualifying authenticated playback evidence required');
    for(const k of ['startedAtMs','completedAtMs','requiredStartMs','requiredEndMs']) {
      if(!Number.isSafeInteger(input[k])||input[k]<0)throw new RangeError('Invalid completion interval');
      record[k]=input[k];
    }
    if(record.requiredEndMs<=record.requiredStartMs||
       record.startedAtMs>record.requiredStartMs||
       record.completedAtMs<record.requiredEndMs||
       record.completedAtMs<record.startedAtMs)
      throw new RangeError('Full uninterrupted listening completion required');
    record.route=input.route;record.foreground=true;record.unmuted=true;record.proof=input.proof;
    Object.freeze(record);
    if(!decision(this.#verify,record,this.#scope))throw new RangeError(ERR);
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const params=[record.tenantId,record.applicationId,record.listenerId,record.creatorId,record.occurrenceId];
      const old=this.#db.prepare('SELECT * FROM radio_listener_completions WHERE tenant_id=? AND application_id=? AND listener_id=? AND creator_id=? AND occurrence_id=?').get(...params);
      if(old) {
        if(old.station_id!==record.stationId||old.program_digest!==record.programDigest||
           old.route!==record.route||old.started_ms!==record.startedAtMs||
           old.completed_ms!==record.completedAtMs||old.required_start_ms!==record.requiredStartMs||
           old.required_end_ms!==record.requiredEndMs)
          throw new RangeError('Conflicting authenticated completion replay');
        this.#db.exec('COMMIT');
        return Object.freeze({completed:true,replayed:true,creatorId:record.creatorId,
          occurrenceId:record.occurrenceId,grooveEligible:true,speakerPointsEarned:0n});
      }
      this.#db.prepare('INSERT INTO radio_listener_completions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(
        record.tenantId,record.applicationId,record.stationId,record.listenerId,
        record.creatorId,record.occurrenceId,record.programDigest,record.route,
        record.startedAtMs,record.completedAtMs,record.requiredStartMs,record.requiredEndMs);
      this.#db.exec('COMMIT');
      return Object.freeze({completed:true,replayed:false,creatorId:record.creatorId,
        occurrenceId:record.occurrenceId,grooveEligible:true,speakerPointsEarned:0n});
    } catch(error){try{this.#db.exec('ROLLBACK');}catch{}throw error;}
  }
  history({creatorId,proof,limit=100,afterOccurrenceId=null}={}) {
    id(creatorId,'creatorId');
    if(typeof proof!=='string'||!proof.length||proof.length>8192||
       !Number.isSafeInteger(limit)||limit<1||limit>100||
       (afterOccurrenceId!==null&&(typeof afterOccurrenceId!=='string'||!afterOccurrenceId.length)))
      throw new RangeError('Bounded authenticated completion history query required');
    const query=Object.freeze({creatorId,proof,limit,afterOccurrenceId});
    if(!decision(this.#read,query,this.#scope))throw new RangeError(ERR);
    const rows=this.#db.prepare('SELECT occurrence_id,program_digest,route,completed_ms FROM radio_listener_completions WHERE tenant_id=? AND application_id=? AND listener_id=? AND creator_id=? AND occurrence_id>? ORDER BY occurrence_id LIMIT ?')
      .all(this.#scope.tenantId,this.#scope.applicationId,this.#scope.listenerId,creatorId,afterOccurrenceId??'',limit);
    return Object.freeze(rows.map(r=>Object.freeze({creatorId,occurrenceId:r.occurrence_id,
      programDigest:r.program_digest,route:r.route,completedAtMs:r.completed_ms})));
  }
  lifetimeCount({creatorId,proof}={}) {
    id(creatorId,'creatorId');
    if(typeof proof!=='string'||!proof.length||proof.length>8192)
      throw new RangeError('Authenticated completion count required');
    if(!decision(this.#read,Object.freeze({creatorId,proof,kind:'count'}),this.#scope))
      throw new RangeError(ERR);
    const row=this.#db.prepare('SELECT COUNT(*) AS count FROM radio_listener_completions WHERE tenant_id=? AND application_id=? AND listener_id=? AND creator_id=?')
      .get(this.#scope.tenantId,this.#scope.applicationId,this.#scope.listenerId,creatorId);
    return row.count;
  }
  close(){this.#db.close();}
}
