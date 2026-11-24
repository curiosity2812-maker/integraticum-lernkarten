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
const noEmail=env.authenticatedContext('noemail').firestore();const nr=doc(noEmail,'joinRequests/g_noemail');const payload={groupId:'g',studentUid:'noemail',studentName:'Student',status:'pending',createdAt:serverTimestamp()};await assertFails(setDoc(nr,{...payload,studentEmail:'fake@example.com'}));await assertSucceeds(setDoc(nr,{...payload,studentEmail:''}));console.log('All rule and transaction checks passed');
}finally{await env.cleanup();}
