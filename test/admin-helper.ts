/** Memory-only HTTP fixture credentials. Never use against a persistent/user server. */
export const fixturePassword='Disposable admin fixture password 2026!';
export async function adminFixture(url:string){
 const initial=await fetch(url+'/api/auth/session');const pre=await initial.json();const firstCookie=initial.headers.get('set-cookie')!.split(';')[0]!;
 const response=await fetch(url+'/api/auth/setup',{method:'POST',headers:{origin:url,cookie:firstCookie,'content-type':'application/json','x-butchr-servr-csrf':pre.csrf},body:JSON.stringify({password:fixturePassword})});
 if(!response.ok)throw Error('Memory admin setup failed: '+response.status);const state=await response.json();return {csrf:state.csrf,cookie:response.headers.get('set-cookie')!.split(';')[0]!};
}
