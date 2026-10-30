import {test,expect} from 'bun:test';
import {randomUUID,createHash} from 'node:crypto';
import {Database} from 'bun:sqlite';
import {createStore} from '../src/store.js';
import {createRuleImport} from '../src/rule-import.js';
const h=(s:string)=>createHash('sha256').update(s).digest('hex');
const source={sourceDigest:h('source'),manifestDigest:h('manifest'),briefDigest:h('briefs'),runtimeHead:'1'.repeat(40)};
const brief='Complete synthetic instructions. '.repeat(100);
const document={rules:[{id:'worker',resourceProvider:'jira-work',query:'project = DISPOSABLE',brief,enabled:true,execution:'swarm',role:'worker',agentPreferences:[{harness:'claude'},{harness:'codex'}],maxNewPerTick:2,minSecondsBetweenAdmissions:60,maxLinkedTurnsPerHour:2,idlePokeEnabled:false,resumeOnRespawn:false},{id:'disabled',resourceProvider:'jira-work',query:'project = DISPOSABLE',brief:'Disabled fixture',enabled:false,role:'sentinel',account:'none'}]};
function input(store:ReturnType<typeof createStore>,auth:string){return {document,source,ifMatch:store.remoteRules.list(auth).sourceEtag};}
test('lossless import, idempotency, atomic failure, authorization isolation and non-destructive restore',()=>{
 const s=createStore(':memory:'),a=s.issue('Memory A'),b=s.issue('Memory B');
 try{
  const request=input(s,a.id),plan=s.remoteRules.migration.plan(a.id,request);expect(plan.ruleCount).toBe(2);expect(plan.enabledCount).toBe(1);expect(s.remoteRules.list(a.id).rules).toHaveLength(0);
  const body={...request,planHash:plan.planHash,idempotencyKey:randomUUID(),confirm:true},r=s.remoteRules.migration.commit(a.id,body),rules=s.delivery(a.id).remoteRules.rules;
  expect(r.applied).toBe(true);expect(rules[0]!.definition.agentPreferences).toHaveLength(2);expect(rules[0]!.definition.maxNewPerTick).toBe(2);expect(rules[0]!.definition.minSecondsBetweenAdmissions).toBe(60);expect(rules[0]!.definition.maxLinkedTurnsPerHour).toBe(2);expect(rules[0]!.definition.brief).toBe(brief);expect(rules[0]!.definition.resumeOnRespawn).toBe(false);expect(rules[0]!.definition.idlePokeEnabled).toBe(false);expect(rules[1]!.definition.enabled).toBe(false);
  expect(s.remoteRules.migration.commit(a.id,body).id).toBe(r.id);expect(s.remoteRules.migration.commit(a.id,body).replayed).toBe(true);
  expect(()=>s.remoteRules.migration.commit(a.id,{...body,source:{...source,briefDigest:h('other')}})).toThrow('Idempotency');expect(()=>s.remoteRules.migration.commit(b.id,body)).toThrow('exact');expect(s.remoteRules.list(b.id).rules).toHaveLength(0);
  expect(()=>s.remoteRules.migration.restore(b.id,r.id,{confirm:true,ifMatch:r.etag})).toThrow('not found');
  const restored=s.remoteRules.migration.restore(a.id,r.id,{confirm:true,ifMatch:r.etag});expect(restored.revertedAt).toBeTruthy();expect(s.remoteRules.list(a.id).rules).toHaveLength(0);expect(s.remoteRules.migration.commit(a.id,body).applied).toBe(false);expect(s.authenticate(a.key)).toBe(a.id);
 }finally{s.close();}
});
test('unsupported fields, coerced metadata, stale plans and intervening edits fail closed',()=>{
 const s=createStore(':memory:'),a=s.issue('Memory fixture');
 try{
  const request=input(s,a.id);for(const field of [{resumeContextCutoff:100},{account:'rotate'},{mcpConfigFile:'/local/only'},{maxLinkedTurnsPerHour:0}])expect(()=>s.remoteRules.migration.plan(a.id,{...request,document:{rules:[{...document.rules[0],...field}]}})).toThrow();
  for(const k of Object.keys(source))expect(()=>s.remoteRules.migration.plan(a.id,{...request,source:{...source,[k]:[(source as any)[k]]}})).toThrow('fingerprints');
  expect(()=>s.remoteRules.migration.plan(a.id,{...request,document:{rules:[],ignored:true}})).toThrow();const plan=s.remoteRules.migration.plan(a.id,request);
  expect(()=>s.remoteRules.migration.commit(a.id,{...request,planHash:'bad',idempotencyKey:randomUUID(),confirm:true})).toThrow('exact');expect(s.remoteRules.list(a.id).rules).toHaveLength(0);
  const body={...request,planHash:plan.planHash,idempotencyKey:randomUUID(),confirm:true},r=s.remoteRules.migration.commit(a.id,body),p=s.remoteRules.plan(a.id,'worker',{query:'project = CHANGED'});s.remoteRules.update(a.id,'worker',{query:'project = CHANGED',ifMatch:p.etag,planHash:p.planHash,confirm:true});
  expect(s.delivery(a.id).remoteRules.rules[0]!.definition.maxLinkedTurnsPerHour).toBe(2);expect(s.remoteRules.migration.commit(a.id,body).applied).toBe(false);expect(()=>s.remoteRules.migration.restore(a.id,r.id,{confirm:true,ifMatch:r.etag})).toThrow('changed');s.revoke(a.id);expect(()=>s.remoteRules.migration.plan(a.id,input(s,a.id))).toThrow('revoked');
 }finally{s.close();}
});
test('rollback history limits count UTF-8 bytes consistently',()=>{
 const db=new Database(':memory:');db.exec('CREATE TABLE authorizations(id TEXT PRIMARY KEY)');let persisted=false;
 const empty={document:'{"rules":[]}',etag:h('{"rules":[]}'),rules:[],revision:0};const service=createRuleImport(db,()=>empty,()=>{},()=>{persisted=true;return {etag:'',backupId:null,changedIds:[]};},{maxRecords:128,maxHistoryBytes:40});
 try{
  db.query('INSERT INTO rule_imports VALUES (?,?,?,?,?,?,?,?,NULL)').run('a',randomUUID(),randomUUID(),'x','{}','😀'.repeat(6),'😀'.repeat(6),'now');
  const request={document:{rules:[]},source,ifMatch:empty.etag},plan=service.plan('a',request);expect(()=>service.commit('a',{...request,planHash:plan.planHash,confirm:true,idempotencyKey:randomUUID()})).toThrow('capacity');expect(persisted).toBe(false);
 }finally{db.close();}
});
