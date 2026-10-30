import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createStore} from '../src/store.js';
import {serve} from '../src/server.js';
import {adminFixture} from './admin-helper.js';
const integration=process.env.CADDY_TEST_BINARY?test:test.skip;
integration('real Caddy overwrites hostile proxy metadata and releases SSE slots after disconnect',async()=>{
 const s=createStore(':memory:'),local=serve(s,0);await adminFixture(`http://127.0.0.1:${local.port}`);await local.stop(true);
 const backend=serve(s,0,undefined,{publicOrigin:'https://butchr.brooswit.nexus'}),reserve=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response()});const port=reserve.port!;await reserve.stop(true);
 const root=mkdtempSync(tmpdir()+'/butchr-caddy-fixture-');let proc:ReturnType<typeof Bun.spawn>|undefined;
 try{
  const template=readFileSync(new URL('../deploy/Caddyfile',import.meta.url),'utf8');
  // Exercise exact production reverse_proxy block over isolated HTTP; no certs or trust-store changes.
  const block=/\n(\s*reverse_proxy[\s\S]*?)\n}\n/.exec(template)![1]!;
  expect(block).not.toContain('flush_interval');
  writeFileSync(root+'/Caddyfile',`{\n admin off\n auto_https off\n}\nhttp://127.0.0.1:${port} {\n${block.replace('127.0.0.1:7731',`127.0.0.1:${backend.port}`)}\n}\n`);
  proc=Bun.spawn([process.env.CADDY_TEST_BINARY!,'run','--config',root+'/Caddyfile','--adapter','caddyfile'],{stdout:'ignore',stderr:'ignore',env:{...process.env,XDG_DATA_HOME:root,XDG_CONFIG_HOME:root}});
  const base=`http://127.0.0.1:${port}`;let ready=false;for(let i=0;i<50;i++){try{if((await fetch(base+'/api/auth/session')).ok){ready=true;break;}}catch{}await Bun.sleep(20);}expect(ready).toBe(true);
  const h={forwarded:'proto=http;host=evil.test','x-forwarded-host':'evil.test','x-forwarded-proto':'http','x-forwarded-for':'untrusted'};
  const pre=await fetch(base+'/api/auth/session',{headers:h});expect(pre.status).toBe(200);expect(pre.headers.get('set-cookie')).toContain('Secure');expect((await fetch(base+'/api/state',{headers:h})).status).toBe(401);
  const key=s.issue('Isolated proxy fixture'),tuple={deploymentId:randomUUID(),sessionId:randomUUID()},headers={...h,authorization:'Bearer '+key.key,'content-type':'application/json'};
  expect((await fetch(base+'/v1/register',{method:'POST',headers,body:JSON.stringify(tuple)})).status).toBe(200);
  for(let i=0;i<6;i++){const abort=new AbortController(),response=await fetch(base+'/v1/events',{headers:{...headers,'x-butchr-deployment-id':tuple.deploymentId,'x-butchr-session-id':tuple.sessionId},signal:abort.signal});expect(response.status).toBe(200);const reader=response.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: snapshot');abort.abort();await reader.cancel().catch(()=>{});await Bun.sleep(30);}
  expect(s.snapshot().authorizations[0]!.deployments[0]!.sessions).toHaveLength(1);
 }finally{proc?.kill();if(proc)await proc.exited;await backend.stop(true);s.close();rmSync(root,{recursive:true,force:true});}
},15000);
