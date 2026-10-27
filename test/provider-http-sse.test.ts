import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {createStore} from '../src/store.js';
import {serve} from '../src/server.js';
import {adminFixture} from './admin-helper.js';
async function frame(reader:ReadableStreamDefaultReader<Uint8Array>){let text='';while(!text.endsWith('\n\n')){const next=await reader.read();if(next.done)throw Error('Unexpected closed stream');text+=new TextDecoder().decode(next.value);}return {event:/event: (.*)\n/.exec(text)![1]!,data:JSON.parse(/data: (.*)\n/.exec(text)![1]!)};}
test('authenticated HTTP subscriptions deliver isolated SSE patches and authoritative reconnect snapshots without consuming notification acknowledgments',async()=>{
 const calls:string[]=[];const store=createStore(':memory:',{providerExecute:async(scope)=>{calls.push(scope.authorizationId);return {id:'200',title:'Disposable observation'};}}),server=serve(store,0),url=`http://127.0.0.1:${server.port}`;
 const a=store.issue('Fixture A'),b=store.issue('Fixture B');const deploymentId=randomUUID(),sessionId=randomUUID();const machine=(key:string)=>({'content-type':'application/json',authorization:'Bearer '+key});const abort=new AbortController(),connections:AbortController[]=[];const closeConnections=()=>{for(const c of connections.splice(0))c.abort();};
 try{
  const owner=await adminFixture(url);const providerPath=`/api/providers/${a.id}/atlassian`;const body=JSON.stringify({enabled:['confluence-page'],credentials:{site:'https://fixture.atlassian.net',email:'fixture@example.test',token:'memory-only-fixture-token'}});
  expect((await fetch(url+providerPath,{method:'PUT',headers:machine(a.key),body})).status).toBe(401);
  const saved=await fetch(url+providerPath,{method:'PUT',headers:{...machine(''),cookie:owner.cookie,origin:url,'x-butchr-servr-csrf':owner.csrf,authorization:''},body});expect(saved.status).toBe(200);expect(await saved.text()).not.toContain('memory-only-fixture-token');
  for(const auth of [a,b])expect((await fetch(url+'/v1/register',{method:'POST',headers:machine(auth.key),body:JSON.stringify({deploymentId,sessionId})})).status).toBe(200);
  const open=(key:string,providers=true)=>{const c=new AbortController();connections.push(c);return fetch(url+'/v1/events',{headers:{...machine(key),'x-butchr-deployment-id':deploymentId,'x-butchr-session-id':sessionId,...(providers?{'x-butchr-provider-protocol':'1'}:{})},signal:AbortSignal.any([abort.signal,c.signal])});};
  expect((await open('invalid')).status).toBe(401);const stream=await open(a.key),reader=stream.body!.getReader();const initial=await frame(reader);expect(initial.data.state.providerReads.providers).toEqual(['confluence-page']);
  const subscription={scope:initial.data.state.providerReads.scope,reads:[{provider:'confluence-page',method:'getPage',args:['200']}]};const subscribe=(key:string)=>fetch(url+'/v1/provider-reads',{method:'POST',headers:machine(key),body:JSON.stringify({deploymentId,sessionId,subscription})});
  expect((await subscribe(b.key)).status).toBe(400);expect((await subscribe(a.key)).status).toBe(200);const update=await frame(reader);expect(update.event).toBe('patch');expect(update.data.baseRevision).toBe(initial.data.revision);const observations=update.data.patch.find((p:any)=>p.path==='/providerReads').value;expect(observations.results[0].result.value.title).toBe('Disposable observation');expect(calls).toEqual([a.id]);
  await reader.cancel();closeConnections();const resumed=(await open(a.key)).body!.getReader();const snapshot=await frame(resumed);expect(snapshot.event).toBe('snapshot');expect(snapshot.data.resync).toBe(true);expect(snapshot.data.state.providerReads.results).toEqual(observations.results);await resumed.cancel();closeConnections();
  const other=(await open(b.key)).body!.getReader();expect((await frame(other)).data.state.providerReads.results).toEqual([]);await other.cancel();closeConnections();const legacy=(await open(a.key,false)).body!.getReader();expect((await frame(legacy)).data.state).not.toHaveProperty('providerReads');await legacy.cancel();store.revoke(a.id);expect((await open(a.key)).status).toBe(401);
 }finally{abort.abort();await server.stop(true);await store.close();}
},15000);
