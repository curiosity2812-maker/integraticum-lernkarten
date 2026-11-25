import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,deleteDoc,getDoc,getDocs,collection,query,where,writeBatch,serverTimestamp,runTransaction,getDocFromServer} from 'firebase/firestore';
import {readFileSync} from 'node:fs';
const env=await initializeTestEnvironment({projectId:'demo-integraticum',firestore:{rules:readFileSync('firestore.rules','utf8')}});
const db=u=>env.authenticatedContext(u,{email:u+'@example.com'}).firestore();
const ref=(u,p)=>doc(db(u),p);
const app='joinRequests/g_student',mem='memberships/g_student';
try {
await env.withSecurityRulesDisabled(async c=>{const d=c.firestore();for(const [p,v] of Object.entries({'users/owner':{role:'teacher'},'users/co':{role:'teacher'},'users/other':{role:'teacher'},'groups/g':{ownerUid:'owner'},'groups/g/teachers/co':{},'courseSets/private':{visibility:'group',groupId:'g'}}))await setDoc(doc(d,p),v);});
await assertSucceeds(getDoc(ref('student',app)));
await assertSucceeds(setDoc(ref('student',app),{groupId:'g',studentUid:'student',studentEmail:'student@example.com',studentName:'Student',status:'pending',createdAt:serverTimestamp()}));
await assertFails(updateDoc(ref('student',app),{status:'approved'}));
await assertFails(getDoc(ref('other',app)));
await assertSucceeds(getDocs(query(collection(db('co'),'joinRequests'),where('groupId','==','g'))));
await assertFails(getDocs(query(collection(db('other'),'joinRequests'),where('groupId','==','g'))));
await assertSucceeds(updateDoc(ref('owner',app),{status:'rejected'}));
await assertSucceeds(updateDoc(ref('student',app),{status:'pending'}));
await assertFails(setDoc(ref('student',mem),{groupId:'g',uid:'student',joinedAt:serverTimestamp()}));
const d=db('co'),b=writeBatch(d);b.set(doc(d,mem),{groupId:'g',uid:'student',joinedAt:serverTimestamp()});b.update(doc(d,app),{status:'approved'});await assertSucceeds(b.commit());
await assertSucceeds(getDoc(ref('student','courseSets/private')));
await assertFails(deleteDoc(ref('other',mem)));
await assertFails(deleteDoc(ref('student',mem)));
await assertSucceeds(deleteDoc(ref('owner',mem)));
await assertFails(getDoc(ref('student','courseSets/private')));
const sd=db('student'), sr=doc(sd,app);
await assertSucceeds(runTransaction(sd,async tx=>{const old=await tx.get(sr);if(old.data().status!=='approved')throw Error('Expected approved');tx.update(sr,{status:'pending'});}));
const verified=await assertSucceeds(getDocFromServer(sr));if(verified.data().status!=='pending')throw Error('Expected pending');
await assertFails(setDoc(ref('student','users/student'),{role:'teacher'}));
await env.withSecurityRulesDisabled(async c=>{const d=c.firestore();await setDoc(doc(d,'joinRequests/g_legacy'),{groupId:'g',studentUid:'legacy',studentEmail:'old@example.com',studentName:'Legacy',status:'approved',extra:'legacy field'});await setDoc(doc(d,'joinRequests/g_mismatch'),{groupId:'g',studentUid:'different',status:'approved'});await setDoc(doc(d,'joinRequests/g_member'),{groupId:'g',studentUid:'member',status:'approved'});await setDoc(doc(d,'memberships/g_member'),{groupId:'g',uid:'member'});});
for(const [uid,allowed] of [['legacy',true],['mismatch',false],['member',false]]){const d=db(uid),r=doc(d,'joinRequests/g_'+uid);const op=runTransaction(d,async tx=>{await tx.get(r);tx.update(r,{status:'pending'});});await (allowed?assertSucceeds(op):assertFails(op));}
const noEmail=env.authenticatedContext('noemail').firestore();const nr=doc(noEmail,'joinRequests/g_noemail');const payload={groupId:'g',studentUid:'noemail',studentName:'Student',status:'pending',createdAt:serverTimestamp()};await assertFails(setDoc(nr,{...payload,studentEmail:'fake@example.com'}));await assertSucceeds(setDoc(nr,{...payload,studentEmail:''}));const progress='personalProgress/student/answers/event1';
const answer={id:'word1',ok:false,mode:'typing',partial:false,errorType:'spelling',at:Date.now()};
await assertSucceeds(setDoc(ref('student',progress),answer));
await assertSucceeds(getDoc(ref('student',progress)));
await assertSucceeds(getDocs(collection(db('student'),'personalProgress/student/answers')));
for(const uid of ['other','owner','co']){await assertFails(getDoc(ref(uid,progress)));await assertFails(getDocs(collection(db(uid),'personalProgress/student/answers')));await assertFails(setDoc(ref(uid,'personalProgress/student/answers/forged'),answer));}
await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),progress)));
await assertFails(updateDoc(ref('student',progress),{ok:true}));
await assertFails(deleteDoc(ref('student',progress)));
await assertFails(setDoc(ref('student','personalProgress/student/answers/bad'),{...answer,mode:'invalid'}));
await assertSucceeds(setDoc(ref('other','personalProgress/other/answers/event1'),answer));
const workspace='personalProgress/student/workspace/sets%3As1';
const item={kind:'sets',key:'s1',payload:JSON.stringify({id:'s1',name:'Test',wordIds:['word1']}),deleted:false};
await assertSucceeds(setDoc(ref('student',workspace),item));
await assertSucceeds(getDoc(ref('student',workspace)));
await assertSucceeds(getDocs(collection(db('student'),'personalProgress/student/workspace')));
await assertSucceeds(setDoc(ref('student',workspace),{...item,payload:'',deleted:true}));
for(const uid of ['other','owner','co']){await assertFails(getDoc(ref(uid,workspace)));await assertFails(setDoc(ref(uid,workspace),item));await assertFails(getDocs(collection(db(uid),'personalProgress/student/workspace')));}
await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),workspace)));
await assertFails(setDoc(ref('student',workspace),{...item,kind:'role'}));
await assertFails(setDoc(ref('student',workspace),{...item,payload:123}));
await assertFails(deleteDoc(ref('student',workspace)));

const html=readFileSync('index.html','utf8');
const resolver=new Function(html.slice(html.indexOf(' function workspaceEqual('),html.indexOf(' function workspaceFlush('))+';return workspaceResolve;')();
const first=db('student'),second=db('student'),root='personalProgress/student/workspace';
const original={kind:'sets',key:'concurrent',payload:JSON.stringify({id:'concurrent',name:'Original'}),deleted:false};
await setDoc(doc(first,root,'concurrent'),original);
await Promise.all([first,second].map((client,i)=>runTransaction(client,async tx=>{
 const target=doc(client,root,'concurrent'),snap=await tx.get(target);
 const changed={...original,payload:JSON.stringify({id:'concurrent',name:'Edit '+i})};
 const result=resolver(changed,snap.data(),original,'conflict-'+i);
 tx.set(target,result.main);if(result.copy)tx.set(doc(client,root,result.copy.key),result.copy);
})));
const concurrent=(await getDocs(collection(first,root))).docs.map(d=>d.data()).filter(x=>x.key==='concurrent'||x.key.startsWith('conflict-')).map(x=>JSON.parse(x.payload).name);
if(concurrent.length!==2||!concurrent.some(x=>x.startsWith('Edit 0'))||!concurrent.some(x=>x.startsWith('Edit 1')))throw Error('Concurrent edit lost');
for(let batch=0;batch<4;batch++){const writes=writeBatch(first);for(let i=0;i<250;i++){const key='load-'+(batch*250+i);writes.set(doc(first,root,key),{kind:'custom',key,payload:JSON.stringify({id:key,de:'Wort '+i,ru:'слово'}),deleted:false});}await writes.commit();}
const loaded=(await getDocs(collection(second,root))).docs.filter(d=>d.id.startsWith('load-'));if(loaded.length!==1000)throw Error('Load count mismatch');
console.log('Concurrent workspace edits and 1000-card load passed');

console.log('All rule and transaction checks passed');
}finally{await env.cleanup();}
