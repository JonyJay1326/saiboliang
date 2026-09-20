"""Standard-library transport and safe local persistence."""
import gzip
import hashlib
import json
import math
import os
import re
import time
import zlib
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class DataError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise DataError(message)


def utcnow():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def safe_url(value):
    require(isinstance(value, str) and not re.search(r'[\s\x00-\x1f]', value), 'invalid URL text')
    u = urlsplit(value)
    require(u.scheme in ('http', 'https') and u.hostname and not u.username and not u.password, 'invalid URL')
    try:
        u.port
    except ValueError as exc:
        raise DataError('invalid port') from exc
    return value


def normalize_url(value):
    u = urlsplit(safe_url(value))
    host = u.hostname.lower()
    if ':' in host:
        host = '[' + host + ']'
    if u.port and (u.scheme, u.port) not in (('http', 80), ('https', 443)):
        host += ':' + str(u.port)
    query = sorted((k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if not k.lower().startswith('utm_'))
    return urlunsplit((u.scheme.lower(), host, u.path, urlencode(query), ''))


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def read_json(path, default=None):
    if not Path(path).exists():
        return default
    def invalid(value):
        raise DataError('non-finite JSON value')
    return json.loads(Path(path).read_text(encoding='utf-8'), parse_constant=invalid)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    os.replace(tmp, path)


def load_key(path, names, label=None):
    # Only import the named credential, never the entire dotenv file.
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    if path and Path(path).is_file():
        pattern = r'\s*(?:export\s+)?(' + '|'.join(re.escape(n) for n in names) + r')\s*=\s*(.*?)\s*'
        for line in Path(path).read_text(encoding='utf-8-sig').splitlines():
            match = re.fullmatch(pattern, line)
            if match:
                value = match[2]
                if value[:1] in ('"', "'") and value[-1:] == value[:1]:
                    return value[1:-1]
                return value.split(' #', 1)[0].strip()
    raise DataError((label or names[0]) + ' not configured')


def load_aa_key(path):
    return load_key(path, ('AA_API_KEY', 'AA_key'), 'AA_API_KEY / AA_key')


def finite(value, minimum=None):
    return type(value) in (int, float) and math.isfinite(value) and (minimum is None or value >= minimum)


def decompress(raw, encoding):
    """Some CDNs force gzip even though urllib never sends Accept-Encoding."""
    if not encoding or encoding.strip().lower() != 'gzip':
        return raw
    try:
        value = gzip.decompress(raw)
    except (OSError, EOFError, zlib.error) as exc:
        raise DataError('invalid gzip response') from exc
    require(len(value) <= 8_000_000, 'decompressed response exceeds size limit')
    return value


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url(newurl)
        require(urlsplit(newurl).scheme == 'https', 'insecure redirect rejected')
        require(not req.has_header('X-api-key') and not req.has_header('Authorization'), 'authenticated redirect rejected')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Client:
    def __init__(self):
        self.last = {}
        self.opener = build_opener(SafeRedirect())

    def get(self, url, headers=None, deadline=None):
        safe_url(url)
        deadline = deadline or time.monotonic() + 120
        host = urlsplit(url).hostname
        for attempt in range(3):
            wait = max(0, self.last.get(host, 0) + 1 - time.monotonic())
            require(time.monotonic() + wait < deadline, 'source budget exhausted')
            time.sleep(wait)
            self.last[host] = time.monotonic()
            req = Request(url, headers={'User-Agent': 'Saiboliang/0.1 (+https://saiboliang.top)', **(headers or {})})
            delay = 2 ** (attempt + 1)
            try:
                with self.opener.open(req, timeout=min(15, deadline - time.monotonic())) as response:
                    raw = response.read(8_000_001)
                    require(len(raw) <= 8_000_000, 'response exceeds size limit')
                    raw = decompress(raw, response.headers.get('Content-Encoding') or '')
                    return raw, response.geturl()
            except HTTPError as exc:
                status = exc.code
                retry = status == 429 or status >= 500
                retry_after = exc.headers.get('Retry-After')
                if retry_after:
                    try:
                        delay = max(delay, float(retry_after))
                    except ValueError:
                        delay = max(delay, parsedate_to_datetime(retry_after).timestamp() - time.time())
                error = 'HTTP ' + str(status)
                exc.close()
                if not retry:
                    raise DataError(error) from None
            except (URLError, TimeoutError, OSError) as exc:
                error = 'network error: ' + type(exc).__name__
            require(attempt < 2 and time.monotonic() + delay < deadline, error)
            time.sleep(delay)
        raise DataError('request failed')

    def post(self, url, body, headers=None, deadline=None):
        """Authenticated JSON POST. Redirects are refused so the key never leaves the host."""
        safe_url(url)
        deadline = deadline or time.monotonic() + 120
        host = urlsplit(url).hostname
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        for attempt in range(3):
            wait = max(0, self.last.get(host, 0) + 1 - time.monotonic())
            require(time.monotonic() + wait < deadline, 'source budget exhausted')
            time.sleep(wait)
            self.last[host] = time.monotonic()
            req = Request(url, data=data, method='POST',
                          headers={'User-Agent': 'Saiboliang/0.1 (+https://saiboliang.top)',
                                   'Content-Type': 'application/json', **(headers or {})})
            delay = 2 ** (attempt + 1)
            try:
                with self.opener.open(req, timeout=min(15, deadline - time.monotonic())) as response:
                    require(response.geturl() == url, 'authenticated redirect rejected')
                    raw = response.read(8_000_001)
                    require(len(raw) <= 8_000_000, 'response exceeds size limit')
                    return raw
            except HTTPError as exc:
                status = exc.code
                retry = status == 429 or status >= 500
                retry_after = exc.headers.get('Retry-After')
                if retry_after:
                    try:
                        delay = max(delay, float(retry_after))
                    except ValueError:
                        delay = max(delay, parsedate_to_datetime(retry_after).timestamp() - time.time())
                error = 'HTTP ' + str(status)
                exc.close()
                if not retry:
                    raise DataError(error) from None
            except (URLError, TimeoutError, OSError) as exc:
                error = 'network error: ' + type(exc).__name__
            require(attempt < 2 and time.monotonic() + delay < deadline, error)
            time.sleep(delay)
        raise DataError('request failed')

    def json(self, url, headers=None, deadline=None):
        raw, _ = self.get(url, headers, deadline)
        return json.loads(raw)
