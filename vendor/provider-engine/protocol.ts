/** Shared server/client read-subscription protocol. No provider credentials or worker commands. */
export const PROVIDER_READ_PROTOCOL=1;
export const MAX_PROVIDER_READS=256,MAX_PROVIDER_RESULT_BYTES=4_000_000,MAX_PROVIDER_STATE_BYTES=24_000_000;
export const providerReadOperations={
 'jira-work':['searchAll','comments','remoteLinks','issue','allComments','pollExternal'],
 'jira-idea':['searchAll','comments','remoteLinks','issue','allComments','pollExternal'],
 'jira-project':['searchProjects','searchAll','comments','remoteLinks','issue','allComments','pollExternal'],
 'confluence-page':['getChildPages','getPageVersions','getPageComments','getPage','confluencePageVersion'],
 'github-issue':['searchAll','comments','get'],
 'github-pr':['searchAll','comments','get'],
 'zendesk-ticket':['searchAll','comments','get'],
 'trello-card':['searchAll','comments','get','lists'],
} as const;
export type RemoteProvider=keyof typeof providerReadOperations;
export interface ProviderRead {provider:RemoteProvider;method:string;args:unknown[]}
export interface ProviderReadScope {serverId:string;authorizationId:string;deploymentId:string;sessionId:string;ruleRevision:string;credentialEpoch:string}
export interface ProviderReadResult {id:string;read:ProviderRead;version:number;observedAt:number;expiresAt:number;result:{ok:true;value:unknown}|{ok:false;code:'unavailable'|'rate-limited'|'expired'}}
export interface ProviderReadState {protocol:1;scope:ProviderReadScope;providers:RemoteProvider[];atlassianOrigin?:string;results:ProviderReadResult[]}
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function exact(v:Record<string,unknown>,keys:string[]){if(Object.keys(v).sort().join(',')!==keys.sort().join(','))throw Error('Invalid provider fields');}
function boundedString(value:unknown,max=32000){if(typeof value!=='string'||!value.length||value.length>max||value.includes('\0'))throw Error('Invalid provider argument');}
export function decodeProviderRead(value:unknown):ProviderRead{
 if(!plain(value))throw Error('Invalid provider read');exact(value,['provider','method','args']);
 if(typeof value.provider!=='string'||!Object.hasOwn(providerReadOperations,value.provider)||typeof value.method!=='string'||!(providerReadOperations[value.provider as RemoteProvider] as readonly string[]).includes(value.method)||!Array.isArray(value.args))throw Error('Unsupported provider read');
 const {provider,method,args}=value as unknown as ProviderRead;
 if(method==='pollExternal'){const item=args[0];if(args.length!==2||!plain(item)||Object.keys(item).some(k=>!['kind','target','origin'].includes(k))||!['confluence','github-issue','github-pr','webpage'].includes(item.kind as string)||typeof item.target!=='string'||!item.target||item.target.length>4096||(item.origin!==undefined&&item.origin!=='ticket-pr')||(args[1]!==null&&typeof args[1]!=='string'))throw Error('Invalid external read');if(typeof args[1]==='string'&&args[1].length>32000)throw Error('External fingerprint too long');}
 else if(method==='lists'){if(args.length)throw Error('Unexpected provider arguments');}
 else if(method==='getPageVersions'){if(args.length!==1||!Array.isArray(args[0])||args[0].length>1000||args[0].some(v=>typeof v!=='string'||!/^\d{1,100}$/.test(v)))throw Error('Invalid page IDs');}
 else if(method==='getChildPages'){if(args.length<1||args.length>2)throw Error('Invalid child-page arguments');boundedString(args[0],100);if(!/^\d+$/.test(args[0] as string))throw Error('Invalid page ID');if(args.length===2)boundedString(args[1],4096);}
 else if((provider==='github-issue'||provider==='github-pr')&&method!=='searchAll'){
  const ref=args[0];if(args.length!==1||!plain(ref))throw Error('Invalid GitHub ref');exact(ref,['owner','repo','number']);if(typeof ref.owner!=='string'||!/^[A-Za-z0-9-]{1,100}$/.test(ref.owner)||typeof ref.repo!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(ref.repo)||!Number.isSafeInteger(ref.number)||(ref.number as number)<1)throw Error('Invalid GitHub ref');
 }else if((provider==='zendesk-ticket'||provider==='trello-card')&&method!=='searchAll'&&method!=='lists'){
  const ref=args[0];if(args.length!==1||!plain(ref))throw Error('Invalid provider ref');
  if(provider==='zendesk-ticket'){exact(ref,['subdomain','id']);if(typeof ref.subdomain!=='string'||!/^[a-z0-9][a-z0-9-]{0,62}$/.test(ref.subdomain)||!Number.isSafeInteger(ref.id)||(ref.id as number)<1)throw Error('Invalid Zendesk ref');}
  else{exact(ref,['boardId','cardId']);if(typeof ref.boardId!=='string'||typeof ref.cardId!=='string'||!(/^[a-f0-9]{24}$/).test(ref.boardId)||!(/^[a-f0-9]{24}$/).test(ref.cardId))throw Error('Invalid Trello ref');}
 }else{if(args.length!==1)throw Error('Invalid provider arguments');if((method==='searchAll'||method==='searchProjects')&&args[0]===''){}else boundedString(args[0]);if(provider==='confluence-page'&&!/^\d{1,100}$/.test(args[0] as string))throw Error('Invalid page ID');}
 return structuredClone({provider,method,args});
}
export function providerReadId(read:ProviderRead):string{const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;return JSON.stringify([read.provider,read.method,canonical(read.args)]);}
export function sameProviderScope(a:ProviderReadScope,b:ProviderReadScope){return Object.keys(a).length===6&&Object.keys(b).length===6&&(['serverId','authorizationId','deploymentId','sessionId','ruleRevision','credentialEpoch'] as const).every(k=>a[k]===b[k]);}
export function decodeProviderScope(value:unknown):ProviderReadScope{
 if(!plain(value))throw Error('Invalid provider scope');exact(value,['serverId','authorizationId','deploymentId','sessionId','ruleRevision','credentialEpoch']);for(const [key,v] of Object.entries(value)){boundedString(v,key==='ruleRevision'?200:100);if(/[\x00-\x20\x7f]/.test(v as string))throw Error('Invalid provider identity');}return {...value} as unknown as ProviderReadScope;
}
function jsonClone(value:unknown,max:number){let nodes=0;const visit=(v:unknown,depth:number):void=>{if(++nodes>200000||depth>32)throw Error('Provider result too complex');if(v===null||typeof v==='boolean'||typeof v==='string')return;if(v instanceof Date&&Number.isFinite(v.getTime()))return;if(typeof v==='number'&&Number.isFinite(v))return;if(Array.isArray(v)){for(const x of v)visit(x,depth+1);return;}if(plain(v)){for(const [k,x] of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))throw Error('Unsafe provider field');if(x!==undefined)visit(x,depth+1);}return;}throw Error('Provider result must be JSON');};visit(value,0);const text=JSON.stringify(value);if(new TextEncoder().encode(text).byteLength>max)throw Error('Provider result exceeds bound');return JSON.parse(text) as unknown;}
export function decodeProviderValue(read:ProviderRead,value:unknown):unknown{
 const copy=jsonClone(value,MAX_PROVIDER_RESULT_BYTES);if(read.method==='pollExternal'){if(!plain(copy)||!['ok','not-modified','unreadable','error'].includes(copy.status as string)||(copy.status==='ok'&&typeof copy.fingerprint!=='string'))throw Error('Invalid external verdict');return copy;}const list=['searchAll','searchProjects','comments','allComments','remoteLinks','lists'].includes(read.method);if(list&&!Array.isArray(copy))throw Error('Invalid provider collection');
 if(['get','issue','getPage','getChildPages','getPageComments','getPageVersions','confluencePageVersion'].includes(read.method)&&!plain(copy))throw Error('Invalid provider resource');
 if(read.method==='getChildPages'||read.method==='getPageComments'){if(!plain(copy)||!Array.isArray(copy.results))throw Error('Invalid page collection');}
 const strings=(v:unknown,keys:string[])=>{if(!plain(v)||keys.some(k=>typeof v[k]!=='string'))throw Error('Invalid provider DTO');};
 const resource=(v:unknown)=>{if(read.provider.startsWith('jira-'))strings(v,['key','summary','status','issuetype','updated']);else if(read.provider.startsWith('github-'))strings(v,['ref','owner','repo','title','body','state','updated','url']);else if(read.provider==='zendesk-ticket')strings(v,['ref','subject','description','status','updated','url']);else if(read.provider==='trello-card')strings(v,['ref','id','boardId','name','desc','updated','url']);};
 if(read.method==='searchAll')for(const item of copy as unknown[])resource(item);
 if(read.method==='get'||read.method==='issue')resource(copy);
 if(read.method==='searchProjects')for(const item of copy as unknown[])strings(item,['id','key','name']);
 if(read.method==='comments'||read.method==='allComments')for(const item of copy as unknown[])strings(item,['id','body','created']);
 if(read.method==='getChildPages'||read.method==='getPageComments')for(const item of (copy as {results:unknown[]}).results)strings(item,['id']);
 if(read.method==='getPageVersions')for(const [id,version] of Object.entries(copy as object))if(!/^\d+$/.test(id)||!Number.isSafeInteger(version)||(version as number)<1)throw Error('Invalid page version');
 return copy;
}
export function decodeProviderReadState(value:unknown):ProviderReadState{
 const all=jsonClone(value,MAX_PROVIDER_STATE_BYTES);if(!plain(all))throw Error('Invalid provider state');exact(all,['protocol','scope','providers','results',...(all.atlassianOrigin!==undefined?['atlassianOrigin']:[])]);if(all.atlassianOrigin!==undefined){if(typeof all.atlassianOrigin!=='string')throw Error('Invalid provider account');const origin=new URL(all.atlassianOrigin);if(origin.origin!==all.atlassianOrigin||origin.protocol!=='https:'||!origin.hostname.endsWith('.atlassian.net'))throw Error('Invalid provider account');}if(all.protocol!==1||!Array.isArray(all.results)||all.results.length>MAX_PROVIDER_READS)throw Error('Invalid provider state');if(!Array.isArray(all.providers)||all.providers.length>8||all.providers.some(p=>typeof p!=='string'||!Object.hasOwn(providerReadOperations,p))||new Set(all.providers).size!==all.providers.length)throw Error('Invalid provider availability');const providers=all.providers as RemoteProvider[];const scope=decodeProviderScope(all.scope),seen=new Set<string>();
 const results=all.results.map((entry:unknown):ProviderReadResult=>{if(!plain(entry))throw Error('Invalid provider result');exact(entry,['id','read','version','observedAt','expiresAt','result']);const read=decodeProviderRead(entry.read);if(entry.id!==providerReadId(read)||seen.has(entry.id as string))throw Error('Invalid provider read identity');seen.add(entry.id as string);if(!Number.isSafeInteger(entry.version)||(entry.version as number)<0||!Number.isSafeInteger(entry.observedAt)||!Number.isSafeInteger(entry.expiresAt)||(entry.expiresAt as number)<(entry.observedAt as number))throw Error('Invalid provider observation time');const result=entry.result;if(!plain(result))throw Error('Invalid provider outcome');let outcome:ProviderReadResult['result'];if(result.ok===true){exact(result,['ok','value']);outcome={ok:true,value:decodeProviderValue(read,result.value)};}else{exact(result,['ok','code']);if(result.ok!==false||!['unavailable','rate-limited','expired'].includes(result.code as string))throw Error('Invalid provider failure');outcome={ok:false,code:result.code as 'unavailable'|'rate-limited'|'expired'};}return {id:entry.id as string,read,version:entry.version as number,observedAt:entry.observedAt as number,expiresAt:entry.expiresAt as number,result:outcome};});return {protocol:1,scope,providers,...(all.atlassianOrigin!==undefined?{atlassianOrigin:all.atlassianOrigin as string}:{}),results};
}
