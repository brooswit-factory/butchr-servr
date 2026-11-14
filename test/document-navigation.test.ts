import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createStore} from '../src/store.js';
import {serve} from '../src/server.js';
import {adminFixture,fixturePassword} from './admin-helper.js';

for(const production of [false,true])test(`cross-site top-level navigation serves only the public shell (production=${production})`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'servr-navigation-'));
 mkdirSync(join(root,'web'));writeFileSync(join(root,'web/control-panel.html'),'<!doctype html><title>Panel shell</title>');
 const store=createStore(':memory:');
 const setup=serve(store,0);try{await adminFixture(`http://127.0.0.1:${setup.port}`);}finally{await setup.stop(true);}
 const origin='https://butchr.example.test';
 const server=serve(store,0,pathToFileURL(root+'/'),production?{publicOrigin:origin}:{}),base=`http://127.0.0.1:${server.port}`;
 const proxy:Record<string,string>=production?{host:'butchr.example.test','x-forwarded-proto':'https','x-forwarded-host':'butchr.example.test'}:{};
 const request=(path:string,init:RequestInit={})=>fetch(base+path,{...init,headers:{...proxy,...init.headers as object}});
 const navigation={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
 try{
  for(const path of ['/','/login','/providers','/authorizations/11111111-1111-1111-1111-111111111111/rules']){
   const response=await request(path,{headers:navigation});
   expect(response.status).toBe(200);expect(await response.text()).toContain('Panel shell');
   expect(response.headers.get('set-cookie')).toBeNull();
  }
  const initial=await request('/api/auth/session'), pre=await initial.json(), cookie=initial.headers.get('set-cookie')!.split(';')[0]!;
  const login=await request('/api/auth/login',{method:'POST',headers:{origin:production?origin:base,cookie,'content-type':'application/json','x-butchr-servr-csrf':pre.csrf},body:JSON.stringify({password:fixturePassword})});
  expect(login.status).toBe(200);const session=await login.json(),state={csrf:session.csrf,cookie:login.headers.get('set-cookie')!.split(';')[0]!};
  for(const path of ['/api/state','/api/auth/session','/api/briefs','/assets/anything.js']){
   expect((await request(path,{headers:{...navigation,cookie:state.cookie}})).status).toBe(403);
  }
  for(const headers of [
   {...navigation,origin:'https://evil.invalid'},
   {...navigation,'sec-fetch-dest':'iframe'},
   {...navigation,'sec-fetch-mode':'cors'},
   {'sec-fetch-site':'cross-site'},
   {...navigation,'sec-fetch-site':'invalid'},
  ])expect((await request('/login',{headers})).status).toBe(403);
  expect((await request('/api/auth/logout',{method:'POST',headers:{...navigation,origin:production?origin:base,cookie:state.cookie,'content-type':'application/json','x-butchr-servr-csrf':state.csrf},body:'{}'})).status).toBe(403);
  expect((await request('/api/state',{headers:{cookie:state.cookie}})).status).toBe(200);
 }finally{await server.stop(true);store.close();rmSync(root,{recursive:true,force:true});}
});
