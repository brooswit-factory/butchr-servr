import {afterAll,afterEach,beforeAll,expect,test} from 'bun:test';
import {GlobalRegistrator} from '@happy-dom/global-registrator';
import {act,cleanup,fireEvent,render,waitFor} from '@testing-library/react';
import {AuthGate} from '../web/auth.js';
let originalFetch:typeof fetch;
beforeAll(()=>{GlobalRegistrator.register();originalFetch=globalThis.fetch;});
afterEach(()=>{cleanup();globalThis.fetch=originalFetch;});afterAll(()=>GlobalRegistrator.unregister());
const state=(authenticated:boolean)=>({configured:true,authenticated,csrf:authenticated?'fixture-active-csrf':'fixture-preauth-csrf'});
function response(authenticated:boolean){return Response.json(state(authenticated));}
test('late session refresh cannot reopen the dashboard after logout',async()=>{
 let resolveLate!:(r:Response)=>void,count=0;globalThis.fetch=(async(path:unknown)=>{if(path==='/api/auth/logout')return Response.json({ok:true});if(++count===1)return response(true);if(count===2)return await new Promise<Response>(resolve=>resolveLate=resolve);return response(false);}) as typeof fetch;
 const view=render(<AuthGate>{()=> <p>Private fixture dashboard</p>}</AuthGate>);await waitFor(()=>expect(view.getByText('Private fixture dashboard')).toBeTruthy());
 await act(async()=>{window.dispatchEvent(new Event('butchr-login-required'));});await waitFor(()=>expect(resolveLate).toBeTruthy());
 await act(async()=>{window.dispatchEvent(new Event('butchr-logout'));});await waitFor(()=>expect(view.getByRole('heading',{name:'Log in'})).toBeTruthy());
 await act(async()=>resolveLate(response(true)));expect(view.queryByText('Private fixture dashboard')).toBeNull();expect(view.getByRole('heading',{name:'Log in'})).toBeTruthy();
});
test('expiry hides but preserves drafts; login restores them and clears password input',async()=>{
 let authenticated=true;globalThis.fetch=(async(path:unknown)=>{if(path==='/api/auth/login'){authenticated=true;return response(true);}return response(authenticated);}) as typeof fetch;
 const view=render(<AuthGate>{()=> <label>Fixture draft<input defaultValue="saved draft"/></label>}</AuthGate>);await waitFor(()=>expect(view.getByLabelText('Fixture draft')).toBeTruthy());const draft=view.getByLabelText('Fixture draft');fireEvent.change(draft,{target:{value:'unsaved fixture draft'}});
 authenticated=false;await act(async()=>window.dispatchEvent(new Event('butchr-login-required')));await waitFor(()=>expect(view.getByRole('heading',{name:'Log in'})).toBeTruthy());expect(draft.closest('[hidden]')).toBeTruthy();
 fireEvent.change(view.getByLabelText('Password'),{target:{value:'Disposable fixture password'}});await act(async()=>fireEvent.submit(view.getByRole('button',{name:'Log in'}).closest('form')!));await waitFor(()=>expect(view.queryByRole('heading',{name:'Log in'})).toBeNull());expect((draft as HTMLInputElement).value).toBe('unsaved fixture draft');expect(draft.closest('[hidden]')).toBeNull();
});
