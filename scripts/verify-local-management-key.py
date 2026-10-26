#!/usr/bin/env python3
"""Verify one newly-provisioned local key without exposing it. No remote destinations or writes."""
import argparse,datetime,hashlib,json,os,pathlib,re,sqlite3,sys,urllib.request,urllib.error
parser=argparse.ArgumentParser();parser.add_argument('--key-id',required=True);args=parser.parse_args()
try:
 import secretstorage
 if not re.fullmatch(r'[0-9a-f-]{36}',args.key_id):raise ValueError('id')
 os.environ.setdefault('DBUS_SESSION_BUS_ADDRESS',f'unix:path=/run/user/{os.getuid()}/bus')
 collection=secretstorage.get_default_collection(secretstorage.dbus_init())
 if collection.is_locked():raise RuntimeError('locked')
 items=collection.search_items({'application':'butchr-servr','purpose':'management-api','key-id':args.key_id})
 if len(items)!=1:raise RuntimeError('item count')
 key=items[0].get_secret().decode()
 with sqlite3.connect('file:'+str(pathlib.Path(__file__).resolve().parent.parent/'runtime/control.sqlite')+'?mode=ro',uri=True) as db:
  row=db.execute('SELECT name,scopes,expires_at FROM management_keys WHERE id=? AND key_hash=? AND active=1 AND revoked_at IS NULL',(args.key_id,hashlib.sha256(key.encode()).hexdigest())).fetchone()
 if not row:raise RuntimeError('verifier mismatch')
 receipts=[]
 for path,expected in [('/api/authorizations',200),('/api/briefs',200),('/api/deployments',200),('/api/auth/session',403),('/api/management-keys',403)]:
  try:
   with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:7731'+path,headers={'Authorization':'Bearer '+key}),timeout=10) as response:status=response.status
  except urllib.error.HTTPError as error:status=error.code
  if status!=expected:raise RuntimeError('scope verification')
  receipts.append({'path':path,'status':status})
 print(json.dumps({'id':args.key_id,'name':row[0],'scopes':json.loads(row[1]),'expiresAt':row[2],'storage':'Codey brooswit OS Secret Service','freshProcessVaultReadVerified':True,'rawSecretReturned':False,'apiChecks':receipts}))
except Exception:
 print(json.dumps({'error':'Local management-key verification failed; no secret was returned'}));sys.exit(1)
