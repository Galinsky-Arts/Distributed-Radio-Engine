import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createPreviewServer} from '../preview-server.mjs';
test('preview health and readiness are deliberately distinct',async()=>{
 const srv=createPreviewServer();srv.listen(0,'127.0.0.1');await once(srv,'listening');
 const url='http://127.0.0.1:'+srv.address().port;
 try{
  const health=await fetch(url+'/healthz');assert.equal(health.status,200);assert.equal((await health.json()).broadcasting,false);
  const ready=await fetch(url+'/readyz');assert.equal(ready.status,503);const body=await ready.json();assert.equal(body.ready,false);assert.equal(body.production,false);assert.match(body.reason,/device qualification/);assert.match(body.reason,/external human audit is not a prerequisite/);
  const status=await fetch(url+'/api/status');assert.equal(status.status,200);assert.equal((await status.json()).productionReady,false);
  const page=await fetch(url+'/');const html=await page.text();assert.equal(page.status,200);assert.match(html,/not broadcasting/);
 }finally{srv.close();await once(srv,'close');}
});
test('unsafe methods and unknown endpoints are not accepted',async()=>{
 const srv=createPreviewServer();srv.listen(0,'127.0.0.1');await once(srv,'listening');
 const url='http://127.0.0.1:'+srv.address().port;
 try{assert.equal((await fetch(url+'/api/status',{method:'POST'})).status,405);assert.equal((await fetch(url+'/missing')).status,404);}
 finally{srv.close();await once(srv,'close');}
});
