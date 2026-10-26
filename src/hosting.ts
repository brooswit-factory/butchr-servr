import {Problem} from './problems.js';

export type HostingOptions = {publicOrigin?:string};
export function requestRates(capacity=2048){
 const rates=new Map<string,{count:number;start:number}>();
 return (id:string,limit:number,now=Date.now())=>{
  for(const [key,rate]of rates)if(now-rate.start>=60000)rates.delete(key);
  const existing=rates.get(id);
  if(existing){if(++existing.count>limit)throw new Problem(429,'Try again shortly');return;}
  if(rates.size>=capacity)throw new Problem(503,'Rate capacity reached');
  rates.set(id,{count:1,start:now});
 };
}
/** This is deployment configuration, never inferred from request headers. */
export function publicOrigin(value:string|undefined):string|undefined {
 if(value===undefined)return undefined;
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.hostname==='localhost'||url.hostname==='127.0.0.1'||url.hostname==='[::1]'||value!==url.origin)throw Error('Public origin must be an exact HTTPS origin without a path');
 return url.origin;
}
/** The TCP peer must ALSO be verified as the same Unix UID by the caller. */
export function checkProxy(req:Request,origin:string,production:boolean){
 if(req.headers.get('host')!==new URL(origin).host)throw new Problem(403,'Untrusted host');
 if(req.headers.has('forwarded'))throw new Problem(403,'Forwarded headers are not supported');
 if(production){
  if(req.headers.get('x-forwarded-proto')!=='https'||req.headers.get('x-forwarded-host')!==new URL(origin).host)throw new Problem(403,'Trusted HTTPS proxy required');
 }else if(['x-forwarded-host','x-forwarded-proto','x-forwarded-for'].some(h=>req.headers.has(h)))throw new Problem(403,'Proxy mode is not configured');
 // X-Forwarded-For is deliberately NEVER used for identity, authorization or throttling.
}
/** Bound actual bytes, including chunked/lying-length bodies, and stalled uploads. */
export async function readJSON(req:Request,max=1024*1024,timeoutMs=5000):Promise<any>{
 const length=req.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max))throw new Problem(413,'Request body too large');
 if(!req.body)throw new Problem(400,'JSON required');
 const reader=req.body.getReader();let size=0;const bytes=new Uint8Array(max);let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(new Problem(408,'Request body timed out'));},timeoutMs);});
  await Promise.race([(async()=>{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>max){void reader.cancel().catch(()=>{});throw new Problem(413,'Request body too large');}bytes.set(chunk.value,size-chunk.value.byteLength);}})(),deadline]);
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)));
 }finally{clearTimeout(timer);reader.releaseLock();}
}
