import type {Database} from 'bun:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {canonical,migrationRules,type DeliveryRule} from './migration-document.js';
import {Problem} from './problems.js';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
interface State{document:string;etag:string;rules:DeliveryRule[];revision:number}
interface Row{id:string;request_hash:string;source:string;old_document:string;new_document:string;created_at:string;reverted_at:string|null}
export function createRuleImport(db:Database,read:(auth:string)=>State,authorize:(auth:string,write?:boolean)=>void,persist:(auth:string,state:State,document:string,ids:string[])=>{etag:string;backupId:null;changedIds:string[]},limits={maxRecords:128,maxHistoryBytes:64_000_000}){
 db.exec('CREATE TABLE IF NOT EXISTS rule_imports(authorization_id TEXT NOT NULL REFERENCES authorizations(id),id TEXT NOT NULL,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,source TEXT NOT NULL,old_document TEXT NOT NULL,new_document TEXT NOT NULL,created_at TEXT NOT NULL,reverted_at TEXT,PRIMARY KEY(authorization_id,id),UNIQUE(authorization_id,idempotency_key))');
 function input(body:any){if(!body||Object.keys(body).some(k=>!['document','source','ifMatch','planHash','confirm','idempotencyKey'].includes(k)))throw new Problem(400,'Invalid migration request');
  const source=body.source;if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).sort().join(',')!=='briefDigest,manifestDigest,runtimeHead,sourceDigest'||!['briefDigest','manifestDigest','sourceDigest'].every(k=>typeof source[k]==='string'&&/^[0-9a-f]{64}$/.test(source[k]))||typeof source.runtimeHead!=='string'||!/^[0-9a-f]{40}$/.test(source.runtimeHead))throw new Problem(400,'Exact source/brief/manifest fingerprints required');
  const rules=migrationRules(body.document),document=canonical({rules});if(Buffer.byteLength(document)>8_000_000)throw new Problem(400,'Migration document too large');
  if(typeof body.ifMatch!=='string'||!/^[0-9a-f]{64}$/.test(body.ifMatch))throw new Problem(400,'Destination revision required');return {rules,document,source:canonical(source)};
 }
 function plan(auth:string,body:unknown){authorize(auth,true);const value=input(body),state=read(auth);if((body as any).ifMatch!==state.etag)throw new Problem(409,'Destination changed');
  if(state.rules.length&&canonical({rules:state.rules})!==value.document)throw new Problem(409,'Destination already has different rules; resolve before importing');
  const planHash=digest(canonical([auth,state.etag,value.document,value.source]));return {planHash,ifMatch:state.etag,ruleCount:value.rules.length,enabledCount:value.rules.filter(r=>r.enabled).length,documentDigest:digest(value.document),source:JSON.parse(value.source),requiresConfirm:true};
 }
 const receipt=(row:Row)=>({id:row.id,source:JSON.parse(row.source),previousEtag:digest(row.old_document),etag:digest(row.new_document),createdAt:row.created_at,revertedAt:row.reverted_at});
 const commit=db.transaction((auth:string,body:any)=>{authorize(auth,true);const value=input(body);if(!uuid.test(body.idempotencyKey)||body.confirm!==true)throw new Problem(400,'Explicit confirmation and UUID idempotency key required');
  const requestHash=digest(canonical([auth,body.ifMatch,body.planHash,value.document,value.source]));const existing=db.query('SELECT * FROM rule_imports WHERE authorization_id=? AND idempotency_key=?').get(auth,body.idempotencyKey) as Row|null;
  if(existing){if(existing.request_hash!==requestHash)throw new Problem(409,'Idempotency key belongs to another import');const current=read(auth);return {...receipt(existing),replayed:true,currentEtag:current.etag,applied:current.document===existing.new_document&&!existing.reverted_at};}
  const p=plan(auth,body);if(p.planHash!==body.planHash)throw new Problem(409,'Review the exact import plan');
  const state=read(auth);
  const history=db.query('SELECT count(*) AS n,COALESCE(sum(length(CAST(old_document AS BLOB))+length(CAST(new_document AS BLOB))),0) AS bytes FROM rule_imports').get() as {n:number;bytes:number};if(history.n>=limits.maxRecords||history.bytes+Buffer.byteLength(state.document)+Buffer.byteLength(value.document)>limits.maxHistoryBytes)throw new Problem(409,'Migration rollback history capacity reached');
  const row:Row={id:randomUUID(),request_hash:requestHash,source:value.source,old_document:state.document,new_document:value.document,created_at:new Date().toISOString(),reverted_at:null};
  persist(auth,state,value.document,value.rules.map(r=>r.id));db.query('INSERT INTO rule_imports VALUES (?,?,?,?,?,?,?,?,NULL)').run(auth,row.id,body.idempotencyKey,requestHash,value.source,state.document,value.document,row.created_at);return {...receipt(row),replayed:false,currentEtag:digest(value.document),applied:true};
 });
 const restore=db.transaction((auth:string,id:string,body:any)=>{authorize(auth,true);const row=db.query('SELECT * FROM rule_imports WHERE authorization_id=? AND id=?').get(auth,id) as Row|null;if(!row)throw new Problem(404,'Migration receipt not found');if(body?.confirm!==true)throw new Problem(400,'Confirm restore');const state=read(auth);
  if(row.reverted_at){if(state.document!==row.old_document)throw new Problem(409,'Destination changed since restore');return receipt(row);}
  if(body.ifMatch!==state.etag||state.document!==row.new_document)throw new Problem(409,'Destination changed since import');
  persist(auth,state,row.old_document,[]);const now=new Date().toISOString();db.query('UPDATE rule_imports SET reverted_at=? WHERE authorization_id=? AND id=?').run(now,auth,id);return {...receipt(row),revertedAt:now};
 });
 return {plan,commit,restore};
}
