import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {collectThirdPartyNoticesForBundle} from '../vendor/butchr/scripts/build/web-notices.js';
import {resolve} from 'node:path';
const result=await Bun.build({entrypoints:[new URL('../src/provider-process-entry.ts',import.meta.url).pathname],target:'node',format:'esm',minify:false,packages:'bundle'});if(!result.success)throw Error(result.logs.join('\n'));const artifact=result.outputs[0]!;const code=await artifact.text();writeFileSync(new URL('../vendor/provider-engine/read-process.js',import.meta.url),code);const hash=createHash('sha256').update(code).digest('hex');writeFileSync(new URL('../vendor/provider-engine/read-process.sha256',import.meta.url),hash+'\n');const ids=[...code.matchAll(/^\/\/ (node_modules\/[^\n]+)$/gm)].map(m=>resolve(import.meta.dir,'..',m[1]!));
writeFileSync(new URL('../vendor/provider-engine/THIRD_PARTY_NOTICES.txt',import.meta.url),collectThirdPartyNoticesForBundle(resolve(import.meta.dir,'..'),ids));
console.log('Bounded read-process asset and third-party notices built:',hash);

const inputs=['package.json','bun.lock','scripts/build-provider-process.ts','scripts/verify-provider-process.ts','src/provider-process-entry.ts','src/provider-process-input.ts','vendor/provider-engine/readers.js','vendor/provider-engine/protocol.ts'];
writeFileSync(new URL('../vendor/provider-engine/PROCESS-SOURCE.json',import.meta.url),JSON.stringify({runtime:'Node >=20',bundleSHA256:hash,inputs:Object.fromEntries(inputs.map(path=>[path,createHash('sha256').update(readFileSync(resolve(import.meta.dir,'..',path))).digest('hex')]))},null,2)+'\n');
