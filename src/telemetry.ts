import type {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {Problem} from './problems.js';
import {validateEvent} from './telemetry-wire.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function canonical(value:any):string{return value&&typeof value==='object'?Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);}
export function createTelemetry(db:Database){
 db.exec(`CREATE TABLE IF NOT EXISTS event_cursors(authorization_id TEXT NOT NULL,deployment_id TEXT NOT NULL,session_id TEXT NOT NULL,sequence INTEGER NOT NULL,occurred_at TEXT NOT NULL,received_at TEXT NOT NULL,projection TEXT NOT NULL,PRIMARY KEY(authorization_id,deployment_id,session_id),FOREIGN KEY(authorization_id,deployment_id,session_id) REFERENCES sessions(authorization_id,deployment_id,id));
 CREATE TABLE IF NOT EXISTS instance_events(authorization_id TEXT NOT NULL,deployment_id TEXT NOT NULL,session_id TEXT NOT NULL,sequence INTEGER NOT NULL,event_id TEXT NOT NULL,digest TEXT NOT NULL,received_at TEXT NOT NULL,PRIMARY KEY(authorization_id,deployment_id,session_id,sequence),UNIQUE(authorization_id,event_id),FOREIGN KEY(authorization_id,deployment_id,session_id) REFERENCES sessions(authorization_id,deployment_id,id));`);
 const ingest=db.transaction((auth:string,body:any)=>{
  if(!exact(body,['deploymentId','sessionId','events'])||!uuid.test(body.deploymentId)||!uuid.test(body.sessionId)||!Array.isArray(body.events)||!body.events.length||body.events.length>16)throw new Problem(400,'Invalid event batch');
  if(!db.query('SELECT id FROM authorizations WHERE id=? AND revoked_at IS NULL').get(auth))throw new Problem(401,'Invalid or revoked authorization');
  const d=body.deploymentId,s=body.sessionId;
  const session=db.query('SELECT last_seen FROM sessions WHERE authorization_id=? AND deployment_id=? AND id=?').get(auth,d,s) as {last_seen:string}|null;
  if(!session)throw new Problem(409,'Register this deployment session first');
  // Delayed snapshots for known historical sessions remain admissible; UI uses occurredAt for staleness.
  let cursor=(db.query('SELECT sequence FROM event_cursors WHERE authorization_id=? AND deployment_id=? AND session_id=?').get(auth,d,s) as {sequence:number}|null)?.sequence??0;
  const now=new Date().toISOString();
  for(const value of body.events){let event;try{event=validateEvent(value);}catch{throw new Problem(400,'Invalid event payload');}const digest=createHash('sha256').update(canonical(event)).digest('hex');
   if(event.sequence<=cursor){const previous=db.query('SELECT event_id,digest FROM instance_events WHERE authorization_id=? AND deployment_id=? AND session_id=? AND sequence=?').get(auth,d,s,event.sequence) as {event_id:string;digest:string}|null;if(previous&&(previous.event_id!==event.id||previous.digest!==digest))throw new Problem(409,'Sequence already belongs to another event');continue;}
   if(event.sequence!==cursor+1)throw new Problem(409,'Event sequence gap');
   if(db.query('SELECT event_id FROM instance_events WHERE authorization_id=? AND event_id=?').get(auth,event.id))throw new Problem(409,'Event identity reused');
   db.query('INSERT INTO instance_events VALUES (?,?,?,?,?,?,?)').run(auth,d,s,event.sequence,event.id,digest,now);
   db.query('INSERT INTO event_cursors VALUES (?,?,?,?,?,?,?) ON CONFLICT(authorization_id,deployment_id,session_id) DO UPDATE SET sequence=excluded.sequence,occurred_at=excluded.occurred_at,received_at=excluded.received_at,projection=excluded.projection').run(auth,d,s,event.sequence,event.occurredAt,now,JSON.stringify(event.data));cursor=event.sequence;
  }
  // This journal contains only IDs/digests. Latest accepted projections/cursors survive retention.
  db.query('DELETE FROM instance_events WHERE authorization_id=? AND deployment_id=? AND session_id=? AND sequence<?').run(auth,d,s,Math.max(0,cursor-63));
  db.query('DELETE FROM instance_events WHERE authorization_id=? AND rowid NOT IN (SELECT rowid FROM instance_events WHERE authorization_id=? ORDER BY received_at DESC,rowid DESC LIMIT 1024)').run(auth,auth);
  db.exec("DELETE FROM instance_events WHERE rowid NOT IN (SELECT rowid FROM instance_events ORDER BY received_at DESC,rowid DESC LIMIT 4096)");
  db.query('DELETE FROM instance_events WHERE received_at<?').run(new Date(Date.now()-14*86400000).toISOString());
  return {acknowledgedSequence:cursor,receivedAt:now};
 });
 function session(auth:string,deployment:string,id:string){const row=db.query('SELECT sequence,occurred_at AS occurredAt,received_at AS receivedAt,projection FROM event_cursors WHERE authorization_id=? AND deployment_id=? AND session_id=?').get(auth,deployment,id) as {sequence:number;occurredAt:string;receivedAt:string;projection:string}|null;return row?{sequence:row.sequence,occurredAt:row.occurredAt,receivedAt:row.receivedAt,snapshot:JSON.parse(row.projection)}:null;}
 return {ingest,session};
}
