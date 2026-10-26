import { randomUUID,createHash } from "node:crypto";
import { Problem, type Store } from "./store.js";
export const MAX_EVENT_BYTES = 96_000_000;
/** Per server process: no replay log. Every open explicitly resynchronizes a full snapshot. */
export function createEventStreams(store:Store,limits={maxEventBytes:MAX_EVENT_BYTES,maxQueuedBytes:192_000_000}){
 const queues=new Set<()=>number>();
 const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
 const active=new Map<string,Set<()=>void>>();
 const encode=new TextEncoder();
 function open(auth:string,signal:AbortSignal){
  const count=[...active.values()].reduce((n,s)=>n+s.size,0);
  if(count>=8||(active.get(auth)?.size??0)>=2)throw new Problem(429,"Stream limit reached");
  const epoch=randomUUID();let sequence=0,revision=`${epoch}:0`,initial:ReturnType<Store["delivery"]>|null=store.delivery(auth),closed=false;
  let hashes={briefs:digest(initial.briefs),remoteRules:digest(initial.remoteRules)};
  let controller:ReadableStreamDefaultController<Uint8Array>,unsubscribe=()=>{},timer:ReturnType<typeof setInterval>;
  const frames:Uint8Array[]=[];let pendingBytes=0,offset=0,waiting=false;const queuedBytes=()=>pendingBytes;
  function pump(){if(closed||!waiting||!frames.length)return;const frame=frames[0]!,end=Math.min(frame.byteLength,offset+65536),chunk=frame.slice(offset,end);offset=end;if(offset===frame.byteLength){pendingBytes-=frame.byteLength;frames.shift();offset=0;}waiting=false;controller.enqueue(chunk);}
  function close(){if(closed)return;closed=true;unsubscribe();clearInterval(timer);signal.removeEventListener('abort',close);queues.delete(queuedBytes);frames.length=0;pendingBytes=0;active.get(auth)?.delete(close);if(!active.get(auth)?.size)active.delete(auth);try{controller.close();}catch{}}
  function send(event:string,data:unknown,id?:string){
   if(closed)return;
   const frame=encode.encode(`${id?`id: ${id}\n`:''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
   const queued=[...queues].reduce((n,size)=>n+size(),0);
   if(queued+frame.byteLength>limits.maxQueuedBytes || frame.byteLength>limits.maxEventBytes || pendingBytes+frame.byteLength>limits.maxEventBytes){close();return;}
   frames.push(frame);pendingBytes+=frame.byteLength;pump();
  }
  const stream=new ReadableStream<Uint8Array>({start(c){
   controller=c;queues.add(queuedBytes);const group=active.get(auth)??new Set();group.add(close);active.set(auth,group);
   signal.addEventListener('abort',close,{once:true});
   unsubscribe=store.subscribe((changed,revoked)=>{
    if((changed!==auth&&changed!=='*')||closed)return;
    try{
    if(revoked){send('revoked',{});close();return;}
    const next=store.delivery(auth),patch:unknown[]=[];
    const nextHashes={briefs:digest(next.briefs),remoteRules:digest(next.remoteRules)};
    for(const path of ['briefs','remoteRules'] as const)if(hashes[path]!==nextHashes[path])patch.push({op:'replace',path:`/${path}`,value:next[path]});
    if(!patch.length)return;
    const baseRevision=revision;revision=`${epoch}:${++sequence}`;hashes=nextHashes;
    send('patch',{baseRevision,revision,patch},revision);
    }catch{close();}
   });
   send('snapshot',{revision,state:initial,resync:true},revision);initial=null;
   if(!closed){timer=setInterval(()=>send('heartbeat',{revision}),10000);timer.unref();}
   if(signal.aborted)close();
  },pull(){waiting=true;pump();},cancel:close},{highWaterMark:0});
  return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-store','x-content-type-options':'nosniff','x-accel-buffering':'no'}});
 }
 return {open,close:()=>{for(const group of [...active.values()])for(const stop of [...group])stop();}};
}
