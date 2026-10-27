/** Developer-only update. The committed bundle is self-contained source, not a sibling runtime dependency. */
import {resolve,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=resolve(process.argv[2]??'../butchr'),target=resolve(import.meta.dirname,'../vendor/provider-engine');
mkdirSync(target,{recursive:true});
const result=await Bun.build({entrypoints:[join(source,'src/providers/readers.ts')],target:'bun',format:'esm',packages:'external',minify:false});
if(!result.success)throw Error(result.logs.join('\n'));
const text=await result.outputs[0]!.text();writeFileSync(join(target,'readers.js'),text);
writeFileSync(join(target,'protocol.ts'),readFileSync(join(source,'src/providers/read-protocol.ts')));
writeFileSync(join(target,'pinned-webpage.ts'),readFileSync(join(source,'src/providers/pinned-webpage.ts')));
const inputs=[...new Set([...text.matchAll(/^\/\/ (?:\.\.\/)?(?:butchr\/)?(src\/[^\n]+\.ts)$/gm)].map(m=>m[1]!))];
// Always record the public boundary modules even when Bun's source comments use absolute paths.
for(const f of ['src/providers/readers.ts','src/providers/read-protocol.ts'])if(!inputs.includes(f))inputs.push(f);
const hash=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
writeFileSync(join(target,'SOURCE.json'),JSON.stringify({sourceProject:'Butchr',license:'MIT',purpose:'Existing provider read methods only; no daemon startup or worker code',inputs:Object.fromEntries(inputs.sort().map(f=>[f,hash(readFileSync(join(source,f)))])),bundleSHA256:hash(text)},null,2)+'\n');
writeFileSync(join(target,'readers.d.ts'),`import type {ProviderRead} from './protocol.js';\nexport type ProviderCredentials={family:'atlassian';site:string;email:string;token:string}|{family:'github';token:string;orgs:string[]}|{family:'zendesk';subdomain:string;token:string}|{family:'trello';boardId:string;apiKey:string;token:string};\nexport function createProviderReader(credentials:ProviderCredentials,fetchImpl?:(url:string,init?:RequestInit)=>Promise<Response>,linkedGithubToken?:string,sdkTransports?:{jira:{sendRequest<T>(options:any):Promise<T>};confluence:{sendRequest<T>(options:any):Promise<T>}}):(read:ProviderRead)=>Promise<unknown>;\n`);
writeFileSync(join(target,'readers.d.ts'),readFileSync(join(target,'readers.d.ts'),'utf8')+`\nexport function linkedWebpageTargets(read:import('./protocol.js').ProviderRead,value:unknown):string[];\nexport function testGithubConnection(token:string,orgs:readonly string[],fetchImpl?:(url:string,init?:RequestInit)=>Promise<Response>):Promise<any>;\nexport function testJiraConnection(credentials:{site:string;email:string;token:string},fetchImpl?:(url:string,init?:RequestInit)=>Promise<Response>):Promise<any>;\nexport function testZendeskToken(subdomain:string,token:string,fetchImpl?:(url:string,init?:RequestInit)=>Promise<Response>):Promise<any>;\nexport function testTrelloCredentials(apiKey:string,token:string,fetchImpl?:(url:string,init?:RequestInit)=>Promise<Response>):Promise<any>;\nexport function testTrelloBoard(boardId:string,apiKey:string,token:string,fetchImpl?:(url:string,init?:RequestInit)=>Promise<Response>):Promise<any>;\n`);
console.log('Provider reader bundle and exact input digests updated; no credentials read.');
