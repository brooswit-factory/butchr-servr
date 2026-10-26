import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {createAdminAuth} from '../src/admin-auth.js';
import {createStore} from '../src/store.js';
import {serve} from '../src/server.js';
import {adminFixture,fixturePassword} from './admin-helper.js';
import {randomUUID} from 'node:crypto';
test('all admin data/routes require a browser session, machine keys cannot grant admin access',async()=>{
 const s=createStore(':memory:'),server=serve(s,0),url=`http://127.0.0.1:${server.port}`;
 try{expect((await fetch(url+'/api/state')).status).toBe(401);const key=s.issue('Memory machine');for(const path of ['/api/state','/api/authorizations','/api/briefs',`/api/authorizations/${key.id}/rules`,`/api/authorizations/${key.id}/rules/catalog`,'/api/unknown'])for(const method of ['GET','POST','PUT','DELETE']){const r=await fetch(url+path,{method,headers:{origin:url,'content-type':'application/json',authorization:'Bearer '+key.key},...(method==='GET'?{}:{body:'{}'})});expect(r.status).toBe(403);}
 const initial=await fetch(url+'/api/auth/session');expect((await initial.json()).configured).toBe(false);expect(initial.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
 const admin=await adminFixture(url);expect((await fetch(url+'/api/state',{headers:{cookie:admin.cookie}})).status).toBe(200);
 for(const headers of [{cookie:admin.cookie},{cookie:admin.cookie,'x-butchr-servr-csrf':admin.csrf,origin:'https://evil.invalid'}] as Record<string,string>[])expect((await fetch(url+'/api/briefs',{method:'POST',headers:{'content-type':'application/json',...headers},body:'{}'})).status).toBe(403);
 const tuple={deploymentId:randomUUID(),sessionId:randomUUID()};const machineHeaders={'content-type':'application/json',authorization:'Bearer '+key.key};expect((await fetch(url+'/v1/register',{method:'POST',headers:machineHeaders,body:JSON.stringify(tuple)})).status).toBe(200);
 const abort=new AbortController();const stream=await fetch(url+'/v1/events',{headers:{authorization:machineHeaders.authorization,'x-butchr-deployment-id':tuple.deploymentId,'x-butchr-session-id':tuple.sessionId},signal:abort.signal});expect(stream.status).toBe(200);abort.abort();
 const logout=await fetch(url+'/api/auth/logout',{method:'POST',headers:{origin:url,cookie:admin.cookie,'content-type':'application/json','x-butchr-servr-csrf':admin.csrf},body:'{}'});expect(logout.status).toBe(200);expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');expect((await fetch(url+'/api/state',{headers:{cookie:admin.cookie}})).status).toBe(401);
 }finally{await server.stop(true);s.close();}
});
test('one-time setup, fixation prevention, hash-only storage, expiry, restart durability and throttling',async()=>{
 const db=new Database(':memory:');let time=1_000_000;let auth=createAdminAuth(db,()=>time);const request=(cookie='',csrf='')=>new Request('http://127.0.0.1/',{method:'POST',headers:{cookie,'x-butchr-servr-csrf':csrf}});const pre=()=>{const p=auth.status(request());return {cookie:p.cookie!.split(';')[0]!,csrf:p.body.csrf}};
 try{let p=pre();expect(()=>auth.csrf(request(p.cookie,'bad'),p.csrf)).toThrow('CSRF');const result=await auth.login(request(p.cookie,p.csrf),{password:fixturePassword},true);const cookie=result.cookie.split(';')[0]!;expect(cookie).not.toBe(p.cookie);expect(auth.status(request(p.cookie)).body.authenticated).toBe(false);
 const hash=(db.query('SELECT hash FROM admin_password').get() as {hash:string}).hash;expect(hash).toStartWith('$argon2id$');expect(hash).not.toContain(fixturePassword);expect(JSON.stringify(db.query('SELECT * FROM admin_sessions').all())).not.toContain(cookie.split('=')[1]!);
 await expect(auth.login(request(p.cookie,p.csrf),{password:fixturePassword},true)).rejects.toThrow('Refresh');p=pre();await expect(auth.login(request(p.cookie,p.csrf),{password:fixturePassword},true)).rejects.toThrow('already');
 auth=createAdminAuth(db,()=>time);expect(auth.requireSession(request(cookie))).toBeTruthy();for(let i=0;i<29;i++){time+=60_000;expect(auth.requireSession(new Request('http://127.0.0.1/api/authorizations/fixture/rules',{headers:{cookie}}))).toBeTruthy();}time+=60_000;expect(()=>auth.requireSession(request(cookie))).toThrow('Login');
 p=pre();const logged=await auth.login(request(p.cookie,p.csrf),{password:fixturePassword},false);const active=logged.cookie.split(';')[0]!;for(let i=0;i<16;i++){time+=29*60_000;expect(auth.requireSession(request(active))).toBeTruthy();}time+=17*60_000;expect(()=>auth.requireSession(request(active))).toThrow('Login');
 for(let i=0;i<5;i++){p=pre();await expect(auth.login(request(p.cookie,p.csrf),{password:'Incorrect fixture password'},false)).rejects.toThrow('Incorrect');}p=pre();await expect(auth.login(request(p.cookie,p.csrf),{password:fixturePassword},false)).rejects.toThrow('Too many');time+=60_001;p=pre();expect((await auth.login(request(p.cookie,p.csrf),{password:fixturePassword},false)).body.authenticated).toBe(true);
 }finally{db.close();}
});
test('password and hashed sessions survive a real disposable database close/reopen',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const root=mkdtempSync(tmpdir()+'/butchr-admin-fixture-');let store=createStore(root+'/fixture.sqlite');
 try{const pre=store.adminAuth.status(new Request('http://fixture/'));const request=new Request('http://fixture/',{method:'POST',headers:{cookie:pre.cookie!.split(';')[0]!,'x-butchr-servr-csrf':pre.body.csrf}});const issued=await store.adminAuth.login(request,{password:fixturePassword},true);const cookie=issued.cookie.split(';')[0]!;store.close();store=createStore(root+'/fixture.sqlite');expect(store.adminAuth.status(new Request('http://fixture/',{headers:{cookie}})).body.authenticated).toBe(true);expect(store.adminAuth.status(new Request('http://fixture/')).body.configured).toBe(true);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
test('password boundary rejects seven characters and accepts eight without complexity requirements',async()=>{
 const db=new Database(':memory:'),auth=createAdminAuth(db);
 const setup=async(password:string)=>{const status=auth.status(new Request('http://fixture/'));return auth.login(new Request('http://fixture/',{method:'POST',headers:{cookie:status.cookie!.split(';')[0]!,'x-butchr-servr-csrf':status.body.csrf}}),{password},true);};
 try{await expect(setup('aaaaaaa')).rejects.toThrow('at least 8 characters');expect(auth.status(new Request('http://fixture/')).body.configured).toBe(false);expect((await setup('aaaaaaaa')).body.authenticated).toBe(true);}finally{db.close();}
});
