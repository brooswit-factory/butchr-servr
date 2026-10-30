import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {createStore} from '../src/store.js';
import {serve} from '../src/server.js';
import {publicOrigin,checkProxy,readJSON,requestRates} from '../src/hosting.js';
import {adminFixture,fixturePassword} from './admin-helper.js';
const origin='https://butchr.example.test',proxy={host:'butchr.example.test','x-forwarded-proto':'https','x-forwarded-host':'butchr.example.test'};
async function configured(){const s=createStore(':memory:'),local=serve(s,0);try{await adminFixture(`http://127.0.0.1:${local.port}`);}finally{await local.stop(true);}return s;}
test('explicit canonical HTTPS mode requires migrated owner, rejects hostile proxy headers',()=>{
 for(const value of ['http://panel.test','https://panel.test/','https://user:pass@panel.test','https://panel.test/path','https://panel.test?q=a','https://localhost','https://127.0.0.1','https://panel.test:443'])expect(()=>publicOrigin(value)).toThrow();
 expect(publicOrigin(origin)).toBe(origin);const s=createStore(':memory:');try{expect(()=>serve(s,0,undefined,{publicOrigin:origin})).toThrow('Configure the owner password');}finally{s.close();}
 for(const headers of [{...proxy,host:'evil.test'},{...proxy,'x-forwarded-proto':'http'},{...proxy,'x-forwarded-host':'evil.test'},{...proxy,forwarded:'proto=https'},{host:'butchr.example.test'}])expect(()=>checkProxy(new Request(origin,{headers}),origin,true)).toThrow();
 expect(()=>checkProxy(new Request(origin,{headers:{...proxy,'x-forwarded-for':'fake, arbitrary'}}),origin,true)).not.toThrow();
 expect(()=>checkProxy(new Request('http://127.0.0.1:7731',{headers:{host:'127.0.0.1:7731','x-forwarded-proto':'https'}}),'http://127.0.0.1:7731',false)).toThrow();
});
test('public admin auth preserves Secure sessions, logout, CSRF and closed setup',async()=>{
 const s=await configured(),server=serve(s,0,undefined,{publicOrigin:origin}),base=`http://127.0.0.1:${server.port}`;
 const request=(path:string,init:RequestInit={})=>fetch(base+path,{...init,headers:{...proxy,...init.headers as object}});
 try{
  expect((await fetch(base+'/api/state')).status).toBe(403);
  for(const path of ['/api/state','/api/briefs','/api/authorizations','/api/deployments','/api/management-keys','/v1/events'])expect((await request(path)).status).toBe(401);
  expect((await request('/setup')).status).toBe(403);expect((await request('/api/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'})).status).toBe(403);
  const pre=await request('/api/auth/session'),p=await pre.json(),preCookie=pre.headers.get('set-cookie')!.split(';')[0]!;
  expect(pre.headers.get('set-cookie')).toContain('; Secure');expect(pre.headers.get('strict-transport-security')).toBe('max-age=31536000');
  const login=await request('/api/auth/login',{method:'POST',headers:{origin,cookie:preCookie,'content-type':'application/json','x-butchr-servr-csrf':p.csrf},body:JSON.stringify({password:fixturePassword})});
  expect(login.status).toBe(200);expect(login.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');expect(login.headers.get('set-cookie')).toContain('; Secure');
  const cookie=login.headers.get('set-cookie')!.split(';')[0]!,session=await login.json();expect(cookie).not.toBe(preCookie);expect((await request('/api/state',{headers:{cookie}})).status).toBe(200);
  for(const h of [{origin:'https://evil.test','x-butchr-servr-csrf':session.csrf},{origin},{origin,'sec-fetch-site':'cross-site','x-butchr-servr-csrf':session.csrf}] as Record<string,string>[])expect((await request('/api/briefs',{method:'POST',headers:{...h,cookie,'content-type':'application/json'},body:'{}'})).status).toBe(403);
  expect((await request('/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({password:'x'.repeat(5000)})})).status).toBe(413);
  const logout=await request('/api/auth/logout',{method:'POST',headers:{origin,cookie,'content-type':'application/json','x-butchr-servr-csrf':session.csrf},body:'{}'});expect(logout.status).toBe(200);expect(logout.headers.get('set-cookie')).toContain('Secure');expect((await request('/api/state',{headers:{cookie}})).status).toBe(401);
 }finally{await server.stop(true);s.close();}
});
test('public machine stream snapshots, updates, reconnect, identity, limits and revoked access',async()=>{
 const s=await configured(),server=serve(s,0,undefined,{publicOrigin:origin}),base=`http://127.0.0.1:${server.port}`,key=s.issue('isolated'),tuple={deploymentId:randomUUID(),sessionId:randomUUID()},headers={...proxy,authorization:'Bearer '+key.key,'content-type':'application/json'};const controls:AbortController[]=[];
 try{
  expect((await fetch(base+'/v1/register',{method:'POST',headers,body:JSON.stringify(tuple)})).status).toBe(200);
  const connect=async()=>{const abort=new AbortController();controls.push(abort);return fetch(base+'/v1/events',{headers:{...headers,'x-butchr-deployment-id':tuple.deploymentId,'x-butchr-session-id':tuple.sessionId},signal:abort.signal});};
  let r=await connect();expect(r.status).toBe(200);let reader=r.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: snapshot');await reader.cancel();controls.at(-1)!.abort();
  r=await connect();reader=r.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: snapshot');
  const second=await connect();expect(second.status).toBe(200);expect((await connect()).status).toBe(429);
  s.saveBrief({name:'Isolated update',text:'No action'});expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: patch');expect(s.snapshot().authorizations[0]!.deployments[0]!.sessions).toHaveLength(1);
  s.revoke(key.id);expect((await connect()).status).toBe(401);
 }finally{controls.forEach(c=>c.abort());await server.stop(true);s.close();}
});
test('JSON bounds actual bytes, lying lengths and stalled uploads',async()=>{
 const request=(stream:ReadableStream<Uint8Array>,headers={})=>new Request('http://fixture/',{method:'POST',body:stream,headers,duplex:'half'} as RequestInit);
 const encoder=new TextEncoder(),body=(text:string)=>new ReadableStream<Uint8Array>({start(c){c.enqueue(encoder.encode(text));c.close();}});
 expect(await readJSON(request(body('{"ok":true}')),20)).toEqual({ok:true});
 await expect(readJSON(request(body('x'.repeat(40)),{'content-length':'1'}),20)).rejects.toThrow('too large');await expect(readJSON(request(body('{}'),{'content-length':'500'}),20)).rejects.toThrow('too large');await expect(readJSON(request(new ReadableStream()),20,15)).rejects.toThrow('timed out');
});

test('rate capacity refuses only new principals and expiry releases slots',()=>{
 const check=requestRates(2);check('a',2,0);check('b',2,0);expect(()=>check('a',2,0)).not.toThrow();expect(()=>check('c',2,0)).toThrow('capacity');expect(()=>check('a',2,0)).toThrow('shortly');expect(()=>check('c',2,60000)).not.toThrow();
});
