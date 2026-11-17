// Optional PostgreSQL durability for the radio engine's SQLite stores.
//
// SQLite stays the default and the only query engine: SqlitePointStore,
// SqliteVestingStore, DurableListenerCompletion, RecordingChannelRegistry and the
// station-operations store keep their synchronous transactions and checks
// unchanged. A host without a persistent disk (for example a free web service)
// can instead treat the SQLite files as a working copy backed by PostgreSQL:
//
//  * restore(): take a new ownership epoch for the deployment and, in the same
//    PostgreSQL transaction, read the latest committed snapshot of every named
//    store; rebuild the private working files from them (SHA-256 checked) BEFORE
//    any store opens;
//  * flush(): detect committed SQLite changes per store (PRAGMA data_version on a
//    separate observer connection), capture a consistent copy (VACUUM INTO) and
//    write every changed store to PostgreSQL in one transaction. Hosts await it
//    before acknowledging an operation (commit() does both);
//  * an instance whose epoch was superseded (for example the old instance of a
//    rolling deploy) can never write again, so two instances cannot overwrite
//    each other's stores.
//
// The bytes stored are exactly what the SQLite files hold: business ledger,
// receipt and routing metadata. These stores never hold media keys, private
// manifests or plaintext media, and nothing here logs row values. The pool is
// injected (any node-postgres-compatible Pool); the engine adds no runtime
// database dependency.
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {chmodSync,existsSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';

const SIDE_FILES=['','-wal','-shm','-journal'];
const DEPLOYMENT=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const STORE=/^[a-z0-9][a-z0-9._-]{0,63}\.sqlite$/;
export const MAX_STORE_BYTES=64*1024*1024;

export class StoreDurabilityError extends Error {
  constructor(code) {super(code);this.code=code;}
}
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function migrateRadioStoreTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS dre_store_epoch(
      deployment TEXT PRIMARY KEY,
      epoch BIGINT NOT NULL,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS dre_store_snapshot(
      deployment TEXT NOT NULL,
      name TEXT NOT NULL,
      generation BIGINT NOT NULL,
      sha256 TEXT NOT NULL,
      bytes BYTEA NOT NULL,
      written_epoch BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (deployment, name));`);
}

async function transaction(pool,work) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const result=await work(client);
    await client.query('COMMIT');
    return result;
  } catch(error) {try{await client.query('ROLLBACK');}catch{}throw error;}
  finally {client.release();}
}

/**
 * PostgreSQL durability for named SQLite store files in one private directory.
 * Call restore() before opening the stores, then commit(work) (or flush() after
 * each committed operation). close() flushes and releases observer connections;
 * it does not end the injected pool.
 */
export function createPostgresStoreDurability({pool,dataDir,deployment,stores,now=()=>Date.now()}) {
  if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function')throw new StoreDurabilityError('STORE_POOL_REQUIRED');
  if(!DEPLOYMENT.test(deployment??''))throw new StoreDurabilityError('INVALID_DEPLOYMENT');
  if(typeof dataDir!=='string'||!isAbsolute(dataDir))throw new StoreDurabilityError('ABSOLUTE_DATA_DIR_REQUIRED');
  const dir=statSync(dataDir);
  if(!dir.isDirectory()||(dir.mode&0o077)!==0)throw new StoreDurabilityError('PRIVATE_DATA_DIR_REQUIRED');
  if(!Array.isArray(stores)||!stores.length||stores.length>32||new Set(stores).size!==stores.length||
      stores.some(name=>typeof name!=='string'||!STORE.test(name)))throw new StoreDurabilityError('INVALID_STORE_NAMES');
  const names=Object.freeze([...stores]);
  let epoch=null,superseded=false,lastError=null,lastFlushAt=null,restored=0,closed=false;
  const observers=new Map(); // name -> {db, version, sha}
  const remote=new Map();    // name -> sha256 last known in PostgreSQL
  let queue=Promise.resolve();

  async function restore() {
    if(epoch!==null||closed)throw new StoreDurabilityError('STORE_ALREADY_RESTORED');
    await migrateRadioStoreTables(pool);
    let claimed=null;
    const rows=await transaction(pool,async client=>{
      const owner=await client.query(`INSERT INTO dre_store_epoch(deployment,epoch) VALUES($1,1)
        ON CONFLICT (deployment) DO UPDATE SET epoch=dre_store_epoch.epoch+1, claimed_at=now()
        RETURNING epoch`,[deployment]);
      claimed=String(owner.rows[0].epoch);
      return (await client.query('SELECT name,sha256,bytes FROM dre_store_snapshot WHERE deployment=$1',[deployment])).rows;
    });
    const known=rows.filter(row=>names.includes(row.name));
    for(const row of known)
      if(!Buffer.isBuffer(row.bytes)||row.bytes.length>MAX_STORE_BYTES||sha256(row.bytes)!==row.sha256)
        throw new StoreDurabilityError('STORE_SNAPSHOT_DIGEST_MISMATCH');
    // PostgreSQL is authoritative once it holds any snapshot for this deployment.
    // On the first boot, existing local files become the first snapshots.
    if(known.length) {
      for(const name of names)for(const suffix of SIDE_FILES)rmSync(join(dataDir,name+suffix),{force:true});
      for(const row of known) {
        const path=join(dataDir,row.name);
        writeFileSync(path,row.bytes,{mode:0o600,flag:'wx'});
        chmodSync(path,0o600);
        remote.set(row.name,row.sha256);
      }
    }
    // Only a fully verified and rebuilt restore makes this instance writable.
    restored=known.length;epoch=claimed;
    return Object.freeze({epoch,restored});
  }

  function attach() {
    for(const name of names) {
      const path=join(dataDir,name);
      if(observers.has(name)||!existsSync(path))continue;
      const db=new DatabaseSync(path);
      db.exec('PRAGMA busy_timeout=5000');
      observers.set(name,{db,version:null,sha:remote.get(name)??null});
    }
  }

  function capture(observer) {
    const version=observer.db.prepare('PRAGMA data_version').get().data_version;
    if(observer.version===version)return null;
    const temp=join(dataDir,`.snapshot-${randomBytes(8).toString('hex')}.sqlite`);
    try {
      observer.db.prepare('VACUUM INTO ?').run(temp);
      const bytes=readFileSync(temp);
      if(bytes.length>MAX_STORE_BYTES)throw new StoreDurabilityError('STORE_TOO_LARGE');
      return {version,bytes,sha:sha256(bytes)};
    } finally {rmSync(temp,{force:true});}
  }

  async function flushNow() {
    if(epoch===null)throw new StoreDurabilityError('STORE_NOT_RESTORED');
    if(closed)throw new StoreDurabilityError('STORE_DURABILITY_CLOSED');
    attach();
    const changed=[];
    for(const [name,observer] of observers) {
      const snapshot=capture(observer);
      if(!snapshot)continue;
      if(snapshot.sha===observer.sha) {observer.version=snapshot.version;continue;}
      changed.push({name,...snapshot});
    }
    if(!changed.length)return 0;
    if(superseded)throw new StoreDurabilityError('STORE_SUPERSEDED');
    await transaction(pool,async client=>{
      const owner=await client.query('SELECT epoch FROM dre_store_epoch WHERE deployment=$1 FOR UPDATE',[deployment]);
      if(String(owner.rows[0]?.epoch)!==epoch) {superseded=true;throw new StoreDurabilityError('STORE_SUPERSEDED');}
      for(const snapshot of changed)
        await client.query(`INSERT INTO dre_store_snapshot(deployment,name,generation,sha256,bytes,written_epoch)
          VALUES($1,$2,1,$3,$4,$5)
          ON CONFLICT (deployment,name) DO UPDATE SET generation=dre_store_snapshot.generation+1,
            sha256=EXCLUDED.sha256, bytes=EXCLUDED.bytes, written_epoch=EXCLUDED.written_epoch, updated_at=now()`,
          [deployment,snapshot.name,snapshot.sha,snapshot.bytes,epoch]);
    });
    for(const snapshot of changed) {
      const observer=observers.get(snapshot.name);
      observer.version=snapshot.version;observer.sha=snapshot.sha;
      remote.set(snapshot.name,snapshot.sha);
    }
    return changed.length;
  }

  /** Persist every committed local change; serialized so snapshots never race. */
  function flush() {
    const run=queue.then(flushNow);
    queue=run.then(()=>{lastError=null;lastFlushAt=now();},error=>{lastError=error?.code??'STORE_WRITE_FAILED';});
    return run;
  }

  return Object.freeze({
    backend:'postgres',stores:names,restore,attach,flush,
    /** Run a store operation, then make it durable before returning its result. */
    async commit(work) {
      if(typeof work!=='function')throw new TypeError('Store operation required');
      const result=await work();
      await flush();
      return result;
    },
    status() {
      return Object.freeze({backend:'postgres',epoch,superseded,restoredStores:restored,trackedStores:observers.size,
        lastError,lastFlushAt:lastFlushAt===null?null:new Date(lastFlushAt).toISOString()});
    },
    healthy() {return epoch!==null&&!superseded&&lastError===null&&!closed;},
    async close() {
      if(closed)return;
      try {if(epoch!==null)await flush();} catch {}
      closed=true;
      for(const {db} of observers.values()) {try{db.close();}catch{}}
      observers.clear();
    }
  });
}
