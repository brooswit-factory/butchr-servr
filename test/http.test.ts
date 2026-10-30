import {adminFixture} from "./admin-helper.js";
import {test,expect} from "bun:test";
import {randomUUID} from "node:crypto";
import {createStore} from "../src/store.js";
import {serve} from "../src/server.js";
test('HTTP guards, normal authorization issuance, scoped connection and invalid/revoked keys',async()=>{
 const store=createStore(':memory:'),server=serve(store,0),url=`http://127.0.0.1:${server.port}`;
 try{const auth=store.issue('Ephemeral test');store.saveBrief({authorizationId:auth.id,name:'Safe',text:'<script>ignored</script>'});
 const state=await adminFixture(url);expect(state).not.toHaveProperty("issuanceEnabled");
 expect((await fetch(url+'/api/state',{headers:{host:'evil.invalid'}})).status).toBe(403);
 expect((await fetch(url+'/api/state',{headers:{origin:'https://evil.invalid'}})).status).toBe(403);
 const admin=(headers:Record<string,string>)=>fetch(url+'/api/authorizations',{method:'POST',headers:{'content-type':'application/json',cookie:state.cookie,...headers},body:'{"name":"Blocked"}'});
 expect((await admin({origin:url})).status).toBe(403);const issuedResponse=await admin({origin:url,'x-butchr-servr-csrf':state.csrf});expect(issuedResponse.status).toBe(201);const issued=await issuedResponse.json();expect(store.authenticate(issued.key)).toBe(issued.id);expect(JSON.stringify(store.snapshot())).not.toContain(issued.key);
 const deploymentId=randomUUID(),sessionId=randomUUID();
 const connect=(key:string,headers:Record<string,string>={})=>fetch(url+'/v1/connect',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key,...headers},body:JSON.stringify({deploymentId,sessionId})});
 expect((await connect('invalid')).status).toBe(401);expect((await connect(auth.key,{origin:url})).status).toBe(403);
 expect((await connect(auth.key)).status).toBe(200);expect((await(await connect(auth.key)).json()).briefs).toHaveLength(1);expect(store.snapshot().authorizations[0]!.deployments[0]!.sessions).toHaveLength(1);
 store.revoke(auth.id);expect((await connect(auth.key)).status).toBe(401);
 }finally{await server.stop(true);store.close()}
});
