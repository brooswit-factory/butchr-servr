import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStore} from '../src/store.js';
import {createEventStreams} from '../src/events.js';
import {serve} from '../src/server.js';
import {adminFixture} from './admin-helper.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const source={sourceDigest:hash('fixture source'),manifestDigest:hash('fixture manifest'),briefDigest:hash('fixture briefs'),runtimeHead:'1'.repeat(40)};
const document={rules:[{id:'fixture',resourceProvider:'jira-work',query:'project = FIXTURE',brief:'Complete synthetic text. '.repeat(400),enabled:false,maxLinkedTurnsPerHour:2,maxNewPerTick:1,minSecondsBetweenAdmissions:60,agentPreferences:[{harness:'claude'},{harness:'codex'}]}]};
function request(s:ReturnType<typeof createStore>,id:string){const body={document,source,ifMatch:s.remoteRules.list(id).sourceEtag};return {...body,planHash:s.remoteRules.migration.plan(id,body).planHash,confirm:true,idempotencyKey:randomUUID()};}
async function frame(reader:ReadableStreamDefaultReader<Uint8Array>){let text='';while(!text.endsWith('\n\n')){const n=await reader.read();if(n.done)throw Error('closed');text+=new TextDecoder().decode(n.value);}return {event:/event: (.*)\n/.exec(text)![1],data:JSON.parse(/data: (.*)\n/.exec(text)![1]!)};}
test('post-write history failure rolls back rules/revision without SSE; restart and restore converge',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'butchr-import-fixture-')),path=join(dir,'fixture.sqlite');let s=createStore(path);const a={id:'00000000-0000-4000-8000-000000000001',key:'bsv1_'+'M'.repeat(43)},b={id:'00000000-0000-4000-8000-000000000002'};const db=new Database(path);for(const fixture of [a,{...b,key:'bsv1_'+'N'.repeat(43)}])db.query('INSERT INTO authorizations VALUES (?,?,?,?,NULL)').run(fixture.id,'Explicit nonsecret disposable fixture',hash(fixture.key),'2026-01-01T00:00:00Z');let notifications=0;const off=s.subscribe(()=>notifications++);let streams=createEventStreams(s);let reader=streams.open(a.id,new AbortController().signal).body!.getReader();
 try{const initial=await frame(reader),before=s.delivery(a.id),body=request(s,a.id);
 db.exec("CREATE TRIGGER fixture_history_failure BEFORE INSERT ON rule_imports BEGIN SELECT RAISE(ABORT,'fixture history write failed'); END");
 expect(()=>s.remoteRules.migration.commit(a.id,body)).toThrow('fixture history');expect(s.delivery(a.id)).toEqual(before);expect(db.query('SELECT * FROM remote_rule_sets').all()).toEqual([]);expect(db.query('SELECT * FROM rule_imports').all()).toEqual([]);expect(notifications).toBe(0);
 db.exec('DROP TRIGGER fixture_history_failure');const receipt=s.remoteRules.migration.commit(a.id,body),patch=await frame(reader);expect(patch.event).toBe('patch');expect(patch.data.baseRevision).toBe(initial.data.revision);expect(patch.data.patch).toHaveLength(1);expect(patch.data.patch[0].path).toBe('/remoteRules');expect(patch.data.patch[0].value.rules[0].definition.brief).toBe(document.rules[0]!.brief);expect(s.delivery(b.id).remoteRules.rules).toEqual([]);
 await reader.cancel();streams.close();off();s.close();s=createStore(path);expect(s.authenticate(a.key)).toBe(a.id);expect(s.remoteRules.migration.commit(a.id,body).replayed).toBe(true);expect(s.delivery(a.id).remoteRules.rules[0]!.definition.maxLinkedTurnsPerHour).toBe(2);
 streams=createEventStreams(s);reader=streams.open(a.id,new AbortController().signal).body!.getReader();expect((await frame(reader)).data.state.remoteRules.rules).toHaveLength(1);s.remoteRules.migration.restore(a.id,receipt.id,{confirm:true,ifMatch:receipt.etag});expect((await frame(reader)).data.patch[0].value.rules).toEqual([]);expect(s.remoteRules.migration.commit(a.id,body).applied).toBe(false);
 }finally{await reader.cancel();streams.close();off();db.close();s.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP import enforces CSRF, management scope, key type, revocation and authorization binding',async()=>{
 const s=createStore(':memory:'),server=serve(s,0),url=`http://127.0.0.1:${server.port}`,a=s.issue('Memory A'),b=s.issue('Memory B'),path=`/api/authorizations/${a.id}/rule-import`;
 const call=(p:string,body:unknown,headers:Record<string,string>={})=>fetch(url+p,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 try{const body=request(s,a.id);expect((await call(path+'/plan',body)).status).toBe(403);const owner=await adminFixture(url);expect((await call(path+'/plan',body,{cookie:owner.cookie,origin:url})).status).toBe(403);
 const r=s.managementKeys.issue({name:'Fixture reader',scopes:['rules:read'],expiresInDays:1}),w=s.managementKeys.issue({name:'Fixture writer',scopes:['rules:write'],expiresInDays:1}),bearer={authorization:'Bearer '+w.key};
 expect((await call(path+'/plan',body,{authorization:'Bearer '+r.key})).status).toBe(403);expect((await call(path+'/plan',body,{authorization:'Bearer '+a.key})).status).toBe(401);expect((await call(path+'/plan',body,{...bearer,origin:url})).status).toBe(403);expect((await call(path+'/plan',body,{...bearer,host:'hostile.invalid'})).status).toBe(403);expect((await call(path+'/plan',body,bearer)).status).toBe(200);
 expect((await call(`/api/authorizations/${b.id}/rule-import`,body,bearer)).status).toBe(409);expect((await call(path,body,bearer)).status).toBe(200);expect(s.delivery(b.id).remoteRules.rules).toEqual([]);s.managementKeys.revoke(w.id);expect((await call(path,body,bearer)).status).toBe(401);s.revoke(a.id);expect((await call(path+'/plan',{...body,ifMatch:s.remoteRules.list(a.id).sourceEtag},{cookie:owner.cookie,origin:url,'x-butchr-servr-csrf':owner.csrf})).status).toBe(403);
 }finally{await server.stop(true);s.close();}
});
