const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const {
  collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction,
  serverTimestamp, setDoc, updateDoc, where, writeBatch,
} = require('firebase/firestore');

async function main() {
  const rules = readFileSync(join(__dirname, 'firestore.rules'), 'utf8');
  const env = await initializeTestEnvironment({ projectId:'demo-integraticum', firestore:{rules} });
  try {
    await env.clearFirestore();
    const owner = env.authenticatedContext('owner').firestore();
    const otherOwner = env.authenticatedContext('otherOwner').firestore();
    const teacher = env.authenticatedContext('teacher', {email:'teacher@example.com',email_verified:true}).firestore();
    const rival = env.authenticatedContext('rival', {email:'rival@example.com',email_verified:true}).firestore();
    const student = env.authenticatedContext('student', {email:'student@example.com'}).firestore();
    const legacyStudent = env.authenticatedContext('legacyStudent', {email:'legacy@example.com'}).firestore();
    const guest = env.unauthenticatedContext().firestore();
    const invite = (db, key) => doc(db, 'groupTeacherInvites', key);
    const grant = (db, id = 'group1_teacher') => doc(db, 'groupCoTeachers', id);
    const invitations = db => collection(db, 'groupTeacherInvites');
    const grants = db => collection(db, 'groupCoTeachers');
    const key = 'TCH-' + 'A'.repeat(32);
    const canceled = 'TCH-' + 'B'.repeat(32);
    const requestId = 'group1_student';
    const application = db => doc(db, 'joinRequests', requestId);
    const membership = db => doc(db, 'memberships', requestId);
    const sets = (db, groupId) => query(collection(db,'courseSets'),where('groupId','==',groupId),where('visibility','==','group'));

    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db,'users','owner'),{role:'super_admin'}),
        setDoc(doc(db,'users','otherOwner'),{role:'teacher'}),
        setDoc(doc(db,'groups','group1'),{ownerUid:'owner',name:'Deutsch A1',code:'INT-STUDENT'}),
        setDoc(doc(db,'groups','group2'),{ownerUid:'otherOwner',name:'Deutsch A2'}),
        setDoc(doc(db,'groups','group1_extra'),{ownerUid:'otherOwner'}),
        setDoc(doc(db,'courseSets','private1'),{visibility:'group',groupId:'group1',ownerUid:'owner'}),
        setDoc(doc(db,'courseSets','private2'),{visibility:'group',groupId:'group2',ownerUid:'otherOwner'}),
        setDoc(doc(db,'courseSets','public'),{visibility:'public',ownerUid:'owner'}),
      ]);
    });
    // Original owner/student workflow with the rules supplied by the project owner.
    assert.equal((await assertSucceeds(getDoc(doc(owner,'users','owner')))).data().role,'super_admin');
    await assertFails(setDoc(doc(student,'users','student'),{role:'teacher'}));
    const legacyGroup = {ownerUid:'owner',name:'Legacy A1',level:'A1',code:'INT-LEGACY',createdAt:serverTimestamp()};
    await assertSucceeds(setDoc(doc(owner,'groups','legacy'),legacyGroup));
    await assertFails(setDoc(doc(legacyStudent,'groups','legacy-student'),{...legacyGroup,ownerUid:'legacyStudent'}));
    const legacyRequest = db=>doc(db,'joinRequests','legacy_legacyStudent');
    const legacyMember = db=>doc(db,'memberships','legacy_legacyStudent');
    assert.equal((await assertSucceeds(getDoc(doc(legacyStudent,'groups','legacy')))).data().code,'INT-LEGACY');
    await assertSucceeds(setDoc(legacyRequest(legacyStudent),{
      groupId:'legacy',studentUid:'legacyStudent',studentEmail:'legacy@example.com',
      studentName:'Ученик',status:'pending',createdAt:serverTimestamp(),
    }));
    assert.equal((await assertSucceeds(getDocs(query(collection(owner,'joinRequests'),where('groupId','==','legacy'))))).size,1);
    await assertSucceeds(setDoc(legacyMember(owner),{groupId:'legacy',uid:'legacyStudent',joinedAt:serverTimestamp()}));
    await assertSucceeds(updateDoc(legacyRequest(owner),{status:'approved'}));
    assert.equal((await assertSucceeds(getDoc(legacyRequest(legacyStudent)))).data().status,'approved');
    assert.equal((await assertSucceeds(getDocs(query(collection(legacyStudent,'memberships'),where('uid','==','legacyStudent'))))).size,1);
    const legacySet = doc(owner,'courseSets','legacy-private');
    const legacyMaterial = {groupId:'legacy',visibility:'group',name:'Legacy',ownerUid:'owner',words:[],createdAt:serverTimestamp()};
    await assertSucceeds(setDoc(legacySet,legacyMaterial));
    assert.equal((await assertSucceeds(getDocs(query(collection(legacyStudent,'courseSets'),where('groupId','==','legacy'))))).size,1);
    await assertSucceeds(deleteDoc(legacySet));
    const sharedSet = doc(owner,'courseSets','legacy-public');
    await assertSucceeds(setDoc(sharedSet,{...legacyMaterial,visibility:'public',groupId:''}));
    await assertSucceeds(getDoc(doc(legacyStudent,'courseSets','legacy-public')));
    await assertSucceeds(deleteDoc(sharedSet));

    const newInvite = {groupId:'group1',ownerUid:'owner',status:'open',createdAt:serverTimestamp()};
    const claim = {status:'pending',teacherUid:'teacher',teacherEmail:'teacher@example.com',emailVerified:true};
    const newGrant = {groupId:'group1',ownerUid:'owner',uid:'teacher',email:'teacher@example.com',inviteCode:key,createdAt:serverTimestamp()};

    await assertFails(getDocs(sets(teacher,'group1')));
    await assertFails(setDoc(invite(otherOwner,key),{...newInvite,ownerUid:'otherOwner'}));
    await assertFails(setDoc(invite(owner,'INT-STUDENT'),newInvite));
    await assertSucceeds(setDoc(invite(owner,canceled),newInvite));
    await assertSucceeds(deleteDoc(invite(owner,canceled)));
    await assertFails(getDoc(invite(teacher,canceled)));
    await assertSucceeds(setDoc(invite(owner,key),newInvite));
    await assertFails(getDoc(invite(guest,key)));
    await assertFails(getDocs(invitations(teacher)));
    await assertFails(getDocs(query(invitations(teacher),where('groupId','==','group1'))));
    assert.equal((await assertSucceeds(getDocs(query(invitations(owner),where('ownerUid','==','owner'))))).size,1);
    await assertFails(updateDoc(invite(owner,key),{...claim,teacherUid:'owner',teacherEmail:'',emailVerified:false}));
    await assertFails(updateDoc(invite(rival,key),claim));
    await assertFails(updateDoc(invite(teacher,key),{...claim,teacherEmail:'spoof@example.com'}));
    await assertFails(updateDoc(invite(teacher,key),{...claim,groupId:'group2'}));

    await assertSucceeds(runTransaction(teacher, async transaction => {
      assert.equal((await transaction.get(invite(teacher,key))).data().status,'open');
      transaction.update(invite(teacher,key),claim);
    }));
    await assertFails(updateDoc(invite(rival,key),{...claim,teacherUid:'rival',teacherEmail:'rival@example.com'}));
    await assertFails(setDoc(grant(teacher),newGrant));
    await assertFails(setDoc(grant(owner),newGrant));
    await assertFails(updateDoc(invite(owner,key),{status:'accepted'}));
    assert.equal((await assertSucceeds(getDocs(query(grants(teacher),where('uid','==','teacher'))))).size,0);

    await assertSucceeds(runTransaction(owner, async transaction => {
      assert.equal((await transaction.get(invite(owner,key))).data().status,'pending');
      transaction.set(grant(owner),newGrant);
      transaction.update(invite(owner,key),{status:'accepted'});
    }));
    assert.equal((await assertSucceeds(getDocs(query(grants(teacher),where('uid','==','teacher'))))).size,1);
    assert.equal((await assertSucceeds(getDocs(query(grants(owner),where('ownerUid','==','owner'))))).size,1);
    await assertFails(getDoc(grant(otherOwner)));
    await assertFails(deleteDoc(grant(teacher)));
    await assertFails(deleteDoc(grant(otherOwner)));
    await assertFails(setDoc(invite(teacher,canceled),{...newInvite,ownerUid:'teacher'}));
    assert.equal((await assertSucceeds(getDocs(sets(teacher,'group1')))).size,1);
    await assertFails(getDocs(sets(teacher,'group2')));
    await assertFails(getDoc(doc(env.authenticatedContext('extra_teacher').firestore(),'courseSets','private1')));
    await assertSucceeds(getDoc(doc(student,'courseSets','public')));

    await assertSucceeds(setDoc(application(student),{groupId:'group1',studentUid:'student',studentEmail:'student@example.com',studentName:'Ученик',status:'pending',createdAt:serverTimestamp()}));
    assert.equal((await assertSucceeds(getDocs(query(collection(teacher,'joinRequests'),where('groupId','==','group1'))))).size,1);
    await assertFails(getDocs(query(collection(teacher,'joinRequests'),where('groupId','==','group2'))));
    await assertFails(updateDoc(application(teacher),{status:'approved'}));
    const membershipData = {groupId:'group1',uid:'student',joinedAt:serverTimestamp()};
    await assertFails(setDoc(membership(teacher),membershipData));
    const batch = writeBatch(teacher);
    batch.set(membership(teacher),membershipData);
    batch.update(application(teacher),{status:'approved'});
    await assertSucceeds(batch.commit());

    const material = doc(teacher,'courseSets','private-new');
    const materialData = {groupId:'group1',visibility:'group',ownerUid:'teacher',coTeacherPublished:true,name:'Neue Wörter',words:[],createdAt:serverTimestamp()};
    await assertFails(setDoc(material,{...materialData,visibility:'public'}));
    await assertFails(setDoc(material,{...materialData,groupId:'group2'}));
    await assertFails(setDoc(material,{...materialData,ownerUid:'owner'}));
    const {coTeacherPublished,...oldFormat}=materialData;
    await assertFails(setDoc(material,oldFormat));
    await assertSucceeds(setDoc(material,materialData));
    const disposable = doc(teacher,'courseSets','private-disposable');
    await assertSucceeds(setDoc(disposable,materialData));
    await assertSucceeds(deleteDoc(disposable));
    await assertFails(deleteDoc(doc(teacher,'courseSets','private1')));

    await assertSucceeds(deleteDoc(grant(owner)));
    assert.equal((await assertSucceeds(getDocs(query(grants(teacher),where('uid','==','teacher'))))).size,0);
    await assertFails(getDoc(doc(teacher,'courseSets','private1')));
    await assertFails(getDocs(query(collection(teacher,'joinRequests'),where('groupId','==','group1'))));
    await assertFails(deleteDoc(material));
    assert.equal((await assertSucceeds(getDoc(doc(owner,'courseSets','private-new')))).data().name,'Neue Wörter');
    await assertSucceeds(getDoc(doc(student,'courseSets','private-new')));
    await assertFails(setDoc(doc(teacher,'courseSets','after-revocation'),materialData));
    await assertFails(updateDoc(invite(teacher,key),claim));
    await assertFails(setDoc(grant(owner),newGrant));
    await assertSucceeds(getDoc(doc(teacher,'courseSets','public')));
    console.log('PASS: private one-time codes, owner approval and cancellation, atomic grants, scoped co-teaching, student approval, legacy student invitations, legacy publishing, revocation.');
  } finally {
    await env.cleanup();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
