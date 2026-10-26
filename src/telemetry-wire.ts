const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function time(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||Date.parse(v)>Date.now()+300000||Date.parse(v)<946684800000)throw new Error('Invalid event timestamp');return v;}
export interface OperationalSnapshot {mode:'management-only'|'daemon'|'unknown';controllersEnabled:boolean|null;remoteConfigsEnabled:boolean;transportConnected:boolean;agentsChecked:boolean;agentsTruncated:boolean;agents:{id:string;status:'idle'|'working'|'blocked'|'done'|'unknown';confirmedAt:string}[]}
export interface InstanceEvent {id:string;sequence:number;occurredAt:string;type:'session.snapshot';data:OperationalSnapshot}
export function validateEvent(value:any):InstanceEvent{
 if(!exact(value,['id','sequence','occurredAt','type','data'])||!uuid.test(value.id)||!Number.isSafeInteger(value.sequence)||value.sequence<1||value.type!=='session.snapshot')throw new Error('Invalid event envelope');time(value.occurredAt);
 const d=value.data;if(!exact(d,['mode','controllersEnabled','remoteConfigsEnabled','transportConnected','agentsChecked','agentsTruncated','agents'])||!['management-only','daemon','unknown'].includes(d.mode)||!(d.controllersEnabled===null||typeof d.controllersEnabled==='boolean')||['remoteConfigsEnabled','transportConnected','agentsChecked','agentsTruncated'].some(k=>typeof d[k]!=='boolean')||!Array.isArray(d.agents)||d.agents.length>100)throw new Error('Invalid operational snapshot');
 const seen=new Set<string>();for(const a of d.agents){if(!exact(a,['id','status','confirmedAt'])||typeof a.id!=='string'||!/^[0-9a-f]{64}$/.test(a.id)||seen.has(a.id)||!['idle','working','blocked','done','unknown'].includes(a.status))throw new Error('Invalid agent metadata');time(a.confirmedAt);seen.add(a.id);}
 if(Buffer.byteLength(JSON.stringify(value))>32768)throw new Error('Event too large');return value;
}
