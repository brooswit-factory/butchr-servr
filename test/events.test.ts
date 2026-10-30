import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {createStore} from '../src/store.js';
import {createEventStreams} from '../src/events.js';
async function frame(reader:ReadableStreamDefaultReader<Uint8Array>){let value='';while(!value.endsWith('\n\n')){const next=await reader.read();if(next.done)throw Error('Stream closed');value+=new TextDecoder().decode(next.value);}return {event:/event: (.*)\n/.exec(value)![1],data:JSON.parse(/data: (.*)\n/.exec(value)![1]!)};}
test('SSE global brief snapshots and patches are committed; revocation clears active streams',async()=>{
 const store=createStore(':memory:'),a=store.issue('Memory A'),b=store.issue('Memory B'),events=createEventStreams(store),instance={deploymentId:randomUUID(),sessionId:randomUUID()};store.connect(a.id,instance.deploymentId,instance.sessionId);const reader=events.open(a.id,new AbortController().signal,instance).body!.getReader();
 try{const initial=await frame(reader);expect(initial.event).toBe('snapshot');expect(initial.data.resync).toBe(true);expect(initial.data.state.briefs).toEqual([]);
 const brief=store.saveBrief({authorizationId:a.id,name:'Own',text:'Delivered'});
 const changed=await frame(reader);expect(changed.event).toBe('patch');expect(changed.data.baseRevision).toBe(initial.data.revision);expect(changed.data.patch).toHaveLength(1);expect(changed.data.patch[0].path).toBe('/briefs');expect(changed.data.patch[0].value[0].name).toBe('Own');
 store.deleteBrief(brief.id);expect((await frame(reader)).data.patch[0].value).toEqual([]);store.revoke(a.id);expect((await reader.read()).done).toBe(true);
 }finally{events.close();store.close();}
});
test('slow-reader overflow discards queued frames, frees stream slots and converges via fresh snapshot',async()=>{
 const store=createStore(':memory:'),a=store.issue('Memory only'),events=createEventStreams(store,{maxEventBytes:2048,maxQueuedBytes:4096}),instance={deploymentId:randomUUID(),sessionId:randomUUID()};store.connect(a.id,instance.deploymentId,instance.sessionId);
 const slow=events.open(a.id,new AbortController().signal,instance).body!.getReader();
 try{const brief=store.saveBrief({authorizationId:a.id,name:'Test',text:'First'});for(let i=0;i<10;i++)store.saveBrief({authorizationId:a.id,name:'Test',text:'Changed '+i},brief.id);
 expect((await slow.read()).done).toBe(true);
 const recovered=events.open(a.id,new AbortController().signal,instance).body!.getReader();const snapshot=await frame(recovered);expect(snapshot.event).toBe('snapshot');expect(snapshot.data.state.briefs[0].text).toBe('Changed 9');await recovered.cancel();
 const aborted=new AbortController();const cancelled=events.open(a.id,aborted.signal,instance).body!.getReader();aborted.abort();expect((await cancelled.read()).done).toBe(true);
 }finally{events.close();store.close();}
});


test('deployment slots are released exactly once on abort, cancellation and shutdown',async()=>{
 const store=createStore(':memory:'),auth=store.issue('Memory slots'),instance={deploymentId:randomUUID(),sessionId:randomUUID()},events=createEventStreams(store);
 store.connect(auth.id,instance.deploymentId,instance.sessionId);
 const firstAbort=new AbortController();
 const first=events.open(auth.id,firstAbort.signal,instance).body!.getReader();
 const second=events.open(auth.id,new AbortController().signal,{...instance,providers:true}).body!.getReader();
 try{
  expect(()=>events.open(auth.id,new AbortController().signal,instance)).toThrow('Deployment stream limit');
  firstAbort.abort();expect((await first.read()).done).toBe(true);
  const replacement=events.open(auth.id,new AbortController().signal,instance).body!.getReader();
  await first.cancel();firstAbort.abort();
  expect(()=>events.open(auth.id,new AbortController().signal,instance)).toThrow('Deployment stream limit');
  await replacement.cancel();
  const again=events.open(auth.id,new AbortController().signal,instance).body!.getReader();
  events.close();events.close();expect((await again.read()).done).toBe(true);expect((await second.read()).done).toBe(true);
  const alreadyAborted=new AbortController();alreadyAborted.abort();
  const closed=events.open(auth.id,alreadyAborted.signal,instance).body!.getReader();expect((await closed.read()).done).toBe(true);
  const fresh=events.open(auth.id,new AbortController().signal,instance).body!.getReader();await fresh.cancel();
 }finally{events.close();await store.close();}
});
