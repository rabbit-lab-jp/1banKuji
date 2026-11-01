import urllib.request

app = urllib.request.urlopen('http://localhost:8000/app.js').read().decode('utf-8', 'replace')
sw = urllib.request.urlopen('http://localhost:8000/sw.js').read().decode('utf-8', 'replace')
print('HAS_CONTROLLERCHANGE=', 'controllerchange' in app)
print('HAS_SKIP_WAITING=', 'SKIP_WAITING' in app and 'SKIP_WAITING' in sw)
print('HAS_CACHE_V6=', 'v6' in sw)
