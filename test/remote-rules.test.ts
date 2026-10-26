import {test,expect} from "bun:test";
import {createStore} from "../src/store.js";
import {serve} from "../src/server.js";
import {parseRules} from "../vendor/butchr/src/rules/rules.js";
const draft={id:"review-work",resourceProvider:"jira-work",query:"project = DISPOSABLE",brief:"    preserve indentation\n",agentPreferences:[{harness:"codex",model:"gpt-5.6-sol",effort:"high"}],execution:"singleton"};
test('shared Butchr model, disabled defaults, full editing, concurrency, deletion and auth isolation',()=>{
 const s=createStore(':memory:');try{
 const a=s.issue('Memory A'),b=s.issue('Memory B');const first=s.remoteRules.create(a.id,{...draft,confirm:false});expect(first.kind).toBe('needs-confirm');expect(s.remoteRules.list(a.id).rules).toHaveLength(0);
 const created=s.remoteRules.create(a.id,{...draft,confirm:true});expect(created.kind).toBe('created');const list=s.remoteRules.list(a.id);expect(list.rules[0]!.enabled).toBe(false);expect(list.rules[0]!.execution).toBe('singleton');expect(s.remoteRules.details(a.id,draft.id).brief).toBe(draft.brief);
 expect(s.remoteRules.list(b.id).rules).toEqual([]);expect(()=>s.remoteRules.details(b.id,draft.id)).toThrow();
 const patch={enabled:true};const plan=s.remoteRules.plan(a.id,draft.id,patch);expect(plan.scopeUnmeasurable).toBe(true);expect(plan.spawned).toBe(0);
 expect(()=>s.remoteRules.update(a.id,draft.id,{...patch,ifMatch:list.sourceEtag,planHash:'forged',confirm:true})).toThrow('Review');
 const result=s.remoteRules.update(a.id,draft.id,{...patch,ifMatch:list.sourceEtag,planHash:plan.planHash,confirm:true});expect(s.remoteRules.list(a.id).rules[0]!.enabled).toBe(true);
 expect(()=>s.remoteRules.update(a.id,draft.id,{query:'different',ifMatch:list.sourceEtag,planHash:plan.planHash,confirm:true})).toThrow('Rules changed');
 expect(()=>s.remoteRules.remove(a.id,draft.id,{ifMatch:result.etag,confirm:true})).toThrow('Disable');
 const disable=s.remoteRules.plan(a.id,draft.id,{enabled:false});const disabled=s.remoteRules.update(a.id,draft.id,{enabled:false,ifMatch:result.etag,planHash:disable.planHash,confirm:true});s.remoteRules.remove(a.id,draft.id,{ifMatch:disabled.etag,confirm:true});expect(s.remoteRules.list(a.id).rules).toEqual([]);
 expect(s.remoteRules.create(b.id,{...draft,confirm:true}).kind).toBe('created');s.revoke(b.id);expect(()=>s.remoteRules.create(b.id,{...draft,id:'another',confirm:true})).toThrow('revoked');
 }finally{s.close()}
});
test('same provider syntax/field validation as Butchr rejects incompatible remote definitions',()=>{
 const s=createStore(':memory:');try{const a=s.issue('Memory');for(const invalid of [{...draft,execution:'invalid'},{...draft,resourceProvider:'filesystem',query:'not JSON'},{...draft,resourceProvider:'github-issue',query:'is:pr'},{...draft,unexpected:'field'},{...draft,agentPreferences:[{harness:'codex',effort:'invalid'}]}]){expect(()=>s.remoteRules.create(a.id,{...invalid,confirm:true})).toThrow();}expect(s.remoteRules.list(a.id).rules).toEqual([]);
 const r=s.remoteRules.create(a.id,{...draft,confirm:true});expect(r.kind).toBe('created');expect(()=>parseRules({rules:s.remoteRules.delivery(a.id,'00000000-0000-4000-8000-000000000001').rules.map(r=>r.definition)})).not.toThrow();
 }finally{s.close()}
});
test('real HTTP rule routes keep CSRF, authorization scoping and machine-key separation',async()=>{
 const s=createStore(':memory:'),server=serve(s,0),url=`http://127.0.0.1:${server.port}`;
 try{const a=s.issue('Memory A'),b=s.issue('Memory B');const state=await(await fetch(url+'/api/state')).json();const base=`${url}/api/authorizations/${a.id}/rules`;
 const call=(path:string,method='GET',body?:unknown,csrf=state.csrf)=>fetch(path,{method,headers:{origin:url,'content-type':'application/json','x-butchr-servr-csrf':csrf},...(body?{body:JSON.stringify(body)}:{})});
 expect((await call(base,'POST',{...draft,confirm:true},'missing')).status).toBe(403);expect((await call(base,'POST',{...draft,confirm:true})).status).toBe(200);expect((await call(base,'POST',{...draft,id:'catalog',confirm:true})).status).toBe(200);expect((await(await call(base+'/catalog/details')).json()).brief).toBe(draft.brief);expect((await(await call(base+'/catalog')).json()).capacityRoles.values).toContain('worker');
 expect((await(await call(`${url}/api/authorizations/${b.id}/rules`)).json()).rules).toEqual([]);
 const connect=async(key:string)=>fetch(url+'/v1/connect',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify({deploymentId:crypto.randomUUID(),sessionId:crypto.randomUUID()})});
 const own=await(await connect(a.key)).json(),other=await(await connect(b.key)).json();expect(own.remoteRules.rules).toHaveLength(2);expect(other.remoteRules.rules).toHaveLength(0);expect(own.remoteRules.rules[0].id).toStartWith(`remote:${own.serverId}:${a.id}:`);expect(own.remoteRules.rules[0].definition.enabled).toBe(false);
 s.revoke(a.id);expect((await connect(a.key)).status).toBe(401);
 }finally{await server.stop(true);s.close()}
});
test('catalog exposes the exact shared editor capacity roles and supported harness catalog',()=>{
 const s=createStore(':memory:');try{const a=s.issue('Memory');const c=s.remoteRules.catalog(a.id);expect(c.capacityRoles.values).toEqual(['worker','sentinel']);expect(c.catalog.map(v=>v.harness)).toContain('codex');expect(c.briefs.some(b=>b.name==='task')).toBe(true);}finally{s.close()}
});
test('rule brief catalogs include the shared global library as independent text choices',()=>{
 const s=createStore(':memory:');try{const a=s.issue('Memory A'),b=s.issue('Memory B');s.saveBrief({authorizationId:a.id,name:'Scoped instructions',text:'Current instruction bytes\n'});const choices=s.remoteRules.catalog(a.id).briefs;expect(choices.some(c=>'customId' in c&&c.name==='Scoped instructions')).toBe(true);expect(s.remoteRules.catalog(b.id).briefs.some(c=>c.name==='Scoped instructions')).toBe(true);}finally{s.close()}
});
