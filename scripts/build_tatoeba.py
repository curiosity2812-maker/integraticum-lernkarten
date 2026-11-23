#!/usr/bin/env python3
"""Build German/Russian sentence examples with reusable Tatoeba audio for Integraticum.
This DOES NOT verify word-level translation or assign CEFR.
"""
import argparse,bz2,collections,csv,io,json,re,urllib.request,zipfile,unicodedata
from pathlib import Path

ROOT='https://downloads.tatoeba.org/exports/per_language/'
URLS={
 'deu':ROOT+'deu/deu_sentences.tsv.bz2',
 'rus':ROOT+'rus/rus_sentences.tsv.bz2',
 'links':ROOT+'deu/deu-rus_links.tsv.bz2',
 'audio':ROOT+'deu/deu_sentences_with_audio.tsv.bz2',
}

def download(url,dest):
    if dest.exists() and dest.stat().st_size>100: return
    req=urllib.request.Request(url,headers={'User-Agent':'Integraticum-educational-import/0.6'})
    with urllib.request.urlopen(req,timeout=120) as response, dest.open('wb') as out:
        while True:
            block=response.read(1024*1024)
            if not block:break
            out.write(block)

def rows(path):
    with bz2.open(path,'rt',encoding='utf-8',errors='replace',newline='') as f:
        yield from csv.reader(f,delimiter='\t')

def allowed_license(value):
    s=(value or '').lower().replace('_','-').replace(' ','')
    if not s or 'nc' in s or 'nd' in s: return False
    return 'cc0' in s or 'publicdomain' in s or ('cc' in s and 'by' in s)

def tokens(s):
    return set(re.findall(r"[a-zÃ¤Ã¶Ã¼Ã]+",unicodedata.normalize('NFC',s).casefold()))

def make(args):
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    cache=Path(args.cache);cache.mkdir(parents=True,exist_ok=True)
    paths={}
    for k,url in URLS.items():
        p=cache/url.rsplit('/',1)[-1]
        if not args.local: download(url,p)
        if not p.exists():raise FileNotFoundError(p)
        paths[k]=p
    # Each German sentence ID has one or more linked Russian IDs.
    linked=collections.defaultdict(list)
    for row in rows(paths['links']):
        if len(row)>=2 and row[0].isdigit() and row[1].isdigit():
            linked[int(row[0])].append(int(row[1]))
    german={}
    for row in rows(paths['deu']):
        if len(row)>=2 and row[0].isdigit() and int(row[0]) in linked:
            german[int(row[0])]=row[-1] if len(row)==2 else row[2]
    wanted_ru={i for k in german for i in linked[k]}
    russian={}
    for row in rows(paths['rus']):
        if len(row)>=2 and row[0].isdigit() and int(row[0]) in wanted_ru:
            russian[int(row[0])]=row[-1] if len(row)==2 else row[2]
    audio={}
    for row in rows(paths['audio']):
        if len(row)<4 or not row[0].isdigit() or not row[1].isdigit():continue
        sid=int(row[0]); aid=int(row[1]); license=row[3].strip()
        if sid not in german or not allowed_license(license):continue
        audio.setdefault(sid,{'id':aid,'url':f'https://tatoeba.org/audio/download/{aid}',
          'license':license,'contributor':row[2], 'attribution_url':row[4] if len(row)>4 else ''})
    examples=[]
    for sid, sentence in german.items():
        if not 8<=len(sentence)<=190:continue
        for rid in linked[sid]:
            if rid not in russian:continue
            examples.append({'de':sentence,'ru':russian[rid], 'de_id':sid,'ru_id':rid,
              'source_url':f'https://tatoeba.org/en/sentences/show/{sid}',
              'text_license':'CC BY 2.0 FR', 'audio':audio.get(sid)})
    # The input dictionary is already in the repository under data/.
    with zipfile.ZipFile(args.dictionary) as z:
        with z.open('sense_records.jsonl') as f:
            dictionary=[json.loads(line) for line in f]
    # Inverted index: only sentence tokens which match actual dictionary headwords.
    byword=collections.defaultdict(list)
    heads={r['word'].casefold() for r in dictionary if re.fullmatch(r'[A-Za-zÃÃÃÃ¤Ã¶Ã¼Ã]+',r['word'])}
    for ex in examples:
        for word in tokens(ex['de']) & heads:
            byword[word].append(ex)
    total=0; audio_words=0; with_examples=0; records=[]
    for rec in dictionary:
        word=rec['word']; opts=byword.get(word.casefold(),[])
        # Prefer audio, short examples; distinct German sentences only.
        opts.sort(key=lambda e:(e['audio'] is None,len(e['de'])))
        seen=set(); selected=[]
        for ex in opts:
            if ex['de_id'] in seen:continue
            seen.add(ex['de_id']);selected.append(ex)
            if len(selected)>=args.max_examples:break
        if selected:with_examples+=1
        if any(e['audio'] for e in selected):audio_words+=1
        total+=len(selected)
        records.append({'id':rec['id'],'word':word,'examples':selected,
                        'match_status':'word_form_in_sentence_not_sense_verified'})
    with (out/'tatoeba_examples.jsonl').open('w',encoding='utf-8') as f:
        for r in records:f.write(json.dumps(r,ensure_ascii=False)+'\n')
    # Lightweight browser-friendly shards by first letter, no huge single fetch.
    shards=collections.defaultdict(dict)
    for r in records:
        if not r['examples']:continue
        key=re.sub('[^a-z0-9]','_',r['word'].casefold()[0]) if r['word'] else '_'
        shards[key][r['id']]=r['examples']
    (out/'shards').mkdir(exist_ok=True)
    for key,items in shards.items():
        (out/'shards'/f'{key}.json').write_text(json.dumps(items,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    report={'dictionary_records':len(dictionary),'german_sentences_linked':len(german),
      'german_russian_pairs':len(examples),'german_sentences_with_licensed_audio':len(audio),
      'dictionary_records_with_examples':with_examples,'dictionary_records_with_audio_example':audio_words,
      'selected_examples':total,'shard_files':len(shards),
      'important':'Sentence word matches do not verify dictionary sense or CEFR. Audio only with explicitly reusable licenses.'}
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--dictionary',default='data/integraticum_sense_alignment_step2.zip')
    p.add_argument('--output',default='tatoeba_result')
    p.add_argument('--cache',default='tatoeba_cache')
    p.add_argument('--max-examples',type=int,default=3)
    p.add_argument('--local',action='store_true',help='Use downloaded files in cache; for tests')
    make(p.parse_args())
