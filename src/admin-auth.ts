import type {Database} from 'bun:sqlite';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {Problem} from './problems.js';
const secret=()=>randomBytes(32).toString('base64url');
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const equal=(a:string,b:string)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const COOKIE='butchr_admin';
const IDLE=30*60_000,ABSOLUTE=8*60*60_000,PREAUTH=10*60_000;
type Session={token_hash:string;csrf:string;created:number;seen:number};
export function createAdminAuth(db:Database,now=Date.now){
 db.exec(`CREATE TABLE IF NOT EXISTS admin_password(id INTEGER PRIMARY KEY CHECK(id=1),hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS admin_sessions(token_hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,created INTEGER NOT NULL,seen INTEGER NOT NULL);`);
 const pending=new Map<string,{csrf:string;expires:number}>();let attempts:number[]=[],hashing=false;
 const configured=()=>!!db.query('SELECT id FROM admin_password WHERE id=1').get();
 const cookie=(value:string,age:number)=>`${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}`;
 function token(req:Request){const values=(req.headers.get('cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(COOKIE+'='));return values.length===1?values[0]!.slice(COOKIE.length+1):'';}
 function session(req:Request){const raw=token(req);if(!/^[\w-]{43}$/.test(raw))return null;const row=db.query('SELECT * FROM admin_sessions WHERE token_hash=?').get(digest(raw)) as Session|null;if(!row)return null;if(now()-row.seen>=IDLE||now()-row.created>=ABSOLUTE){db.query('DELETE FROM admin_sessions WHERE token_hash=?').run(row.token_hash);return null;}if(!['GET','HEAD'].includes(req.method))db.query('UPDATE admin_sessions SET seen=? WHERE token_hash=?').run(now(),row.token_hash);return row;}
 function csrf(req:Request,expected:string){if(!equal(req.headers.get('x-butchr-servr-csrf')??'',expected))throw new Problem(403,'CSRF check failed');}
 function status(req:Request){const active=session(req);if(active)return {body:{configured:true,authenticated:true,csrf:active.csrf},cookie:null};for(const [key,p]of pending)if(p.expires<=now())pending.delete(key);const old=pending.get(digest(token(req)));if(old)return {body:{configured:configured(),authenticated:false,csrf:old.csrf},cookie:null};if(pending.size>=128)pending.delete(pending.keys().next().value!);const raw=secret(),p={csrf:secret(),expires:now()+PREAUTH};pending.set(digest(raw),p);return {body:{configured:configured(),authenticated:false,csrf:p.csrf},cookie:cookie(raw,PREAUTH/1000)};}
 function begin(req:Request){const key=digest(token(req)),p=pending.get(key);if(!p||p.expires<=now())throw new Problem(403,'Refresh the login page and try again');csrf(req,p.csrf);pending.delete(key);attempts=attempts.filter(t=>now()-t<60_000);if(attempts.length>=5||hashing)throw new Problem(429,'Too many login attempts. Try again in a minute');attempts.push(now());}
 function password(value:unknown){if(typeof value!=='string'||value.length<8||Buffer.byteLength(value)>1024||value.includes('\0'))throw new Problem(400,'Use a password of at least 8 characters and at most 1024 bytes');return value;}
 function issue(){const raw=secret(),created=now();db.query('DELETE FROM admin_sessions WHERE seen<=? OR created<=?').run(created-IDLE,created-ABSOLUTE);db.query('DELETE FROM admin_sessions WHERE token_hash IN (SELECT token_hash FROM admin_sessions ORDER BY created DESC LIMIT -1 OFFSET 15)').run();const row={token_hash:digest(raw),csrf:secret(),created,seen:created};db.query('INSERT INTO admin_sessions VALUES (?,?,?,?)').run(row.token_hash,row.csrf,row.created,row.seen);return {body:{configured:true,authenticated:true,csrf:row.csrf},cookie:cookie(raw,ABSOLUTE/1000)};}
 async function login(req:Request,body:unknown,setup:boolean){begin(req);const value=password((body as {password?:unknown})?.password);if(setup&&configured())throw new Problem(409,'Password already configured');if(!setup&&!configured())throw new Problem(409,'Set up your password first');hashing=true;try{if(setup){const hash=await Bun.password.hash(value,{algorithm:'argon2id',memoryCost:65536,timeCost:3});return db.transaction(()=>{if(!db.query('INSERT OR IGNORE INTO admin_password VALUES (1,?)').run(hash).changes)throw new Problem(409,'Password already configured');return issue();})();}const row=db.query('SELECT hash FROM admin_password WHERE id=1').get() as {hash:string};if(!await Bun.password.verify(value,row.hash))throw new Problem(401,'Incorrect password');return issue();}finally{hashing=false;}}
 function requireSession(req:Request){const active=session(req);if(!active)throw new Problem(401,'Login required');return active;}
 function logout(req:Request){const active=requireSession(req);csrf(req,active.csrf);db.query('DELETE FROM admin_sessions WHERE token_hash=?').run(active.token_hash);return {body:{ok:true},cookie:cookie('',0)};}
 return {status,login,logout,requireSession,csrf,configured};
}
