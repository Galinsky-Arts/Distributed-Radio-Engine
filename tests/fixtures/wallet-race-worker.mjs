// Explicit concurrency fixture; no actual reward authorization or background agent.
import {CreatorPointLedger} from '../../src/point-ledger.mjs';
import {SqlitePointStore} from '../../src/sqlite-point-store.mjs';
const scope={tenantId:'tenant',applicationId:'app',principalId:'listener'};
const store=new SqlitePointStore(process.argv[2]);
const ledger=new CreatorPointLedger({scope,store,verifyVestingReceipt:()=>true,authorizeOperation:()=>true,now:()=>2000});
try {
  const result=ledger.spend({creatorId:'artist',operationId:process.argv[3],amount:60n,offerId:'offer',proof:'test-proof'});
  process.stdout.write(JSON.stringify({applied:result.applied}));
} catch(error) {
  if(!/Insufficient/.test(error.message))throw error;
  process.stdout.write(JSON.stringify({applied:false}));
} finally {store.close();}
