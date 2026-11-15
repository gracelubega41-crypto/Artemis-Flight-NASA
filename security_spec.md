# Artemis Flight Academy — Security Specification & Invariants

## 1. Data Invariants
1. **Identity Integrity**: Every user-owned document (`users/{userId}`, `simulations/{runId}`, `credentials/{credentialId}`, `certifications/{reportId}`, `auditLogs/{logId}`) must bind `uid` or `userId` strictly to `request.auth.uid` on creation by non-admin users.
2. **Privilege Escalation Prevention**: A trainee cannot self-assign `role: 'instructor'` or `clearanceTier: 'FLIGHT_DIRECTOR'` during profile creation or updates. Only verified Flight Directors (`gracelubega41@gmail.com` or `/admins/{uid}`) may promote clearance tiers or revoke credentials.
3. **PII Isolation**: User email addresses and instructor assignments live strictly under `/users/{userId}/private/{docId}`, readable and writable only by the owning user or verified Flight Director.
4. **Temporal Integrity**: All `createdAt` and `updatedAt` fields must match `request.time` (enforced via `serverTimestamp()`).
5. **Immutable Regulatory Audit Trail**: `auditLogs` are strictly append-only (`allow update, delete: if false`).
6. **Terminal Credential Revocation**: Once a `FlightCredential` reaches `status == 'REVOKED'`, it cannot be reactivated or modified.

## 2. Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Shadow Field Injection**: Creating a `SimulationRun` with an extra `isVerified: true` field -> blocked by `keys().hasOnly(...)`.
2. **Role Self-Escalation**: Trainee creating `/users/{uid}` with `role: "instructor"` -> blocked by `incoming().role == 'trainee'`.
3. **Clearance Tier Forgery**: Trainee updating `/users/{uid}` to `clearanceTier: "COMMANDER"` -> blocked by `affectedKeys().hasOnly(...)` + role check.
4. **Unverified Email Spoofing**: Request with matching admin email where `email_verified == false` -> blocked by `request.auth.token.email_verified == true`.
5. **Cross-User PII Scraping**: Trainee `B` reading `/users/A/private/info` -> blocked by `request.auth.uid == userId || isAdmin()`.
6. **Unbounded String Poisoning**: Injecting a 10KB string into `runId` or `callsign` -> blocked by `isValidId()` and `.size()` limits.
7. **Timestamp Spoofing**: Sending client-forged `createdAt` Date instead of `serverTimestamp()` -> blocked by `incoming().createdAt == request.time`.
8. **Orphaned / Spoofed Ownership**: Trainee `A` creating a `SimulationRun` with `userId: "trainee_B"` -> blocked by `incoming().userId == request.auth.uid`.
9. **Audit Log Tampering**: Any user or admin attempting `update` or `delete` on `/auditLogs/{logId}` -> blocked by `allow update, delete: if false`.
10. **Credential Reactivation**: Attempting to change a `REVOKED` `FlightCredential` back to `ACTIVE` -> blocked by terminal state lock `existing().status == 'ACTIVE'`.
11. **Direct Client Mutation of Outcome After Lock**: Attempting to mutate `outcome` or `safetyScore` on a completed `SimulationRun` -> blocked (`allow update: if false` for non-admin, immutable telemetry).
12. **Blanket Collection Scraping**: Attempting `list` on `/simulations` without `where('userId', '==', uid)` -> blocked by `resource.data.userId == request.auth.uid || resource.data.instructorEmail == request.auth.token.email`.
