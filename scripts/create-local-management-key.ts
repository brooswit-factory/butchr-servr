/** Explicit OS-owner bootstrap. Run only when authorized; no raw secret output or argv. */
import {lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {createStore} from '../src/store.js';
import {provisionManagementKey} from '../src/key-provision.js';
if(process.argv.includes('--help')){console.log('Usage: bun scripts/create-local-management-key.ts --name LABEL --days 30 --scopes authorizations:read,rules:read,briefs:read,deployments:read [--db runtime/control.sqlite]\nStores raw key only in the existing unlocked OS Secret Service; prints metadata only.');process.exit(0);}
const args=new Map<string,string>();for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];if(!k||!v||!['--name','--days','--scopes','--db'].includes(k)||args.has(k))throw new Error('Invalid CLI arguments');args.set(k,v);}
const path=resolve(args.get('--db')??new URL('../runtime/control.sqlite',import.meta.url).pathname);const file=lstatSync(path);
if(!file.isFile()||file.isSymbolicLink()||file.uid!==process.getuid?.()||(file.mode&0o077)!==0)throw new Error('Bootstrap requires an existing private database owned by this OS user');
const helper=new URL('./store-management-key.py',import.meta.url).pathname;
async function vault(payload?:{id:string;key:string}){const child=Bun.spawn(['/usr/bin/python3',helper,...(payload?[]:['--check'])],{stdin:payload?new TextEncoder().encode(JSON.stringify(payload)):'ignore',stdout:'pipe',stderr:'ignore'});const output=await new Response(child.stdout).json().catch(()=>null);if(await child.exited!==0||!(payload?output?.stored:output?.available))throw new Error('An existing unlocked OS Secret Service is required');}
await vault();const store=createStore(path);
try{const status=store.adminAuth.status(new Request('http://127.0.0.1/'));if(!status.body.configured)throw new Error('Configure the owner password before local bootstrap');const result=await provisionManagementKey(store.managementKeys,{name:args.get('--name'),expiresInDays:Number(args.get('--days')),scopes:(args.get('--scopes')??'').split(',')},(id,key)=>vault({id,key}));console.log(JSON.stringify({...result,storage:'OS Secret Service',rawKeyReturned:false}));}finally{store.close();}
