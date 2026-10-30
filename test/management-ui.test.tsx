import {beforeAll,afterAll,afterEach,test,expect} from 'bun:test';
import {GlobalRegistrator} from '@happy-dom/global-registrator';
import {render,cleanup,fireEvent,waitFor,act} from '@testing-library/react';
import {ManagementKeys} from '../web/management-keys.js';
beforeAll(()=>GlobalRegistrator.register());afterEach(cleanup);afterAll(()=>GlobalRegistrator.unregister());
const row={id:'00000000-0000-4000-8000-000000000001',name:'Fixture automation',scopes:['briefs:read'],createdAt:'2026-01-01T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z',revokedAt:null,lastUsedAt:null,pending:false};
test('management UI provides scopes/expiry, masks one-time fixture key and refreshes metadata',async()=>{
 const calls:{path:string;method:string;body?:any}[]=[];let created=false;const key='bsm1_'+'T'.repeat(43);
 const request=async(path:string,method='GET',body?:any)=>{calls.push({path,method,body});if(method==='POST'){created=true;return {...row,key};}return {keys:created?[row]:[]};};
 const view=render(<ManagementKeys request={request}/>);await waitFor(()=>expect(view.getByText('No management keys yet.')).toBeTruthy());
 fireEvent.change(view.getByLabelText('Name'),{target:{value:'Fixture automation'}});fireEvent.click(view.getByLabelText('authorizations:create'));await act(async()=>fireEvent.submit(view.getByRole('button',{name:'Create key'}).closest('form')!));
 await waitFor(()=>expect(view.getByRole('heading',{name:'Save this key now'})).toBeTruthy());const posted=calls.find(c=>c.method==='POST')!;expect(posted.body.expiresInDays).toBe(30);expect(posted.body.scopes).toContain('authorizations:create');expect(posted.body.scopes).not.toContain('authorizations:revoke');
 expect(view.getByLabelText('New management key').getAttribute('type')).toBe('password');expect(view.queryByText(key)).toBeNull();expect(view.getByText('Fixture automation')).toBeTruthy();fireEvent.click(view.getByRole('button',{name:'Dismiss key'}));expect(view.queryByLabelText('New management key')).toBeNull();
});
test('pending and revoked metadata are honest and revocation needs confirmation',async()=>{
 let revoked=false;const oldConfirm=globalThis.confirm;globalThis.confirm=()=>false;
 const request=async(_path:string,method='GET')=>{if(method==='POST')revoked=true;return {keys:[{...row,pending:true}]};};
 try{const view=render(<ManagementKeys request={request}/>);await waitFor(()=>expect(view.getByText(/Pending · Expires/)).toBeTruthy());fireEvent.click(view.getByRole('button',{name:'Revoke management key'}));expect(revoked).toBe(false);}finally{globalThis.confirm=oldConfirm;}
});
