// Explicit software race fixture. No production identity, seed or media delivery.
import {RecordingChannelRegistry} from '../../src/recording-channels.mjs';
import {DurableListenerCompletion} from '../../src/listener-history.mjs';
import {GrooveGrantIssuer} from '../../src/groove-grants.mjs';
const registry=new RecordingChannelRegistry(process.argv[2]);
const scope={tenantId:'tenant',applicationId:'app',stationId:'station',listenerId:process.argv[4]};
const history=new DurableListenerCompletion(process.argv[3],{scope,verifyCompletion:()=>false,authorizeRead:()=>true,now:()=>4000});
try{
 const issuer=new GrooveGrantIssuer({scope,registry,history,policy:{version:1,creatorId:'artist',grooveIds:['groove'],minimumCompletions:[1]},
  seed:new Uint8Array(32).fill(7),issuerId:'issuer',verifyOpportunity:()=>true,verifyPolicy:()=>true,authorizeAccess:()=>true,
  territory:'US',now:()=>4000,deliverToEndpoint:async()=>false,
  resolveRights:()=>({tenantId:'tenant',assetRef:'bonus',uses:['reward'],territories:['US'],validFrom:'1970-01-01T00:00:00Z',validUntil:'2030-01-01T00:00:00Z'})});
 const result=issuer.claim({opportunity:JSON.parse(process.argv[5]),proof:'fixture'});
 process.stdout.write(JSON.stringify({state:result.state}));
}finally{history.close();registry.close();}
