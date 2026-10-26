import {parseRules,type Rule} from '../vendor/butchr/src/rules/rules.js';
import {Problem} from './problems.js';
/** Compatibility data only: the server never executes these rules. */
export type DeliveryRule=Rule&{maxLinkedTurnsPerHour?:number;account?:'none'};
export const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v)??'null';
export function migrationRules(document:unknown):DeliveryRule[]{
 if(!document||typeof document!=='object'||Array.isArray(document)||Object.keys(document).some(k=>k!=='rules'))throw new Problem(400,'Migration document may contain only rules');
 const raw=(document as {rules?:unknown})?.rules;if(!Array.isArray(raw)||raw.length>100)throw new Problem(400,'Expected at most 100 complete rule definitions');
 for(const value of raw){
  if(!value||typeof value!=='object')throw new Problem(400,'Invalid rule definition');const r=value as Record<string,unknown>;
  if('resumeContextCutoff' in r)throw new Problem(400,'resumeContextCutoff requires an explicit compatibility mapping');
  if('account' in r&&r.account!=='none')throw new Problem(400,'Nondefault legacy account requires an explicit compatibility mapping');
  if('maxLinkedTurnsPerHour' in r&&(!Number.isSafeInteger(r.maxLinkedTurnsPerHour)||Number(r.maxLinkedTurnsPerHour)<=0))throw new Problem(400,'Invalid preserved linked-turn limit');
  if((Array.isArray(r.mcpServers)&&r.mcpServers.length)||r.mcpConfigFile)throw new Problem(400,'Host-local MCP bindings require a local mapping before migration');
 }
 const warnings:string[]=[];let rules:Rule[];try{rules=parseRules(document,'migration',warnings);}catch{throw new Problem(400,'Invalid or unsupported migration rule fields');}if(warnings.length)throw new Problem(400,'Migration fields require explicit compatibility review');
 return rules.map((r,i)=>({...r,...('maxLinkedTurnsPerHour' in raw[i]?{maxLinkedTurnsPerHour:raw[i].maxLinkedTurnsPerHour}:{}),...('account' in raw[i]?{account:'none' as const}:{})}));
}
/** Preserve supported legacy data when normal APIs read/edit a migrated document. */
export function deliveryRules(document:unknown):DeliveryRule[]{
 let rules:Rule[];try{rules=parseRules(document,'remote rules');}catch{throw new Problem(400,'Invalid rule definition');}
 const raw=(document as {rules:Record<string,unknown>[]}).rules;
 return rules.map((rule,index)=>{const old=raw[index]!;if('maxLinkedTurnsPerHour' in old&&(!Number.isSafeInteger(old.maxLinkedTurnsPerHour)||Number(old.maxLinkedTurnsPerHour)<=0))throw new Problem(400,'Invalid preserved linked-turn limit');return {...rule,...('maxLinkedTurnsPerHour' in old?{maxLinkedTurnsPerHour:Number(old.maxLinkedTurnsPerHour)}:{}),...(old.account==='none'?{account:'none' as const}:{})};});
}
