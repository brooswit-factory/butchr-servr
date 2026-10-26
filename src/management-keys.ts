import type {Database} from 'bun:sqlite';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Problem} from './problems.js';
import {MANAGEMENT_SCOPES,type ManagementScope} from "./management-scopes.js";
const hash=(key:string)=>createHash('sha256').update(key).digest('hex');
interface Row{id:string;name:string;scopes:string;created_at:string;expires_at:string;revoked_at:string|null;last_used_at:string|null;active:number}
const metadata=(r:Row)=>({id:r.id,name:r.name,scopes:JSON.parse(r.scopes) as ManagementScope[],createdAt:r.created_at,expiresAt:r.expires_at,revokedAt:r.revoked_at,lastUsedAt:r.last_used_at,pending:!r.active});
export function createManagementKeys(db:Database,now=Date.now){
 db.exec('CREATE TABLE IF NOT EXISTS management_keys(id TEXT PRIMARY KEY,name TEXT NOT NULL,key_hash TEXT NOT NULL UNIQUE,scopes TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,last_used_at TEXT,active INTEGER NOT NULL DEFAULT 1)');
 function list(){return (db.query('SELECT id,name,scopes,created_at,expires_at,revoked_at,last_used_at,active FROM management_keys ORDER BY created_at,id').all() as Row[]).map(metadata);}
 function issue(body:any,active=true){
  if(!body||typeof body.name!=='string'||!body.name.trim()||body.name.length>100||body.name.includes('\0'))throw new Problem(400,'A key name of at most 100 characters is required');
  if(!Array.isArray(body.scopes)||!body.scopes.length||body.scopes.some((s:unknown)=>!MANAGEMENT_SCOPES.includes(s as ManagementScope))||new Set(body.scopes).size!==body.scopes.length)throw new Problem(400,'Choose valid, distinct management scopes');
  const days=body.expiresInDays;if(!Number.isInteger(days)||days<1||days>90)throw new Problem(400,'Expiry must be between 1 and 90 days');
  if((db.query('SELECT count(*) AS n FROM management_keys').get() as {n:number}).n>=1000)throw new Problem(409,'Management key history limit reached');
  const key='bsm1_'+randomBytes(32).toString('base64url'),row:Row={id:randomUUID(),name:body.name.trim(),scopes:JSON.stringify(body.scopes),created_at:new Date(now()).toISOString(),expires_at:new Date(now()+days*86400_000).toISOString(),revoked_at:null,last_used_at:null,active:active?1:0};
  db.query('INSERT INTO management_keys VALUES (?,?,?,?,?,?,NULL,NULL,?)').run(row.id,row.name,hash(key),row.scopes,row.created_at,row.expires_at,row.active);return {...metadata(row),key};
 }
 function authenticate(key:string){if(!/^bsm1_[A-Za-z0-9_-]{43}$/.test(key))throw new Problem(401,'Invalid or expired management key');const row=db.query('SELECT id,name,scopes,created_at,expires_at,revoked_at,last_used_at,active FROM management_keys WHERE key_hash=?').get(hash(key)) as Row|null;if(!row||!row.active||row.revoked_at||Date.parse(row.expires_at)<=now())throw new Problem(401,'Invalid or expired management key');return metadata(row);}
 function revoke(id:string){if(!db.query('UPDATE management_keys SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').run(new Date(now()).toISOString(),id).changes)throw new Problem(404,'Management key not found');return {ok:true};}
 function activate(id:string){if(!db.query('UPDATE management_keys SET active=1 WHERE id=? AND active=0 AND revoked_at IS NULL AND expires_at>?').run(id,new Date(now()).toISOString()).changes)throw new Problem(409,'Management key activation failed');}
 return {list,issue,issuePending:(body:unknown)=>issue(body,false),activate,authenticate,revoke,touch:(id:string)=>db.query('UPDATE management_keys SET last_used_at=? WHERE id=?').run(new Date(now()).toISOString(),id)};
}
/** Explicit allowlist: bearer keys never reach password/session/key-management APIs or aggregate browser state. */
export function managementScope(path:string,method:string):ManagementScope|null{
 if(path==='/api/authorizations')return method==='GET'?'authorizations:read':method==='POST'?'authorizations:create':null;
 if(/^\/api\/authorizations\/[0-9a-f-]{36}\/revoke$/.test(path)&&method==='POST')return 'authorizations:revoke';
 if(/^\/api\/authorizations\/[0-9a-f-]{36}\/rules(?:\/[a-zA-Z0-9_-]+)?(?:\/(?:details|plan|enabled))?$/.test(path)){if(method==='GET')return 'rules:read';if(['POST','PUT','DELETE'].includes(method))return 'rules:write';}
 if(path==='/api/briefs'&&method==='GET')return 'briefs:read';
 if((path==='/api/briefs'&&method==='POST')||(/^\/api\/briefs\/[0-9a-f-]{36}$/.test(path)&&['PUT','DELETE'].includes(method)))return 'briefs:write';
 if(path==='/api/deployments'&&method==='GET')return 'deployments:read';return null;
}
