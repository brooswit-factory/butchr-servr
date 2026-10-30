/** Disposable browser verification only: memory-only records, no providers/workers. */
import {createStore} from "../src/store.js";
import {serve} from "../src/server.js";
const store=createStore(':memory:');
const a=store.issue('Disposable UI A'),b=store.issue('Disposable UI B');
store.saveBrief({authorizationId:a.id,name:'Disposable remote brief',text:'# Disposable instructions\nPreserve local work.\n'});
store.remoteRules.create(a.id,{id:'fixture-disabled-rule',resourceProvider:'jira-work',query:'project = DISPOSABLE',brief:'@builtin:task',confirm:true});
const deployment=crypto.randomUUID(),observed=crypto.randomUUID(),empty=crypto.randomUUID();
store.connect(a.id,deployment,observed);store.connect(a.id,deployment,empty);
store.telemetry.ingest(a.id,{deploymentId:deployment,sessionId:observed,events:[{id:crypto.randomUUID(),sequence:1,occurredAt:new Date().toISOString(),type:'session.snapshot',data:{mode:'management-only',controllersEnabled:false,remoteConfigsEnabled:true,transportConnected:true,agentsChecked:true,agentsTruncated:false,agents:[{id:'a'.repeat(64),status:'working',confirmedAt:new Date().toISOString()},{id:'b'.repeat(64),status:'idle',confirmedAt:'2020-01-01T00:00:00.000Z'}]}}]});
const server=serve(store,0,new URL('../web-dist-next/',import.meta.url));
if(process.argv.includes('--admin-fixture')){const {adminFixture}=await import('../test/admin-helper.js');const url=`http://127.0.0.1:${server.port}`,session=await adminFixture(url);await fetch(url+'/api/auth/logout',{method:'POST',headers:{origin:url,cookie:session.cookie,'content-type':'application/json','x-butchr-servr-csrf':session.csrf},body:'{}'});}
console.log(JSON.stringify({event:'disposable-ui-fixture',url:`http://127.0.0.1:${server.port}`,authorizationA:a.id,authorizationB:b.id,deployment,observedSession:observed,emptySession:empty}));
async function close(){await server.stop(true);store.close();process.exit(0);}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
