import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Database} from 'bun:sqlite';
import {createStore} from '../src/store.js';
const event=(sequence:number)=>({id:randomUUID(),sequence,occurredAt:new Date().toISOString(),type:'session.snapshot',data:{mode:'management-only',controllersEnabled:false,remoteConfigsEnabled:true,transportConnected:true,agentsChecked:false,agentsTruncated:false,agents:[]}});
test('event ingestion binds registered tuples, validates metadata, deduplicates and rejects gaps atomically',()=>{
 const s=createStore(':memory:'),a=s.issue('Memory A'),b=s.issue('Memory B'),d=randomUUID(),session=randomUUID();s.connect(a.id,d,session);
 const batch=(events:unknown[])=>({deploymentId:d,sessionId:session,events});
 try{const first=event(1);expect(()=>s.telemetry.ingest(b.id,batch([first]))).toThrow('Register');expect(()=>s.telemetry.ingest(a.id,{...batch([first]),sessionId:randomUUID()})).toThrow('Register');
 expect(s.telemetry.ingest(a.id,batch([first])).acknowledgedSequence).toBe(1);expect(s.telemetry.ingest(a.id,batch([JSON.parse(JSON.stringify(first))])).acknowledgedSequence).toBe(1);
 expect(()=>s.telemetry.ingest(a.id,batch([{...first,data:{...first.data,prompt:'forbidden'}}]))).toThrow('payload');expect(()=>s.telemetry.ingest(a.id,batch([event(3)]))).toThrow('gap');
 expect(()=>s.telemetry.ingest(a.id,batch([event(2),{...event(3),data:{secret:'forbidden'}}]))).toThrow('payload');expect(s.telemetry.session(a.id,d,session)?.sequence).toBe(1);
 expect(()=>s.telemetry.ingest(a.id,batch([{...event(2),id:first.id}]))).toThrow('reused');
 for(let seq=2;seq<=75;seq++)s.telemetry.ingest(a.id,batch([event(seq)]));expect(s.telemetry.session(a.id,d,session)?.sequence).toBe(75);expect(s.telemetry.ingest(a.id,batch([first])).acknowledgedSequence).toBe(75);
 s.revoke(a.id);expect(()=>s.telemetry.ingest(a.id,batch([event(76)]))).toThrow('revoked');
 }finally{s.close();}
});
test('global brief migration preserves IDs, colliding names and bytes; event cursor survives server restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'global-brief-migration-')),path=join(dir,'db');const db=new Database(path);const a=randomUUID(),b=randomUUID(),id1=randomUUID(),id2=randomUUID(),timestamp=new Date().toISOString();
 db.exec('CREATE TABLE authorizations(id TEXT PRIMARY KEY,name TEXT,key_hash TEXT UNIQUE,created_at TEXT,revoked_at TEXT); CREATE TABLE briefs(id TEXT PRIMARY KEY,authorization_id TEXT,name TEXT,text TEXT,updated_at TEXT);');
 for(const id of [a,b])db.query('INSERT INTO authorizations VALUES (?,?,?,?,NULL)').run(id,'Memory',id,timestamp);
 db.query('INSERT INTO briefs VALUES (?,?,?,?,?)').run(id1,a,'Same name','  Original A\n',timestamp);db.query('INSERT INTO briefs VALUES (?,?,?,?,?)').run(id2,b,'Same name','Original B\n',timestamp);db.close();
 let s=createStore(path);try{const briefs=s.snapshot().briefs;expect(briefs.map((v:any)=>v.id).sort()).toEqual([id1,id2].sort());expect(briefs.map((v:any)=>v.text).sort()).toEqual(['  Original A\n','Original B\n'].sort());expect(briefs.every((v:any)=>!('authorizationId' in v))).toBe(true);
 const d=randomUUID(),sid=randomUUID();expect(s.connect(a,d,sid).briefs).toHaveLength(2);expect(s.connect(b,randomUUID(),randomUUID()).briefs).toHaveLength(2);const one=event(1);s.telemetry.ingest(a,{deploymentId:d,sessionId:sid,events:[one]});s.close();s=createStore(path);expect(s.telemetry.session(a,d,sid)?.sequence).toBe(1);expect(s.snapshot().briefs).toEqual(briefs);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('legacy aggregate101 promotes intact; over-capacity migration refuses without changing legacy records',()=>{
 for(const count of [101,1001]){const dir=mkdtempSync(join(tmpdir(),'global-capacity-')),path=join(dir,'db'),db=new Database(path),a=randomUUID(),b=randomUUID(),time=new Date().toISOString();
 db.exec('CREATE TABLE authorizations(id TEXT PRIMARY KEY,name TEXT,key_hash TEXT UNIQUE,created_at TEXT,revoked_at TEXT); CREATE TABLE briefs(id TEXT PRIMARY KEY,authorization_id TEXT,name TEXT,text TEXT,updated_at TEXT);');for(const id of [a,b])db.query('INSERT INTO authorizations VALUES (?,?,?,?,NULL)').run(id,'Memory',id,time);
 db.transaction(()=>{for(let i=0;i<count;i++)db.query('INSERT INTO briefs VALUES (?,?,?,?,?)').run(randomUUID(),i%2?a:b,'Same name','Instructions '+i,time);})();const before=db.query('SELECT * FROM briefs ORDER BY id').all();db.close();
 try{if(count===101){const s=createStore(path);try{expect(s.snapshot().briefs).toHaveLength(101);expect(s.remoteRules.catalog(a).briefs.filter(v=>'customId' in v).every(v=>v.name.includes('('))).toBe(true);}finally{s.close();}}else{expect(()=>createStore(path)).toThrow('unchanged');const check=new Database(path);expect(check.query('SELECT * FROM briefs ORDER BY id').all()).toEqual(before);expect((check.query('PRAGMA table_info(briefs)').all() as {name:string}[]).some(c=>c.name==='authorization_id')).toBe(true);check.close();}}finally{rmSync(dir,{recursive:true,force:true});}
 }
});
