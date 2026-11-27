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

  it('rejects invalid cityId query parameters, empty ask questions, and out-of-range coordinates', async () => {
    const badCity = await request(app).get('/api/community/reports?cityId=bad-city!');
    expect(badCity.status).toBe(400);

    const emptyAsk = await request(app).post('/api/ask').send({
      question: '   ',
      household: validHousehold,
    });
    expect(emptyAsk.status).toBe(400);

    const badCoords = await request(app).post('/api/emergency/resources').send({
      lat: 120,
      lng: 77.2,
      cityName: 'Delhi NCR',
    });
    expect(badCoords.status).toBe(400);
  });

  it('enforces sliding-window rate limits on guarded endpoints', async () => {
    const limitedApp = createApiApp({ rateLimitMax: 2 });
    const reqBody = {
      cityId: 'delhi_mayur_vihar',
      category: 'smoke',
      severity: 'mild',
      note: 'Light smoke test',
    };

    const r1 = await request(limitedApp).post('/api/community/reports').send(reqBody);
    const r2 = await request(limitedApp).post('/api/community/reports').send(reqBody);
    const r3 = await request(limitedApp).post('/api/community/reports').send(reqBody);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.body.error).toMatch(/Too many requests/i);
  });
});
