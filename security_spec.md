# BreathEasy AI — Firestore Security Specification

## 1. Data Invariants
1. **Default-Deny Catch-All:** Any unmapped collection or document path under `/databases/{database}/documents` is denied for both read and write.
2. **Owner-Only Private Household Data (`/users/{userId}/private/{docId}`):** Only the authenticated, email-verified user whose `request.auth.uid == userId` can read, create, update, or delete their household preferences. `userId` in the document body must match `request.auth.uid`.
3. **Community Pulse Attribution & Integrity (`/communityReports/{reportId}`):**
   - Only verified signed-in users can create reports with `authorId == request.auth.uid`, initial `corroborations == 1`, `status == 'unconfirmed_single'`, `createdAt == request.time`, and `updatedAt == request.time`.
   - Updating an existing report is strictly restricted to incrementing `corroborations` by `1` (bounded `<= 500`), updating `confidence`, `status`, and `updatedAt == request.time`, with `authorId`, `cityId`, `h3Zone`, `category`, and `createdAt` immutable.
   - Deleting a report is strictly limited to its original `authorId`.
4. **Owner-Scoped Saved Briefs (`/agentBriefs/{briefId}`):** List queries and gets require `resource.data.userId == request.auth.uid` (no blanket `isSignedIn()` reads).

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated `get` / `list` on `/users/u1/private/household`.
2. Signed-in user `u2` reading `/users/u1/private/household`.
3. Signed-in user with `email_verified: false` writing `/users/u1/private/household`.
4. User `u1` creating `/users/u1/private/household` with `userId: "u2"` (Identity Spoofing).
5. User `u1` injecting shadow field `isAdmin: true` into `/users/u1/private/household` (Shadow Field Injection).
6. User `u1` using an oversized 1500-char document ID `{reportId}` (ID Poisoning / DoW).
7. User `u1` creating a `communityReports` doc with forged `corroborations: 99` and `status: "multi_source_verified"` (State Shortcutting).
8. User `u1` creating a `communityReports` doc with a 5,000-char `note` (Resource Exhaustion).
9. User `u1` mutating `authorId` or `createdAt` on an existing `communityReports` doc (Immortal Field Tampering).
10. User `u1` setting client-forged `createdAt` timestamp instead of `request.time` (Temporal Forgery).
11. User `u2` deleting `u1`'s `communityReports` doc.
12. User `u2` listing `/agentBriefs` without `userId == request.auth.uid` filter (Query Scraping).
