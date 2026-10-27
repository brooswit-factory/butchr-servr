import {checkProxy,publicOrigin,readJSON,requestRates,type HostingOptions} from "./hosting.js";
import {managementScope} from "./management-keys.js";
import { createEventStreams } from "./events.js";
import { isSameUidPeerAsync } from "./peer-uid.js";
import { Problem, type Store } from "./store.js";
const baseHeaders = {"cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","content-security-policy":"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
export function serve(store: Store, port=7731,webRoot=new URL("../web-dist/",import.meta.url),options:HostingOptions={}) {
  const configuredOrigin=publicOrigin(options.publicOrigin),production=!!configuredOrigin;
  if(production&&!store.adminAuth.configured())throw Error("Configure the owner password locally before public hosting");
  const headers={...baseHeaders,...(production?{"strict-transport-security":"max-age=31536000"}:{})};
  let requests=0;
  const streams=createEventStreams(store,production?{maxEventBytes:96_000_000,maxQueuedBytes:96_000_000,maxStreams:4,maxPerAuthorization:2}:undefined);
  const rate=requestRates();
  const providerTimer=setInterval(()=>void store.providerPolls.tick(),1000);providerTimer.unref();
  const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{...headers,...(status===429?{"retry-after":"60"}:{})}});
  const server=Bun.serve({hostname:"127.0.0.1",port,idleTimeout:60,maxRequestBodySize:1024*1024,error(){return new Response(null,{status:500,headers});},async fetch(req,server) {
    if(requests>=16)return json({error:"Server busy"},503);
    requests++;
    try {
      const url=new URL(req.url); const origin=configuredOrigin??`http://127.0.0.1:${server.port}`;
      checkProxy(req,origin,production);
      const peer=server.requestIP(req); if(!peer || peer.address!=="127.0.0.1") throw new Problem(403,"Loopback required");
      if(!(await isSameUidPeerAsync(peer,{server:{address:"127.0.0.1",port:server.port!}}))) throw new Problem(403,"Same user required");
      if(["/v1/connect","/v1/register","/v1/events","/v1/instance-events","/v1/provider-reads"].includes(url.pathname)) {
        if(url.search)throw new Problem(400,"Machine URLs do not accept query parameters");
        const streaming=url.pathname==="/v1/events";
        if(req.method!==(streaming?"GET":"POST"))throw new Problem(405,"Method not allowed");
        if(req.headers.get("origin") || (req.headers.get("sec-fetch-site") && req.headers.get("sec-fetch-site")!=="none")) throw new Problem(403,"Machine endpoint");
        if(!streaming&&!req.headers.get("content-type")?.startsWith("application/json")) throw new Problem(415,"JSON required");
        const auth=store.authenticate(req.headers.get("authorization")?.replace(/^Bearer /,"")??null);
        rate(auth,240);
        if(streaming){store.registered(auth,req.headers.get("x-butchr-deployment-id"),req.headers.get("x-butchr-session-id"));const providerProtocol=req.headers.get('x-butchr-provider-protocol');if(providerProtocol&&providerProtocol!=='1')throw new Problem(400,'Unsupported provider protocol');const response=streams.open(auth,req.signal,providerProtocol==='1'?{deploymentId:req.headers.get('x-butchr-deployment-id')!,sessionId:req.headers.get('x-butchr-session-id')!,providers:true}:undefined);if(production)response.headers.set("strict-transport-security","max-age=31536000");return response;}
        const body=await readJSON(req);if(url.pathname==='/v1/provider-reads'){store.registered(auth,body.deploymentId,body.sessionId);return json(store.providerPolls.set(auth,body.deploymentId,body.sessionId,body.subscription));}if(url.pathname==="/v1/instance-events"){const result=store.telemetry.ingest(auth,body);store.providerPolls.touch(auth,body.deploymentId,body.sessionId);return json(result);}
        const snapshot=store.connect(auth,body.deploymentId,body.sessionId);
        return json(url.pathname==="/v1/register"?{serverId:snapshot.serverId,authorizationId:auth,registered:true}:snapshot);
      }
      const bearer=req.headers.get('authorization');
      if(bearer){
        if(!url.pathname.startsWith('/api/')||url.search||req.headers.has('cookie')||req.headers.has('origin')||(req.headers.get('sec-fetch-site')&&req.headers.get('sec-fetch-site')!=='none'))throw new Problem(403,'Management keys require a non-browser API request');
        const key=store.managementKeys.authenticate(bearer.startsWith('Bearer ')?bearer.slice(7):'');const scope=managementScope(url.pathname,req.method);
        rate('management:'+key.id,120);
        if(!scope||!key.scopes.includes(scope)||(scope==='rules:read'&&url.pathname.endsWith('/catalog')&&!key.scopes.includes('briefs:read')))throw new Problem(403,'Management scope required');
        store.managementKeys.touch(key.id);
      }
      const o=req.headers.get("origin"), site=req.headers.get("sec-fetch-site");
      if((o && o!==origin)||(site && !["same-origin","none"].includes(site))) throw new Problem(403,"Same origin required");
      if(!["GET","HEAD"].includes(req.method)&& ((!bearer&&o!==origin)||!req.headers.get("content-type")?.startsWith("application/json")))throw new Problem(403,"Same-origin JSON required");
      const authResponse=(result:{body:unknown;cookie:string|null})=>{const response=json(result.body);if(result.cookie)response.headers.set('set-cookie',result.cookie+(production?'; Secure':''));return response;};
      if(req.method==='GET'&&url.pathname==='/api/auth/session')return authResponse(store.adminAuth.status(req));
      if(production&&['/setup','/api/auth/setup'].includes(url.pathname))throw new Problem(403,'Initial setup is local only');
      if(req.method==='POST'&&['/api/auth/login','/api/auth/setup'].includes(url.pathname)){
        return authResponse(await store.adminAuth.login(req,await readJSON(req,4096),url.pathname.endsWith('/setup')));
      }
      if(req.method==='POST'&&url.pathname==='/api/auth/logout')return authResponse(store.adminAuth.logout(req));
      let csrf='';
      if(url.pathname.startsWith('/api/')&&!bearer){const active=store.adminAuth.requireSession(req);csrf=active.csrf;if(!['GET','HEAD'].includes(req.method))store.adminAuth.csrf(req,csrf);}
      const providers=/^\/api\/providers\/([0-9a-f-]{36})(?:\/(atlassian|github|zendesk|trello)(?:\/(test))?)?$/.exec(url.pathname);
      if(providers){if(bearer)throw new Problem(403,'Owner session required');const [,authorization,family,action]=providers;if(req.method==='GET'&&!family)return json(store.providerConnections.list(authorization!));if(req.method==='PUT'&&family&&!action)return json(store.providerConnections.save(authorization!,family,await readJSON(req,16000)));if(req.method==='POST'&&family&&action==='test'){rate('provider-test:'+authorization+':'+family,12);return json(await store.providerConnections.test(authorization!,family,req.signal));}}
      if(req.method==='GET'&&url.pathname==='/api/management-keys')return json({keys:store.managementKeys.list()});
      if(req.method==='POST'&&url.pathname==='/api/management-keys')return json(store.managementKeys.issue(await readJSON(req)),201);
      const managementRevoke=/^\/api\/management-keys\/([0-9a-f-]{36})\/revoke$/.exec(url.pathname);
      if(req.method==='POST'&&managementRevoke)return json(store.managementKeys.revoke(managementRevoke[1]!));
      if(req.method==='GET'&&url.pathname==='/api/authorizations')return json({authorizations:store.snapshot().authorizations.map(({deployments,...a})=>a)});
      if(req.method==='GET'&&url.pathname==='/api/deployments')return json({authorizations:store.snapshot().authorizations});
      if(req.method==='GET'&&url.pathname==='/api/briefs')return json({briefs:store.snapshot().briefs});
      if(req.method==='POST'&&url.pathname==='/api/auth/activity')return json({ok:true});
      if(req.method==="GET" && url.pathname==="/api/state") return json({...store.snapshot(),csrf});
      if(req.method==="POST" && url.pathname==="/api/authorizations") {return json(store.issue((await readJSON(req)).name),201);}
      const revoke=/^\/api\/authorizations\/([^/]+)\/revoke$/.exec(url.pathname);
      if(req.method==="POST" && revoke) {store.revoke(revoke[1]!);return json({ok:true});}
      const migration=/^\/api\/authorizations\/([0-9a-f-]{36})\/rule-import(?:\/(plan|[0-9a-f-]{36}\/restore))?$/.exec(url.pathname);
      if(migration&&req.method==='POST'){const auth=migration[1]!,action=migration[2];const body=await readJSON(req);if(action==='plan')return json(store.remoteRules.migration.plan(auth,body));if(action?.endsWith('/restore'))return json(store.remoteRules.migration.restore(auth,action.slice(0,-8),body));return json(store.remoteRules.migration.commit(auth,body));}
      const rules=/^\/api\/authorizations\/([^/]+)\/rules(?:\/([^/]+))?(?:\/(details|plan|enabled))?$/.exec(url.pathname);
      if(rules){const auth=rules[1]!,id=rules[2],action=rules[3];
        if(req.method==="GET"&&!id)return json(store.remoteRules.list(auth));
        if(req.method==="GET"&&id==="catalog"&&!action)return json(store.remoteRules.catalog(auth));
        if(req.method==="GET"&&id&&action==="details")return json(store.remoteRules.details(auth,id));
        if(req.method==="POST"&&!id)return json(store.remoteRules.create(auth,await readJSON(req)));
        if(req.method==="POST"&&id&&action==="plan")return json(store.remoteRules.plan(auth,id,await readJSON(req)));
        if((req.method==="PUT"&&id&&!action)||(req.method==="POST"&&id&&action==="enabled"))return json(store.remoteRules.update(auth,id!,await readJSON(req)));
        if(req.method==="DELETE"&&id)return json(store.remoteRules.remove(auth,id,await readJSON(req)));
      }
      if(req.method==="POST" && url.pathname==="/api/briefs") return json(store.saveBrief(await readJSON(req)),201);
      const brief=/^\/api\/briefs\/([^/]+)$/.exec(url.pathname);
      if(req.method==="PUT" && brief) return json(store.saveBrief(await readJSON(req),brief[1]));
      if(req.method==="DELETE" && brief) {store.deleteBrief(brief[1]!);return json({ok:true});}
      if(req.method==="GET"&&url.pathname==="/THIRD_PARTY_NOTICES.txt")return new Response(Bun.file(new URL("THIRD_PARTY_NOTICES.txt",webRoot)),{headers});
      if(req.method==="GET"&&url.pathname.startsWith("/assets/")){
        const name=url.pathname.slice(8);if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw new Problem(404,"Asset not found");
        const file=Bun.file(new URL(`assets/${name}`,webRoot));if(!await file.exists())throw new Problem(404,"Asset not found");return new Response(file,{headers});
      }
      if(req.method==="GET"&&(url.pathname==="/"||url.pathname==="/login"||url.pathname==="/setup"||url.pathname==="/management-keys"||url.pathname==="/authorizations"||url.pathname==="/briefs"||url.pathname==="/providers"||/^\/authorizations\/[0-9a-f-]{36}(?:\/(?:rules|deployments|security)(?:\/[0-9a-f-]{36}\/sessions(?:\/[0-9a-f-]{36}(?:\/(?:agents|status))?)?)?)?$/.test(url.pathname))){
        const file=Bun.file(new URL("web/control-panel.html",webRoot));if(!await file.exists())throw new Problem(503,"Build the control panel web app before starting it");return new Response(file,{headers});
      }
      return json({error:"Not found"},404);
    } catch(e) {return json({error:e instanceof Problem?e.message:"Request failed"},e instanceof Problem?e.status:400);}finally{requests--;}
  }}); const stop=server.stop.bind(server);server.stop=(async(force?:boolean)=>{const stopping=stop(force);streams.close();clearInterval(providerTimer);await Promise.all([store.providerPolls.stop(),store.providerConnections.stop()]);await stopping;}) as typeof server.stop;return server;
}
