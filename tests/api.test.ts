import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApiApp } from '../src/server/app.ts';
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

describe('Express API routes & security headers', () => {
  const app = createApiApp({ disableRateLimit: true });

  it('returns health status with hardened HTTP headers and without x-powered-by', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('executes deterministic digital twin and indoor box simulation endpoints', async () => {
    const twinRes = await request(app).post('/api/twin/simulate').send({
      presetId: 'metro_vs_auto',
      ambientPm25: 298,
      roomSqft: 140,
      durationMin: 35,
      purifierHours: 4,
      roomSealed: true,
    });
    expect(twinRes.status).toBe(200);
    expect(twinRes.body.co2Defensible).toBe(true);

    const badIndoor = await request(app).post('/api/indoor/simulate').send({
      outdoorPm25: -10,
      roomSqft: 140,
      sealGaps: true,
      stopIncense: true,
      coverCooking: true,
      diyBoxFan: false,
      hepaPurifier: false,
    });
    expect(badIndoor.status).toBe(400);
  });

  it('redacts PII and clusters corroborating community pulse reports within 45 minutes', async () => {
    const first = await request(app).post('/api/community/reports').send({
      cityId: 'kolkata_salt_lake',
      category: 'smoke',
      severity: 'severe',
      note: 'Dense smoke near sector gate call 9988776655',
    });
    expect(first.status).toBe(201);
    expect(first.body.report.note).toContain('[redacted-phone]');
    expect(first.body.report.corroborations).toBe(1);

    const second = await request(app).post('/api/community/reports').send({
      cityId: 'kolkata_salt_lake',
      category: 'smoke',
      severity: 'severe',
      note: 'Same smoke plume still visible',
    });
    expect(second.status).toBe(200);
    expect(second.body.clustered).toBe(true);
    expect(second.body.report.corroborations).toBe(2);
  });

  it('triggers pre-LLM emergency gate before any Gemini API call', async () => {
    const res = await request(app).post('/api/ask').send({
      question: 'My mother has chest pain and shortness of breath right now',
      household: validHousehold,
    });
    expect(res.status).toBe(200);
    expect(res.body.emergencyTriggered).toBe(true);
    expect(res.body.answer).toContain('112');
  });

  it('rejects invalid agent payloads with 400', async () => {
    const res = await request(app).post('/api/agents/run').send({
      agentId: 'non_existent_agent',
      household: validHousehold,
    });
    expect(res.status).toBe(400);
  });
});
