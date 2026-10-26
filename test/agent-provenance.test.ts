import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Database} from 'bun:sqlite';
import {randomUUID} from 'node:crypto';
import {validateEvent} from '../src/telemetry-wire.js';
import {createStore} from '../src/store.js';
const agent=(provenance?:unknown)=>({id:'a'.repeat(64),status:'idle',confirmedAt:new Date().toISOString(),...(provenance===undefined?{}:{provenance})});
const event=(a:unknown,sequence=1)=>({id:randomUUID(),sequence,occurredAt:new Date().toISOString(),type:'session.snapshot',data:{mode:'daemon',controllersEnabled:true,remoteConfigsEnabled:true,transportConnected:true,agentsChecked:true,agentsTruncated:false,agents:[a]}});
const provenance={provider:'confluence-page',kind:'resource',ruleId:'fixture-rule',resourceId:'90071992547409931234'};
test('legacy payloads still validate; structured IDs stay strings and reject arbitrary content',()=>{
 expect(validateEvent(event(agent())).data.agents[0]!.provenance).toBeUndefined();expect(validateEvent(event(agent(provenance))).data.agents[0]!.provenance!.resourceId).toBe(provenance.resourceId);
 for(const bad of [{...provenance,query:'secret filter'},{...provenance,prompt:'secret'},{...provenance,resourceId:123},{...provenance,resourceId:'<script>alert(1)</script>'},{...provenance,ruleId:'bad\nrule'},{...provenance,provider:'unknown'},{...provenance,provider:['jira-work']},{...provenance,kind:'query'},{...provenance,provider:'filesystem',resourceId:'/private/path'},{...provenance,resourceId:'1'.repeat(513)}])expect(()=>validateEvent(event(agent(bad)))).toThrow();
 expect(()=>validateEvent(event(agent({provider:'filesystem',kind:'resource',ruleId:'fixture'})))).not.toThrow();expect(()=>validateEvent(event(agent({provider:'github-pr',kind:'query',ruleId:'fixture'})))).not.toThrow();
});
test('provenance stays scoped, persists and cannot partially replace a valid session on rejection',()=>{
 const store=createStore(':memory:'),a=store.issue('Disposable A'),b=store.issue('Disposable B'),d=randomUUID(),s=randomUUID();try{store.connect(a.id,d,s);const body=(events:unknown[])=>({deploymentId:d,sessionId:s,events});store.telemetry.ingest(a.id,body([event(agent(provenance))]));expect(store.telemetry.session(a.id,d,s)!.snapshot.agents[0]!.provenance).toEqual(provenance);expect(store.telemetry.session(b.id,d,s)).toBeNull();expect(()=>store.telemetry.ingest(b.id,body([event(agent(provenance))]))).toThrow();expect(()=>store.telemetry.ingest(a.id,body([event(agent(),2),event(agent({...provenance,query:'forbidden'}),3)]))).toThrow();expect(store.telemetry.session(a.id,d,s)!.sequence).toBe(1);store.revoke(a.id);expect(()=>store.telemetry.ingest(a.id,body([event(agent(),2)]))).toThrow();}finally{store.close();}
});

test('optional provenance persists across store reopen without schema migration or identity change',()=>{
 const directory=mkdtempSync(join(tmpdir(),'provenance-disposable-')),path=join(directory,'db');let store=createStore(path);store.close();const a={id:randomUUID()},d=randomUUID(),s=randomUUID(),db=new Database(path);db.query('INSERT INTO authorizations(id,name,key_hash,created_at,revoked_at) VALUES (?,?,?,?,NULL)').run(a.id,'Fixed noncredential fixture','0'.repeat(64),new Date().toISOString());db.close();store=createStore(path);try{store.connect(a.id,d,s);store.telemetry.ingest(a.id,{deploymentId:d,sessionId:s,events:[event(agent(provenance))]});store.close();store=createStore(path);const snapshot=store.telemetry.session(a.id,d,s)!;expect(snapshot.sequence).toBe(1);expect(snapshot.snapshot.agents[0]!.provenance).toEqual(provenance);expect(snapshot.snapshot.agents[0]!.id).toBe('a'.repeat(64));}finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('admitted rule scope rejects spoofing and links only matching current definitions in its authorization',()=>{
 const store=createStore(':memory:'),a=store.issue('Memory origin A'),b=store.issue('Memory origin B'),d=randomUUID(),s=randomUUID(),serverId=store.snapshot().serverId;try{store.connect(a.id,d,s);const draft={id:'fixture-rule',resourceProvider:'confluence-page',query:'{"ancestor":"123"}',brief:'Disposable instructions',confirm:true};store.remoteRules.create(a.id,draft);store.remoteRules.create(b.id,draft);const origin={id:'fixture-rule',name:'fixture-rule',source:'remote',serverId,authorizationId:a.id},body=(provenance:unknown,sequence=1)=>({deploymentId:d,sessionId:s,events:[event(agent(provenance),sequence)]});
 expect(()=>store.telemetry.ingest(a.id,body({...provenance,admittedRule:{...origin,authorizationId:b.id}}))).toThrow();expect(()=>store.telemetry.ingest(a.id,body({...provenance,admittedRule:{...origin,serverId:randomUUID()}}))).toThrow();store.telemetry.ingest(a.id,body({...provenance,admittedRule:origin}));const historical=store.telemetry.session(a.id,d,s)!;expect(historical.ruleLinks['a'.repeat(64)]).toBe(`/authorizations/${a.id}/rules#rule-confluence-page--fixture-rule`);expect(store.telemetry.session(b.id,d,s)).toBeNull();const current=store.remoteRules.list(a.id);store.remoteRules.remove(a.id,'fixture-rule',{confirm:true,ifMatch:current.sourceEtag});const deleted=store.telemetry.session(a.id,d,s)!;expect(deleted.ruleLinks).toEqual({});expect(deleted.snapshot.agents[0]!.provenance!.admittedRule).toEqual(origin);
 }finally{store.close();}
});
