import type {RulesApi,RuleCreateOutcome} from "../vendor/butchr/dashboard-app/src/api/rules.js";
export function authorizationRulesApi(authorizationId:string,request:(path:string,method?:string,body?:unknown)=>Promise<any>,canWrite:()=>boolean=()=>true):RulesApi{
 const base=`/api/authorizations/${encodeURIComponent(authorizationId)}/rules`,capabilities={get write(){return canWrite()}};
 const catalog=()=>request(base+'/catalog');
 return {capabilities,refreshCapabilities:async()=>capabilities,listRules:()=>request(base),getCatalog:async()=>(await catalog()).catalog,getCapacityRoles:async()=>(await catalog()).capacityRoles,getBriefs:async()=>(await catalog()).briefs,
 getRuleDetails:id=>request(`${base}/${encodeURIComponent(id)}/details`),
 previewRule:async()=>{throw Error("Provider queries cannot be executed by the control panel. Definitions are validated when reviewed and saved.");},
 planRule:(id,patch,confirm)=>request(`${base}/${encodeURIComponent(id)}/plan`,'POST',{...patch,confirm}),
 updateFields:(id,patch,ifMatch,planHash,confirm)=>request(`${base}/${encodeURIComponent(id)}`,'PUT',{...patch,ifMatch,planHash,confirm}),
 setEnabled:(id,enabled,ifMatch,planHash,confirm)=>request(`${base}/${encodeURIComponent(id)}/enabled`,'POST',{enabled,ifMatch,planHash,confirm}),
 createRule:async(draft,confirm)=>{try{return await request(base,'POST',{...draft,confirm}) as RuleCreateOutcome;}catch(e){return {kind:"refused",error:e instanceof Error?e.message:"Rule could not be created"};}},
 deleteRule:(id,ifMatch,confirm)=>request(`${base}/${encodeURIComponent(id)}`,'DELETE',{ifMatch,confirm}),undo:async()=>{throw Error("Undo is unavailable on the control panel; review and save another edit to revert a change.");}};
}
