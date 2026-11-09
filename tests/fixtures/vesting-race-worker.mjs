// Explicit local fixture worker, never a live attestation or background agent.
import {VestingGate} from '../../src/vesting.mjs';
import {SqliteVestingStore} from '../../src/sqlite-vesting-store.mjs';
const scope={tenantId:'tenant',applicationId:'app',principalId:'listener'};
const sample={...scope,stationId:'station',occurrenceId:'run1',creatorId:'artist',programDigest:'digest',
  contentRef:'content',outroRef:'outro',startedAtMs:100,completedAtMs:1000,
  requiredStartMs:100,contentEndMs:900,outroEndMs:1000,points:50n,unit:'micro-reference-seconds',
  policyVersion:1,playbackContinuous:true,interruptions:false,proof:'test-proof'};
const store=new SqliteVestingStore(process.argv[2]);
const result=new VestingGate({scope,verifyCompletion:()=>true,store,now:()=>1000}).vest(sample);
process.stdout.write(JSON.stringify({accepted:result.accepted,reason:result.reason}));
store.close();
