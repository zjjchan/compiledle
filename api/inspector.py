from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse, urlunparse

import httpx

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/133.0.0.0 Safari/537.36"
)
MAX_HTML_BYTES = 65_536
MAX_REDIRECTS = 5


@dataclass(frozen=True)
class InspectedSite:
    url: str
    title: str
    icon_url: str


class _HeadMetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._in_title = False
        self.title_chunks: list[str] = []
        self.og_title: str | None = None
        self.og_site_name: str | None = None
        self.app_name: str | None = None
        self.apple_touch_icon: str | None = None
        self.icon: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag_l = tag.lower()
        attr_map = {k.lower(): (v or "").strip() for k, v in attrs}

        if tag_l == "title":
            self._in_title = True
        elif tag_l == "meta":
            prop = attr_map.get("property", "").lower()
            name = attr_map.get("name", "").lower()
            content = attr_map.get("content", "")
            if not content:
                return
            if prop == "og:title" and not self.og_title:
                self.og_title = content
            elif prop == "og:site_name" and not self.og_site_name:
                self.og_site_name = content
            elif name in ("application-name", "apple-mobile-web-app-title") and not self.app_name:
                self.app_name = content
        elif tag_l == "link":
            rel = attr_map.get("rel", "").lower()
            href = attr_map.get("href", "")
            if not href:
                return
            if "apple-touch-icon" in rel and not self.apple_touch_icon:
                self.apple_touch_icon = href
            elif "icon" in rel and not self.icon:
                self.icon = href

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title_chunks.append(data)


def normalize_and_validate_url(raw_url: str) -> str:
    cleaned = raw_url.strip()
    if not cleaned:
        raise ValueError("URL cannot be empty.")

    if "://" not in cleaned:
        cleaned = f"https://{cleaned}"

    parsed = urlparse(cleaned)
    scheme = parsed.scheme.lower()
    if scheme not in ("http", "https"):
        raise ValueError("Only http:// and https:// URLs are supported.")

    hostname = parsed.hostname
    if not hostname or "." not in hostname:
        raise ValueError("Please enter a valid website domain.")

    _assert_public_host(hostname)

    path = parsed.path or "/"
    normalized = urlunparse((scheme, parsed.netloc, path, parsed.params, parsed.query, ""))
    return normalized


def _assert_public_host(hostname: str) -> None:
    lower_host = hostname.lower().strip(".")
    if lower_host in ("localhost", "metadata.google.internal") or lower_host.endswith(".local"):
        raise ValueError("Private or local network URLs are not allowed.")

    try:
        infos = socket.getaddrinfo(lower_host, None)
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve domain '{hostname}'.") from exc

    for info in infos:
        sockaddr = info[4]
        ip_str = sockaddr[0]
        ip_obj = ipaddress.ip_address(ip_str)
        if (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_reserved
            or ip_obj.is_unspecified
        ):
            raise ValueError("Private or internal IP addresses are not allowed.")


def _fallback_title_from_url(url: str) -> str:
    parsed = urlparse(url)
    host = (parsed.hostname or "Daily Game").lower()
    if host.startswith("www."):
        host = host[4:]
    segments = [
        seg for seg in parsed.path.split("/")
        if seg and seg.lower() not in ("index.html", "games", "game", "daily", "play", "en")
    ]
    if segments:
        candidate = segments[-1].replace("-", " ").replace("_", " ").strip()
        if candidate:
            return candidate.title()
    base = host.split(".")[0].replace("-", " ").replace("_", " ")
    return base.title() or "Daily Game"


def _default_favicon(url: str) -> str:
    host = urlparse(url).hostname or "example.com"
    return f"https://www.google.com/s2/favicons?domain={host}&sz=128"


async def inspect_daily_url(raw_url: str) -> InspectedSite:
    current_url = normalize_and_validate_url(raw_url)
    fallback_title = _fallback_title_from_url(current_url)
    fallback_icon = _default_favicon(current_url)

    try:
        async with httpx.AsyncClient(
            follow_redirects=False,
            timeout=httpx.Timeout(6.0, connect=4.0),
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        ) as client:
            for _ in range(MAX_REDIRECTS + 1):
                async with client.stream("GET", current_url) as response:
                    if response.is_redirect and response.headers.get("location"):
                        next_url = urljoin(current_url, response.headers["location"])
                        current_url = normalize_and_validate_url(next_url)
                        continue

                    buf = bytearray()
                    async for chunk in response.aiter_bytes():
                        buf.extend(chunk)
                        if len(buf) >= MAX_HTML_BYTES:
                            break

                    html_snippet = buf.decode(response.encoding or "utf-8", errors="ignore")
                    parser = _HeadMetadataParser()
                    parser.feed(html_snippet)

                    raw_title = (
                        parser.app_name
                        or parser.og_title
                        or "".join(parser.title_chunks).strip()
                        or parser.og_site_name
                        or fallback_title
                    )
                    clean_title = " ".join(raw_title.split())[:80] or fallback_title

                    raw_icon = parser.apple_touch_icon or parser.icon
                    icon_url = urljoin(current_url, raw_icon) if raw_icon else _default_favicon(current_url)

                    return InspectedSite(
                        url=current_url,
                        title=clean_title,
                        icon_url=icon_url,
                    )
    except ValueError:
        raise
    except Exception:
        return InspectedSite(
            url=current_url,
            title=fallback_title,
            icon_url=fallback_icon,
        )

    return InspectedSite(
        url=current_url,
        title=fallback_title,
        icon_url=fallback_icon,
    )
