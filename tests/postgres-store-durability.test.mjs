import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createPostgresStoreDurability,StoreDurabilityError} from '../src/postgres-store-durability.mjs';
import {SqlitePointStore} from '../src/sqlite-point-store.mjs';
import {SqliteVestingStore} from '../src/sqlite-vesting-store.mjs';
import {CreatorPointLedger} from '../src/point-ledger.mjs';
import {vestingKey} from '../src/vesting.mjs';
import {createSqliteStationOperationsStore} from '../src/station-operations.mjs';

const databaseUrl=process.env.DRE_TEST_DATABASE_URL;
const skip=!databaseUrl&&'Set DRE_TEST_DATABASE_URL to a disposable PostgreSQL database';
const pg=databaseUrl?(await import('pg')).default:null;

const scope={tenantId:'tenant',applicationId:'app',principalId:'listener'};
const receipt={...scope,creatorId:'artist',stationId:'station',occurrenceId:'occurrence',programDigest:'digest',
  contentRef:'content',outroRef:'outro',startedAtMs:100,completedAtMs:1000,requiredStartMs:100,
  contentEndMs:900,outroEndMs:1000,policyVersion:1,unit:'micro-reference-seconds',
  decision:'vested',walletSettlement:'pending',points:100n};
const STORES=['points.sqlite','vesting.sqlite','operations.sqlite'];
const ledger=store=>new CreatorPointLedger({scope,store,verifyVestingReceipt:()=>true,authorizeOperation:()=>true,now:()=>2000});

function privateDir(t) {
  const dir=mkdtempSync(join(tmpdir(),'dre-durable-'));chmodSync(dir,0o700);
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function pool(t) {
  const value=new pg.Pool({connectionString:databaseUrl,max:3});
  t.after(()=>value.end());
  return value;
}
const deployment=()=>`test/dre-${randomBytes(6).toString('hex')}`;
async function boot(t,{pool:db,dir,name}) {
  const durability=createPostgresStoreDurability({pool:db,dataDir:dir,deployment:name,stores:STORES});
  const restored=await durability.restore();
  const points=new SqlitePointStore(join(dir,'points.sqlite'));
  const vesting=new SqliteVestingStore(join(dir,'vesting.sqlite'));
  const operations=createSqliteStationOperationsStore(join(dir,'operations.sqlite'));
  durability.attach();
  t.after(async()=>{await durability.close();points.close();vesting.close();operations.close();});
  return {durability,restored,points,vesting,operations};
}

test('a restarted host with an empty data directory restores ledger and receipts from PostgreSQL',{skip},async t=>{
  const db=pool(t),name=deployment();
  const first=await boot(t,{pool:db,dir:privateDir(t),name});
  assert.equal(first.restored.restored,0);
  await first.durability.commit(()=>{
    first.vesting.claim(vestingKey(receipt),receipt);
    ledger(first.points).creditVesting({operationId:'credit',receipt,proof:'test-proof'});
  });
  await first.durability.commit(()=>ledger(first.points).spend({creatorId:'artist',operationId:'spend',amount:30n,offerId:'offer',proof:'test-proof'}));
  assert.equal(await first.durability.flush(),0,'no committed change, no write');
  assert.equal(first.durability.healthy(),true);

  const second=await boot(t,{pool:db,dir:privateDir(t),name});
  assert.equal(second.restored.restored,3,'every opened store (including schema-only stores) was snapshotted');
  assert.equal(BigInt(second.restored.epoch),BigInt(first.durability.status().epoch)+1n);
  assert.equal(ledger(second.points).balance('artist').balance,70n);
  assert.equal(ledger(second.points).audit('artist').consistent,true);
  assert.equal(second.vesting.get(vestingKey(receipt)).points,100n);
  // Replays stay idempotent against the restored ledger.
  assert.equal(ledger(second.points).creditVesting({operationId:'credit',receipt,proof:'test-proof'}).applied,false);
});

test('a superseded instance can no longer write and reports unhealthy',{skip},async t=>{
  const db=pool(t),name=deployment();
  const old=await boot(t,{pool:db,dir:privateDir(t),name});
  await old.durability.commit(()=>ledger(old.points).creditVesting({operationId:'credit',receipt,proof:'test-proof'}));
  const current=await boot(t,{pool:db,dir:privateDir(t),name});
  ledger(old.points).spend({creatorId:'artist',operationId:'late',amount:10n,offerId:'offer',proof:'test-proof'});
  await assert.rejects(old.durability.flush(),error=>error instanceof StoreDurabilityError&&error.code==='STORE_SUPERSEDED');
  assert.equal(old.durability.healthy(),false);
  assert.equal(old.durability.status().lastError,'STORE_SUPERSEDED');
  await assert.rejects(old.durability.flush(),/STORE_SUPERSEDED/,'stays fenced');
  await current.durability.commit(()=>ledger(current.points).spend({creatorId:'artist',operationId:'spend',amount:30n,offerId:'offer',proof:'test-proof'}));
  const third=await boot(t,{pool:db,dir:privateDir(t),name});
  assert.equal(ledger(third.points).balance('artist').balance,70n,'the fenced write never reached PostgreSQL');
});

test('a tampered or oversized snapshot fails restore before any store opens',{skip},async t=>{
  const db=pool(t),name=deployment();
  const first=await boot(t,{pool:db,dir:privateDir(t),name});
  await first.durability.commit(()=>ledger(first.points).creditVesting({operationId:'credit',receipt,proof:'test-proof'}));
  await db.query("UPDATE dre_store_snapshot SET bytes=bytes||'\\x00'::bytea WHERE deployment=$1",[name]);
  const dir=privateDir(t);
  const durability=createPostgresStoreDurability({pool:db,dataDir:dir,deployment:name,stores:STORES});
  await assert.rejects(durability.restore(),/STORE_SNAPSHOT_DIGEST_MISMATCH/);
  assert.deepEqual(readdirSync(dir),[],'no working file was written');
  await assert.rejects(durability.flush(),/STORE_NOT_RESTORED/);
});

test('a failed PostgreSQL write is reported and never acknowledged',{skip},async t=>{
  const db=pool(t),dir=privateDir(t),name=deployment();
  let broken=false;
  const flaky={query:(...args)=>db.query(...args),
    connect:async()=>{if(broken)throw new Error('connection refused');return db.connect();}};
  const durability=createPostgresStoreDurability({pool:flaky,dataDir:dir,deployment:name,stores:['points.sqlite']});
  await durability.restore();
  const points=new SqlitePointStore(join(dir,'points.sqlite'));
  t.after(async()=>{await durability.close();points.close();});
  broken=true;
  await assert.rejects(durability.commit(()=>ledger(points).creditVesting({operationId:'credit',receipt,proof:'test-proof'})),/connection refused/);
  assert.equal(durability.healthy(),false);
  assert.equal(durability.status().lastError,'STORE_WRITE_FAILED');
  broken=false;
  assert.equal(await durability.flush(),1,'the pending committed change is written on the next flush');
  assert.equal(durability.healthy(),true);
});

test('configuration is validated before any I/O',async t=>{
  const fake={connect(){throw new Error('unused');},query(){throw new Error('unused');}};
  const dir=privateDir(t);
  const make=change=>()=>createPostgresStoreDurability({pool:fake,dataDir:dir,deployment:'tenant/app',stores:['points.sqlite'],...change});
  assert.doesNotThrow(make({}));
  assert.throws(make({pool:null}),/STORE_POOL_REQUIRED/);
  assert.throws(make({deployment:'../x'}),/INVALID_DEPLOYMENT/);
  assert.throws(make({dataDir:'relative'}),/ABSOLUTE_DATA_DIR_REQUIRED/);
  assert.throws(make({stores:[]}),/INVALID_STORE_NAMES/);
  assert.throws(make({stores:['../points.sqlite']}),/INVALID_STORE_NAMES/);
  assert.throws(make({stores:['points.sqlite','points.sqlite']}),/INVALID_STORE_NAMES/);
  const open=mkdtempSync(join(tmpdir(),'dre-open-'));chmodSync(open,0o755);t.after(()=>rmSync(open,{recursive:true,force:true}));
  assert.throws(make({dataDir:open}),/PRIVATE_DATA_DIR_REQUIRED/);
  await assert.rejects(make({})().flush(),/STORE_NOT_RESTORED/);
});
