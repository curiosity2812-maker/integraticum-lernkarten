#!/usr/bin/env python3
"""Integraticum: independent word-level evidence from Russian Wiktionary.

Literal overlaps are NOT proof of sense alignment. No entry is approved for
publication by this script. All output records preserve the original data.
"""
import argparse
import collections
import gzip
import html.parser
import json
import re
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

PAGE = 'https://kaikki.org/ruwiktionary/rawdata.html'

class LinkParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            href = dict(attrs).get('href')
            if href:
                self.links.append(href)


def discover_source(page_url):
    request = urllib.request.Request(page_url, headers={'User-Agent': 'Integraticum/0.6 educational dictionary'})
    with urllib.request.urlopen(request, timeout=90) as response:
        page = response.read().decode('utf-8', 'replace')
    parser = LinkParser()
    parser.feed(page)
    links = [urllib.parse.urljoin(page_url, href) for href in parser.links]
    candidates = [url for url in links if re.search(r'(?:ru-extract|extract)\.jsonl\.gz(?:\?|$)', url, re.I)]
    if not candidates:
        candidates = [url for url in links if 'extract' in url.lower() and '.jsonl.gz' in url.lower()]
    if not candidates:
        raise RuntimeError('Russian Wiktionary extract link not found on ' + page_url)
    return candidates[0]


def normalize(value):
    value = unicodedata.normalize('NFKC', str(value)).casefold()
    value = ''.join(ch for ch in unicodedata.normalize('NFD', value) if unicodedata.category(ch) != 'Mn')
    return re.sub(r'[^Ð°-ÑÑa-z0-9]+', ' ', value).strip()


def normalize_pos(value):
    value = str(value or '').lower().strip()
    return {
        'adjective': 'adj', 'adj': 'adj', 'adverb': 'adv', 'adv': 'adv',
        'pronoun': 'pron', 'pron': 'pron', 'preposition': 'prep', 'prep': 'prep',
        'proper noun': 'name', 'name': 'name', 'noun': 'noun', 'verb': 'verb',
    }.get(value, value)


def read_russian_wiktionary(url, wanted):
    request = urllib.request.Request(url, headers={'User-Agent': 'Integraticum/0.6 educational dictionary'})
    with urllib.request.urlopen(request, timeout=180) as response:
        with gzip.GzipFile(fileobj=response) as stream:
            for line in stream:
                try:
                    item = json.loads(line)
                except (ValueError, UnicodeError):
                    continue
                if item.get('lang_code') != 'de' and str(item.get('lang', '')).lower() not in ('Ð½ÐµÐ¼ÐµÑÐºÐ¸Ð¹', 'german', 'deutsch'):
                    continue
                word = str(item.get('word', ''))
                if word.casefold() not in wanted:
                    continue
                glosses = []
                for sense in item.get('senses', []):
                    for gloss in sense.get('glosses') or sense.get('raw_glosses') or []:
                        if isinstance(gloss, str) and normalize(gloss):
                            glosses.append(gloss)
                yield word.casefold(), {
                    'part_of_speech': normalize_pos(item.get('pos')),
                    'glosses_ru': glosses,
                    'source_url': 'https://ru.wiktionary.org/wiki/' + urllib.parse.quote(word),
                }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--source-url', default=None)
    args = parser.parse_args()

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    print('Loading Integraticum dictionary...', flush=True)
    with zipfile.ZipFile(args.input) as archive:
        with archive.open('sense_records.jsonl') as stream:
            records = [json.loads(line) for line in stream if line.strip()]
    wanted = {str(record.get('word', '')).casefold() for record in records}
    print(f'Loaded {len(records)} records; {len(wanted)} distinct headwords', flush=True)

    source_url = args.source_url or discover_source(PAGE)
    print('Downloading independent source:', source_url, flush=True)
    independent = collections.defaultdict(list)
    for word, evidence in read_russian_wiktionary(source_url, wanted):
        independent[word].append(evidence)
    print(f'Independent source matched {len(independent)} headwords', flush=True)

    stats = collections.Counter()
    with (output / 'independent_evidence.jsonl').open('w', encoding='utf-8') as evidence_file, \
         (output / 'verified_sense_records.jsonl').open('w', encoding='utf-8') as records_file:
        for record in records:
            word = str(record.get('word', '')).casefold()
            sources = independent.get(word, [])
            same_pos = [source for source in sources if source['part_of_speech'] == normalize_pos(record.get('part_of_speech'))]
            candidates = list(dict.fromkeys(record.get('unassigned_word_level_translations_ru') or []))
            matches = []
            seen = set()
            for candidate in candidates:
                candidate_norm = normalize(candidate)
                if len(candidate_norm) < 2:
                    continue
                for source in same_pos:
                    for gloss in source['glosses_ru']:
                        if re.search(r'(?<!\w)' + re.escape(candidate_norm) + r'(?!\w)', normalize(gloss)):
                            key = (candidate, gloss, source['source_url'])
                            if key not in seen:
                                seen.add(key)
                                matches.append({'candidate_ru': candidate, 'wiktionary_gloss_ru': gloss, 'source_url': source['source_url'], 'match_type': 'literal_phrase_overlap'})
            evidence = {
                'id': record.get('id'), 'word': record.get('word'),
                'part_of_speech': record.get('part_of_speech'),
                'wiktionary_headword_found': bool(sources),
                'same_part_of_speech_found': bool(same_pos),
                'independent_glosses': same_pos,
                'candidate_matches': matches,
            }
            evidence_file.write(json.dumps(evidence, ensure_ascii=False) + '\n')
            record['independent_evidence'] = {
                'source': 'Russian Wiktionary (Wiktextract)',
                'headword_found': bool(sources),
                'part_of_speech_found': bool(same_pos),
                'literal_translation_matches': matches,
            }
            record['publication_status'] = 'not_verified'
            for sense in record.get('senses', []):
                sense['alignment_status'] = 'unresolved_sense'
                sense['independent_evidence_available'] = bool(same_pos)
            records_file.write(json.dumps(record, ensure_ascii=False) + '\n')
            stats['total_records'] += 1
            stats['headword_found'] += bool(sources)
            stats['same_part_of_speech_found'] += bool(same_pos)
            stats['records_with_literal_overlap'] += bool(matches)
    report = dict(stats)
    report['source_url'] = source_url
    report['sense_verified_for_publication'] = 0
    report['limitations'] = 'Literal overlap is evidence only, not verification of a particular meaning.'
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('FINISHED:', json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
