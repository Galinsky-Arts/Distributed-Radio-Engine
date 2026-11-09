import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {CreatorPointLedger,pointWalletKey,createStoredVestingVerifier} from '../src/point-ledger.mjs';
import {SqlitePointStore} from '../src/sqlite-point-store.mjs';
const scope={tenantId:'tenant',applicationId:'app',principalId:'listener'};
const receipt={...scope,creatorId:'artist',stationId:'station',occurrenceId:'occurrence',programDigest:'digest',
  contentRef:'content',outroRef:'outro',startedAtMs:100,completedAtMs:1000,requiredStartMs:100,
  contentEndMs:900,outroEndMs:1000,policyVersion:1,unit:'micro-reference-seconds',
  decision:'vested',walletSettlement:'pending',points:100n};
const setup=(store,change={})=>new CreatorPointLedger({scope,store,verifyVestingReceipt:()=>true,
  authorizeOperation:()=>true,now:()=>2000,...change});
function memory(t,change={}) {
  const store=new SqlitePointStore(':memory:',{allowMemory:true});t.after(()=>store.close());
  return {store,ledger:setup(store,change)};
}
function file(t) {
  const directory=mkdtempSync(join(tmpdir(),'radio-wallet-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  return join(directory,'points.sqlite');
}
const credit=(l,change={})=>l.creditVesting({operationId:'credit',receipt,proof:'test-proof',...change});
const spend=(l,change={})=>l.spend({creatorId:'artist',operationId:'spend',amount:30n,offerId:'offer',proof:'test-proof',...change});

test('accepted immutable receipts credit exact large creator-specific balances',t=>{
  const {ledger:l}=memory(t),big=10n**100n+9007199254740993n;
  credit(l,{receipt:{...receipt,points:big}});
  assert.equal(l.balance('artist').balance,big);
  assert.equal(l.balance('other-artist').balance,0n);
  assert.equal(l.balance('artist').lifetimeEarned,big);
});
test('receipt and operation idempotency cannot mint under a fresh operation ID',t=>{
  const {ledger:l}=memory(t);
  assert.equal(credit(l).applied,true);
  assert.equal(credit(l).applied,false);
  assert.equal(credit(l,{operationId:'other-credit'}).applied,false);
  assert.throws(()=>credit(l,{receipt:{...receipt,points:999n}}),/Conflicting/);
  assert.equal(l.balance('artist').balance,100n);
  assert.equal(l.entries('artist').items.length,1);
});
test('cross-station same occurrence is a conflicting receipt rather than new credit',t=>{
  const {ledger:l}=memory(t);credit(l);
  assert.throws(()=>credit(l,{operationId:'other',receipt:{...receipt,stationId:'other'}}),/Conflicting/);
  assert.equal(l.balance('artist').balance,100n);
});
test('spending preserves lifetime earned and never spends another creator balance',t=>{
  const {ledger:l}=memory(t);credit(l);spend(l);
  assert.equal(l.balance('artist').balance,70n);
  assert.equal(l.balance('artist').lifetimeEarned,100n);
  assert.throws(()=>spend(l,{creatorId:'other-artist'}),/Insufficient/);
  assert.equal(l.balance('other-artist').balance,0n);
});
test('insufficient spends and conflicting retries leave ledger unchanged',t=>{
  const {ledger:l}=memory(t);credit(l);
  assert.throws(()=>spend(l,{amount:101n}),/Insufficient/);
  assert.equal(l.entries('artist').items.length,1);
  spend(l);
  assert.equal(spend(l).applied,false);
  assert.throws(()=>spend(l,{amount:20n}),/Conflicting/);
  assert.equal(l.balance('artist').balance,70n);
});
test('authorized exact reversal restores debit once without lifetime inflation',t=>{
  const {ledger:l}=memory(t);credit(l);spend(l);
  const reverse={creatorId:'artist',operationId:'refund',originalOperationId:'spend',reason:'failed-grant',proof:'test-proof'};
  assert.equal(l.reverse(reverse).balance,100n);
  assert.equal(l.reverse(reverse).applied,false);
  assert.throws(()=>l.reverse({...reverse,operationId:'second-refund'}),/already reversed/);
  assert.equal(l.balance('artist').lifetimeEarned,100n);
  assert.equal(l.balance('artist').lifetimeReversed,0n);
});
test('credit reversal cannot make a negative account or recreate a consumed receipt',t=>{
  const {ledger:l}=memory(t);credit(l);spend(l);
  const reverse={creatorId:'artist',operationId:'revoke',originalOperationId:'credit',reason:'invalid-evidence',proof:'test-proof'};
  assert.throws(()=>l.reverse(reverse),/Insufficient/);
  l.reverse({...reverse,operationId:'refund',originalOperationId:'spend'});
  assert.equal(l.reverse(reverse).balance,0n);
  assert.equal(l.balance('artist').lifetimeReversed,100n);
  assert.equal(l.balance('artist').netEarned,0n);
  assert.equal(credit(l,{operationId:'replayed'}).applied,false);
  assert.equal(l.balance('artist').balance,0n);
});
test('receipt scope/closure and operation authorization fail before mutations',t=>{
  const {ledger:l}=memory(t);
  for(const change of [{principalId:'other'},{tenantId:'other'},{applicationId:'other'},
    {decision:'forfeited'},{walletSettlement:'not-applicable'},{completedAtMs:999},{points:-1n},
    {outroRef:''},{unit:'decibels'}])
    assert.throws(()=>credit(l,{receipt:{...receipt,...change}}));
  const denied=memory(t,{verifyVestingReceipt:()=>false}).ledger;
  assert.throws(()=>credit(denied),/authentication/);
  assert.equal(l.entries('artist').items.length,0);
  const deniedOperations=memory(t,{authorizeOperation:()=>false}).ledger;credit(deniedOperations);
  assert.throws(()=>spend(deniedOperations),/authorization/);
  assert.throws(()=>deniedOperations.reverse({creatorId:'artist',operationId:'revoke',originalOperationId:'credit',
    reason:'test',proof:'test-proof'}),/authorization/);
  assert.equal(deniedOperations.balance('artist').balance,100n);
});
test('frozen trusted verifiers receive exact scope and no arbitrary keys',t=>{
  let verified=false,authorized=false;
  const {ledger:l}=memory(t,{verifyVestingReceipt:(r,p,s)=>{
    verified=true;assert.equal(Object.isFrozen(r),true);assert.equal(r.privateKey,undefined);
    assert.equal(p,'test-proof');assert.deepEqual(s,scope);return true;
  },authorizeOperation:(op,context,p)=>{
    authorized=true;assert.equal(Object.isFrozen(op),true);assert.equal(context.creatorId,'artist');
    assert.equal(op.amount,'30');assert.equal(p,'test-proof');return true;
  }});
  credit(l,{receipt:{...receipt,privateKey:'never forwarded'}});spend(l);
  assert.equal(verified,true);assert.equal(authorized,true);
  assert.equal(l.entries('artist').items[0].proof,undefined);
});
test('same creator under another listener tenant or app is a separate wallet',t=>{
  const {store,ledger:l}=memory(t);credit(l);
  for(const change of [{principalId:'other'},{tenantId:'other'},{applicationId:'other'}]) {
    const other=setup(store,{scope:{...scope,...change}});
    assert.equal(other.balance('artist').balance,0n);
    assert.throws(()=>spend(other),/Insufficient/);
  }
});
test('restart preserves consumed receipts balance and bounded immutable audit',t=>{
  const path=file(t);let store=new SqlitePointStore(path);let l=setup(store);
  credit(l);spend(l);store.close();
  assert.equal(statSync(path).mode&0o077,0);
  store=new SqlitePointStore(path);l=setup(store);
  assert.equal(l.balance('artist').balance,70n);assert.equal(credit(l,{operationId:'retry'}).applied,false);
  const first=l.entries('artist',{limit:1}),second=l.entries('artist',{afterSequence:first.nextSequence,limit:1});
  assert.equal(first.items.length,1);assert.equal(second.items.length,1);
  assert.equal(first.items[0].delta,100n);assert.equal(second.items[0].delta,-30n);
  assert.equal(Object.isFrozen(first.items),true);
  assert.throws(()=>l.entries('artist',{limit:1001}));
  store.close();
});
test('failure between balance update and audit insert rolls back both',t=>{
  const path=file(t),store=new SqlitePointStore(path),l=setup(store);credit(l);
  const db=new DatabaseSync(path);
  db.exec("CREATE TRIGGER fail_spend AFTER INSERT ON radio_point_entries WHEN NEW.kind='spend' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  assert.throws(()=>spend(l),/injected failure/);
  assert.equal(l.balance('artist').balance,100n);assert.equal(l.entries('artist').items.length,1);
  db.exec('DROP TRIGGER fail_spend');assert.equal(spend(l).balance,70n);db.close();store.close();
});
test('four-process concurrent spends never overspend or lose ledger entries',async t=>{
  const path=file(t),store=new SqlitePointStore(path);credit(setup(store));store.close();
  const run=operationId=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[new URL('./fixtures/wallet-race-worker.mjs',import.meta.url).pathname,path,operationId],
      {stdio:['ignore','pipe','pipe']});
    let out='',err='';child.stdout.on('data',x=>{out+=x;});child.stderr.on('data',x=>{err+=x;});
    child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(out)):reject(new Error(err)));
  });
  const results=await Promise.all(['one','two','three','four'].map(run));
  assert.equal(results.filter(x=>x.applied).length,1);
  const check=new SqlitePointStore(path),l=setup(check);
  assert.equal(l.balance('artist').balance,40n);assert.equal(l.entries('artist').items.length,2);check.close();
});
test('no in-memory default or client post API and unsupported schemas fail',t=>{
  assert.throws(()=>new CreatorPointLedger());
  assert.throws(()=>new SqlitePointStore(':memory:'),/opt-in/);
  const {ledger:l}=memory(t);assert.equal(l.post,undefined);
  const path=file(t),store=new SqlitePointStore(path);store.close();
  const db=new DatabaseSync(path);db.exec('UPDATE radio_wallet_schema SET version=2');db.close();
  assert.throws(()=>new SqlitePointStore(path),/Unsupported/);
});
test('async verifier rejections are denied without unhandled secret exceptions',async t=>{
  const {ledger:l}=memory(t,{verifyVestingReceipt:()=>Promise.reject(new Error('private token'))});
  assert.throws(()=>credit(l),/authentication/);
  await new Promise(resolve=>setImmediate(resolve));
});
test('stored receipt adapter authorizes access and matches the immutable complete decision',t=>{
  let reads=0;
  const authoritative={get:key=>{
    reads++;assert.equal(key,JSON.stringify(['tenant','app','listener','artist','occurrence']));
    return Object.freeze({...receipt});
  }};
  const verify=createStoredVestingVerifier({receiptStore:authoritative,
    authorizeReceiptAccess:(r,s,p)=>p==='authorized-proof'});
  const {ledger:l}=memory(t,{verifyVestingReceipt:verify});
  assert.throws(()=>credit(l),/authentication/);assert.equal(reads,0);
  assert.throws(()=>credit(l,{proof:'authorized-proof',receipt:{...receipt,points:101n}}),/authentication/);
  assert.equal(credit(l,{proof:'authorized-proof'}).balance,100n);
  assert.equal(credit(l,{operationId:'retry',proof:'authorized-proof'}).applied,false);
});
test('audit query cursors and account mutations remain scoped to exact creator wallet',t=>{
  const {ledger:l}=memory(t);credit(l);
  assert.equal(l.entries('other-artist').items.length,0);
  assert.throws(()=>l.entries('artist',{afterSequence:-1n}));
  assert.throws(()=>l.reverse({creatorId:'other-artist',operationId:'refund',originalOperationId:'credit',reason:'test',proof:'test-proof'}),/Original scoped/);
});
test('bounded audit reconciles immutable entries and detects materialized balance corruption',t=>{
  const path=file(t),store=new SqlitePointStore(path),l=setup(store);credit(l);spend(l);
  assert.deepEqual(l.audit('artist'),{status:'checked',verified:true,consistent:true,scanned:2});
  assert.deepEqual(l.audit('artist',{maxEntries:1}),{status:'limit-reached',verified:false,consistent:null,scanned:0});
  const db=new DatabaseSync(path);
  db.prepare('UPDATE radio_point_wallets SET balance=? WHERE wallet_id=?').run('999',pointWalletKey(scope,'artist'));
  assert.equal(l.audit('artist').consistent,false);
  assert.equal(l.audit('other-artist').consistent,true);
  db.close();store.close();
});


import {VestingGate} from '../src/vesting.mjs';
import {SqliteVestingStore} from '../src/sqlite-vesting-store.mjs';
test('actual durable outro receipt credits a wallet once; altered and missing receipts fail',t=>{
  const path=file(t),receiptPath=path+'.vesting';
  let receipts=new SqliteVestingStore(receiptPath);
  const event={...receipt,proof:'fixture',playbackContinuous:true,interruptions:false};
  delete event.decision;delete event.walletSettlement;
  const gate=new VestingGate({scope,store:receipts,verifyCompletion:()=>true,now:()=>1000});
  const accepted=gate.vest(event);assert.equal(accepted.accepted,true);
  receipts.close();receipts=new SqliteVestingStore(receiptPath);t.after(()=>receipts.close());
  const store=new SqlitePointStore(path);t.after(()=>store.close());
  const ledger=setup(store,{verifyVestingReceipt:createStoredVestingVerifier({receiptStore:receipts,
    authorizeReceiptAccess:(_receipt,_scope,proof)=>proof==='test-proof'})});
  assert.equal(credit(ledger,{receipt:accepted.record}).applied,true);
  assert.equal(credit(ledger,{receipt:accepted.record,operationId:'retry'}).applied,false);
  assert.throws(()=>credit(ledger,{receipt:{...accepted.record,points:999n},operationId:'altered'}),/authentication/);
  assert.throws(()=>credit(ledger,{receipt:{...accepted.record,occurrenceId:'missing'},operationId:'missing'}),/authentication/);
  assert.equal(ledger.balance('artist').balance,100n);
  assert.equal(ledger.audit('artist').consistent,true);
});
