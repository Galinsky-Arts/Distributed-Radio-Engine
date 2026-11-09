import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,lstatSync,statSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
import {id} from './contracts.mjs';
import {vestingKey} from './vesting.mjs';

const encode=record=>JSON.stringify({...record,points:record.points.toString()});
function decode(value) {
  const record=JSON.parse(value);
  const ids=['tenantId','applicationId','principalId','stationId','occurrenceId','creatorId','programDigest','contentRef','outroRef'];
  const times=['startedAtMs','completedAtMs','requiredStartMs','contentEndMs','outroEndMs'];
  const fields=[...ids,...times,'policyVersion','unit','decision','points','walletSettlement'];
  if(!record||Object.keys(record).length!==fields.length||fields.some(key=>!Object.hasOwn(record,key)))
    throw new Error('Corrupt vesting receipt');
  for(const key of ids)id(record[key],key);
  if(times.some(key=>!Number.isSafeInteger(record[key])||record[key]<0)||
      !Number.isSafeInteger(record.policyVersion)||record.policyVersion<1||record.unit!=='micro-reference-seconds')
    throw new Error('Corrupt vesting receipt');
  if(typeof record.points!=='string'||!/^\d{1,37}$/.test(record.points)||
      !['vested','forfeited'].includes(record.decision))
    throw new Error('Corrupt vesting receipt');
  if(BigInt(record.points)>10n**36n||
      (record.decision==='forfeited'&&(record.points!=='0'||record.walletSettlement!=='not-applicable'))||
      (record.decision==='vested'&&record.walletSettlement!=='pending'))
    throw new Error('Corrupt vesting receipt');
  return Object.freeze({...record,points:BigInt(record.points)});
}

/** Node endpoint persistence only. No proof, media/key, wallet or network I/O. */
export class SqliteVestingStore {
  #db;
  constructor(path,{allowMemory=false,busyTimeoutMs=1000}={}) {
    if(!Number.isSafeInteger(busyTimeoutMs)||busyTimeoutMs<1||busyTimeoutMs>10000)
      throw new RangeError('Invalid SQLite contention bound');
    if(path===':memory:') {
      if(!allowMemory)throw new TypeError('Volatile test store requires explicit opt-in');
    } else {
      if(typeof path!=='string'||!isAbsolute(path))throw new TypeError('Explicit absolute receipt path required');
      const parent=statSync(dirname(path));
      if(!parent.isDirectory()||(parent.mode&0o077)!==0)
        throw new Error('Receipt directory must be private to its endpoint owner');
      try {const fd=openSync(path,'wx',0o600);closeSync(fd);}
      catch(error) {if(error.code!=='EEXIST')throw error;}
      const file=lstatSync(path);
      if(!file.isFile()||file.isSymbolicLink()||(file.mode&0o077)!==0)
        throw new Error('Receipt file must be a private ordinary file');
    }
    const db=new DatabaseSync(path);
    try {
      db.exec('PRAGMA busy_timeout='+busyTimeoutMs);
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      db.exec('BEGIN IMMEDIATE');
      db.exec('CREATE TABLE IF NOT EXISTS radio_vesting_schema (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)');
      db.exec('INSERT OR IGNORE INTO radio_vesting_schema (id,version) VALUES (1,1)');
      if(db.prepare('SELECT version FROM radio_vesting_schema WHERE id=1').get().version!==1)
        throw new Error('Unsupported vesting receipt schema');
      db.exec('CREATE TABLE IF NOT EXISTS radio_vesting_receipts (receipt_key TEXT PRIMARY KEY, record_json TEXT NOT NULL CHECK(json_valid(record_json))) STRICT');
      db.exec('COMMIT');
    } catch(error) {
      try {db.exec('ROLLBACK');}catch {}
      db.close();throw error;
    }
    this.#db=db;
  }
  get(key) {
    if(typeof key!=='string'||key.length>1024)throw new TypeError('Invalid receipt key');
    const row=this.#db.prepare('SELECT record_json FROM radio_vesting_receipts WHERE receipt_key=?').get(key);
    return row?decode(row.record_json):null;
  }
  claim(key,record) {
    if(typeof key!=='string'||key.length>1024)throw new TypeError('Invalid receipt key');
    const body=encode(record);
    const canonical=decode(body);
    if(key!==vestingKey(canonical))throw new TypeError('Receipt key does not bind its scope');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const found=this.get(key);
      if(found) {this.#db.exec('COMMIT');return Object.freeze({inserted:false,record:found});}
      this.#db.prepare('INSERT INTO radio_vesting_receipts (receipt_key,record_json) VALUES (?,?)').run(key,body);
      this.#db.exec('COMMIT');
      return Object.freeze({inserted:true,record:canonical});
    } catch(error) {
      try {this.#db.exec('ROLLBACK');}catch {}
      throw error;
    }
  }
  close() {this.#db.close();}
}
