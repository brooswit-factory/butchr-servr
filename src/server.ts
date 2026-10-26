import { createEventStreams } from "./events.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { isSameUidPeerAsync } from "./peer-uid.js";
import { Problem, type Store } from "./store.js";
const baseHeaders = {"cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","content-security-policy":"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
export function serve(store: Store, port=7731) {
  const streams=createEventStreams(store);
  const rates=new Map<string,{count:number;start:number}>();
  const csrf=randomBytes(32).toString("base64url");
  const json=(body:unknown,status=200)=>Response.json(body,{status,headers:baseHeaders});
  const server=Bun.serve({hostname:"127.0.0.1",port,idleTimeout:60,maxRequestBodySize:1024*1024,error(){return new Response(null,{status:500,headers:baseHeaders});},async fetch(req,server) {
    try {
      const url=new URL(req.url); const origin=`http://127.0.0.1:${server.port}`;
      if(req.headers.get("host")!==new URL(origin).host) throw new Problem(403,"Untrusted host");
      const peer=server.requestIP(req); if(!peer || peer.address!=="127.0.0.1") throw new Problem(403,"Loopback required");
      if(["/v1/connect","/v1/register","/v1/events"].includes(url.pathname)) {
        if(url.search)throw new Problem(400,"Machine URLs do not accept query parameters");
        const streaming=url.pathname==="/v1/events";
        if(req.method!==(streaming?"GET":"POST"))throw new Problem(405,"Method not allowed");
        if(req.headers.get("origin") || (req.headers.get("sec-fetch-site") && req.headers.get("sec-fetch-site")!=="none")) throw new Problem(403,"Machine endpoint");
        if(!streaming&&!req.headers.get("content-type")?.startsWith("application/json")) throw new Problem(415,"JSON required");
        const auth=store.authenticate(req.headers.get("authorization")?.replace(/^Bearer /,"")??null);
        const now=Date.now();const rate=rates.get(auth);if(rate&&now-rate.start<60000){if(++rate.count>240)throw new Problem(429,"Try again shortly");}else{rates.set(auth,{count:1,start:now});}
        if(streaming){store.registered(auth,req.headers.get("x-butchr-deployment-id"),req.headers.get("x-butchr-session-id"));return streams.open(auth,req.signal);}
        const body=await req.json(); const snapshot=store.connect(auth,body.deploymentId,body.sessionId);
        return json(url.pathname==="/v1/register"?{serverId:snapshot.serverId,authorizationId:auth,registered:true}:snapshot);
      }
      if(!(await isSameUidPeerAsync(peer,{server:{address:"127.0.0.1",port:server.port!}}))) throw new Problem(403,"Same user required");
      const o=req.headers.get("origin"), site=req.headers.get("sec-fetch-site");
      if((o && o!==origin)||(site && !["same-origin","none"].includes(site))) throw new Problem(403,"Same origin required");
      if(!["GET","HEAD"].includes(req.method)) {
        const token=req.headers.get("x-butchr-servr-csrf")??"";
        if(o!==origin || token.length!==csrf.length || !timingSafeEqual(Buffer.from(token),Buffer.from(csrf))) throw new Problem(403,"CSRF check failed");
        if(!req.headers.get("content-type")?.startsWith("application/json")) throw new Problem(415,"JSON required");
      }
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
      if(req.method==="GET"&&url.pathname==="/THIRD_PARTY_NOTICES.txt")return new Response(Bun.file(new URL("../web-dist/THIRD_PARTY_NOTICES.txt",import.meta.url)),{headers:baseHeaders});
      if(req.method==="GET"&&url.pathname.startsWith("/assets/")){
        const name=url.pathname.slice(8);if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw new Problem(404,"Asset not found");
        const file=Bun.file(new URL(`../web-dist/assets/${name}`,import.meta.url));if(!await file.exists())throw new Problem(404,"Asset not found");return new Response(file,{headers:baseHeaders});
      }
      if(req.method==="GET"&&(url.pathname==="/"||url.pathname==="/authorizations"||url.pathname==="/briefs"||/^\/authorizations\/[0-9a-f-]{36}(?:\/(?:rules|deployments))?$/.test(url.pathname))){
        const file=Bun.file(new URL("../web-dist/web/control-panel.html",import.meta.url));if(!await file.exists())throw new Problem(503,"Build the control panel web app before starting it");return new Response(file,{headers:baseHeaders});
      }
      return json({error:"Not found"},404);
    } catch(e) {return json({error:e instanceof Problem?e.message:"Request failed"},e instanceof Problem?e.status:400);}
  }}); const stop=server.stop.bind(server);server.stop=((force?:boolean)=>{streams.close();return stop(force);}) as typeof server.stop;return server;
}
