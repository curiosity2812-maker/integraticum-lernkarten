
#!/usr/bin/env python3
"""Compare FreeDict-derived RU candidates against independently edited Russian Wiktionary.
Never treats matching headwords as proof of matching senses.
"""
import argparse, collections, gzip, html.parser, io, json, re, unicodedata, urllib.request, zipfile
from pathlib import Path

class Links(html.parser.HTMLParser):
    def __init__(self): super().__init__(); self.links=[]
    def handle_starttag(self,tag,attrs):
        if tag=='a':
            d=dict(attrs)
            if d.get('href'):self.links.append(d['href'])

def download_source(url):
    from urllib.parse import urljoin
    page = urllib.request.urlopen(url, timeout=60).read().decode('utf-8', 'replace')
    parser = Links()
    parser.feed(page)

    candidates = [
        urljoin(url, href)
        for href in parser.links
        if 'extract' in href.lower()
        and '.jsonl.gz' in href.lower()
    ]

    if not candidates:
        raise RuntimeError(
            'Cannot locate Wiktionary extract. '
            'Check https://kaikki.org/ruwiktionary/rawdata.html'
        )

    return candidates[0]

