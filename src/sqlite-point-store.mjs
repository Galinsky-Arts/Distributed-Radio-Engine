import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,lstatSync,statSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
import {id} from './contracts.mjs';

const integer=value=>{
  if(typeof value!=='string'||!/^\d{1,1000}$/.test(value))throw new Error('Corrupt point balance');
  return BigInt(value);
};
const stats=row=>{
  const balance=row?integer(row.balance):0n,earned=row?integer(row.lifetime_earned):0n,
    reversed=row?integer(row.lifetime_reversed):0n;
  if(reversed>earned)throw new Error('Corrupt lifetime point accounting');
  return Object.freeze({balance,lifetimeEarned:earned,lifetimeReversed:reversed,netEarned:earned-reversed});
};

/** Internal local-endpoint persistence, not an authorization or network API. */
export class SqlitePointStore {
  #db;
  constructor(path,{allowMemory=false,busyTimeoutMs=1000}={}) {
    if(!Number.isSafeInteger(busyTimeoutMs)||busyTimeoutMs<1||busyTimeoutMs>10000)
      throw new RangeError('Invalid SQLite contention bound');
    if(path===':memory:') {
      if(!allowMemory)throw new TypeError('Volatile wallet requires explicit test opt-in');
    } else {
      if(typeof path!=='string'||!isAbsolute(path))throw new TypeError('Explicit absolute wallet path required');
      const parent=statSync(dirname(path));
      if(!parent.isDirectory()||(parent.mode&0o077)!==0)throw new Error('Private endpoint wallet directory required');
      try {const fd=openSync(path,'wx',0o600);closeSync(fd);}catch(error){if(error.code!=='EEXIST')throw error;}
      const file=lstatSync(path);
      if(!file.isFile()||file.isSymbolicLink()||(file.mode&0o077)!==0)throw new Error('Private ordinary wallet file required');
    }
    const db=new DatabaseSync(path);
    try {
      db.exec('PRAGMA busy_timeout='+busyTimeoutMs);
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
      db.exec('CREATE TABLE IF NOT EXISTS radio_wallet_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL)');
      db.exec('INSERT OR IGNORE INTO radio_wallet_schema(id,version) VALUES(1,1)');
      if(db.prepare('SELECT version FROM radio_wallet_schema WHERE id=1').get().version!==1)
        throw new Error('Unsupported point-wallet schema');
      db.exec('CREATE TABLE IF NOT EXISTS radio_point_wallets(wallet_id TEXT PRIMARY KEY,balance TEXT NOT NULL,lifetime_earned TEXT NOT NULL,lifetime_reversed TEXT NOT NULL) STRICT');
      db.exec("CREATE TABLE IF NOT EXISTS radio_point_entries(sequence INTEGER PRIMARY KEY AUTOINCREMENT,wallet_id TEXT NOT NULL,operation_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('vest','spend','reverse')),delta TEXT NOT NULL,source_id TEXT UNIQUE,reference_id TEXT,payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),created_at INTEGER NOT NULL,UNIQUE(wallet_id,operation_id),UNIQUE(wallet_id,reference_id)) STRICT");
      db.exec('COMMIT');
    } catch(error) {try{db.exec('ROLLBACK');}catch{}db.close();throw error;}
    this.#db=db;
  }
  #wallet(value) {
    if(typeof value!=='string'||value.length>1024)throw new TypeError('Invalid wallet scope');
    const parts=JSON.parse(value);
    if(!Array.isArray(parts)||parts.length!==4)throw new TypeError('Invalid wallet scope');
    for(const part of parts)id(part,'wallet scope');
  }
  balance(walletId) {
    this.#wallet(walletId);
    return stats(this.#db.prepare('SELECT * FROM radio_point_wallets WHERE wallet_id=?').get(walletId));
  }
  apply(walletId,operation,nowMs) {
    this.#wallet(walletId);
    const fields=['kind','operationId','amount','sourceId','sourceBinding','referenceId','metadata'];
    if(!operation||Object.keys(operation).length!==fields.length||fields.some(k=>!Object.hasOwn(operation,k)))
      throw new TypeError('Exact bounded wallet operation required');
    operation=Object.fromEntries(fields.map(k=>[k,operation[k]]));
    id(operation.operationId,'operationId');id(operation.metadata,'operation metadata');
    if(!['vest','spend','reverse'].includes(operation.kind)||!Number.isSafeInteger(nowMs)||nowMs<0)
      throw new TypeError('Invalid wallet operation');
    if(operation.kind!=='reverse'&&(typeof operation.amount!=='string'||!/^\d{1,1000}$/.test(operation.amount)))
      throw new RangeError('Invalid point quantity');
    if(operation.kind==='spend'&&BigInt(operation.amount)===0n)throw new RangeError('Positive spend required');
    if(operation.kind==='vest') {
      if(typeof operation.sourceId!=='string'||operation.sourceId.length>1024||
          typeof operation.sourceBinding!=='string'||operation.sourceBinding.length>8192)
        throw new TypeError('Bounded immutable vesting binding required');
      const source=JSON.parse(operation.sourceId),wallet=JSON.parse(walletId);
      if(!Array.isArray(source)||source.length!==5||wallet.some((value,i)=>source[i]!==value)||operation.referenceId!==null)
        throw new TypeError('Vesting source does not bind wallet scope');
      id(source[4],'vesting occurrence');
    }
    if(operation.kind!=='vest'&&(operation.sourceId!==null||operation.sourceBinding!==null))
      throw new TypeError('Unexpected source binding');
    if(operation.kind==='reverse') {
      id(operation.referenceId,'original operation');
      if(operation.amount!==null)throw new TypeError('Reversal quantity must derive from original');
    } else if(operation.referenceId!==null)throw new TypeError('Unexpected reversal reference');
    const payload=JSON.stringify(operation);
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const prior=this.#db.prepare('SELECT payload_json FROM radio_point_entries WHERE wallet_id=? AND operation_id=?')
        .get(walletId,operation.operationId);
      if(prior) {
        if(prior.payload_json!==payload)throw new RangeError('Conflicting financial replay');
        const result=Object.freeze({applied:false,...this.balance(walletId)});
        this.#db.exec('COMMIT');return result;
      }
      if(operation.kind==='vest') {
        const consumed=this.#db.prepare('SELECT wallet_id,payload_json FROM radio_point_entries WHERE source_id=?').get(operation.sourceId);
        if(consumed) {
          const original=JSON.parse(consumed.payload_json);
          if(consumed.wallet_id!==walletId||original.sourceBinding!==operation.sourceBinding||original.amount!==operation.amount)
            throw new RangeError('Conflicting consumed vesting receipt');
          const result=Object.freeze({applied:false,...this.balance(walletId)});
          this.#db.exec('COMMIT');return result;
        }
      }
      let delta;
      if(operation.kind==='reverse') {
        const original=this.#db.prepare('SELECT kind,delta FROM radio_point_entries WHERE wallet_id=? AND operation_id=?')
          .get(walletId,operation.referenceId);
        if(!original||original.kind==='reverse')throw new RangeError('Original scoped point operation required');
        if(this.#db.prepare('SELECT 1 FROM radio_point_entries WHERE wallet_id=? AND reference_id=?').get(walletId,operation.referenceId))
          throw new RangeError('Original point operation already reversed');
        delta=-BigInt(original.delta);
      } else delta=(operation.kind==='spend'?-1n:1n)*BigInt(operation.amount);
      const current=this.balance(walletId),next=current.balance+delta;
      if(next<0n)throw new RangeError('Insufficient creator-specific points');
      const earned=current.lifetimeEarned+(operation.kind==='vest'?delta:0n);
      const reversed=current.lifetimeReversed+(operation.kind==='reverse'&&delta<0n?-delta:0n);
      if([next,earned,reversed].some(value=>value.toString().length>1000)||reversed>earned)
        throw new RangeError('Point account resource/integrity bound exceeded');
      this.#db.prepare('INSERT INTO radio_point_wallets(wallet_id,balance,lifetime_earned,lifetime_reversed) VALUES(?,?,?,?) ON CONFLICT(wallet_id) DO UPDATE SET balance=excluded.balance,lifetime_earned=excluded.lifetime_earned,lifetime_reversed=excluded.lifetime_reversed')
        .run(walletId,next.toString(),earned.toString(),reversed.toString());
      this.#db.prepare('INSERT INTO radio_point_entries(wallet_id,operation_id,kind,delta,source_id,reference_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(walletId,operation.operationId,operation.kind,delta.toString(),operation.sourceId,operation.referenceId,payload,nowMs);
      this.#db.exec('COMMIT');
      return Object.freeze({applied:true,balance:next,lifetimeEarned:earned,lifetimeReversed:reversed,netEarned:earned-reversed});
    } catch(error) {try{this.#db.exec('ROLLBACK');}catch{}throw error;}
  }
  entries(walletId,{afterSequence=0n,limit=100}={}) {
    this.#wallet(walletId);
    if(typeof afterSequence!=='bigint'||afterSequence<0n||afterSequence>9223372036854775807n||
        !Number.isSafeInteger(limit)||limit<1||limit>1000)throw new RangeError('Invalid bounded audit cursor');
    const statement=this.#db.prepare('SELECT sequence,operation_id,kind,delta,source_id,reference_id,created_at FROM radio_point_entries WHERE wallet_id=? AND sequence>? ORDER BY sequence LIMIT ?');
    statement.setReadBigInts(true);
    const rows=statement.all(walletId,afterSequence,limit);
    const items=Object.freeze(rows.map(row=>Object.freeze({sequence:row.sequence,operationId:row.operation_id,
      kind:row.kind,delta:BigInt(row.delta),sourceId:row.source_id,referenceId:row.reference_id,createdAtMs:row.created_at})));
    return Object.freeze({items,nextSequence:items.at(-1)?.sequence??afterSequence});
  }
  audit(walletId,{maxEntries=100000}={}) {
    this.#wallet(walletId);
    if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>100000)
      throw new RangeError('Invalid audit resource bound');
    this.#db.exec('BEGIN');
    try {
      const actual=this.balance(walletId);
      const rows=this.#db.prepare('SELECT operation_id,kind,delta,reference_id FROM radio_point_entries WHERE wallet_id=? ORDER BY sequence LIMIT ?')
        .all(walletId,maxEntries+1);
      if(rows.length>maxEntries) {
        this.#db.exec('COMMIT');
        return Object.freeze({status:'limit-reached',verified:false,consistent:null,scanned:0});
      }
      let balance=0n,earned=0n,reversed=0n,valid=true;
      const originals=new Map(),reversals=new Set();
      for(const row of rows) {
        if(typeof row.delta!=='string'||!/^[-]?\d{1,1000}$/.test(row.delta))throw new Error('Corrupt point audit');
        const delta=BigInt(row.delta);
        if(row.kind==='vest') {if(delta<0n)valid=false;earned+=delta;}
        else if(row.kind==='spend') {if(delta>=0n)valid=false;}
        else if(row.kind==='reverse') {
          const original=originals.get(row.reference_id);
          if(!original||original.kind==='reverse'||delta!==-original.delta||reversals.has(row.reference_id))valid=false;
          reversals.add(row.reference_id);
          if(delta<0n)reversed-=delta;
        } else valid=false;
        balance+=delta;if(balance<0n)valid=false;
        originals.set(row.operation_id,{kind:row.kind,delta});
      }
      const consistent=valid&&balance===actual.balance&&earned===actual.lifetimeEarned&&reversed===actual.lifetimeReversed;
      this.#db.exec('COMMIT');
      return Object.freeze({status:'checked',verified:true,consistent,scanned:rows.length});
    } catch(error) {try{this.#db.exec('ROLLBACK');}catch{}throw error;}
  }
  close(){this.#db.close();}
}
