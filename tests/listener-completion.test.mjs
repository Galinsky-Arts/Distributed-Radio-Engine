import {test} from 'node:test';import assert from 'node:assert/strict';
import {ListenerCompletion} from '../src/listener-completion.mjs';
const base={listenerId:'l1',creatorId:'artist',occurrenceId:'occ1',route:'headphones',foreground:true,unmuted:true,startedAtMs:0,completedAtMs:1000,requiredStartMs:0,requiredEndMs:1000};
test('headphones complete listening toward Grooves but not speaker points',()=>{
 const l=new ListenerCompletion(),r=l.complete(base);
 assert.equal(r.grooveEligible,true);assert.equal(r.speakerPointsEligible,false);
});
test('muted or stopped background session does not complete',()=>{
 const l=new ListenerCompletion();
 assert.equal(l.complete({...base,foreground:false}).complete,false);
 assert.equal(l.complete({...base,unmuted:false}).complete,false);
 assert.equal(l.history('l1','artist').length,0);
});
test('replay preserves one completion and does not reroll route',()=>{
 const l=new ListenerCompletion();l.complete(base);
 const r=l.complete({...base,route:'speaker'});
 assert.equal(r.replayed,true);assert.equal(r.speakerPointsEligible,false);
 assert.equal(l.history('l1','artist').length,1);
});
test('late joins and invalid timelines do not complete',()=>{
 const l=new ListenerCompletion();
 assert.equal(l.complete({...base,startedAtMs:1}).complete,false);
 assert.throws(()=>l.complete({...base,completedAtMs:-1}));
});

test('a declared speaker route is not verified speaker-point eligibility',()=>{
 const l=new ListenerCompletion({maxCompletions:1});
 assert.equal(l.complete({...base,route:'speaker'}).speakerPointsEligible,false);
 assert.throws(()=>l.complete({...base,occurrenceId:'other'}),/capacity/);
});
