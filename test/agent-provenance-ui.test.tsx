import {afterAll,afterEach,beforeAll,expect,test} from 'bun:test';
import {GlobalRegistrator} from '@happy-dom/global-registrator';
import {MemoryRouter} from 'react-router';
import {cleanup,render} from '@testing-library/react';
import {SessionAgents,type Session} from '../web/sessions.js';
import type {AgentProvenance} from '../src/telemetry-wire.js';
beforeAll(()=>GlobalRegistrator.register());afterEach(cleanup);afterAll(()=>GlobalRegistrator.unregister());
const session=(provenance?:AgentProvenance):Session=>({id:'fixture',firstSeen:'fixture',lastSeen:'fixture',events:{sequence:1,occurredAt:new Date().toISOString(),receivedAt:new Date().toISOString(),snapshot:{mode:'daemon',controllersEnabled:true,remoteConfigsEnabled:true,transportConnected:true,agentsChecked:true,agentsTruncated:false,agents:[{id:'a'.repeat(64),status:'idle',confirmedAt:new Date().toISOString(),...(provenance?{provenance}:{})}]}}});
test('details show provider, rule and exact string resource without HTML interpretation',()=>{
 const view=render(<SessionAgents session={session({provider:'confluence-page',kind:'resource',ruleId:'fixture-rule',resourceId:'90071992547409931234'})}/>);expect(view.getByText('confluence-page')).toBeTruthy();expect(view.getByText('Confluence child pages (ancestor query)')).toBeTruthy();expect(view.getByText('fixture-rule')).toBeTruthy();expect(view.getByText('90071992547409931234')).toBeTruthy();expect(view.getByText('Matched resource')).toBeTruthy();
});
test('old clients, whole-query agents, legacy rule identity and withheld paths are honest',()=>{
 const view=render(<SessionAgents session={session()}/>);expect(view.getByText('Provenance unavailable from this client.')).toBeTruthy();view.rerender(<SessionAgents session={session({provider:'github-issue',kind:'query',ruleId:'fixture'})}/>);expect(view.getByText('No single resource')).toBeTruthy();view.rerender(<SessionAgents session={session({provider:'filesystem',kind:'resource',ruleId:'fixture'})}/>);expect(view.getByText('Withheld (filesystem path)')).toBeTruthy();view.rerender(<SessionAgents session={session({provider:'jira-work',kind:'resource',resourceId:'FIXTURE-1'})}/>);expect(view.getByText('Unknown admission origin (legacy identity)')).toBeTruthy();
});

test('resource labels are text nodes, never executable HTML or URL links',()=>{
 const view=render(<SessionAgents session={session({provider:'confluence-page',kind:'resource',ruleId:'fixture',resourceId:'<img src=x onerror=alert(1)>'})}/>);expect(view.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();expect(view.container.querySelector('img,script,a')).toBeNull();
});

test('captured admitted label remains historical and a verified rule link uses the scoped existing anchor route',()=>{
 const provenance:AgentProvenance={provider:'confluence-page',kind:'resource',ruleId:'fixture-rule',resourceId:'123',admittedRule:{id:'fixture-rule',name:'Fixture admitted label',source:'local'}};const s=session(provenance);const view=render(<MemoryRouter><SessionAgents session={s}/></MemoryRouter>);expect(view.getByText(/Fixture admitted label/)).toBeTruthy();expect(view.getByText(/Historical association/)).toBeTruthy();expect(view.queryByRole('link')).toBeNull();s.events!.ruleLinks={['a'.repeat(64)]:'/authorizations/fixture/rules#rule-confluence-page--fixture-rule'};view.rerender(<MemoryRouter><SessionAgents session={s}/></MemoryRouter>);expect(view.getByRole('link',{name:'Open current rule'}).getAttribute('href')).toBe('/authorizations/fixture/rules#rule-confluence-page--fixture-rule');
});
