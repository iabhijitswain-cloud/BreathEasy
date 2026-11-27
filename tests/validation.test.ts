import { describe, expect, it } from 'vitest';
import {
  agentRunSchema,
  askSchema,
  communityReportSchema,
  redactPiiFromNote,
  twinSimulateSchema,
} from '../src/server/validation.ts';
import { CITY_PRESETS, DEFAULT_MEMBERS } from '../src/lib/deterministicEngines.ts';

const validHousehold = {
  city: CITY_PRESETS[0],
  language: 'en' as const,
  eli10: false,
  budgetTier: 'under_2000' as const,
  roomSqft: 140,
  hasPets: true,
  hasToddler: true,
  housingType: 'independent_flat' as const,
  commuteMode: 'auto_rickshaw' as const,
  schoolTime: '07:45 AM',
  members: DEFAULT_MEMBERS,
};

describe('server input validation & PII redaction', () => {
  it('redacts phone numbers and emails from community pulse notes', () => {
    const cleaned = redactPiiFromNote(
      'Smoke near gate call 9876543210 or email resident@example.com immediately',
    );
    expect(cleaned).not.toContain('9876543210');
    expect(cleaned).not.toContain('resident@example.com');
    expect(cleaned).toContain('[redacted-phone]');
    expect(cleaned).toContain('[redacted-email]');
  });

  it('rejects out-of-bounds twin simulation values', () => {
    const res = twinSimulateSchema.safeParse({
      presetId: 'metro_vs_auto',
      ambientPm25: -50,
      roomSqft: 100000,
      durationMin: 30,
      purifierHours: 4,
      roomSealed: true,
    });
    expect(res.success).toBe(false);
  });

  it('rejects unsupported image MIME types on agentRunSchema', () => {
    const res = agentRunSchema.safeParse({
      agentId: 'indoor_air',
      household: validHousehold,
      roomImageBase64: 'YWJj',
      roomImageMimeType: 'image/svg+xml',
    });
    expect(res.success).toBe(false);
  });

  it('validates clean community reports and rejects invalid categories', () => {
    expect(
      communityReportSchema.safeParse({
        cityId: 'delhi_mayur_vihar',
        category: 'garbage_burning',
        severity: 'moderate',
        note: 'Leaf smoke near park gate.',
      }).success,
    ).toBe(true);

    expect(
      communityReportSchema.safeParse({
        cityId: 'delhi-invalid!',
        category: 'unknown_event',
        severity: 'moderate',
      }).success,
    ).toBe(false);
  });

  it('rejects blank ask questions', () => {
    expect(
      askSchema.safeParse({
        question: '   ',
        household: validHousehold,
      }).success,
    ).toBe(false);
  });
});
