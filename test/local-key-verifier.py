"""No real vault/database/network: mirror Secret Service's generator interface."""
import contextlib,hashlib,io,json,pathlib,runpy,sys,types
key='bsm1_'+'F'*43;identifier='00000000-0000-4000-8000-000000000001'
class Collection:
 def is_locked(self):return False
 def search_items(self,attributes):
  assert attributes['key-id']==identifier
  yield types.SimpleNamespace(get_secret=lambda:key.encode())
secretstorage=types.ModuleType('secretstorage');secretstorage.dbus_init=lambda:None;secretstorage.get_default_collection=lambda bus:Collection();sys.modules['secretstorage']=secretstorage
class DB:
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def execute(self,query,params):
  assert params==(identifier,hashlib.sha256(key.encode()).hexdigest())
  return types.SimpleNamespace(fetchone=lambda:('Memory verifier fixture',json.dumps(['briefs:read']),'2099-01-01T00:00:00Z'))
sqlite=types.ModuleType('sqlite3');sqlite.connect=lambda *args,**kwargs:DB();sys.modules['sqlite3']=sqlite
class Response:
 def __init__(self,code):self.status=code
 def __enter__(self):return self
 def __exit__(self,*args):pass
class Opener:
 def open(self,request,timeout):
  assert request.get_header('Authorization')=='Bearer '+key
  assert request.full_url.startswith('http://127.0.0.1:7731/')
  return Response(403 if request.full_url.endswith(('/api/auth/session','/api/management-keys')) else 200)
transport=types.ModuleType('local_key_http');transport.direct_opener=lambda:Opener();sys.modules['local_key_http']=transport
sys.argv=['verify-local-management-key.py','--key-id',identifier];output=io.StringIO()
with contextlib.redirect_stdout(output):runpy.run_path(str(pathlib.Path(__file__).parent.parent/'scripts/verify-local-management-key.py'),run_name='__main__')
result=json.loads(output.getvalue());assert result['id']==identifier and result['freshProcessVaultReadVerified'] and len(result['apiChecks'])==5;assert key not in output.getvalue()
print('Generator-backed credential lookup verifies scopes without returning the secret')
