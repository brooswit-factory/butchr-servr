import { randomBytes, timingSafeEqual } from "node:crypto";
import { isSameUidPeerAsync } from "./peer-uid.js";
import { Problem, type Store } from "./store.js";
const baseHeaders = {"cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","content-security-policy":"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
export function serve(store: Store, port=7731, allowIssuance=false) {
  const rates=new Map<string,{count:number;start:number}>();
  const csrf=randomBytes(32).toString("base64url");
  const json=(body:unknown,status=200)=>Response.json(body,{status,headers:baseHeaders});
  const server=Bun.serve({hostname:"127.0.0.1",port,maxRequestBodySize:1024*1024,async fetch(req,server) {
    try {
      const url=new URL(req.url); const origin=`http://127.0.0.1:${server.port}`;
      if(req.headers.get("host")!==new URL(origin).host) throw new Problem(403,"Untrusted host");
      const peer=server.requestIP(req); if(!peer || peer.address!=="127.0.0.1") throw new Problem(403,"Loopback required");
      if(url.pathname==="/v1/connect" && req.method==="POST") {
        if(req.headers.get("origin") || (req.headers.get("sec-fetch-site") && req.headers.get("sec-fetch-site")!=="none")) throw new Problem(403,"Machine endpoint");
        if(!req.headers.get("content-type")?.startsWith("application/json")) throw new Problem(415,"JSON required");
        const auth=store.authenticate(req.headers.get("authorization")?.replace(/^Bearer /,"")??null);
        const now=Date.now();const rate=rates.get(auth);if(rate&&now-rate.start<60000){if(++rate.count>240)throw new Problem(429,"Try again shortly");}else{rates.set(auth,{count:1,start:now});}
        const body=await req.json(); return json(store.connect(auth,body.deploymentId,body.sessionId));
      }
      if(!(await isSameUidPeerAsync(peer,{server:{address:"127.0.0.1",port:server.port!}}))) throw new Problem(403,"Same user required");
      const o=req.headers.get("origin"), site=req.headers.get("sec-fetch-site");
      if((o && o!==origin)||(site && !["same-origin","none"].includes(site))) throw new Problem(403,"Same origin required");
      if(!["GET","HEAD"].includes(req.method)) {
        const token=req.headers.get("x-butchr-servr-csrf")??"";
        if(o!==origin || token.length!==csrf.length || !timingSafeEqual(Buffer.from(token),Buffer.from(csrf))) throw new Problem(403,"CSRF check failed");
        if(!req.headers.get("content-type")?.startsWith("application/json")) throw new Problem(415,"JSON required");
      }
      if(req.method==="GET" && url.pathname==="/api/state") return json({...store.snapshot(),csrf,issuanceEnabled:allowIssuance});
      if(req.method==="POST" && url.pathname==="/api/authorizations") {if(!allowIssuance) throw new Problem(403,"Real key issuance awaits security approval"); return json(store.issue((await req.json()).name),201);}
      const revoke=/^\/api\/authorizations\/([^/]+)\/revoke$/.exec(url.pathname);
      if(req.method==="POST" && revoke) {store.revoke(revoke[1]!);return json({ok:true});}
      if(req.method==="POST" && url.pathname==="/api/briefs") return json(store.saveBrief(await req.json()),201);
      const brief=/^\/api\/briefs\/([^/]+)$/.exec(url.pathname);
      if(req.method==="PUT" && brief) return json(store.saveBrief(await req.json(),brief[1]));
      if(req.method==="DELETE" && brief) {store.deleteBrief(brief[1]!);return json({ok:true});}
      if(req.method==="GET" && ["/","/authorizations","/briefs","/app.js","/style.css"].includes(url.pathname)) {
        const file=url.pathname==="/app.js"?"app.js":url.pathname==="/style.css"?"style.css":"index.html";
        return new Response(Bun.file(new URL(`../web/${file}`,import.meta.url)),{headers:baseHeaders});
      }
      return json({error:"Not found"},404);
    } catch(e) {return json({error:e instanceof Problem?e.message:"Request failed"},e instanceof Problem?e.status:400);}
  }}); return server;
}
