import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

function send(res,status,body,type='application/json; charset=utf-8') {
 res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"});
 res.end(body);
}
const repo='https://github.com/neophilism/Distributed-Radio-Engine';
export function createPreviewServer() {
 return createServer((req,res)=>{
  if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,JSON.stringify({error:'method_not_allowed'}));
  const path=req.url?.split('?')[0] ?? '/';
  if(path==='/healthz')return send(res,200,JSON.stringify({service:'distributed-radio-engine',status:'ok',environment:'development-preview',broadcasting:false}));
  if(path==='/readyz'||path==='/api/readiness')return send(res,503,JSON.stringify({ready:false,broadcasting:false,production:false,reason:'Native streaming, approved content, authenticated key delivery and device qualification are not complete; an external human audit is not a prerequisite',commit:process.env.RENDER_GIT_COMMIT??'unavailable'}));
  if(path==='/api/status')return send(res,200,JSON.stringify({project:'Distributed Radio Engine',stage:'development',productionReady:false,broadcasting:false,repo,commit:process.env.RENDER_GIT_COMMIT??'unavailable',reportedAt:new Date().toISOString(),independentReview:'pending',deviceQualification:'pending',upstreamIntegration:'pending'}));
  if(path==='/')return send(res,200,`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Distributed Radio Engine — Development Preview</title><style>body{margin:0;background:#101820;color:#e9eff3;font:16px system-ui,sans-serif}main{max-width:760px;margin:10vh auto;padding:24px}h1{font-size:clamp(30px,5vw,56px);line-height:1.1}p{line-height:1.6;color:#bdcdd6}.notice{border:1px solid #778c9b;border-radius:12px;padding:20px;background:#202f39}a{color:#a6d6ef}small{color:#9eb5c1}</style></head><body><main><small>NEOPHILISM / INFRASTRUCTURE</small><h1>Distributed Radio Engine</h1><div class="notice"><strong>Development preview — not broadcasting</strong><p>The reusable radio software is under active development. This endpoint is online to report service availability and readiness. It does not stream music, distribute content, or award verified speaker points.</p></div><p><a href="/api/status">Status JSON</a> · <a href="/api/readiness">Readiness checks</a> · <a href="${repo}">Source repository</a></p><small>Production requires tested audio clients, verified key delivery, streaming infrastructure and field qualification. Independent expert review may follow when funded.</small></main></body></html>`,'text/html; charset=utf-8');
  return send(res,404,JSON.stringify({error:'not_found'}));
 });
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const port=Number(process.env.PORT||10000);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
 createPreviewServer().listen(port,'0.0.0.0');
}
