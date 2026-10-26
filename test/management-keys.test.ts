import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {createManagementKeys} from '../src/management-keys.js';
import {createStore} from '../src/store.js';
import {serve} from '../src/server.js';
import {adminFixture} from './admin-helper.js';
import {randomUUID} from 'node:crypto';
test('strong hash-only scoped keys retain identity through migration, expire and revoke independently',()=>{
 const db=new Database(':memory:');let now=Date.now();const keys=createManagementKeys(db,()=>now);let copy:Database|undefined;
 try{for(const body of [{name:'x',scopes:[],expiresInDays:30},{name:'x',scopes:['passwords:write'],expiresInDays:30},{name:'x',scopes:['briefs:read'],expiresInDays:0},{name:'x',scopes:['briefs:read'],expiresInDays:91}])expect(()=>keys.issue(body)).toThrow();
 const first=keys.issue({name:'Memory fixture',scopes:['briefs:read'],expiresInDays:1}),second=keys.issue({name:'Other fixture',scopes:['rules:read'],expiresInDays:30});expect(first.key).toMatch(/^bsm1_[A-Za-z0-9_-]{43}$/);expect(JSON.stringify(db.query('SELECT * FROM management_keys').all())).not.toContain(first.key);expect(JSON.stringify(keys.list())).not.toContain(first.key);expect(keys.authenticate(first.key).id).toBe(first.id);
 copy=Database.deserialize(db.serialize());const migrated=createManagementKeys(copy,()=>now);expect(migrated.authenticate(first.key).id).toBe(first.id);expect(migrated.authenticate(first.key).scopes).toEqual(['briefs:read']);keys.revoke(second.id);expect(()=>keys.authenticate(second.key)).toThrow('Invalid');expect(keys.authenticate(first.key).id).toBe(first.id);now+=86400_000;expect(()=>keys.authenticate(first.key)).toThrow('expired');
 }finally{copy?.close();db.close();}
});
test('password-only issuance/revocation; bearer scopes, CSRF boundaries and machine keys stay separate',async()=>{
 const store=createStore(':memory:'),server=serve(store,0),url=`http://127.0.0.1:${server.port}`;
 const call=(path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>fetch(url+path,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{expect((await call('/api/management-keys')).status).toBe(401);const owner=await adminFixture(url),ownerHeaders={cookie:owner.cookie,origin:url,'x-butchr-servr-csrf':owner.csrf};
 expect((await call('/api/management-keys','POST',{name:'Blocked',scopes:['briefs:read'],expiresInDays:30},{cookie:owner.cookie,origin:url})).status).toBe(403);
 const issued=await call('/api/management-keys','POST',{name:'Disposable',scopes:['briefs:read'],expiresInDays:30},ownerHeaders);expect(issued.status).toBe(201);const key=await issued.json(),bearer={authorization:'Bearer '+key.key};store.saveBrief({name:'Fixture shared brief',text:'Harmless fixture'});
 expect((await(await call('/api/briefs','GET',undefined,bearer)).json()).briefs).toHaveLength(1);
 for(const path of ['/api/state','/api/auth/session','/api/management-keys','/api/authorizations','/api/deployments'])expect((await call(path,'GET',undefined,bearer)).status).toBe(403);
 expect((await call('/api/briefs','POST',{name:'Denied',text:'No'},bearer)).status).toBe(403);expect((await call('/api/briefs?key=forbidden','GET',undefined,bearer)).status).toBe(403);
 expect((await call('/api/briefs','GET',undefined,{...bearer,origin:url})).status).toBe(403);expect((await call('/api/briefs','GET',undefined,{...bearer,cookie:owner.cookie})).status).toBe(403);
 const rulesReader=store.managementKeys.issue({name:'Memory rules-only reader',scopes:['rules:read'],expiresInDays:30});const instance=store.issue('Memory machine');store.saveBrief({name:'Scope sentinel',text:'PRIVATE-GLOBAL-BRIEF-SCOPE-SENTINEL'});const catalog=await call(`/api/authorizations/${instance.id}/rules/catalog`,'GET',undefined,{authorization:'Bearer '+rulesReader.key});expect(catalog.status).toBe(403);expect(await catalog.text()).not.toContain('PRIVATE-GLOBAL-BRIEF-SCOPE-SENTINEL');expect((await call('/api/briefs','GET',undefined,{authorization:'Bearer '+instance.key})).status).toBe(401);expect((await call('/v1/register','POST',{deploymentId:randomUUID(),sessionId:randomUUID()},bearer)).status).toBe(401);
 const writer=store.managementKeys.issue({name:'Memory writer',scopes:['briefs:write','authorizations:create','rules:write','rules:read','deployments:read'],expiresInDays:30}),write={authorization:'Bearer '+writer.key};
 expect((await call('/api/briefs','POST',{name:'Created',text:'Safe'},write)).status).toBe(201);expect((await call('/api/deployments','GET',undefined,write)).status).toBe(200);
 for(const path of ['/api/auth/setup','/api/auth/login','/api/auth/logout','/api/auth/activity','/api/management-keys'])expect((await call(path,'POST',{},write)).status).toBe(403);
 const limited=store.managementKeys.issue({name:'Memory denied-rate fixture',scopes:['briefs:read'],expiresInDays:1});for(let attempt=0;attempt<120;attempt++)expect((await call('/api/state','GET',undefined,{authorization:'Bearer '+limited.key})).status).toBe(403);expect((await call('/api/state','GET',undefined,{authorization:'Bearer '+limited.key})).status).toBe(429);
 expect((await call(`/api/management-keys/${key.id}/revoke`,'POST',{},ownerHeaders)).status).toBe(200);expect((await call('/api/briefs','GET',undefined,bearer)).status).toBe(401);expect(JSON.stringify(await(await call('/api/management-keys','GET',undefined,ownerHeaders)).json())).not.toContain(key.key);
 }finally{await server.stop(true);store.close();}
});
test('secure local provisioning returns metadata only and stays inactive on vault failure',async()=>{
 const {provisionManagementKey}=await import('../src/key-provision.js');const db=new Database(':memory:'),keys=createManagementKeys(db);let stored='';
 try{const request={name:'Memory vault fixture',scopes:['briefs:read'],expiresInDays:30};const result=await provisionManagementKey(keys,request,async(_id,key)=>{stored=key;});expect(result).not.toHaveProperty('key');expect(keys.authenticate(stored).id).toBe(result.id);await expect(provisionManagementKey(keys,request,async()=>{throw Error('fixture vault unavailable')})).rejects.toThrow('inactive');expect(keys.list().filter(k=>k.revokedAt)).toHaveLength(1);}finally{db.close();}
});

test('vault/activation cleanup failures cannot turn a pending key into valid access',async()=>{
 const {provisionManagementKey}=await import('../src/key-provision.js');const db=new Database(':memory:'),keys=createManagementKeys(db);let raw='';const request={name:'Memory failure fixture',scopes:['briefs:read'],expiresInDays:30};
 try{await expect(provisionManagementKey({...keys,revoke:()=>{throw Error('fixture DB busy')}},request,async(_id,key)=>{raw=key;throw Error('fixture uncertain vault')})).rejects.toThrow('inactive');expect(()=>keys.authenticate(raw)).toThrow('Invalid');await expect(provisionManagementKey({...keys,activate:()=>{throw Error('fixture DB busy')}},request,async(_id,key)=>{raw=key})).rejects.toThrow('activation');expect(()=>keys.authenticate(raw)).toThrow('Invalid');expect(keys.list().every(k=>k.pending)).toBe(true);}finally{db.close();}
});
