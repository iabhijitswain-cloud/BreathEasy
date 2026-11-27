import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Firestore Security Rules & Blueprint Invariants (Dirty Dozen Guardrails)', () => {
  const rootDir = path.resolve(__dirname, '..');
  const rules = fs.readFileSync(path.join(rootDir, 'firestore.rules'), 'utf8');
  const blueprint = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'firebase-blueprint.json'), 'utf8'),
  ) as {
    entities: Record<string, { properties: Record<string, { maxLength?: number }> }>;
    firestore: Record<string, unknown>;
  };

  it('defines global default-deny catch-all at top of rules', () => {
    expect(rules).toContain("rules_version = '2';");
    expect(rules).toContain('match /{document=**}');
    expect(rules).toContain('allow read, write: if false;');
  });

  it('enforces email_verified == true and valid path IDs', () => {
    expect(rules).toContain('request.auth.token.email_verified == true');
    expect(rules).toContain('function isValidId(id)');
    expect(rules).toContain("id.matches('^[a-zA-Z0-9_\\\\-]+$')");
  });

  it('isolates household private data strictly to owner and validates keys strictly', () => {
    expect(rules).toContain('match /users/{userId}/private/{docId}');
    expect(rules).toContain('isOwner(userId)');
    expect(rules).toContain('data.keys().hasAll(');
    expect(rules).toContain('data.keys().hasOnly(');
    expect(rules).toContain('affectedKeys().hasOnly(');
  });

  it('prevents state shortcutting, temporal forgery, and blanket list scraping', () => {
    expect(rules).toContain("incoming().status == 'unconfirmed_single'");
    expect(rules).toContain('incoming().corroborations == 1');
    expect(rules).toContain('incoming().corroborations == existing().corroborations + 1');
    expect(rules).toContain('request.time');
    expect(rules).toContain('existing().userId == request.auth.uid');
    expect(rules).not.toMatch(/allow\s+list:\s*if\s+isSignedIn\(\)\s*;/);
  });

  it('keeps firebase-blueprint.json maxLength and enum constraints synchronized with rules', () => {
    const noteMax = blueprint.entities.CommunityPulseDoc.properties.note.maxLength;
    const summaryMax = blueprint.entities.SavedAgentBriefDoc.properties.summary.maxLength;
    expect(noteMax).toBe(240);
    expect(summaryMax).toBe(300);
    expect(rules).toContain('data.note.size() <= 240');
    expect(rules).toContain('data.summary.size() <= 300');
    expect(rules).toContain("'custom'");
    expect(Object.keys(blueprint.firestore)).toHaveLength(3);
  });
});
