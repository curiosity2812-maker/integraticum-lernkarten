
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
    if url.endswith('.gz'):return url
    page=urllib.request.urlopen(url,timeout=60).read().decode('utf-8','replace')
    p=Links();p.feed(page)
    from urllib.parse import urljoin
    candidates=[urljoin(url,x) for x in p.links if re.search(r'(?:ru-extract|extract)\.jsonl\.gz(?:\?|$)',x)]
    if not candidates:raise RuntimeError('Cannot locate Russian Wiktionary JSONL.gz on '+url)
    return candidates[0]

def norm(s):
    s=unicodedata.normalize('NFKC',str(s)).casefold()
    s=''.join(c for c in unicodedata.normalize('NFD',s) if unicodedata.category(c)!='Mn')
    return re.sub(r'[^а-яёa-z0-9]+',' ',s).strip()

def pos(p):
    return {'noun':'noun','proper noun':'name','name':'name','verb':'verb','adj':'adj','adjective':'adj','adv':'adv','adverb':'adv','pron':'pron','pronoun':'pron','prep':'prep','preposition':'prep'}.get(str(p).lower(),str(p).lower())

def source_records(url, wanted):
    """Stream full Russian Wiktionary dump; retain only German-language headwords in input."""
    req=urllib.request.Request(url,headers={'User-Agent':'IntegraticumDictionaryResearch/0.6 (open educational project)'})
    with urllib.request.urlopen(req,timeout=180) as response:
        with gzip.GzipFile(fileobj=response) as gz:
            for raw in gz:
                try: obj=json.loads(raw)
                except (ValueError,UnicodeError):continue
                if obj.get('lang_code')!='de' and str(obj.get('lang','')).lower() not in ('немецкий','german','deutsch'):continue
                word=obj.get('word','')
                if word.casefold() not in wanted:continue
                yield obj

def extract_glosses(obj):
    results=[]
    for s in obj.get('senses',[]):
        glosses=s.get('glosses') or s.get('raw_glosses') or []
        for g in glosses:
            if isinstance(g,str) and norm(g):results.append({'gloss_ru':g,'tags':s.get('tags',[])})
    return results

def run(args):
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(args.input) as z:
        with z.open('sense_records.jsonl') as f:
            rows=[json.loads(x) for x in f]
    wanted={r['word'].casefold() for r in rows}
    url=args.source_url or download_source('https://kaikki.org/ruwiktionary/rawdata.html')
    byword=collections.defaultdict(list)
    for obj in source_records(url,wanted):
        byword[obj['word'].casefold()].append({'pos':pos(obj.get('pos')),'glosses':extract_glosses(obj),'source':'Russian Wiktionary (ruwiktionary via Wiktextract)','url':'https://ru.wiktionary.org/wiki/'+__import__('urllib.parse',fromlist=['quote']).quote(obj['word'])})
    stats=collections.Counter()
    with (out/'independent_evidence.jsonl').open('w',encoding='utf8') as ev, (out/'verified_sense_records.jsonl').open('w',encoding='utf8') as dst:
        for r in rows:
            sources=byword.get(r['word'].casefold(),[])
            same=[x for x in sources if pos(x['pos'])==pos(r.get('part_of_speech'))]
            candidates=list(dict.fromkeys(r.get('unassigned_word_level_translations_ru',[])))
            matches=[]
            for c in candidates:
                nc=norm(c)
                if len(nc)<2:continue
                for src in same:
                    for g in src['glosses']:
                        ng=norm(g['gloss_ru'])
                        if re.search(r'(?<!\w)'+re.escape(nc)+r'(?!\w)',ng):
                            matches.append({'candidate_ru':c,'wiktionary_gloss_ru':g['gloss_ru'],'source_url':src['url'],'match_type':'literal_phrase_overlap'})
            matches=list({(x['candidate_ru'],x['wiktionary_gloss_ru']):x for x in matches}.values())
            evidence={'id':r['id'],'word':r['word'],'pos':r.get('part_of_speech'),'wiktionary_found':bool(sources),'same_pos':bool(same),'wiktionary_senses':[{'pos':x['pos'],'glosses':x['glosses'],'url':x['url']} for x in same],'candidate_matches':matches}
            ev.write(json.dumps(evidence,ensure_ascii=False)+'\n')
            r['independent_evidence']={'source':'Russian Wiktionary','word_found':bool(sources),'part_of_speech_found':bool(same),'literal_translation_matches':matches}
            r['publication_status']='not_verified'
            for s in r['senses']:
                s['alignment_status']='unresolved_sense'
                s['independent_evidence_available']=bool(same)
            dst.write(json.dumps(r,ensure_ascii=False)+'\n')
            stats['total']+=1
            stats['wiktionary_headword_found']+=bool(sources)
            stats['same_pos_found']+=bool(same)
            stats['records_with_literal_overlap']+=bool(matches)
            stats['records_without_literal_overlap']+=not bool(matches)
            stats['sense_verified_for_publication']+=0
    report={'input_records':stats['total'],'wiktionary_headword_found':stats['wiktionary_headword_found'],'same_pos_found':stats['same_pos_found'],'records_with_literal_overlap':stats['records_with_literal_overlap'],'records_without_literal_overlap':stats['records_without_literal_overlap'],'sense_verified_for_publication':0,'source_url':url,'limitations':'Word-level overlap is evidence, not sense verification; no automatic publication approval.'}
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--source-url');run(p.parse_args())
