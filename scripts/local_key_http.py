"""Loopback verifier transport: ignore environment proxies and never forward credentials on redirect."""
import urllib.request
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  return None

def direct_opener():
 return urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
