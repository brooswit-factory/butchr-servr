import {test,expect} from "bun:test";
import {createHash,randomUUID} from "node:crypto";
import {mkdtempSync,rmSync,statSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Database} from "bun:sqlite";
import {createStore} from "../src/store.js";
import {serve} from "../src/server.js";
// Explicit nonsecret mock credential, only used in disposable test data. No production issuance.
const key='bsv1_'+'T'.repeat(43), auth=randomUUID();
function fixture(path:string){const store=createStore(path);const db=new Database(path);db.query('INSERT INTO authorizations VALUES (?,?,?,?,NULL)').run(auth,'Disposable mock',createHash('sha256').update(key).digest('hex'),new Date().toISOString());db.close();return store;}
function temporary(){return mkdtempSync(join(tmpdir(),'butchr-servr-test-'));}
test('restart persistence, scoped briefs, reconnect deduplication and revocation',()=>{
 const dir=temporary(),path=join(dir,'test.sqlite');let s=fixture(path);try{
 const d=randomUUID(),session=randomUUID();s.saveBrief({authorizationId:auth,name:'Review',text:'# Safe remote instructions'});
 s.connect(auth,d,session);s.connect(auth,d,session);expect(s.snapshot().authorizations[0]!.deployments[0]!.sessions.length).toBe(1);
 s.close();s=createStore(path);expect(s.authenticate(key)).toBe(auth);expect(s.connect(auth,d,session).briefs).toHaveLength(1);expect(s.snapshot().authorizations[0]!.deployments[0]!.sessions).toHaveLength(1);
 s.revoke(auth);expect(()=>s.authenticate(key)).toThrow('Invalid or revoked');expect(()=>s.authenticate('invalid')).toThrow();
 expect(statSync(path).mode&0o777).toBe(0o600);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('issuance reveals once, hash-only storage and authorization isolation (in-memory)',()=>{
 const s=createStore(':memory:');try{const a=s.issue('A'),b=s.issue('B');expect(s.authenticate(a.key)).toBe(a.id);s.saveBrief({authorizationId:a.id,name:'A only',text:'secret A content'});expect(s.connect(b.id,randomUUID(),randomUUID()).briefs).toEqual([]);const snapshot=JSON.stringify(s.snapshot());expect(snapshot).not.toContain(a.key);expect(snapshot).not.toContain('key_hash');s.revoke(a.id);expect(()=>s.authenticate(a.key)).toThrow();expect(s.authenticate(b.key)).toBe(b.id);}finally{s.close()}
});
test('remote brief storage rejects control names and reserved references without changing saved briefs',()=>{
 const s=createStore(':memory:');try{const auth=s.issue('Memory only');s.saveBrief({authorizationId:auth.id,name:'Valid',text:'Existing instructions'});const original=s.snapshot().briefs;
 for(const value of [{name:'Bad\nname',text:'Instructions'},{name:'Reserved',text:'@builtin:task'}])expect(()=>s.saveBrief({authorizationId:auth.id,...value})).toThrow();
 expect(s.snapshot().briefs).toEqual(original);
 }finally{s.close()}
});

test('remote Markdown content retains indentation and trailing newlines byte-for-byte',()=>{
 const s=createStore(':memory:');try{const auth=s.issue('Memory only'),text='    code block\n\nTrailing line  \n';s.saveBrief({authorizationId:auth.id,name:'  Name  ',text});const brief=s.connect(auth.id,randomUUID(),randomUUID()).briefs[0]!;expect(brief.text).toBe(text);expect(brief.name).toBe('Name');}finally{s.close()}
});
