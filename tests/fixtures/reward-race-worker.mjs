// Explicit local race fixture, never a production authority.
import {SqlitePointStore} from '../../src/sqlite-point-store.mjs';
import {PointRewards} from '../../src/point-rewards.mjs';
const store=new SqlitePointStore(process.argv[2],{busyTimeoutMs:5000});
try {
 const rewards=new PointRewards({scope:{tenantId:'tenant',applicationId:'app',principalId:process.argv[3]},store,
  recordingRegistry:{reserve(){}},authorizeCreator:()=>false,authorizeRedemption:()=>true,
  verifyPriceSnapshot:()=>false,territory:'US',now:()=>2000,
  resolveRights:()=>({tenantId:'tenant',assetRef:'recording',uses:['reward'],territories:['US'],
   validFrom:'1970-01-01T00:00:00Z',validUntil:'2030-01-01T00:00:00Z'})});
 try { const result=rewards.redeem({creatorId:'artist',offerId:'offer',offerVersion:1,operationId:'race',proof:'fixture-consent'});
  process.stdout.write(JSON.stringify({applied:result.applied}));
 }catch(error){process.stdout.write(JSON.stringify({applied:false,error:error.message}));}
}finally{store.close();}
