    // Insert inside match /databases/{database}/documents.
    function coTeacherSignedIn() {
      return request.auth != null;
    }

    function ownsCoTeacherGroup(groupId) {
      return coTeacherSignedIn()
        && get(/databases/$(database)/documents/groups/$(groupId)).data.ownerUid == request.auth.uid;
    }

    function coTeacherGrantPath(groupId, uid) {
      return /databases/$(database)/documents/groupCoTeachers/$(groupId + '_' + uid);
    }

    function teacherInvitePath(code) {
      return /databases/$(database)/documents/groupTeacherInvites/$(code);
    }

    function isGroupCoTeacher(groupId) {
      return coTeacherSignedIn() && matchesCoTeacherGrant(groupId, request.auth.uid);
    }

    function matchesCoTeacherGrant(groupId, uid) {
      let grant = get(coTeacherGrantPath(groupId, uid)).data;
      return grant.groupId == groupId && grant.uid == uid;
    }

    function createsTeacherInvite(code) {
      let invite = request.resource.data;
      return code.matches('TCH-[0-9A-F]{32}')
        && invite.keys().hasOnly(['groupId', 'ownerUid', 'status', 'createdAt'])
        && invite.ownerUid == request.auth.uid
        && invite.status == 'open' && invite.createdAt == request.time
        && ownsCoTeacherGroup(invite.groupId);
    }

    function claimsTeacherInvite() {
      let invite = resource.data;
      let claim = request.resource.data;
      return invite.status == 'open' && invite.ownerUid != request.auth.uid
        && claim.diff(invite).affectedKeys().hasOnly(['status', 'teacherUid', 'teacherEmail', 'emailVerified'])
        && claim.status == 'pending' && claim.teacherUid == request.auth.uid
        && claim.teacherEmail == request.auth.token.get('email', '')
        && claim.emailVerified == request.auth.token.get('email_verified', false);
    }

    function acceptsTeacherInvite(code) {
      let invite = resource.data;
      let grant = coTeacherGrantPath(invite.groupId, invite.teacherUid);
      return invite.status == 'pending' && ownsCoTeacherGroup(invite.groupId)
        && request.resource.data.diff(invite).affectedKeys().hasOnly(['status'])
        && request.resource.data.status == 'accepted'
        && !exists(grant) && getAfter(grant).data.inviteCode == code;
    }

    match /groupTeacherInvites/{code} {
      allow get: if coTeacherSignedIn() && (resource.data.ownerUid == request.auth.uid
        || resource.data.status == 'open'
        || resource.data.get('teacherUid', '') == request.auth.uid);
      allow list: if coTeacherSignedIn() && resource.data.ownerUid == request.auth.uid;
      allow create: if coTeacherSignedIn() && createsTeacherInvite(code);
      allow update: if coTeacherSignedIn() && (claimsTeacherInvite() || acceptsTeacherInvite(code));
      allow delete: if coTeacherSignedIn() && resource.data.status in ['open', 'pending']
        && ownsCoTeacherGroup(resource.data.groupId);
    }

    function createsCoTeacherGrant(grantId) {
      let grant = request.resource.data;
      let path = teacherInvitePath(grant.inviteCode);
      let invite = get(path).data;
      return grant.keys().hasOnly(['groupId', 'ownerUid', 'uid', 'email', 'inviteCode', 'createdAt'])
        && grantId == grant.groupId + '_' + grant.uid
        && ownsCoTeacherGroup(grant.groupId)
        && grant.ownerUid == request.auth.uid
        && invite.groupId == grant.groupId && invite.ownerUid == grant.ownerUid
        && invite.teacherUid == grant.uid && invite.teacherEmail == grant.email
        && grant.createdAt == request.time
        && invite.status == 'pending' && getAfter(path).data.status == 'accepted';
    }

    match /groupCoTeachers/{grantId} {
      allow get, list: if coTeacherSignedIn()
        && (resource.data.uid == request.auth.uid || resource.data.ownerUid == request.auth.uid);
      allow create: if coTeacherSignedIn() && createsCoTeacherGrant(grantId);
      allow delete: if ownsCoTeacherGroup(resource.data.groupId);
    }

    function coTeacherApprovesStudent(joinId) {
      let application = resource.data;
      let membership = /databases/$(database)/documents/memberships/$(joinId);
      return joinId == application.groupId + '_' + application.studentUid
        && getAfter(membership).data.groupId == application.groupId
        && getAfter(membership).data.uid == application.studentUid;
    }

    match /joinRequests/{joinId} {
      allow read: if isGroupCoTeacher(resource.data.groupId);
      allow update: if isGroupCoTeacher(resource.data.groupId)
        && resource.data.status == 'pending'
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status'])
        && (request.resource.data.status == 'rejected'
          || (request.resource.data.status == 'approved' && coTeacherApprovesStudent(joinId)));
    }

    match /memberships/{membershipId} {
      allow create: if isGroupCoTeacher(request.resource.data.groupId)
        && coTeacherCreatesMembership(membershipId);
    }

    function coTeacherCreatesMembership(membershipId) {
      let member = request.resource.data;
      let path = /databases/$(database)/documents/joinRequests/$(membershipId);
      let application = get(path).data;
      return member.keys().hasOnly(['groupId', 'uid', 'joinedAt'])
        && membershipId == member.groupId + '_' + member.uid
        && member.joinedAt == request.time
        && application.status == 'pending'
        && application.groupId == member.groupId && application.studentUid == member.uid
        && getAfter(path).data.status == 'approved';
    }

    match /courseSets/{setId} {
      allow read: if resource.data.visibility == 'group' && isGroupCoTeacher(resource.data.groupId);
      allow create: if request.resource.data.visibility == 'group'
        && isGroupCoTeacher(request.resource.data.groupId)
        && request.resource.data.ownerUid == request.auth.uid
        && request.resource.data.keys().hasOnly(['name', 'level', 'ownerUid', 'ownerName', 'visibility', 'groupId', 'words', 'createdAt'])
        && request.resource.data.words is list && request.resource.data.words.size() <= 150
        && request.resource.data.name is string && request.resource.data.name.size() <= 100
        && request.resource.data.createdAt == request.time;
      allow delete: if resource.data.visibility == 'group' && isGroupCoTeacher(resource.data.groupId)
        && resource.data.ownerUid == request.auth.uid;
    }
