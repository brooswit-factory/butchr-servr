/** Server-side public webpage transport. Every redirect hop is resolved, checked
 * and connected to that exact address while TLS/Host retain the original host.
 * Node HTTP lookup/HTTPS options: https://nodejs.org/api/http.html#httprequesturl-options-callback
 * https://nodejs.org/api/https.html#httpsrequesturl-options-callback */
import {lookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {createGunzip,createInflate,createBrotliDecompress} from 'node:zlib';
import type {Readable,Transform} from 'node:stream';
const denied4=new BlockList(),denied6=new BlockList(),global6=new BlockList();
for(const [network,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4],['168.63.129.16',32]] as const)denied4.addSubnet(network,prefix,'ipv4');
global6.addSubnet('2000::',3,'ipv6');for(const [network,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const)denied6.addSubnet(network,prefix,'ipv6');
export function publicProviderAddress(address:string){const family=isIP(address);return family===4?!denied4.check(address,'ipv4'):family===6&&global6.check(address,'ipv6')&&!denied6.check(address,'ipv6');}
export type PinnedAddress={address:string;family:number};
export function createPinnedWebpageFetch(deps:{resolve?:(host:string)=>Promise<PinnedAddress[]>;request?:typeof httpRequest;timeoutMs?:number}={}){
 const resolve=deps.resolve??(host=>lookup(host,{all:true,verbatim:true}));
 return async(input:string,init:RequestInit={}):Promise<Response>=>{
  const url=new URL(input),host=url.hostname.replace(/^\[|\]$/g,'');if(!['http:','https:'].includes(url.protocol)||url.username||url.password||host==='localhost'||/\.(?:localhost|local|internal)$/i.test(host)||init.body||(init.method&&init.method!=='GET'))throw Error('Public webpage read required');
  const headers=new Headers(init.headers);for(const key of headers.keys())if(!['if-none-match','if-modified-since'].includes(key))throw Error('Webpage credentials and custom headers are forbidden');
  const signal=AbortSignal.any([AbortSignal.timeout(deps.timeoutMs??10000),...(init.signal?[init.signal]:[])]);
  const answers=await Promise.race([isIP(host)?Promise.resolve([{address:host,family:isIP(host)}]):resolve(host),new Promise<never>((_,reject)=>{signal.addEventListener('abort',()=>reject(Error('Webpage resolution timed out')),{once:true});})]);
  if(signal.aborted||!answers.length||answers.length>32||answers.some(a=>!publicProviderAddress(a.address)||a.family!==isIP(a.address)))throw Error('Nonpublic or invalid webpage address');const pinned=answers[0]!;
  return new Promise<Response>((resolveResponse,reject)=>{
   const request=deps.request??(url.protocol==='https:'?httpsRequest:httpRequest);let responseBody:ReadableStreamDefaultController<Uint8Array>|null=null;let settled=false;
   const req=request({protocol:url.protocol,hostname:pinned.address,port:url.port||(url.protocol==='https:'?443:80),path:url.pathname+url.search,agent:false,method:'GET',headers:{host:url.host,...Object.fromEntries(headers)},family:pinned.family,...(url.protocol==='https:'?{rejectUnauthorized:true,checkServerIdentity:(_hostname:string,cert:import('node:tls').PeerCertificate)=>checkServerIdentity(host,cert),...(!isIP(host)?{servername:host}:{})}:{}),signal,maxHeaderSize:16384},message=>{
    if(signal.aborted){message.destroy();reject(Error('Webpage request aborted'));return;}
    message.pause();let source:Readable|null=null,decoder:Transform|null=null,encoded=0,decoded=0,ended=false;
    const destroy=()=>{decoder?.destroy();message.destroy();req.destroy();};
    const fail=()=>{if(ended)return;ended=true;try{responseBody?.error(Error('Webpage response failed'));}catch{}responseBody=null;destroy();};
    message.on('error',fail);req.on('error',fail);
    // Match fetch's decoded-body semantics without buffering a compressed bomb.
    // Initialize on demand so ETag/Last-Modified and status-only paths can cancel
    // immediately without reading or decoding any response body.
    const body=new ReadableStream<Uint8Array>({start(controller){responseBody=controller;},pull(controller){
     if(!source){
      const coding=String(message.headers['content-encoding']??'identity').trim().toLowerCase();
      if(!['identity','','gzip','x-gzip','deflate','br'].includes(coding)){fail();return;}
      decoder=coding==='gzip'||coding==='x-gzip'?createGunzip():coding==='deflate'?createInflate():coding==='br'?createBrotliDecompress():null;
      source=decoder??message;
      message.on('data',(chunk:Buffer)=>{encoded+=chunk.byteLength;if(encoded>1_000_000)fail();});
      source.on('data',(chunk:Buffer)=>{source!.pause();decoded+=chunk.byteLength;if(decoded>1_000_000){fail();return;}if(!ended)controller.enqueue(new Uint8Array(chunk));});
      source.on('end',()=>{if(ended)return;ended=true;responseBody=null;controller.close();});
      if(decoder){decoder.on('error',fail);message.pipe(decoder);}
     }
     source.resume();
    },cancel(){ended=true;responseBody=null;destroy();}},{highWaterMark:0});
    const responseHeaders=new Headers();for(const [name,value] of Object.entries(message.headers))if(value!==undefined)for(const item of Array.isArray(value)?value:[value])responseHeaders.append(name,item);
    try{const status=message.statusCode??502;const response=new Response([204,205,304].includes(status)?null:body,{status,headers:responseHeaders});settled=true;resolveResponse(response);if([204,205,304].includes(status)){responseBody=null;message.destroy();req.destroy();}}catch{responseBody=null;message.destroy();req.destroy();reject(Error('Invalid webpage response'));}
   });
   req.on('error',()=>{if(!settled)reject(Error('Webpage connection failed'));else{try{responseBody?.error(Error('Webpage connection failed'));}catch{}}});req.end();
  });
 };
}
