import {adminFixture} from "./admin-helper.js";
import {test,expect} from 'bun:test';
import {createStore} from '../src/store.js';
import {serve} from '../src/server.js';
import {authorizationRulesApi} from '../web/rules-api.js';
import {reviewChanges,saveChanges} from '../vendor/butchr/dashboard-app/src/view-model/rules-save.js';
import type {RuleCreateDraft} from '../vendor/butchr/dashboard-app/src/api/rules.js';
import type {RuleChange} from '../vendor/butchr/dashboard-app/src/view-model/rules-draft.js';
test('actual shared editor review/save flow creates, edits, enables, disables and deletes through server adapter',async()=>{
 const store=createStore(':memory:'),server=serve(store,0),url=`http://127.0.0.1:${server.port}`;
 try{const auth=store.issue('Disposable memory editor');const state=await adminFixture(url);
 const request=async(path:string,method='GET',body?:unknown)=>{const r=await fetch(url+path,{method,headers:{origin:url,cookie:state.cookie,'content-type':'application/json','x-butchr-servr-csrf':state.csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await r.json();if(!r.ok)throw Error(value.error);return value;};
 const api=authorizationRulesApi(auth.id,request);const draft:RuleCreateDraft={id:'editor-rule',resourceProvider:'jira-work' as const,query:'project = DISPOSABLE',execution:'persistent' as const,brief:'Instruction bytes\n',role:'worker' as const,agentPreferences:[{harness:'codex' as const,model:'gpt-5.6-sol',effort:'high' as const}]};
 async function apply(changes:RuleChange[]){const before=await api.listRules();const review=await reviewChanges(api,changes);expect(review.every(r=>!r.error)).toBe(true);const result=await saveChanges(api,review,before.sourceEtag);expect(result.allSaved).toBe(true);return result;}
 await apply([{kind:'create',key:'new',ruleId:draft.id,draft}]);expect((await api.listRules()).rules[0]!.enabled).toBe(false);
 await apply([{kind:'update',key:draft.id,ruleId:draft.id,patch:{query:'project = UPDATED',execution:'singleton',idlePokeEnabled:false}}]);
 expect((await api.listRules()).rules[0]!.execution).toBe('singleton');await apply([{kind:'enable',key:draft.id,ruleId:draft.id}]);expect((await api.listRules()).rules[0]!.enabled).toBe(true);
 await apply([{kind:'disable',key:draft.id,ruleId:draft.id},{kind:'delete',key:draft.id,ruleId:draft.id}]);expect((await api.listRules()).rules).toEqual([]);
 await expect(api.previewRule(draft.id)).rejects.toThrow('cannot be executed');
 }finally{await server.stop(true);store.close();}
});
