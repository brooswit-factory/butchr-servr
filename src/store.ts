import { Database } from "bun:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, existsSync, lstatSync } from "node:fs";
import { dirname } from "node:path";
export class Problem extends Error { constructor(public status: number, message: string) { super(message); } }
const hash = (key: string) => createHash("sha256").update(key).digest("hex");
export function text(value: unknown, max: number, trim = true) { if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) throw new Problem(400, "Invalid text field"); return trim ? value.trim() : value; }
export function uuid(value: unknown) { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Problem(400, "Expected UUID v4"); return value; }
export function createStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  if(path!==":memory:" && existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) throw new Error("Unsafe database path");
  const db = new Database(path, {create: true});
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE;
  CREATE TABLE IF NOT EXISTS meta (id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS authorizations (id TEXT PRIMARY KEY,name TEXT NOT NULL,key_hash TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,revoked_at TEXT);
  CREATE TABLE IF NOT EXISTS deployments (authorization_id TEXT NOT NULL REFERENCES authorizations(id),id TEXT NOT NULL,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,PRIMARY KEY(authorization_id,id));
  CREATE TABLE IF NOT EXISTS sessions (authorization_id TEXT NOT NULL,deployment_id TEXT NOT NULL,id TEXT NOT NULL,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,PRIMARY KEY(authorization_id,deployment_id,id),FOREIGN KEY(authorization_id,deployment_id) REFERENCES deployments(authorization_id,id));
  CREATE TABLE IF NOT EXISTS briefs (id TEXT PRIMARY KEY,authorization_id TEXT NOT NULL REFERENCES authorizations(id),name TEXT NOT NULL,text TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  if (!db.query("SELECT id FROM meta").get()) db.query("INSERT INTO meta VALUES (?)").run(randomUUID());
  const serverId = (db.query("SELECT id FROM meta").get() as {id:string}).id;
  function issue(name: unknown) {
    const label = text(name,100); const id=randomUUID(); const key=`bsv1_${randomBytes(32).toString("base64url")}`;
    db.query("INSERT INTO authorizations VALUES (?,?,?,?,NULL)").run(id,label,hash(key),new Date().toISOString());
    return {id,key};
  }
  function authenticate(key: string | null) {
    if (!key || !/^bsv1_[A-Za-z0-9_-]{43}$/.test(key)) throw new Problem(401,"Invalid or revoked authorization");
    const auth=db.query("SELECT id FROM authorizations WHERE key_hash=? AND revoked_at IS NULL").get(hash(key)) as {id:string}|null;
    if (!auth) throw new Problem(401,"Invalid or revoked authorization"); return auth.id;
  }
  function briefs(auth: string) {return db.query("SELECT id,name,text,updated_at AS updatedAt FROM briefs WHERE authorization_id=? ORDER BY updated_at,id").all(auth) as {id:string;name:string;text:string;updatedAt:string}[];}
  const connect = db.transaction((auth: string, deployment: unknown, session: unknown) => {
    const d=uuid(deployment), s=uuid(session), now=new Date().toISOString();
    const deploymentExists=db.query("SELECT id FROM deployments WHERE authorization_id=? AND id=?").get(auth,d);
    if(!deploymentExists && (db.query("SELECT count(*) AS n FROM deployments WHERE authorization_id=?").get(auth) as {n:number}).n>=1000)throw new Problem(429,"Deployment limit reached");
    const sessionExists=db.query("SELECT id FROM sessions WHERE authorization_id=? AND deployment_id=? AND id=?").get(auth,d,s);
    if(!sessionExists && (db.query("SELECT count(*) AS n FROM sessions WHERE authorization_id=?").get(auth) as {n:number}).n>=10000)throw new Problem(429,"Session limit reached");
    db.query("INSERT INTO deployments VALUES (?,?,?,?) ON CONFLICT(authorization_id,id) DO UPDATE SET last_seen=excluded.last_seen").run(auth,d,now,now);
    db.query("INSERT INTO sessions VALUES (?,?,?,?,?) ON CONFLICT(authorization_id,deployment_id,id) DO UPDATE SET last_seen=excluded.last_seen").run(auth,d,s,now,now);
    return {serverId,authorizationId:auth,briefs:briefs(auth).map(b=>({...b,id:`remote:${serverId}:${auth}:${b.id}`,builtin:false,source:"remote" as const}))};
  });
  function snapshot() { return {serverId,authorizations:(db.query("SELECT id,name,created_at AS createdAt,revoked_at AS revokedAt FROM authorizations ORDER BY created_at").all() as {id:string}[]).map(a=>({...a, deployments:(db.query("SELECT id,first_seen AS firstSeen,last_seen AS lastSeen FROM deployments WHERE authorization_id=?").all(a.id) as {id:string}[]).map(d=>({...d,sessions:db.query("SELECT id,first_seen AS firstSeen,last_seen AS lastSeen FROM sessions WHERE authorization_id=? AND deployment_id=? ORDER BY first_seen").all(a.id,d.id)}))})),briefs:db.query("SELECT id,authorization_id AS authorizationId,name,text,updated_at AS updatedAt FROM briefs ORDER BY updated_at").all()}; }
  function revoke(id: string) {if (!db.query("UPDATE authorizations SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(new Date().toISOString(),id).changes) throw new Problem(404,"Active authorization not found");}
  function saveBrief(input: any, id?: string) {
    const auth=uuid(input.authorizationId), name=text(input.name,100), content=text(input.text,200000,false);
    if (/[\x00-\x1f\x7f]/.test(name) || content.startsWith("@builtin:")) throw new Problem(400,"Brief must have a single-line name and instructions, not a built-in reference");
    if (!db.query("SELECT id FROM authorizations WHERE id=? AND revoked_at IS NULL").get(auth)) throw new Problem(400,"Choose an active authorization");
    if (id) {if (!db.query("UPDATE briefs SET name=?,text=?,updated_at=? WHERE id=? AND authorization_id=?").run(name,content,new Date().toISOString(),uuid(id),auth).changes) throw new Problem(404,"Brief not found");}
    else {if ((db.query("SELECT count(*) AS n FROM briefs WHERE authorization_id=?").get(auth) as {n:number}).n>=100) throw new Problem(400,"Brief limit reached"); id=randomUUID(); db.query("INSERT INTO briefs VALUES (?,?,?,?,?)").run(id,auth,name,content,new Date().toISOString());} return {id};
  }
  function deleteBrief(id:string) {if(!db.query("DELETE FROM briefs WHERE id=?").run(uuid(id)).changes) throw new Problem(404,"Brief not found");}
  return {issue,authenticate,connect,snapshot,revoke,saveBrief,deleteBrief,close:()=>db.close()};
}
export type Store = ReturnType<typeof createStore>;
