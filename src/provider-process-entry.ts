import {readProviderProcessInput} from './provider-process-input.js';
/** Fixed isolated read entry. No shell, worker control, dynamic imports or user-selected code. */
import {createProviderReader,testGithubConnection,testJiraConnection,testZendeskToken,testTrelloCredentials,testTrelloBoard,type ProviderCredentials} from '../vendor/provider-engine/readers.js';
import {decodeProviderRead,decodeProviderValue} from '../vendor/provider-engine/protocol.js';
const originalFetch=globalThis.fetch;let aggregate=0;const deadline=Date.now()+30000;
async function main(){
 const job=await readProviderProcessInput(process.stdin) as any,credentials=job.credentials as ProviderCredentials;
 if(!credentials||!['atlassian','github','zendesk','trello'].includes(credentials.family)||!['read','probe'].includes(job.mode))throw Error('Invalid read job');
 const origins=new Set([credentials.family==='atlassian'?new URL(credentials.site).origin:credentials.family==='github'?'https://api.github.com':credentials.family==='zendesk'?`https://${credentials.subdomain}.zendesk.com`:'https://api.trello.com',...(job.linkedGithubToken?['https://api.github.com']:[])]);
 const boundedFetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response> = async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(!origins.has(url.origin)||url.username||url.password||url.protocol!=='https:')throw Error('Unexpected provider target');const method=init.method??'GET';if(method!=='GET'&&!(method==='POST'&&/\/search(?:\/jql)?$/.test(url.pathname)))throw Error('Read method required');
  const response=await originalFetch(input,{...init,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(Math.max(1,deadline-Date.now())),...(init.signal?[init.signal]:[])])});
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  if(reader)try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;aggregate+=part.value.byteLength;if(bytes>2000000||aggregate>8000000){await reader.cancel();throw Error('Provider response bound');}chunks.push(part.value);}}finally{reader.releaseLock();}
  const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}return new Response([204,205,304].includes(response.status)?null:body,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
 globalThis.fetch=Object.assign(boundedFetch,{preconnect:originalFetch.preconnect});
 let value:unknown;
 if(job.mode==='read'){const read=decodeProviderRead(job.read);value=decodeProviderValue(read,await createProviderReader(credentials,globalThis.fetch,job.linkedGithubToken)(read));}
 else if(credentials.family==='github')value=await testGithubConnection(credentials.token,credentials.orgs);
 else if(credentials.family==='atlassian')value=await testJiraConnection(credentials);
 else if(credentials.family==='zendesk'){const result=await testZendeskToken(credentials.subdomain,credentials.token);value=result.ok?{ok:true,account:result.label}:{ok:false,error:'Provider connection failed'};}
 else{const result=await testTrelloCredentials(credentials.apiKey,credentials.token);if(!result.ok)value={ok:false,error:'Provider connection failed'};else{const board=await testTrelloBoard(credentials.boardId,credentials.apiKey,credentials.token);value=board.ok?{ok:true,account:result.label,board:board.name}:{ok:false,error:'Provider board connection failed'};}}
 process.stdout.write(JSON.stringify({ok:true,value}));
}
try{await main();}catch{process.stdout.write('{"ok":false}');process.exitCode=1;}
