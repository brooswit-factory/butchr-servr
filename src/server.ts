import {managementScope} from "./management-keys.js";
import { createEventStreams } from "./events.js";
import { isSameUidPeerAsync } from "./peer-uid.js";
import { Problem, type Store } from "./store.js";
const baseHeaders = {"cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","content-security-policy":"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
export function serve(store: Store, port=7731,webRoot=new URL("../web-dist/",import.meta.url)) {
  const streams=createEventStreams(store);
  const rates=new Map<string,{count:number;start:number}>();
  const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{...baseHeaders,...(status===429?{"retry-after":"60"}:{})}});
  const server=Bun.serve({hostname:"127.0.0.1",port,idleTimeout:60,maxRequestBodySize:1024*1024,error(){return new Response(null,{status:500,headers:baseHeaders});},async fetch(req,server) {
    try {
      const url=new URL(req.url); const origin=`http://127.0.0.1:${server.port}`;
      if(req.headers.get("host")!==new URL(origin).host) throw new Problem(403,"Untrusted host");
      const peer=server.requestIP(req); if(!peer || peer.address!=="127.0.0.1") throw new Problem(403,"Loopback required");
      if(["/v1/connect","/v1/register","/v1/events","/v1/instance-events"].includes(url.pathname)) {
        if(url.search)throw new Problem(400,"Machine URLs do not accept query parameters");
        const streaming=url.pathname==="/v1/events";
        if(req.method!==(streaming?"GET":"POST"))throw new Problem(405,"Method not allowed");
        if(req.headers.get("origin") || (req.headers.get("sec-fetch-site") && req.headers.get("sec-fetch-site")!=="none")) throw new Problem(403,"Machine endpoint");
        if(!streaming&&!req.headers.get("content-type")?.startsWith("application/json")) throw new Problem(415,"JSON required");
        const auth=store.authenticate(req.headers.get("authorization")?.replace(/^Bearer /,"")??null);
        const now=Date.now();const rate=rates.get(auth);if(rate&&now-rate.start<60000){if(++rate.count>240)throw new Problem(429,"Try again shortly");}else{rates.set(auth,{count:1,start:now});}
        if(streaming){store.registered(auth,req.headers.get("x-butchr-deployment-id"),req.headers.get("x-butchr-session-id"));return streams.open(auth,req.signal);}
        const body=await req.json();if(url.pathname==="/v1/instance-events")return json(store.telemetry.ingest(auth,body));
        const snapshot=store.connect(auth,body.deploymentId,body.sessionId);
        return json(url.pathname==="/v1/register"?{serverId:snapshot.serverId,authorizationId:auth,registered:true}:snapshot);
      }
      const bearer=req.headers.get('authorization');
      if(bearer){
        if(!url.pathname.startsWith('/api/')||url.search||req.headers.has('cookie')||req.headers.has('origin')||(req.headers.get('sec-fetch-site')&&req.headers.get('sec-fetch-site')!=='none'))throw new Problem(403,'Management keys require a non-browser API request');
        const key=store.managementKeys.authenticate(bearer.startsWith('Bearer ')?bearer.slice(7):'');const scope=managementScope(url.pathname,req.method);
        const rateId='management:'+key.id,now=Date.now(),rate=rates.get(rateId);if(rate&&now-rate.start<60000){if(++rate.count>120)throw new Problem(429,'Try again shortly');}else rates.set(rateId,{count:1,start:now});
        if(!scope||!key.scopes.includes(scope)||(scope==='rules:read'&&url.pathname.endsWith('/catalog')&&!key.scopes.includes('briefs:read')))throw new Problem(403,'Management scope required');
        store.managementKeys.touch(key.id);
      }
      if(!(await isSameUidPeerAsync(peer,{server:{address:"127.0.0.1",port:server.port!}}))) throw new Problem(403,"Same user required");
      const o=req.headers.get("origin"), site=req.headers.get("sec-fetch-site");
      if((o && o!==origin)||(site && !["same-origin","none"].includes(site))) throw new Problem(403,"Same origin required");
      if(!["GET","HEAD"].includes(req.method)&& ((!bearer&&o!==origin)||!req.headers.get("content-type")?.startsWith("application/json")))throw new Problem(403,"Same-origin JSON required");
      const authResponse=(result:{body:unknown;cookie:string|null})=>{const response=json(result.body);if(result.cookie)response.headers.set('set-cookie',result.cookie);return response;};
      if(req.method==='GET'&&url.pathname==='/api/auth/session')return authResponse(store.adminAuth.status(req));
      if(req.method==='POST'&&['/api/auth/login','/api/auth/setup'].includes(url.pathname)){
        if(Number(req.headers.get('content-length'))>4096)throw new Problem(413,'Login request too large');
        const raw=await req.text();if(Buffer.byteLength(raw)>4096)throw new Problem(413,'Login request too large');
        return authResponse(await store.adminAuth.login(req,JSON.parse(raw),url.pathname.endsWith('/setup')));
      }
      if(req.method==='POST'&&url.pathname==='/api/auth/logout')return authResponse(store.adminAuth.logout(req));
      let csrf='';
      if(url.pathname.startsWith('/api/')&&!bearer){const active=store.adminAuth.requireSession(req);csrf=active.csrf;if(!['GET','HEAD'].includes(req.method))store.adminAuth.csrf(req,csrf);}
      if(req.method==='GET'&&url.pathname==='/api/management-keys')return json({keys:store.managementKeys.list()});
      if(req.method==='POST'&&url.pathname==='/api/management-keys')return json(store.managementKeys.issue(await req.json()),201);
      const managementRevoke=/^\/api\/management-keys\/([0-9a-f-]{36})\/revoke$/.exec(url.pathname);
      if(req.method==='POST'&&managementRevoke)return json(store.managementKeys.revoke(managementRevoke[1]!));
      if(req.method==='GET'&&url.pathname==='/api/authorizations')return json({authorizations:store.snapshot().authorizations.map(({deployments,...a})=>a)});
      if(req.method==='GET'&&url.pathname==='/api/deployments')return json({authorizations:store.snapshot().authorizations});
      if(req.method==='GET'&&url.pathname==='/api/briefs')return json({briefs:store.snapshot().briefs});
      if(req.method==='POST'&&url.pathname==='/api/auth/activity')return json({ok:true});
      if(req.method==="GET" && url.pathname==="/api/state") return json({...store.snapshot(),csrf});
      if(req.method==="POST" && url.pathname==="/api/authorizations") {return json(store.issue((await req.json()).name),201);}
      const revoke=/^\/api\/authorizations\/([^/]+)\/revoke$/.exec(url.pathname);
      if(req.method==="POST" && revoke) {store.revoke(revoke[1]!);return json({ok:true});}
      const rules=/^\/api\/authorizations\/([^/]+)\/rules(?:\/([^/]+))?(?:\/(details|plan|enabled))?$/.exec(url.pathname);
      if(rules){const auth=rules[1]!,id=rules[2],action=rules[3];
        if(req.method==="GET"&&!id)return json(store.remoteRules.list(auth));
        if(req.method==="GET"&&id==="catalog"&&!action)return json(store.remoteRules.catalog(auth));
        if(req.method==="GET"&&id&&action==="details")return json(store.remoteRules.details(auth,id));
        if(req.method==="POST"&&!id)return json(store.remoteRules.create(auth,await req.json()));
        if(req.method==="POST"&&id&&action==="plan")return json(store.remoteRules.plan(auth,id,await req.json()));
        if((req.method==="PUT"&&id&&!action)||(req.method==="POST"&&id&&action==="enabled"))return json(store.remoteRules.update(auth,id!,await req.json()));
        if(req.method==="DELETE"&&id)return json(store.remoteRules.remove(auth,id,await req.json()));
      }
      if(req.method==="POST" && url.pathname==="/api/briefs") return json(store.saveBrief(await req.json()),201);
      const brief=/^\/api\/briefs\/([^/]+)$/.exec(url.pathname);
      if(req.method==="PUT" && brief) return json(store.saveBrief(await req.json(),brief[1]));
      if(req.method==="DELETE" && brief) {store.deleteBrief(brief[1]!);return json({ok:true});}
      if(req.method==="GET"&&url.pathname==="/THIRD_PARTY_NOTICES.txt")return new Response(Bun.file(new URL("THIRD_PARTY_NOTICES.txt",webRoot)),{headers:baseHeaders});
      if(req.method==="GET"&&url.pathname.startsWith("/assets/")){
        const name=url.pathname.slice(8);if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw new Problem(404,"Asset not found");
        const file=Bun.file(new URL(`assets/${name}`,webRoot));if(!await file.exists())throw new Problem(404,"Asset not found");return new Response(file,{headers:baseHeaders});
      }
      if(req.method==="GET"&&(url.pathname==="/"||url.pathname==="/login"||url.pathname==="/setup"||url.pathname==="/management-keys"||url.pathname==="/authorizations"||url.pathname==="/briefs"||/^\/authorizations\/[0-9a-f-]{36}(?:\/(?:rules|deployments|security)(?:\/[0-9a-f-]{36}\/sessions(?:\/[0-9a-f-]{36}(?:\/(?:agents|status))?)?)?)?$/.test(url.pathname))){
        const file=Bun.file(new URL("web/control-panel.html",webRoot));if(!await file.exists())throw new Problem(503,"Build the control panel web app before starting it");return new Response(file,{headers:baseHeaders});
      }
      return json({error:"Not found"},404);
    } catch(e) {return json({error:e instanceof Problem?e.message:"Request failed"},e instanceof Problem?e.status:400);}
  }}); const stop=server.stop.bind(server);server.stop=((force?:boolean)=>{const stopping=stop(force);streams.close();return stopping;}) as typeof server.stop;return server;
}
