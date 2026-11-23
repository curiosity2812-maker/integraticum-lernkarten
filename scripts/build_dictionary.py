#!/usr/bin/env python3
"""Stream a de-Wiktionary Wiktextract gzip and emit compact, bounded JSON shards.
No inferred CEFR levels or translations are fabricated.
"""
import argparse, gzip, hashlib, json, os, re, urllib.request
from collections import defaultdict
from pathlib import Path

SOURCE='https://kaikki.org/dewiktionary/raw-wiktextract-data.jsonl.gz'
POS={'noun','verb','adj','adv','pron','prep','conj','det','num','intj','particle','phrase','name','proper name','abbrev','interj','postp'}

def compact(entry):
    word=entry.get('word','').strip()
    if not word or len(word)>90 or not re.search(r'[A-Za-zÄÖÜäöüß]',word):return None
    if entry.get('lang_code')!='de' and entry.get('lang') not in ('Deutsch','German'):return None
    pos=str(entry.get('pos') or '').lower()
    if pos not in POS:return None
    senses=[]
    for s in entry.get('senses',[])[:8]:
        glosses=s.get('glosses') or s.get('raw_glosses') or []
        if not glosses:continue
        gloss=str(glosses[0])[:250]
        if gloss:senses.append({'de':gloss})
    if not senses:return None
    sounds=entry.get('sounds') or []
    ipa=next((s.get('ipa') for s in sounds if s.get('ipa')),None)
    audio=next((s.get(k) for s in sounds for k in ('ogg_url','mp3_url','audio') if isinstance(s.get(k),str) and s[k].startswith('https://')),None)
    tags=set(entry.get('tags') or [])
    for f in entry.get('forms') or []:
        if isinstance(f,dict):tags.update(f.get('tags') or [])
    gender=next((g for g in ('masculine','feminine','neuter') if g in tags),None)
    forms=[]
    for f in entry.get('forms') or []:
        if not isinstance(f,dict):continue
        form=f.get('form','')
        if form and form!=word and len(form)<90:
            forms.append({'v':form,'tags':(f.get('tags') or [])[:5]})
        if len(forms)>=24:break
    topics=list(dict.fromkeys(t for s in entry.get('senses') or [] for t in (s.get('topics') or []) if isinstance(t,str)))[:8]
    return {'w':word,'p':pos,'g':gender,'ipa':ipa,'audio':audio,'s':senses,'f':forms,'topics':topics,'cefr':None,'ru':None,'uk':None}

def main():
    a=argparse.ArgumentParser()
    a.add_argument('--source',default=SOURCE)
    a.add_argument('--out',default='dictionary')
    a.add_argument('--limit',type=int,default=0,help='For smoke tests only')
    args=a.parse_args()
    out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
    buckets=defaultdict(list);seen=set();counts={'lines':0,'accepted':0,'duplicate':0,'invalid':0}
    source=open(args.source,'rb') if os.path.isfile(args.source) else urllib.request.urlopen(urllib.request.Request(args.source,headers={'User-Agent':'Integraticum-Dictionary-Importer/1.0'}),timeout=90)
    with source as raw, gzip.GzipFile(fileobj=raw) as stream:
        for line in stream:
            counts['lines']+=1
            try: entry=json.loads(line)
            except (ValueError,UnicodeDecodeError):counts['invalid']+=1;continue
            item=compact(entry)
            if item is None:continue
            key=(item['w'].casefold(),item['p'])
            if key in seen:counts['duplicate']+=1;continue
            seen.add(key)
            bucket=hashlib.sha256(item['w'].casefold().encode('utf-8')).hexdigest()[:2]
            buckets[bucket].append(item);counts['accepted']+=1
            if args.limit and counts['accepted']>=args.limit:break
            if counts['lines']%100000==0:print(counts,flush=True)
    manifest={'schema':'integraticum-dictionary-v1','source':args.source,'license_notice':'Based on Wiktionary contributors. See ATTRIBUTION.md.','counts':counts,'shards':{}}
    for bucket,words in sorted(buckets.items()):
        words.sort(key=lambda x:(x['w'].casefold(),x['p']))
        filename=f'{bucket}.json'
        (out/filename).write_text(json.dumps(words,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        manifest['shards'][bucket]={'file':filename,'count':len(words)}
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(counts,ensure_ascii=False))
if __name__=='__main__':main()
