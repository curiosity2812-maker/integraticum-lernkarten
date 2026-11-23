
#!/usr/bin/env python3
"""Extract attested German->Russian translations from WikDict TEI; never guess translations."""
import argparse, collections, hashlib, json, re, urllib.request, xml.etree.ElementTree as ET
from pathlib import Path

URL='https://download.wikdict.com/dictionaries/tei/recommended/deu-rus.tei'
CYR=re.compile(r'[А-Яа-яЁё]')

def tag(el):
    return (el.tag if hasattr(el,'tag') else el).rsplit('}',1)[-1]

def txt(el):
    return ' '.join(' '.join(el.itertext()).split())

def extract(entry):
    heads=[]; trans=[]
    for child in entry:
        if tag(child.tag) == 'form':
            heads += [txt(e) for e in child.iter() if tag(e.tag)=='orth']
        if tag(child.tag) == 'sense':
            for e in child.iter():
                if tag(e.tag) in ('quote','def'):
                    value=txt(e)
                    if CYR.search(value):
                        trans.append(value)
    if not heads:
        heads=[txt(e) for e in entry.iter() if tag(e.tag)=='orth'][:1]
    if not trans:
        for e in entry.iter():
            if tag(e.tag)=='quote' and CYR.search(txt(e)):
                trans.append(txt(e))
    heads=[x for x in heads if x and len(x)<=90]
    trans=list(dict.fromkeys(x for x in trans if CYR.search(x) and len(x)<=180))[:12]
    return heads,trans

def run(source,out,limit=0):
    out=Path(out)
    out.mkdir(parents=True,exist_ok=True)
    if source.startswith('https://'):
        response=urllib.request.urlopen(
            urllib.request.Request(
                source,
                headers={'User-Agent':'Integraticum/0.6 educational dictionary'}
            ),
            timeout=120
        )
    else:
        response=open(source,'rb')
    words=collections.defaultdict(list)
    entries=0
    with response as stream:
        for _,e in ET.iterparse(stream,events=('end',)):
            if tag(e.tag)!='entry':
                continue
            entries+=1
            heads,translations=extract(e)
            for head in heads:
                key=head.casefold()
                for t in translations:
                    if t not in words[key] and len(words[key])<12:
                        words[key].append(t)
            e.clear()
            if limit and entries>=limit:
                break
    shards=collections.defaultdict(dict)
    for word,translations in words.items():
        prefix=hashlib.sha256(word.encode('utf-8')).hexdigest()[:2]
        shards[prefix][word]=translations
    for prefix,rows in shards.items():
        (out/f'{prefix}.json').write_text(
            json.dumps(rows,ensure_ascii=False,separators=(',',':')),
            encoding='utf-8'
        )
    report={
        'source':source,
        'source_entries':entries,
        'german_headwords_with_russian_translations':len(words),
        'shards':len(shards),
        'status':'extracted_not_human_verified',
        'license':'WikDict/DBnary/Wiktionary CC BY-SA; attribution required'
    }
    (out/'report.json').write_text(
        json.dumps(report,ensure_ascii=False,indent=2),
        encoding='utf-8'
    )
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--source',default=URL)
    p.add_argument('--out',default='translations/ru')
    p.add_argument('--limit',type=int,default=0)
    a=p.parse_args()
    run(a.source,a.out,a.limit)
