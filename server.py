from __future__ import annotations

import html as html_module
import json
import os
import re
import time
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urljoin, urlparse
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
STATIC_PATH = ROOT / 'static'
DATA_PATH = ROOT / 'data' / 'lotteries.json'
DEFAULT_SOURCE_URL = os.environ.get('LOTTERY_SOURCE_URL', 'https://1kuji.com/').strip()
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
MYPAGE_URL = 'https://1kuji.com/mypage'
DOUBLE_CHANCE_COUNT_PATTERN = re.compile(r'ダブルチャンス挑戦回数\s*[:：]?\s*([\d,]+)\s*回')


def parse_double_chance_count(text: str) -> int | None:
    match = DOUBLE_CHANCE_COUNT_PATTERN.search(text)
    if not match:
        return None
    return int(match.group(1).replace(',', ''))


def fetch_double_chance_count() -> int:
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError('Playwright がありません。python -m pip install -r requirements.txt を実行してください。') from exc

    profile_path = ROOT / '.local' / 'mypage-browser'
    profile_path.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        try:
            context = playwright.chromium.launch_persistent_context(
                user_data_dir=str(profile_path),
                channel='msedge',
                headless=False,
                args=['--no-first-run'],
            )
        except PlaywrightError as exc:
            raise RuntimeError('Edgeを起動できませんでした。Microsoft Edgeがインストールされているか確認してください。') from exc

        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(MYPAGE_URL, wait_until='domcontentloaded', timeout=45000)
            deadline = time.monotonic() + 180
            next_mypage_navigation = 0.0

            while time.monotonic() < deadline:
                if page.is_closed():
                    raise RuntimeError('ブラウザーが閉じられました。もう一度取得してください。')

                try:
                    body_text = page.locator('body').inner_text(timeout=5000)
                except PlaywrightError:
                    body_text = ''

                count = parse_double_chance_count(body_text)
                if count is not None:
                    return count

                current_url = urlparse(page.url)
                if (
                    current_url.hostname
                    and current_url.hostname.lower().endswith('1kuji.com')
                    and current_url.path.rstrip('/') != '/auth/charaos/callback'
                    and time.monotonic() >= next_mypage_navigation
                ):
                    page.goto(MYPAGE_URL, wait_until='domcontentloaded', timeout=45000)
                    next_mypage_navigation = time.monotonic() + 10

                page.wait_for_timeout(1000)

            raise RuntimeError('回数を確認できませんでした。Edgeでマイページにログインし、表示を確認してから再度取得してください。')
        finally:
            context.close()


def is_local_app_request(host_header: str, origin_header: str, server_port: int) -> bool:
    try:
        host = urlparse(f'http://{host_header}')
        origin = urlparse(origin_header)
    except ValueError:
        return False

    local_hosts = {'localhost', '127.0.0.1', '::1'}
    return (
        host.hostname in local_hosts
        and host.port == server_port
        and origin.hostname == host.hostname
        and origin.port == server_port
        and origin.scheme == 'http'
    )


def build_shop_search_url(detail_url: str | None) -> str:
    if not detail_url:
        return ''

    path = urlparse(detail_url).path.rstrip('/')
    slug = path.rsplit('/', 1)[-1] if path else ''
    if not slug or slug in {'products', 'shop_lists'}:
        return ''
    return f'https://1kuji.com/shop_lists?product_id={slug}'


def normalize_item(item: dict[str, Any]) -> dict[str, Any]:
    stores = item.get('stores', [])
    if isinstance(stores, str):
        stores = re.split(r'[,、，・/／]', stores)
    if not isinstance(stores, list):
        stores = []

    return {
        'title': str(item.get('title') or item.get('name') or '不明な作品'),
        'category': str(item.get('category') or item.get('genre') or '一般'),
        'prize': str(item.get('prize') or item.get('award') or 'N/A'),
        'date': str(item.get('date') or item.get('sale_date') or datetime.utcnow().date().isoformat()),
        'note': str(item.get('note') or item.get('summary') or ''),
        'url': str(item.get('url') or item.get('detail_url') or ''),
        'thumbnail': str(item.get('thumbnail') or ''),
        'online_url': str(item.get('online_url') or ''),
        'online_date': str(item.get('online_date') or ''),
        'online_time': str(item.get('online_time') or ''),
        'stores': [str(store).strip() for store in stores if str(store).strip()],
        'shop_search_url': build_shop_search_url(item.get('url') or item.get('detail_url') or ''),
    }


def read_local_lotteries() -> dict[str, Any]:
    if not DATA_PATH.exists():
        return {'lotteries': []}

    try:
        with DATA_PATH.open('r', encoding='utf-8') as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            return {'lotteries': []}
        items = data.get('lotteries', [])
        if not isinstance(items, list):
            return {'lotteries': []}
        return {'lotteries': [normalize_item(item) for item in items]}
    except Exception:
        return {'lotteries': []}


def write_local_lotteries(data: dict[str, Any]) -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with DATA_PATH.open('w', encoding='utf-8') as fh:
        json.dump({'lotteries': data.get('lotteries', [])}, fh, ensure_ascii=False, indent=2)


def extract_text(data: Any) -> str:
    if isinstance(data, str):
        return data
    if isinstance(data, (dict, list)):
        return json.dumps(data, ensure_ascii=False)
    return str(data)


def parse_date_from_text(text: str) -> str:
    match = re.search(r'(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日', text)
    if not match:
        return (datetime.utcnow() - timedelta(days=1)).date().isoformat()
    year, month, day = match.groups()
    return f'{year}-{int(month):02d}-{int(day):02d}'


def parse_labeled_sale_info(text: str, label: str) -> tuple[str, str]:
    match = re.search(
        rf'{re.escape(label)}\s*[:：]\s*(\d{{4}})年\s*(\d{{1,2}})月\s*(\d{{1,2}})日'
        rf'(?:\s*[（(][^）)]*[）)])?\s*(?:(\d{{1,2}}):(\d{{2}}))?',
        text,
    )
    if not match:
        return '', ''

    year, month, day, hour, minute = match.groups()
    date = f'{year}-{int(month):02d}-{int(day):02d}'
    time = f'{int(hour):02d}:{minute}' if hour and minute else ''
    return date, time


def parse_stores_from_text(text: str) -> list[str]:
    match = re.search(r'取扱店\s*[:：]\s*(.*?)(?=■|※|$)', text)
    if not match:
        return []

    store_text = re.sub(r'\s+', ' ', match.group(1)).strip()
    store_text = re.sub(r'など\s*$', '', store_text).strip(' 　、,，・')
    return list(dict.fromkeys(
        store.strip()
        for store in re.split(r'[,、，・/／]', store_text)
        if store.strip()
    ))


def normalize_thumbnail_url(value: str) -> str:
    cleaned = (value or '').strip()
    if not cleaned:
        return ''
    lowered = cleaned.lower()
    if '1kuji.com/ogp.jpg' in lowered or 'ogp.jpg' in lowered or 'logo' in lowered or 'common' in lowered:
        return ''
    return cleaned


def parse_1kuji_detail_page(detail_html: str, detail_url: str) -> dict[str, Any]:
    soup = BeautifulSoup(detail_html, 'html.parser')

    title = soup.find('h2') or soup.find('h1')
    title_text = title.get_text(' ', strip=True) if title else '一番くじ'
    title_text = re.sub(r'の詳細へ$', '', title_text)
    title_text = title_text.strip() or '一番くじ'

    product_images = [
        normalize_thumbnail_url(urljoin(detail_url, image.get('src') or image.get('data-src') or ''))
        for image in soup.select('img[src], img[data-src]')
    ]
    thumbnail = next(
        (image for image in product_images if '/uploads/product_item/image/' in urlparse(image).path),
        '',
    )
    if not thumbnail:
        thumbnail = next(
            (image for image in product_images if '/uploads/product/top_banner/' in urlparse(image).path),
            '',
        )
    if not thumbnail:
        og_image = soup.select_one('meta[property="og:image"]')
        thumbnail = normalize_thumbnail_url(
            urljoin(detail_url, og_image.get('content', '').strip()) if og_image else ''
        )
    if not thumbnail:
        thumbnail = next((image for image in product_images if image), '')

    online_url = ''
    candidates: list[str] = []
    for link in soup.select('a[href]'):
        href = html_module.unescape((link.get('href') or '').strip())
        href_lower = href.lower()
        if not href or 'javascript:void(0)' in href_lower:
            continue
        if 'on-line.1kuji.com' in href_lower or 'productdetail.aspx' in href_lower or 'productlist.aspx' in href_lower:
            candidates.append(href)

    for href in candidates:
        href_lower = href.lower()
        if 'page/guide.aspx' in href_lower or 'productlist.aspx' in href_lower:
            continue
        if 'productdetail.aspx' in href_lower or 'pid=' in href_lower or 'bid=' in href_lower:
            online_url = href
            break

    if not online_url:
        raw_matches = re.findall(r'https?://[^\s"\'<>]+ProductDetail\.aspx\?[^\s"\'<>]+|/Form/Product/ProductDetail\.aspx\?[^\s"\'<>]+', detail_html, flags=re.I)
        for match in raw_matches:
            resolved = html_module.unescape(match)
            resolved = urljoin(detail_url, resolved)
            if 'on-line.1kuji.com' in resolved.lower() and ('pid=' in resolved.lower() or 'bid=' in resolved.lower()):
                online_url = resolved
                break

    if not online_url and any(phrase in soup.get_text(' ', strip=True) for phrase in ['オンライン販売はありません', '販売はありません']):
        online_url = ''

    body_text = soup.get_text(' ', strip=True)
    release_date, _ = parse_labeled_sale_info(body_text, '店頭販売')
    if not release_date:
        release_date = parse_date_from_text(body_text)
    online_date, online_time = parse_labeled_sale_info(body_text, 'オンライン販売')
    stores = parse_stores_from_text(body_text)

    note = '1kuji.comから自動取得した最新情報'
    if 'オンライン販売' in body_text:
        note = 'オンライン販売/店頭販売の情報を自動取得'

    return {
        'title': title_text,
        'category': '一番くじ',
        'prize': '最新情報',
        'date': release_date,
        'online_date': online_date,
        'online_time': online_time,
        'stores': stores,
        'note': note,
        'url': detail_url,
        'thumbnail': thumbnail,
        'online_url': online_url,
        'shop_search_url': build_shop_search_url(detail_url),
    }


def parse_1kuji_index(url: str, html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, 'html.parser')
    seen: set[str] = set()
    results: list[dict[str, Any]] = []

    for anchor in soup.select('a[href*="/products/"]'):
        href = anchor.get('href', '').strip()
        text = ' '.join(anchor.get_text(' ', strip=True).split())
        if not href or 'javascript:' in href or '詳細へ' in text or text in {'', 'MENU'}:
            continue
        full_url = urljoin(url, href)
        if full_url in seen:
            continue
        seen.add(full_url)
        results.append({'title': text, 'url': full_url})

    normalized: list[dict[str, Any]] = []
    for item in results:
        detail_url = item['url']
        try:
            request = Request(detail_url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html,*/*;q=0.8'})
            with urlopen(request, timeout=20) as response:
                charset = response.headers.get_content_charset() or 'utf-8'
                detail_html = response.read().decode(charset, errors='replace')
            parsed = parse_1kuji_detail_page(detail_html, detail_url)
            normalized.append({
                'title': parsed['title'],
                'category': parsed['category'],
                'prize': parsed['prize'],
                'date': parsed['date'],
                'online_date': parsed['online_date'],
                'online_time': parsed['online_time'],
                'stores': parsed['stores'],
                'note': parsed['note'],
                'url': detail_url,
                'thumbnail': parsed.get('thumbnail', ''),
                'online_url': parsed.get('online_url', ''),
                'shop_search_url': build_shop_search_url(detail_url),
            })
        except Exception:
            normalized.append({
                'title': item['title'].replace('の詳細へ', '').strip() or '一番くじ',
                'category': '一番くじ',
                'prize': '最新情報',
                'date': (datetime.utcnow() - timedelta(days=1)).date().isoformat(),
                'note': '1kuji.comから自動取得',
                'url': item.get('url', ''),
                'thumbnail': '',
                'online_url': '',
                'shop_search_url': build_shop_search_url(item.get('url', '')),
            })

    return normalized


def parse_html_items(html: str) -> list[dict[str, Any]]:
    text = re.sub(r'<script.*?</script>', '', html, flags=re.I | re.S)
    text = re.sub(r'<style.*?</style>', '', text, flags=re.I | re.S)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = html_module.unescape(text)
    text = re.sub(r'\s+', ' ', text)
    matches = re.findall(r'([A-Z0-9]+賞|[A-Z]+賞|[A-Z]+)[^\n]{0,40}(.{0,40}?)', text)
    items: list[dict[str, Any]] = []
    for prize, title in matches[:40]:
        if len(title.strip()) < 2:
            continue
        items.append({
            'title': title.strip()[:80],
            'category': 'サイト取得',
            'prize': prize.strip(),
            'date': (datetime.utcnow() - timedelta(days=1)).date().isoformat(),
            'note': '自動取得したアイテム',
        })
    return items


def fetch_remote_lotteries(url: str) -> dict[str, Any]:
    target_url = (url or DEFAULT_SOURCE_URL).strip()
    if not target_url:
        return read_local_lotteries()

    parsed_url = urlparse(target_url)
    if '1kuji.com' not in parsed_url.netloc.lower() and not parsed_url.netloc.endswith('1kuji.com'):
        request = Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8'})
        with urlopen(request, timeout=20) as response:
            content_type = response.headers.get_content_type() or ''
            charset = response.headers.get_content_charset() or 'utf-8'
            body = response.read().decode(charset, errors='replace')

        if 'application/json' in content_type or body.lstrip().startswith('{') or body.lstrip().startswith('['):
            try:
                payload = json.loads(body)
                if isinstance(payload, dict):
                    lotteries = payload.get('lotteries') or payload.get('items') or payload.get('data')
                    if isinstance(lotteries, list):
                        return {'lotteries': [normalize_item(item) for item in lotteries]}
                    if isinstance(payload.get('result'), list):
                        return {'lotteries': [normalize_item(item) for item in payload['result']]}
                elif isinstance(payload, list):
                    return {'lotteries': [normalize_item(item) for item in payload]}
            except json.JSONDecodeError:
                pass

        html_items = parse_html_items(body)
        if html_items:
            return {'lotteries': html_items}
        return {'lotteries': []}

    request = Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html,*/*;q=0.8'})
    with urlopen(request, timeout=20) as response:
        charset = response.headers.get_content_charset() or 'utf-8'
        body = response.read().decode(charset, errors='replace')

    items = parse_1kuji_index(url, body)
    return {'lotteries': items}


class LotteryHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(STATIC_PATH), **kwargs)

    def do_GET(self) -> None:
        if self.path.startswith('/api/fetch'):
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            source_url = unquote(query.get('url', [DEFAULT_SOURCE_URL])[0]).strip() or DEFAULT_SOURCE_URL
            try:
                data = fetch_remote_lotteries(source_url)
                write_local_lotteries(data)
                payload = data
                status = 200
            except Exception as exc:
                payload = {'error': str(exc)}
                status = 500
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps(payload, ensure_ascii=False).encode('utf-8'))
            return

        if self.path.startswith('/api/lotteries'):
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            source_url = query.get('url', [DEFAULT_SOURCE_URL])[0].strip() or DEFAULT_SOURCE_URL
            data = fetch_remote_lotteries(source_url)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))
            return

        if self.path.startswith('/api/config'):
            payload = {'source_url': DEFAULT_SOURCE_URL}
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps(payload, ensure_ascii=False).encode('utf-8'))
            return

        super().do_GET()

    def do_POST(self) -> None:
        if urlparse(self.path).path == '/api/double-chance':
            if not is_local_app_request(
                self.headers.get('Host', ''),
                self.headers.get('Origin', ''),
                self.server.server_port,
            ):
                payload = {'error': 'ローカルアプリからの操作だけ許可されています。'}
                status = 403
            else:
                try:
                    payload = {'count': fetch_double_chance_count()}
                    status = 200
                except Exception as exc:
                    self.log_error('Double-chance count retrieval failed: %s', exc)
                    payload = {'error': str(exc)}
                    status = 502

            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(json.dumps(payload, ensure_ascii=False).encode('utf-8'))
            return

        if self.path.startswith('/api/fetch'):
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            source_url = unquote(query.get('url', [DEFAULT_SOURCE_URL])[0]).strip()
            try:
                data = fetch_remote_lotteries(source_url)
                write_local_lotteries(data)
                payload = data
                status = 200
            except Exception as exc:
                payload = {'error': str(exc)}
                status = 500
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps(payload, ensure_ascii=False).encode('utf-8'))
            return

        self.send_response(405)
        self.end_headers()


def main() -> None:
    port = int(os.environ.get('PORT', '8000'))
    server = ThreadingHTTPServer(('127.0.0.1', port), LotteryHandler)
    print(f'Lottery server running on http://localhost:{port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopping lottery server...')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
