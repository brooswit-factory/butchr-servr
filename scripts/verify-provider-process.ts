import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),manifest=JSON.parse(readFileSync(new URL('vendor/provider-engine/PROCESS-SOURCE.json',root),'utf8'));
const required=['package.json','bun.lock','scripts/build-provider-process.ts','scripts/verify-provider-process.ts','src/provider-process-entry.ts','src/provider-process-input.ts','vendor/provider-engine/readers.js','vendor/provider-engine/protocol.ts'];
if(JSON.stringify(Object.keys(manifest.inputs).sort())!==JSON.stringify(required.sort()))throw Error('Provider subprocess source manifest incomplete');
const digest=(path:string)=>createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex');
for(const [path,hash] of Object.entries(manifest.inputs))if(digest(path)!==hash)throw Error('Provider subprocess stale: '+path+'; run build:providers');
const hash=digest('vendor/provider-engine/read-process.js');if(hash!==manifest.bundleSHA256||hash!==readFileSync(new URL('vendor/provider-engine/read-process.sha256',root),'utf8').trim())throw Error('Provider subprocess asset checksum mismatch');
console.log('Provider subprocess source and bundle digests verified.');
