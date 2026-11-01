import re
import urllib.request
from bs4 import BeautifulSoup

url = 'https://1kuji.com/products/onep_o12'
html = urllib.request.urlopen(
    urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}),
    timeout=20,
).read().decode('utf-8', 'replace')

print('HAS_PRODUCTDETAIL=', 'ProductDetail.aspx' in html)
print('MATCHES=', re.findall(r'https?://[^\s"\'<>]+ProductDetail\.aspx\?[^\s"\'<>]+|/Form/Product/ProductDetail\.aspx\?[^\s"\'<>]+', html, flags=re.I)[:10])

soup = BeautifulSoup(html, 'html.parser')
for a in soup.select('a[href]'):
    href = (a.get('href') or '').strip()
    text = ' '.join(a.get_text(' ', strip=True).split())
    if 'on-line.1kuji.com' in href or 'ONLINE' in text or 'オンライン' in text:
        print('TEXT=', text)
        print('HREF=', href)
        print('---')
