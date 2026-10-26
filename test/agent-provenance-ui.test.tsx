import {afterAll,afterEach,beforeAll,expect,test} from 'bun:test';
import {GlobalRegistrator} from '@happy-dom/global-registrator';
import {MemoryRouter} from 'react-router';
import {cleanup,render} from '@testing-library/react';
import {SessionAgents,type Session} from '../web/sessions.js';
import type {AgentProvenance} from '../src/telemetry-wire.js';
beforeAll(()=>GlobalRegistrator.register());afterEach(cleanup);afterAll(()=>GlobalRegistrator.unregister());
const session=(provenance?:AgentProvenance):Session=>({id:'fixture',firstSeen:'fixture',lastSeen:'fixture',events:{sequence:1,occurredAt:new Date().toISOString(),receivedAt:new Date().toISOString(),snapshot:{mode:'daemon',controllersEnabled:true,remoteConfigsEnabled:true,transportConnected:true,agentsChecked:true,agentsTruncated:false,agents:[{id:'a'.repeat(64),status:'idle',confirmedAt:new Date().toISOString(),...(provenance?{provenance}:{})}]}}});
test('details show provider, rule and exact string resource without HTML interpretation',()=>{
 const view=render(<SessionAgents session={session({provider:'confluence-page',kind:'resource',ruleId:'fixture-rule',resourceId:'90071992547409931234'})}/>);expect(view.getByText('confluence-page')).toBeTruthy();expect(view.queryByText('Query family')).toBeNull();expect(view.queryByText('Agent scope')).toBeNull();expect(view.getByText('fixture-rule')).toBeTruthy();expect(view.getByText('90071992547409931234')).toBeTruthy();expect(view.getByText('fixture-rule').getAttribute('title')).toContain('admission origin is unknown');
});
test('old clients, whole-query agents, legacy rule identity and withheld paths are honest',()=>{
 const view=render(<SessionAgents session={session()}/>);expect(view.getByText('Provenance unavailable from this client.')).toBeTruthy();view.rerender(<SessionAgents session={session({provider:'github-issue',kind:'query',ruleId:'fixture'})}/>);expect(view.getByText('No single resource')).toBeTruthy();view.rerender(<SessionAgents session={session({provider:'filesystem',kind:'resource',ruleId:'fixture'})}/>);expect(view.getByText('Withheld (filesystem path)')).toBeTruthy();view.rerender(<SessionAgents session={session({provider:'jira-work',kind:'resource',resourceId:'FIXTURE-1'})}/>);expect(view.getByText('Unknown')).toBeTruthy();
});

test('resource labels are text nodes, never executable HTML or URL links',()=>{
 const view=render(<SessionAgents session={session({provider:'confluence-page',kind:'resource',ruleId:'fixture',resourceId:'<img src=x onerror=alert(1)>'})}/>);expect(view.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();expect(view.container.querySelector('img,script,a')).toBeNull();
});

test('captured admitted label remains historical and a verified rule link uses the scoped existing anchor route',()=>{
 const provenance:AgentProvenance={provider:'confluence-page',kind:'resource',ruleId:'fixture-rule',resourceId:'123',admittedRule:{id:'fixture-rule',name:'Fixture admitted label',source:'local'}};const s=session(provenance);const view=render(<MemoryRouter><SessionAgents session={s}/></MemoryRouter>);expect(view.getByText(/Fixture admitted label/)).toBeTruthy();expect(view.getByText('Fixture admitted label').getAttribute('title')).toContain('confirmed admission');expect(view.queryByText(/Historical association/)).toBeNull();expect(view.queryByRole('link')).toBeNull();s.events!.ruleLinks={['a'.repeat(64)]:'/authorizations/fixture/rules#rule-confluence-page--fixture-rule'};view.rerender(<MemoryRouter><SessionAgents session={s}/></MemoryRouter>);expect(view.getByRole('link',{name:'Fixture admitted label'}).getAttribute('href')).toBe('/authorizations/fixture/rules#rule-confluence-page--fixture-rule');
});

test('originating rule shows only captured name or identity ID, with no visible provenance decorations',()=>{
 const p:AgentProvenance={provider:'confluence-page',kind:'resource',ruleId:'stable-rule-id',resourceId:'123',admittedRule:{id:'stable-rule-id',name:'Readable historical name',source:'local'}};const view=render(<SessionAgents session={session(p)}/>);const label=view.getByText('Originating rule');expect(label.nextElementSibling!.textContent).toBe('Readable historical name');expect(view.queryByText('Agent scope')).toBeNull();expect(view.queryByText('Query family')).toBeNull();expect(view.queryByText('stable-rule-id')).toBeNull();expect(view.getByText('123')).toBeTruthy();expect(view.getByText('confluence-page')).toBeTruthy();const {admittedRule:_,...identity}=p;view.rerender(<SessionAgents session={session(identity)}/>);expect(view.getByText('Originating rule').nextElementSibling!.textContent).toBe('stable-rule-id');expect(view.getByText('stable-rule-id').getAttribute('title')).toContain('unknown');
});
