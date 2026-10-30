#!/usr/bin/env python3
"""Private stdin/stdout protocol for the local OS-owner CLI. Never emit secret values."""
import json,os,sys
try:
 import secretstorage
 # Existing per-user bus/collection only. Do not initialize/unlock a keyring or prompt.
 os.environ.setdefault('DBUS_SESSION_BUS_ADDRESS',f'unix:path=/run/user/{os.getuid()}/bus')
 bus=secretstorage.dbus_init();collection=secretstorage.get_default_collection(bus)
 if collection.is_locked():raise RuntimeError('locked')
 if len(sys.argv)>1 and sys.argv[1]=='--check':print(json.dumps({'available':True}));sys.exit(0)
 raw=sys.stdin.buffer.read(8193)
 if len(raw)>8192:raise ValueError('oversize')
 payload=json.loads(raw)
 if not isinstance(payload.get('key'),str) or not payload['key'].startswith('bsm1_'):raise ValueError('invalid')
 collection.create_item('butchr-servr management automation',{'application':'butchr-servr','purpose':'management-api','key-id':payload['id']},payload['key'].encode(),replace=False,content_type='text/plain')
 print(json.dumps({'stored':True}))
except Exception:
 print(json.dumps({'error':'OS credential service unavailable or locked'}));sys.exit(1)
