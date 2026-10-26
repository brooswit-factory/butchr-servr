import {test,expect} from 'bun:test';
test('local key verifier cannot forward bearer credentials to environment proxies or redirect targets',async()=>{
 const child=Bun.spawn(['/usr/bin/python3',new URL('./local-key-http.py',import.meta.url).pathname],{stdout:'pipe',stderr:'pipe'});const output=await new Response(child.stdout).text(),error=await new Response(child.stderr).text();expect(await child.exited).toBe(0);expect(error).toBe('');expect(output).toContain('ignores proxy environment and rejects redirects');
});
test('fresh-process verifier supports generator-backed vault search without secret output',async()=>{
 const child=Bun.spawn(['/usr/bin/python3',new URL('./local-key-verifier.py',import.meta.url).pathname],{stdout:'pipe',stderr:'pipe'});const output=await new Response(child.stdout).text(),error=await new Response(child.stderr).text();expect(await child.exited).toBe(0);expect(error).toBe('');expect(output).toContain('without returning the secret');
});
