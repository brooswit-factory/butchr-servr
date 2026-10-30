"""Isolated nonsecret transport regression. Never contacts a user service or keyring."""
import http.server,importlib.util,os,pathlib,threading,urllib.request,urllib.error
spec=importlib.util.spec_from_file_location('local_key_http',pathlib.Path(__file__).parent.parent/'scripts/local_key_http.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
seen=[]
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  seen.append((self.server.server_port,self.path,self.headers.get('Authorization')))
  if self.path=='/redirect':self.send_response(302);self.send_header('Location',f'http://127.0.0.1:{trap.server_port}/leak')
  else:self.send_response(200)
  self.end_headers()
target=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);trap=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
for server in [target,trap]:threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 os.environ['HTTP_PROXY']=os.environ['http_proxy']=f'http://127.0.0.1:{trap.server_port}';os.environ['NO_PROXY']=os.environ['no_proxy']=''
 opener=module.direct_opener();headers={'Authorization':'Bearer DISPOSABLE-NONSECRET-FIXTURE'}
 with opener.open(urllib.request.Request(f'http://127.0.0.1:{target.server_port}/direct',headers=headers),timeout=5) as response:assert response.status==200
 try:opener.open(urllib.request.Request(f'http://127.0.0.1:{target.server_port}/redirect',headers=headers),timeout=5);raise AssertionError('redirect accepted')
 except urllib.error.HTTPError as error:assert error.code==302
 assert len(seen)==2 and all(port==target.server_port for port,path,auth in seen),'proxy or redirect received request'
 print('Direct transport ignores proxy environment and rejects redirects')
finally:
 for server in [target,trap]:server.shutdown();server.server_close()
