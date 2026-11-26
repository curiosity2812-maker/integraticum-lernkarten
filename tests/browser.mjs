import {chromium,firefox,webkit} from 'playwright';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const html=readFileSync('index.html','utf8').replace("projectId:'integraticum'","projectId:'demo-integraticum'").replace("import {getAuth,","import {connectAuthEmulator,getAuth,").replace("import {getFirestore,","import {connectFirestoreEmulator,getFirestore,").replace("auth.languageCode='ru';","connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8080);auth.languageCode='ru';");
const server=createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}else if(req.url==='/integraticum.css'||req.url==='/integraticum-emblem.svg'){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'image/svg+xml');res.end(readFileSync(req.url.slice(1)));}else if(req.url.endsWith('.json')){res.setHeader('Content-Type','application/json');try{res.end(readFileSync(req.url.slice(1)));}catch{res.statusCode=404;res.end('[]');}}else{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(8765,'127.0.0.1',r));
try{for(const [name,engine] of Object.entries({chromium,firefox,webkit})){
const dir=await mkdtemp(join(tmpdir(),'integraticum-'));let context;
try{context=await engine.launchPersistentContext(dir,{headless:true});let p=context.pages()[0];await p.goto('http://127.0.0.1:8765/');await p.waitForFunction(()=>window.integraticumAuthReady===true,{},{timeout:60000});await p.evaluate(()=>go('account'));await p.locator('#authEmail').fill(name+'@example.test');await p.locator('#authPassword').fill('Test-only-123');await p.getByRole('button',{name:'Зарегистрироваться',exact:true}).click();await p.waitForFunction(()=>!!window.integraticumUser,{},{timeout:60000});const uid=await p.evaluate(()=>window.integraticumUser.uid);await p.waitForTimeout(1500);await context.setOffline(true);await p.evaluate(()=>{const b=window.integraticumBridge;b.data.custom.push({id:'browser-test',de:'Haus',ru:'дом'});b.save();});await context.close();context=await engine.launchPersistentContext(dir,{headless:true});p=context.pages()[0];await p.goto('http://127.0.0.1:8765/');await p.waitForFunction(()=>!!window.integraticumUser,{},{timeout:60000});assert.equal(await p.evaluate(()=>window.integraticumUser.uid),uid);assert.equal(await p.evaluate(()=>window.integraticumBridge.data.custom.some(x=>x.id==='browser-test')),true);console.log(name+': registration, persistent login and offline local data after restart passed');await p.evaluate(()=>{const b=window.integraticumBridge;b.data.history=[{id:'browser-test',ok:false,mode:'typing',errorType:'spelling',at:Date.now()}];b.data.sets.push({id:'browser-set',name:'Test set',wordIds:['browser-test']});go('progress');});await p.getByRole('heading',{name:'Динамика обучения'}).waitFor();await p.getByRole('heading',{name:'Прогресс по наборам'}).waitFor();await p.getByText('Test set',{exact:true}).waitFor();await p.getByText('Орфография · 1 слов',{exact:true}).waitFor();await p.getByRole('button',{name:'Тренировать',exact:true}).click();await p.waitForFunction(()=>typeof session!=='undefined'&&session?.mode==='typing'&&session.queue[0]?.id==='browser-test');console.log(name+': progress view, set statistics and targeted training passed');await p.evaluate(()=>{const b=window.integraticumBridge;b.data.writing='yes';b.data.custom.push({id:'adaptive-test',de:'Haus',ru:'дом'});b.data.history=b.data.history.filter(h=>h.id!=='adaptive-test');delete b.data.records['adaptive-test'];startSession(['adaptive-test'],'smart');});assert.deepEqual(await p.evaluate(()=>session.queue.map(x=>x.exercise).sort()),['cards','choice','recall','typing']);await p.getByRole('button',{name:/Показать/}).click();await p.getByRole('button',{name:'Не вспомнил',exact:true}).click();await p.waitForFunction(()=>session.index===1&&session.queue.length===5);assert.equal(await p.evaluate(()=>{const h=data.history.filter(x=>x.id==='adaptive-test').at(-1);return data.records['adaptive-test'].due-h.at;}),4*3600000);await p.evaluate(()=>{while(session.index<session.queue.length){feedback={ok:true};nextQuestion();}});await p.getByRole('heading',{name:'Занятие завершено'}).waitFor();const mixed=await p.evaluate(()=>{const ids=Array.from({length:5},(_,i)=>'mix-'+i);for(const id of ids)data.custom.push({id,de:id,ru:id});startSession(ids,'smart');const q=session.queue;return {length:q.length,types:ids.every(id=>new Set(q.filter(x=>x.id===id).map(x=>x.exercise)).size===4),first:ids.every(id=>q.find(x=>x.id===id).exercise==='cards'),interleaved:q.slice(0,5).some(x=>x.exercise!=='cards')};});assert.equal(mixed.length,20);assert.ok(mixed.types&&mixed.first&&mixed.interleaved);console.log(name+': mixed session traversed all four exercise types and interleaved five words');const checks=await p.evaluate(()=>{const h={id:'x',ok:false,errorType:'spelling',mode:'typing',at:1000};const good={...h,ok:true};return [adaptiveMode([h],'x','yes')==='typing',adaptiveMode([h],'x','no')==='recall',adaptiveMode([{...h,errorType:'meaning'}],'x','yes')==='choice',reviewRecord(null,{...h,partial:true}).due-h.at===12*3600000,[24,72,168,336,720,1440].every((hours,i)=>Array.from({length:i+1},()=>good).reduce(reviewRecord,null).due-good.at===hours*3600000)];});assert.ok(checks.every(Boolean));console.log(name+': adaptive exercise, retry and spaced repetition passed');await p.evaluate(()=>{const b=window.integraticumBridge;b.data.custom.push({id:'cloud-test',de:'Baum',ru:'дерево'},{id:'cloud-test-2',de:'Buch',ru:'книга'});b.data.sets.push({id:'cloud-set',name:'Cloud set',wordIds:['cloud-test','cloud-test-2']});b.save();startSession(['cloud-test','cloud-test-2'],'recall');finishRecall(true);});const checkpoint=await p.evaluate(()=>session.learningId);const secondDir=await mkdtemp(join(tmpdir(),'integraticum-second-'));let second;try{second=await engine.launchPersistentContext(secondDir,{headless:true});const q=second.pages()[0];await q.goto('http://127.0.0.1:8765/');await q.waitForFunction(()=>window.integraticumAuthReady===true,{},{timeout:60000});await q.evaluate(()=>go('account'));await q.locator('#authEmail').fill(name+'@example.test');await q.locator('#authPassword').fill('Test-only-123');await q.getByRole('button',{name:'Войти',exact:true}).click();await q.waitForFunction(()=>!!window.integraticumUser,{},{timeout:60000});assert.equal(await q.evaluate(()=>window.integraticumUser.uid),uid);await q.waitForFunction(()=>data.custom.some(x=>x.id==='cloud-test')&&data.sets.some(x=>x.id==='cloud-set')&&data.history.some(x=>x.id==='cloud-test'&&x.ok),{},{timeout:60000});await q.waitForFunction(id=>data.learningSessions.some(x=>x.learningId===id&&x.index===1),checkpoint,{timeout:60000});await q.evaluate(id=>{const i=data.learningSessions.findIndex(x=>x.learningId===id);if(i<0)throw Error('Checkpoint not found');resumeLearning(i);},checkpoint);assert.equal(await q.evaluate(()=>session.index),1);assert.equal(await q.evaluate(()=>session.queue[session.index].id),'cloud-test-2');await q.evaluate(()=>finishRecall(true));await p.waitForFunction(()=>data.history.some(x=>x.id==='cloud-test-2'&&x.ok),{},{timeout:60000});console.log(name+': independent profile cloud restoration, session resume and reverse answer sync passed');await context.setOffline(true);await p.evaluate(()=>{const b=window.integraticumBridge;b.data.custom.push({id:'offline-cloud',de:'Tisch',ru:'стол'});b.data.sets.push({id:'offline-set',name:'Offline set',wordIds:['offline-cloud']});b.save();startSession(['offline-cloud'],'recall');finishRecall(true);});const offlineEvent=await p.evaluate(()=>data.history.find(x=>x.id==='offline-cloud').eventId);assert.equal(await q.evaluate(()=>data.history.some(x=>x.id==='offline-cloud')),false);await context.close();context=await engine.launchPersistentContext(dir,{headless:true});p=context.pages()[0];await p.goto('http://127.0.0.1:8765/');await p.waitForFunction(()=>!!window.integraticumUser,{},{timeout:60000});await q.waitForFunction(id=>data.history.some(x=>x.eventId===id)&&data.custom.some(x=>x.id==='offline-cloud')&&data.sets.some(x=>x.id==='offline-set'),offlineEvent,{timeout:60000});await context.setOffline(true);await context.setOffline(false);await p.reload();await p.waitForFunction(id=>window.integraticumUser&&data.history.some(x=>x.eventId===id),offlineEvent,{timeout:60000});assert.equal(await q.evaluate(id=>data.history.filter(x=>x.eventId===id).length,offlineEvent),1);assert.equal(await p.evaluate(id=>data.history.filter(x=>x.eventId===id).length,offlineEvent),1);console.log(name+': offline answers and sets survive restart, reconnect and deduplication passed');for(const [width,height] of [[390,844],[768,1024],[1440,900]]){await p.setViewportSize({width,height});for(const pageName of ['account','plan','progress','sets','courses','settings']){await p.evaluate(n=>go(n),pageName);await p.locator('#view h1').first().waitFor();const layout=await p.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('#view button')].filter(b=>b.getBoundingClientRect().width>0).map(b=>({text:b.textContent.trim(),width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height}))}));assert.ok(layout.scroll<=layout.width+2,name+' '+width+' '+pageName+' horizontal overflow '+JSON.stringify(layout));assert.ok(layout.buttons.every(b=>b.width>0&&b.height>=24),name+' '+width+' '+pageName+' undersized button '+JSON.stringify(layout));}console.log(name+': responsive layout at '+width+'px passed');}const roleUrl='http://127.0.0.1:8080/v1/projects/demo-integraticum/databases/(default)/documents/users/'+uid;
const roleResponse=await fetch(roleUrl,{method:'PATCH',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({fields:{role:{stringValue:'teacher'}}})});assert.ok(roleResponse.ok,await roleResponse.text());
await p.reload();await p.waitForFunction(()=>window.integraticumCourse?.accountProfile()?.role==='teacher',{},{timeout:60000});
for(const [button,id] of [['Добавить курс','courseCreate'],['Приглашения','courseInvitations'],['Заявки учеников','courseRequests'],['Опубликовать набор','coursePublish'],['Преподаватели группы','courseTeachers']]){await p.evaluate(()=>go('account'));await p.getByRole('button',{name:button,exact:true}).click();await p.locator('#'+id).waitFor({state:'visible'});}
console.log(name+': teacher account navigation and five management sections passed');
await p.evaluate(()=>go('library'));
await p.getByText(/A1 · 832 карточек с проверенным русским переводом/).waitFor({timeout:60000});
await p.getByText(/Записей в библиотеке:/).waitFor({timeout:60000});

await p.getByText(/A2 · 630 проверенных карточек/).waitFor({timeout:60000});
const counts=await p.evaluate(()=>{const all=dictionaryCards();return {total:all.length,a1:all.filter(w=>w.a1Reviewed).length,a2:all.filter(w=>w.a2Reviewed).length,unknown:all.filter(w=>!w.level_verified).length};});
assert.equal(counts.a1,832);assert.equal(counts.a2,630);assert.ok(counts.total>1462&&counts.unknown>0);
await p.locator('#filterLevel').selectOption('A2');
assert.equal(await p.evaluate(()=>dictionaryResults().length),630);
assert.equal(await p.evaluate(()=>dictionaryResults().every(w=>w.topic&&w.topic!=='Без темы'&&w.topics.includes(w.topic))),true);
for(const [topic,translation] of [['Еда и напитки','рецепт блюда'],['Здоровье и тело','рецепт врача']]){
  await p.locator('#filterTopic').selectOption(topic);
  const matching=await p.evaluate(()=>dictionaryResults().filter(w=>w.de==='das Rezept').map(w=>w.ru));
  assert.equal(matching.length,1);
  assert.ok(matching[0].includes(translation));
  const learning=await p.evaluate(topic=>{
    const filters=learningFilter;
    learningFilter={level:'A2',topic,part:'all'};
    try{return learningPool().filter(w=>w.de==='das Rezept').map(w=>w.ru);}
    finally{learningFilter=filters;}
  },topic);
  assert.deepEqual(learning,matching);
}
await p.locator('#filterTopic').selectOption('all');
await p.locator('#filterPart').selectOption('conj');
await p.locator('#search').fill('weil');
await p.locator('#results').getByRole('button',{name:'Открыть',exact:true}).first().click();
await p.locator('.grammar-support').getByText('Nebensatz · глагол в конце',{exact:true}).waitFor();
for(const [width,height] of [[390,844],[768,1024],[1440,900]]){
 await p.setViewportSize({width,height});
 for(const [id,label] of [['dict_25c911117321203d0b6d','Nebensatz · глагол в конце'],['conjunction-denn-reason','Hauptsatz · обычный порядок слов'],['a1-320-1','Wo? · Dativ'],['a1-320-2','Wohin? · Akkusativ'],['a1-320-3','Время · Dativ'],['a1-647-1','Dativ'],['dict_2483930c6658347aa523','zu + Infinitiv']]){
  await p.evaluate(id=>openWord(id),id);
  await p.locator('.grammar-chip').getByText(label,{exact:true}).waitFor();
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2),name+' '+width+' '+id+' overflow');
  assert.ok(await p.locator('.grammar-support').isVisible());
 }
}
const grammarId='dict_25c911117321203d0b6d';
for(const mode of ['cards','recall','typing','choice']){
 await p.evaluate(({id,mode})=>startSession([id],mode),{id:grammarId,mode});
 assert.equal(await p.locator('.grammar-support').count(),0);
 if(mode==='cards'||mode==='recall')await p.getByRole('button',{name:'Показать ответ',exact:true}).click();
 else if(mode==='typing'){await p.locator('#typed').fill('weil');await p.getByRole('button',{name:'Проверить',exact:true}).click();}
 else {await p.evaluate(id=>pick(id),grammarId);await p.getByRole('button',{name:'Проверить',exact:true}).click();}
 await p.locator('.grammar-support').getByText('Nebensatz · глагол в конце',{exact:true}).waitFor();
}
await p.evaluate(()=>{session=null;go('library');});
await p.locator('#search').fill('');await p.locator('#filterPart').selectOption('all');await p.locator('#filterLevel').selectOption('all');
console.log(name+': A2 search, sense-aware grammar chips at three screen sizes, and four learning modes passed');

await p.locator('#filterLevel').selectOption('unknown');assert.ok(await p.evaluate(()=>dictionaryResults().length>0&&dictionaryResults().every(w=>!w.level_verified)));
await p.locator('#filterLevel').selectOption('A1');assert.ok(await p.evaluate(()=>dictionaryResults().length>0&&dictionaryResults().every(w=>w.level_verified&&w.level==='A1')));
await p.locator('#filterPart').selectOption('noun');assert.ok(await p.evaluate(()=>dictionaryResults().length>0&&dictionaryResults().every(w=>w.part==='noun')));
const sample=await p.evaluate(()=>dictionaryResults().find(w=>w.ru&&w.de));
await p.locator('#search').fill(sample.de);assert.ok(await p.evaluate(id=>dictionaryResults().some(w=>w.id===id),sample.id));
await p.locator('#search').fill(sample.ru.split(';')[0].trim());assert.ok(await p.evaluate(id=>dictionaryResults().some(w=>w.id===id),sample.id));
await p.locator('#search').fill('');await p.locator('#filterPart').selectOption('all');await p.locator('#filterLevel').selectOption('all');
assert.equal(await p.locator('#results .item').count(),80);await p.getByRole('button',{name:'Вперёд →',exact:true}).click();await p.getByText(/Страница 2 из/).waitFor();
await p.locator('#results').getByRole('button',{name:'Открыть',exact:true}).first().click();
assert.ok(await p.evaluate(()=>page==='word'&&!!word(selectedWord)));
console.log(name+': real dictionary loading, search, filters, pagination and word opening passed '+JSON.stringify(counts));
await p.evaluate(()=>go('library'));
const parts=await p.locator('#filterPart option').evaluateAll(xs=>xs.map(x=>x.value).filter(x=>x!=='all'));
for(const part of parts){await p.locator('#filterPart').selectOption(part);assert.ok(await p.evaluate(v=>dictionaryResults().every(w=>w.part===v),part));}
await p.locator('#filterPart').selectOption('all');
const topic=await p.evaluate(()=>dictionaryCards().find(w=>w.a1Reviewed&&w.topic).topic);
await p.locator('#filterTopic').selectOption(topic);assert.ok(await p.evaluate(t=>dictionaryResults().length>0&&dictionaryResults().every(w=>w.topic===t||w.topics?.includes(t)),topic));
await p.locator('#filterTopic').selectOption('all');
const uk=await p.evaluate(()=>dictionaryCards().find(w=>w.a1Reviewed&&w.uk));
await p.locator('#search').fill(uk.uk);assert.ok(await p.evaluate(id=>dictionaryResults().some(w=>w.id===id),uk.id));
await p.evaluate(()=>openWord('c0'));
await p.getByText('die Wohnungen',{exact:false}).first().waitFor();
await p.getByText('Räume, in denen jemand lebt.',{exact:false}).waitFor();
await p.evaluate(()=>{window.testSpeech=[];Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{cancel(){},getVoices(){return [{lang:'de-DE'}]},speak(u){window.testSpeech.push({text:u.text,lang:u.lang,rate:u.rate})}}});window.SpeechSynthesisUtterance=class{constructor(text){this.text=text}};});
await p.getByRole('button',{name:'Произнести слово',exact:true}).click();await p.getByRole('button',{name:/Произнести пример/}).click();
assert.deepEqual(await p.evaluate(()=>window.testSpeech),[{text:'die Wohnung',lang:'de-DE',rate:0.85},{text:'Ich wohne in einer kleinen Wohnung.',lang:'de-DE',rate:0.85}]);
console.log(name+': part and topic filters, Ukrainian search, forms, definition and speech dispatch passed');
await p.evaluate(()=>go('library'));
const categories=await p.locator('#filterPart option').evaluateAll(xs=>xs.map(x=>x.value).filter(x=>x!=='all'));
for(const part of categories){await p.locator('#filterPart').selectOption(part);await p.locator('#partHint').waitFor({state:'visible'});assert.equal(await p.locator('#partHint p').textContent(),await p.evaluate(v=>partHints[v],part));}
await p.locator('#filterPart').selectOption('all');assert.equal(await p.locator('#partHint').count(),0);
await p.locator('#filterPart').selectOption('intj');await p.locator('#filterLevel').selectOption('unknown');await p.locator('#filterTopic').selectOption(topic);await p.locator('#search').fill('ach');
await p.evaluate(()=>{filter.ch=true;refreshResults();});
await p.reload();await p.locator('#filterPart').waitFor();assert.equal(await p.locator('#filterPart').inputValue(),'intj');assert.equal(await p.locator('#filterLevel').inputValue(),'unknown');assert.equal(await p.locator('#search').inputValue(),'ach');await p.getByText(/Записей в библиотеке:/).waitFor({timeout:60000});assert.equal(await p.locator('#filterTopic').inputValue(),topic);assert.equal(await p.evaluate(()=>filter.ch),true);await p.locator('#partHint').waitFor({state:'visible'});
for(const section of ['account','progress','sets','courses','calendar','settings','plan']){await p.evaluate(v=>go(v),section);await p.reload();await p.waitForFunction(v=>page===v,section);}
await p.waitForFunction(()=>window.integraticumAuthReady&&window.integraticumUser&&word('c0'));
const reloadCheckpoint=await p.evaluate(()=>{startSession(['c0','cloud-test','cloud-test-2'],'recall');finishRecall(true);finishRecall(true);return {id:session.learningId,index:session.index};});
await p.reload();await p.waitForFunction(()=>page==='home'&&window.integraticumAuthReady&&window.integraticumUser);
await p.evaluate(()=>go('plan'));
await p.waitForFunction(id=>data.learningSessions.some(x=>x.learningId===id),reloadCheckpoint.id);
await p.evaluate(id=>resumeLearning(data.learningSessions.findIndex(x=>x.learningId===id)),reloadCheckpoint.id);
assert.deepEqual(await p.evaluate(()=>({id:session.learningId,index:session.index})),reloadCheckpoint);
console.log(name+': interrupted training returns home and resumes saved reloadCheckpoint');
console.log(name+': all grammar panels and navigation/filter restoration passed');
assert.equal(reloadCheckpoint.index,2);
const adminRole=await fetch(roleUrl,{method:'PATCH',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({fields:{role:{stringValue:'super_admin'}}})});assert.ok(adminRole.ok);
await p.reload();await p.waitForFunction(()=>window.integraticumCourse?.accountProfile()?.role==='super_admin',{},{timeout:60000});
await p.evaluate(()=>go('calendar'));
const month=await p.locator('#view h2').first().textContent();
await p.getByRole('button',{name:'›',exact:true}).click();assert.notEqual(await p.locator('#view h2').first().textContent(),month);
await p.getByRole('button',{name:'‹',exact:true}).click();assert.equal(await p.locator('#view h2').first().textContent(),month);
const observers=[];
try{
for(const role of ['student','teacher']){
 const ctx=await engine.launch();const v=await ctx.newPage();observers.push({ctx,v,role});
 await v.goto('http://127.0.0.1:8765/');await v.waitForFunction(()=>window.integraticumAuthReady===true);await v.evaluate(()=>go('account'));
 await v.locator('#authName').fill('Test '+role+' '+name);
 await v.locator('#authEmail').fill(name+'-'+role+'@example.test');await v.locator('#authPassword').fill('Test-only-123');await v.getByRole('button',{name:'Зарегистрироваться',exact:true}).click();
 await v.waitForFunction(()=>!!window.integraticumUser);const observerUid=await v.evaluate(()=>window.integraticumUser.uid);assert.notEqual(observerUid,uid);
 const base='http://127.0.0.1:8080/v1/projects/demo-integraticum/databases/(default)/documents/';
 const seed=async(path,fields)=>{const res=await fetch(base+path,{method:'PATCH',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({fields:Object.fromEntries(Object.entries(fields).map(([k,value])=>[k,{stringValue:value}]))})});assert.ok(res.ok);};
 const gid='calendar-'+name+'-'+role;
 await v.waitForFunction(expected=>window.integraticumUser.displayName===expected,'Test '+role+' '+name);
 await seed('users/'+observerUid,{role,name:'Test '+role+' '+name,email:name+'-'+role+'@example.test'});await seed('groups/'+gid,{ownerUid:role==='teacher'?observerUid:uid,name:'Calendar test',level:'A1',code:gid});
 if(role==='student')await seed('memberships/'+gid+'_'+observerUid,{groupId:gid,uid:observerUid});
 await v.reload();await v.waitForFunction(r=>window.integraticumCourse?.accountProfile()?.role===r&&window.integraticumCourse.hasMembership(),role,{timeout:60000});await v.evaluate(()=>go('notifications'));
}
await p.locator('#calType').selectOption('holiday');await p.locator('#calNote').fill('Browser holiday '+name);
const calendarDialogs=[];p.on('dialog',async d=>{calendarDialogs.push(d.message());await d.accept();});
const calendarBefore=await p.evaluate(()=>Object.fromEntries(['calType','calStart','calEnd','calGroup','calNote'].map(id=>[id,document.getElementById(id).value])));
console.log(name+': calendar form before save '+JSON.stringify(calendarBefore));
await p.getByRole('button',{name:'Сохранить',exact:true}).click();
try{await p.getByText('Browser holiday '+name,{exact:false}).first().waitFor({timeout:15000});}catch(e){const remote=await fetch('http://127.0.0.1:8080/v1/projects/demo-integraticum/databases/(default)/documents/calendarEvents',{headers:{Authorization:'Bearer owner'}});console.log(name+': calendar diagnostic '+JSON.stringify({dialogs:calendarDialogs,remote:await remote.json(),client:await p.evaluate(()=>window.integraticumCourse.calendarEvents())}));throw e;}
await q.waitForFunction(note=>window.integraticumCourse.calendarEvents().some(e=>e.note===note),'Browser holiday '+name,{timeout:60000});
for(const {v} of observers){await v.getByText('Browser holiday '+name,{exact:false}).first().waitFor({timeout:60000});assert.ok(await v.evaluate(()=>unreadCalendar()>0));}
await observers[0].v.getByRole('button',{name:'Отметить прочитанными',exact:true}).click();assert.equal(await observers[0].v.evaluate(()=>unreadCalendar()),0);assert.ok(await observers[1].v.evaluate(()=>unreadCalendar()>0));
await p.evaluate(()=>go('notifications'));
await p.getByText('Browser holiday '+name,{exact:false}).first().waitFor();
assert.ok(await p.evaluate(()=>unreadCalendar()>0&&!document.getElementById('notificationDot').hidden));
await p.getByRole('button',{name:'Отметить прочитанными',exact:true}).click();
assert.equal(await p.evaluate(()=>unreadCalendar()),0);
await p.reload();await p.waitForFunction(()=>window.integraticumUser&&calendarNotices().length>0);
assert.equal(await p.evaluate(()=>unreadCalendar()),0);
await p.getByRole('button',{name:'Открыть календарь',exact:true}).click();
await p.getByRole('button',{name:'Изменить',exact:true}).last().click();await p.locator('#calNote').fill('Updated holiday '+name);await p.getByRole('button',{name:'Сохранить',exact:true}).click();
await q.waitForFunction(note=>window.integraticumCourse.calendarEvents().some(e=>e.note===note),'Updated holiday '+name,{timeout:60000});
for(const {v} of observers){await v.getByText('Updated holiday '+name,{exact:false}).first().waitFor({timeout:60000});assert.ok(await v.evaluate(()=>unreadCalendar()>0));}
await p.waitForFunction(()=>unreadCalendar()>0);
await p.evaluate(()=>go('notifications'));
await p.getByText('Updated holiday '+name,{exact:false}).first().waitFor();
await p.getByRole('button',{name:'Открыть календарь',exact:true}).click();
await p.getByRole('button',{name:'Удалить',exact:true}).last().click();
await q.waitForFunction(note=>!window.integraticumCourse.calendarEvents().some(e=>e.note===note),'Updated holiday '+name,{timeout:60000});
console.log(name+': calendar month navigation, UI create edit delete and second profile synchronization passed');
assert.equal(await p.evaluate(()=>unreadCalendar()),0);
console.log(name+': calendar notifications, read persistence, edited event unread and deletion passed');
for(const {v} of observers)await v.waitForFunction(note=>!calendarNotices().some(e=>e.note===note),'Updated holiday '+name,{timeout:60000});
console.log(name+': distinct student and teacher accounts received calendar notices and independent read status');
const studentPage=observers.find(x=>x.role==='student').v;
const teacherPage=observers.find(x=>x.role==='teacher').v;
const studentUid=await studentPage.evaluate(()=>window.integraticumUser.uid);
const teacherUid=await teacherPage.evaluate(()=>window.integraticumUser.uid);
for(const learner of [studentPage,teacherPage]){
 await learner.evaluate(()=>go('account'));
 assert.equal(await learner.getByRole('button',{name:'Управление',exact:true}).count(),0);
 for(const route of ['admin','adminUsers','adminGroups','adminSets','adminActivity']){
  await learner.evaluate(route=>go(route),route);
  await learner.getByText('Раздел доступен сотрудникам с соответствующими правами.').waitFor();
 }
}
await p.evaluate(()=>go('account'));
await p.getByRole('button',{name:'Управление',exact:true}).click();
await p.getByRole('heading',{name:'Управление',exact:true}).waitFor();
for(const [width,height] of [[390,844],[768,1024],[1440,900]]){
 await p.setViewportSize({width,height});
 for(const section of ['Пользователи','Группы','Наборы','Активность','Календарь']){
  await p.locator('#view').getByRole('button',{name:section,exact:true}).click();
  await p.locator('#view h1').waitFor();
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2),
   name+' '+width+'px: overflow in '+section);
  await p.evaluate(()=>go('admin'));
 }
}
await p.getByRole('button',{name:'Пользователи',exact:true}).click();
await p.getByRole('heading',{name:`Test student ${name}`,exact:true}).waitFor();
assert.equal(await p.getByRole('button',{name:'Добавить пользователя',exact:true}).count(),0);
const searchInput=p.locator('#adminUserSearch');
await searchInput.fill(`Test student ${name}`);
assert.equal(await p.locator('.admin-user').count(),1);
await searchInput.fill(`${name}-student@example.test`);
assert.equal(await p.locator('.admin-user').count(),1);
await p.locator('#adminUserRole').selectOption('teacher');
assert.equal(await p.locator('.admin-user').count(),0);
await p.locator('#adminUserRole').selectOption('student');
const studentCard=p.locator('.admin-user');
await studentCard.locator('select').selectOption('teacher');
await studentCard.getByRole('button',{name:'Изменить роль',exact:true}).click();
await studentPage.waitForFunction(()=>window.integraticumCourse.accountProfile().role==='teacher');
await p.getByText('Роль изменена.',{exact:true}).waitFor();
await p.locator('#adminUserRole').selectOption('teacher');
await studentCard.locator('select').selectOption('student');
await studentCard.getByRole('button',{name:'Изменить роль',exact:true}).click();
await studentPage.waitForFunction(()=>window.integraticumCourse.accountProfile().role==='student');
const teacherEmail=`${name}-teacher@example.test`;
await p.getByRole('button',{name:'Управление',exact:true}).click();
await p.getByRole('button',{name:'Группы',exact:true}).click();
const groupName=`Группа администратора ${name}`;
await p.locator('#groupName').fill(groupName);
await p.getByRole('button',{name:'Создать группу',exact:true}).click();
await p.getByRole('button',{name:groupName,exact:true}).click();
const code=await p.getByText('Код группы',{exact:false}).locator('strong').textContent();
await p.locator('#adminTeacher').selectOption(teacherUid);
await p.getByRole('button',{name:'Назначить',exact:true}).click();
await p.getByText(teacherEmail,{exact:true}).waitFor();
await teacherPage.evaluate(()=>window.integraticumCourse.reload());
await teacherPage.evaluate(()=>go('courses'));
await teacherPage.getByRole('button',{name:groupName,exact:true}).waitFor();
await studentPage.evaluate(()=>openCourseSection('courseJoin'));
await studentPage.evaluate(()=>window.integraticumCourse.reload());
await studentPage.locator('#joinCode').fill(code);
await studentPage.getByRole('button',{name:'Отправить заявку',exact:true}).click();
await p.locator('#courseRequests').getByRole('button',{name:'Принять',exact:true}).click();
await p.locator('#selectedCourseDetails').getByText(`Test student ${name}`,{exact:true}).waitFor();
await studentPage.evaluate(()=>openCourseSection('courseOwnRequests'));
await studentPage.getByText(groupName+': Принята',{exact:true}).waitFor();
await studentPage.evaluate(()=>{
 startSession(['c0'],'recall');
 finishRecall(true);
});
const groupId=await teacherPage.getByRole('button',{name:groupName,exact:true}).getAttribute('data-id');
await p.getByRole('button',{name:'Управление',exact:true}).click();
await p.getByRole('button',{name:'Активность',exact:true}).click();
await p.locator('#adminActivityGroup').selectOption(groupId);
const waitForActivity=async view=>{
 for(let i=0;i<15;i++){
  await view.locator('#activityExercises').waitFor();
  if(await view.locator('#activityExercises').textContent()==='1')return;
  await new Promise(resolve=>setTimeout(resolve,600));
  await view.evaluate(()=>window.integraticumCourse.reloadManagement());
 }
 throw Error('Expected one cloud-saved exercise in group');
};
await waitForActivity(p);
assert.equal(await p.locator('#activityActive').textContent(),'1');
assert.equal(await p.locator('#activityWords').textContent(),'1');
await teacherPage.getByRole('button',{name:groupName,exact:true}).click();
await teacherPage.getByRole('button',{name:'Активность группы',exact:true}).click();
await waitForActivity(teacherPage);
assert.equal(await teacherPage.locator('#adminActivityGroup').count(),0);
await teacherPage.getByText('Упражнений 1 · Изучаемых слов 1',{exact:true}).waitFor();
await teacherPage.evaluate(()=>{
 data.sets.push({id:'test-publication',name:'Материал для модерации',level:'A1',wordIds:['c0']});
 save();
 openCourseSection('coursePublish');
});
await teacherPage.locator('#publishSet').selectOption('test-publication');
await teacherPage.getByRole('button',{name:'Опубликовать копию',exact:true}).click();
await teacherPage.getByText('Копия набора опубликована.',{exact:true}).waitFor();
await p.getByRole('button',{name:'Управление',exact:true}).click();
await p.getByRole('button',{name:'Наборы',exact:true}).click();
const publication=p.getByRole('article').filter({has:p.getByRole('heading',{name:'Материал для модерации',exact:true})});
await publication.getByText('Общий доступ',{exact:true}).waitFor();
await publication.getByRole('button',{name:'Снять с публикации',exact:true}).click();
await p.getByText('Набор снят с публикации.',{exact:true}).waitFor();
await publication.waitFor({state:'detached'});
assert.ok(await teacherPage.evaluate(()=>data.sets.some(set=>set.id==='test-publication')));
await p.getByRole('button',{name:'Управление',exact:true}).click();
await p.getByRole('button',{name:'Группы',exact:true}).click();
await p.getByRole('button',{name:groupName,exact:true}).click();
await p.getByRole('button',{name:'Отозвать доступ',exact:true}).click();
await p.getByText('Доступ преподавателя отозван.',{exact:true}).waitFor();
await teacherPage.evaluate(()=>window.integraticumCourse.reload());
await teacherPage.evaluate(()=>{go('account');go('courses');});
await teacherPage.getByRole('heading',{name:'Учебные группы',exact:true}).waitFor();
assert.equal(await teacherPage.getByRole('button',{name:groupName,exact:true}).count(),0);
await p.locator('#selectedCourseDetails').getByRole('button',{name:'Удалить из группы',exact:true}).click();
await p.getByText('Ученик удалён из группы.',{exact:true}).waitFor();
assert.equal(await studentPage.evaluate(()=>window.integraticumUser.uid),studentUid);
console.log(name+': administrator permissions, profiles, role changes, group management, set moderation, activity and responsive layout passed');
}finally{for(const {ctx} of observers)await ctx.close();}





}finally{await second?.close();await rm(secondDir,{recursive:true,force:true});}}finally{await context?.close();await rm(dir,{recursive:true,force:true});}
}}finally{server.close();}
