/** Disposable browser verification only: memory-only records, no providers/workers. */
import {createStore} from "../src/store.js";
import {serve} from "../src/server.js";
const store=createStore(':memory:');
const a=store.issue('Disposable UI A'),b=store.issue('Disposable UI B');
store.saveBrief({authorizationId:a.id,name:'Disposable remote brief',text:'# Disposable instructions\nPreserve local work.\n'});
store.remoteRules.create(a.id,{id:'fixture-disabled-rule',resourceProvider:'jira-work',query:'project = DISPOSABLE',brief:'@builtin:task',confirm:true});
const server=serve(store,0);
console.log(JSON.stringify({event:'disposable-ui-fixture',url:`http://127.0.0.1:${server.port}`,authorizationA:a.id,authorizationB:b.id}));
async function close(){await server.stop(true);store.close();process.exit(0);}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
