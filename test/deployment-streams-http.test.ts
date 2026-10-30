import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createStore} from '../src/store.js';
import {serve} from '../src/server.js';
import {adminFixture} from './admin-helper.js';

async function frame(reader:ReadableStreamDefaultReader<Uint8Array>){
 let text='';
 while(!text.endsWith('\n\n')){
  const next=await reader.read();
  if(next.done)throw Error('Unexpected closed stream');
  text+=new TextDecoder().decode(next.value);
 }
 return {event:/event: (.*)\n/.exec(text)![1]!,data:JSON.parse(/data: (.*)\n/.exec(text)![1]!)};
}

for(const production of [false,true])test(`${production?'public proxy':'local'} streams share exactly two slots per registered deployment, not authorization or session`,async()=>{
 const store=createStore(':memory:');
 if(production){
  const setup=serve(store,0);
  try{await adminFixture(`http://127.0.0.1:${setup.port}`);}finally{await setup.stop(true);}
 }
 const origin='https://streams.example.test';
 const proxy:Record<string,string>=production?{host:'streams.example.test','x-forwarded-proto':'https','x-forwarded-host':'streams.example.test'}:{};
 const server=serve(store,0,undefined,production?{publicOrigin:origin}:{}),base=`http://127.0.0.1:${server.port}`;
 const a=store.issue('Memory stream owner A'),b=store.issue('Memory stream owner B');
 const deployments=Array.from({length:7},()=>({deploymentId:randomUUID(),sessions:[randomUUID(),randomUUID()]}));
 const controls:AbortController[]=[],readers:ReadableStreamDefaultReader<Uint8Array>[]=[];
 const headers=(key:string)=>({...proxy,authorization:'Bearer '+key,'content-type':'application/json'});
 const register=(key:string,deploymentId:string,sessionId:string)=>fetch(base+'/v1/register',{
  method:'POST',headers:headers(key),body:JSON.stringify({deploymentId,sessionId})
 });
 const open=async(key:string,deploymentId:string,sessionId:string,providers=false)=>{
  const abort=new AbortController();controls.push(abort);
  const response=await fetch(base+'/v1/events',{headers:{...headers(key),'x-butchr-deployment-id':deploymentId,'x-butchr-session-id':sessionId,...(providers?{'x-butchr-provider-protocol':'1'}:{})},signal:abort.signal});
  return {response,abort};
 };
 const initial=async(response:Response,auth:string,providers:boolean)=>{
  expect(response.status).toBe(200);
  const reader=response.body!.getReader();readers.push(reader);const snapshot=await frame(reader);
  expect(snapshot.event).toBe('snapshot');expect(snapshot.data.resync).toBe(true);
  expect(snapshot.data.state.authorizationId).toBe(auth);
  if(providers)expect(snapshot.data.state.providerReads.scope.authorizationId).toBe(auth);
  else expect(snapshot.data.state).not.toHaveProperty('providerReads');
  return {reader,revision:snapshot.data.revision};
 };
 try{
  for(const deployment of deployments)for(const session of deployment.sessions)
   expect((await register(a.key,deployment.deploymentId,session)).status).toBe(200);
  const first=deployments[0]!;
  // Same UUID tuple under another authorization is a different, independently owned deployment.
  expect((await register(b.key,first.deploymentId,first.sessions[0]!)).status).toBe(200);
  const normal=await open(a.key,first.deploymentId,first.sessions[0]!),normalState=await initial(normal.response,a.id,false);
  const provider=await open(a.key,first.deploymentId,first.sessions[1]!,true),providerState=await initial(provider.response,a.id,true);
  expect((await open(a.key,first.deploymentId,first.sessions[0]!,true)).response.status).toBe(429);
  const newSession=randomUUID();expect((await register(a.key,first.deploymentId,newSession)).status).toBe(200);
  expect((await open(a.key,first.deploymentId,newSession)).response.status).toBe(429);
  // Twelve simultaneous A streams exceed both former global caps and the former per-owner cap.
  for(const deployment of deployments.slice(1,6)){
   await initial((await open(a.key,deployment.deploymentId,deployment.sessions[0]!)).response,a.id,false);
   await initial((await open(a.key,deployment.deploymentId,deployment.sessions[1]!,true)).response,a.id,true);
  }
  const other=await initial((await open(b.key,first.deploymentId,first.sessions[0]!,true)).response,b.id,true);
  await initial((await open(b.key,first.deploymentId,first.sessions[0]!)).response,b.id,false);
  expect((await open(b.key,first.deploymentId,first.sessions[0]!)).response.status).toBe(429);
  // A genuine concurrent admission race still admits only two, across both protocols/sessions.
  const racing=deployments[6]!;
  const raced=await Promise.all([open(a.key,racing.deploymentId,racing.sessions[0]!),open(a.key,racing.deploymentId,racing.sessions[1]!,true),open(a.key,racing.deploymentId,racing.sessions[0]!,true)]);
  expect(raced.map(r=>r.response.status).sort()).toEqual([200,200,429]);
  for(const [i,result]of raced.entries())if(result.response.status===200)await initial(result.response,a.id,i!==0);
  // Neither another owner's registration nor another deployment's session is sufficient.
  expect((await open(b.key,deployments[1]!.deploymentId,deployments[1]!.sessions[0]!)).response.status).toBe(409);
  expect((await open(a.key,first.deploymentId,deployments[1]!.sessions[0]!)).response.status).toBe(409);
  expect((await open(a.key,randomUUID(),randomUUID(),true)).response.status).toBe(409);
  expect((await open('invalid',first.deploymentId,first.sessions[0]!)).response.status).toBe(401);
  expect((await fetch(base+'/v1/events',{headers:headers(a.key)})).status).toBe(400);
  // Disconnect is observed by the HTTP server, then a fresh session receives a resync snapshot.
  await normalState.reader.cancel();normal.abort.abort();
  let resumed:Awaited<ReturnType<typeof open>>|undefined;
  for(let i=0;i<30;i++){
   const attempt=await open(a.key,first.deploymentId,newSession);
   if(attempt.response.status===200){resumed=attempt;break;}
   expect(attempt.response.status).toBe(429);await attempt.response.body!.cancel();await delay(10);
  }
  expect(resumed).toBeDefined();
  const resumedState=await initial(resumed!.response,a.id,false);
  expect(resumedState.revision).not.toBe(normalState.revision);
  // A second session's provider stream is still active and shares the same cap.
  expect((await open(a.key,first.deploymentId,newSession,true)).response.status).toBe(429);
  const brief=store.saveBrief({name:'Shared brief',text:'Disposable stream reconnect evidence'});
  const providerPatch=await frame(providerState.reader);
  expect(providerPatch.event).toBe('patch');expect(providerPatch.data.baseRevision).toBe(providerState.revision);
  expect(providerPatch.data.patch.find((p:any)=>p.path==='/briefs').value[0].name).toBe('Shared brief');
  // Revoking A closes every one of its deployment streams without closing B's slots.
  expect((await frame(resumedState.reader)).event).toBe('patch');
  store.revoke(a.id);
  const revoked=await resumedState.reader.read();
  if(!revoked.done){expect(new TextDecoder().decode(revoked.value)).toContain('event: revoked');expect((await resumedState.reader.read()).done).toBe(true);}
  expect((await open(a.key,first.deploymentId,newSession)).response.status).toBe(401);
  expect((await frame(other.reader)).event).toBe('patch');
  store.saveBrief({name:'Shared brief',text:'B still receives updates'},brief.id);
  expect((await frame(other.reader)).data.patch[0].value[0].text).toBe('B still receives updates');
  expect(store.snapshot().authorizations.find(row=>row.id===a.id)!.deployments).toHaveLength(7);
  expect(store.snapshot().authorizations.find(row=>row.id===a.id)!.deployments.find(row=>row.id===first.deploymentId)!.sessions).toHaveLength(3);
 }finally{for(const control of controls)control.abort();await Promise.all(readers.map(reader=>reader.cancel().catch(()=>{})));await server.stop(true);await store.close();}
},15000);
