import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRadioJoin,recoverRadioJoin} from '../src/radio-join.mjs';
const program={stationId:'station',version:1,digest:'digest',durationMs:6000,timeline:[
{ref:'opening',role:'opening',fromMs:0,toMs:1000},{ref:'song',role:'content',fromMs:1000,toMs:5000},{ref:'outro',role:'closing',fromMs:5000,toMs:6000}]};
const base={program,startedAtMs:10000,route:{clientType:'web',status:'ready'},evidence:{status:'unverified'}};
test('late join enters current segment and not track start',()=>{
  const join=createRadioJoin({...base,nowMs:13500});
  assert.equal(join.segmentRef,'song'); assert.equal(join.segmentOffsetMs,2500);assert.equal(join.seekable,false);
});
test('recovery follows wall-clock boundary across cycles',()=>{
  const join=recoverRadioJoin({...base,nowMs:16700});assert.equal(join.cycle,1);assert.equal(join.segmentRef,'opening');
});
test('route and evidence truthfully preserve degraded state',()=>{
  const join=createRadioJoin({...base,nowMs:11000,route:{clientType:'native',status:'recovering'},evidence:{status:'unavailable'}});
  assert.equal(join.route.status,'recovering');assert.equal(join.evidence.status,'unavailable');
});
test('reject timeline overlaps and unsafe elapsed clock arithmetic',()=>{
  const overlapping={...program,timeline:[{ref:'one',fromMs:0,toMs:2000},{ref:'two',fromMs:1000,toMs:6000}]};
  assert.throws(()=>createRadioJoin({...base,nowMs:11000,program:overlapping}));
  assert.throws(()=>createRadioJoin({...base,startedAtMs:-Number.MAX_SAFE_INTEGER,nowMs:Number.MAX_SAFE_INTEGER}));
});
test('reject invalid time, route and incomplete timeline',()=>{
  assert.throws(()=>createRadioJoin({...base,nowMs:9999}));
  assert.throws(()=>createRadioJoin({...base,nowMs:10000,route:{clientType:'unknown',status:'ready'}}));
  assert.throws(()=>createRadioJoin({...base,nowMs:10000,program:{...program,timeline:[]}}));
});
test('join snapshots whitelist route/evidence metadata and reject invalid identities',()=>{
  const join=createRadioJoin({...base,nowMs:11000,
    route:{clientType:'web',status:'ready',privateKey:'not public'},
    evidence:{status:'unverified',rawAmbientAudio:'not public'}});
  assert.deepEqual(join.route,{clientType:'web',status:'ready'});
  assert.deepEqual(join.evidence,{status:'unverified'});
  for(const change of [{stationId:''},{digest:''},{version:0},
    {timeline:[null]}, {timeline:[{ref:'',role:'content',fromMs:0,toMs:6000}]},
    {timeline:[{ref:'segment',role:'unknown',fromMs:0,toMs:6000}]}])
    assert.throws(()=>createRadioJoin({...base,nowMs:11000,program:{...program,...change}}));
});

