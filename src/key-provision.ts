import type {createManagementKeys} from './management-keys.js';
/** OS-owner bootstrap only: never returns the raw key; fail closed if secure storage fails. */
export async function provisionManagementKey(keys:ReturnType<typeof createManagementKeys>,request:unknown,save:(id:string,key:string)=>Promise<void>){
 const issued=keys.issuePending(request);const {key,...metadata}=issued;
 try{await save(issued.id,key);}catch{try{keys.revoke(issued.id);}catch{}throw new Error('Secure credential storage failed; the new key remains inactive');}
 try{keys.activate(issued.id);}catch{throw new Error('Key activation failed; the pending credential requires owner review');}
 return {...metadata,pending:false};
}
