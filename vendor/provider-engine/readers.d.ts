import type {ProviderRead} from './protocol.js';
export type ProviderCredentials={family:'atlassian';site:string;email:string;token:string}|{family:'github';token:string;orgs:string[]}|{family:'zendesk';subdomain:string;token:string}|{family:'trello';boardId:string;apiKey:string;token:string};
export function createProviderReader(credentials:ProviderCredentials,fetchImpl?:(url:string,init?:RequestInit)=>Promise<Response>,linkedGithubToken?:string,sdkTransports?:{jira:{sendRequest<T>(options:any):Promise<T>};confluence:{sendRequest<T>(options:any):Promise<T>}}):(read:ProviderRead)=>Promise<unknown>;

export function linkedWebpageTargets(read:import('./protocol.js').ProviderRead,value:unknown):string[];
export function testGithubConnection(token:string,orgs:readonly string[],fetchImpl?:(url:string,init?:RequestInit)=>Promise<Response>):Promise<any>;
export function testJiraConnection(credentials:{site:string;email:string;token:string},fetchImpl?:(url:string,init?:RequestInit)=>Promise<Response>):Promise<any>;
export function testZendeskToken(subdomain:string,token:string,fetchImpl?:(url:string,init?:RequestInit)=>Promise<Response>):Promise<any>;
export function testTrelloCredentials(apiKey:string,token:string,fetchImpl?:(url:string,init?:RequestInit)=>Promise<Response>):Promise<any>;
export function testTrelloBoard(boardId:string,apiKey:string,token:string,fetchImpl?:(url:string,init?:RequestInit)=>Promise<Response>):Promise<any>;
