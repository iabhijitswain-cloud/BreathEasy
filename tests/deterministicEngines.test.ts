import { describe, expect, it } from 'vitest';
import {
  CITY_PRESETS,
  detectClinicalEmergencyDistress,
  getCleanRoomPlans,
  getCpcbVerdict,
  getDailyJourneyStages,
  getPredictiveHourlyOutlook,
  runDigitalTwinSimulation,
  runIndoorBoxSimulation,
  sanitizeHttpUrl,
} from '../src/lib/deterministicEngines.ts';

describe('deterministicEngines', () => {
  it('maps PM2.5 across all CPCB AQI tiers accurately', () => {
    expect(getCpcbVerdict(20).category).toBe('Good');
    expect(getCpcbVerdict(45).category).toBe('Satisfactory');
    expect(getCpcbVerdict(75).category).toBe('Moderate');
    expect(getCpcbVerdict(110).category).toBe('Poor');
    expect(getCpcbVerdict(180).category).toBe('Very Poor');
    expect(getCpcbVerdict(310).category).toBe('Severe');
  });

  it('models lower indoor PM2.5 when sealing gaps, stopping incense, and running HEPA', () => {
    const unmitigated = runIndoorBoxSimulation({
      outdoorPm25: 300,
      roomSqft: 140,
      sealGaps: false,
      stopIncense: false,
      coverCooking: false,
      diyBoxFan: false,
      hepaPurifier: false,
    });
    const protectedRoom = runIndoorBoxSimulation({
      outdoorPm25: 300,
      roomSqft: 140,
      sealGaps: true,
      stopIncense: true,
      coverCooking: true,
      diyBoxFan: false,
      hepaPurifier: true,
    });

    expect(protectedRoom.simulatedRange[1]).toBeLessThan(unmitigated.baselineMid);
    expect(protectedRoom.dropPctRange[1]).toBeGreaterThanOrEqual(protectedRoom.dropPctRange[0]);
  });

  it('keeps CO2 claims strictly restricted to defensible modal shifts', () => {
    const metro = runDigitalTwinSimulation({
      presetId: 'metro_vs_auto',
      ambientPm25: 298,
      roomSqft: 140,
      durationMin: 35,
      purifierHours: 4,
      roomSealed: true,
    });
    const exercise = runDigitalTwinSimulation({
      presetId: 'exercise_indoors',
      ambientPm25: 298,
      roomSqft: 140,
      durationMin: 30,
      purifierHours: 4,
      roomSealed: true,
    });

    expect(metro.co2Defensible).toBe(true);
    expect(metro.co2SavedKg).toBeGreaterThan(0);
    expect(exercise.co2Defensible).toBe(false);
    expect(exercise.co2SavedKg).toBeNull();
  });

  it('excludes toxic houseplants when pets or toddlers are present', () => {
    const withPet = getCleanRoomPlans('under_2000', 140, true, false);
    const noPetNoToddler = getCleanRoomPlans('under_2000', 140, false, false);

    expect(withPet.excludedPlants.length).toBeGreaterThan(0);
    expect(withPet.plantDisclaimer).toContain('do NOT meaningfully remove PM2.5');
    expect(noPetNoToddler.excludedPlants.length).toBe(0);
  });

  it('triggers pre-LLM clinical distress gate in English, Hindi, and Bengali', () => {
    expect(detectClinicalEmergencyDistress('My grandfather has chest pain and cannot breathe')).toBe(
      true,
    );
    expect(detectClinicalEmergencyDistress('बच्चे को सांस नहीं आ रही है')).toBe(true);
    expect(detectClinicalEmergencyDistress('বাবা বুকে ব্যথা অনুভব করছেন')).toBe(true);
    expect(detectClinicalEmergencyDistress('Should my child play outside today?')).toBe(false);
  });

  it('produces separated observed vs predicted horizons and rejects invalid data safely', () => {
    const outlook = getPredictiveHourlyOutlook(CITY_PRESETS[0]);
    expect(outlook.insufficientData).toBe(false);
    expect(outlook.horizons[0].isObserved).toBe(true);
    expect(outlook.horizons.slice(1).every((h) => !h.isObserved)).toBe(true);

    const invalid = getPredictiveHourlyOutlook({ ...CITY_PRESETS[0], baselinePm25: 0 });
    expect(invalid.insufficientData).toBe(true);
    expect(invalid.horizons).toHaveLength(0);
  });

  it('builds calm 4-stage daily journey nudges', () => {
    const stages = getDailyJourneyStages(CITY_PRESETS[0], 'auto_rickshaw', '07:45 AM');
    expect(stages.map((s) => s.id)).toEqual(['morning', 'commute', 'midday', 'evening']);
  });

  it('sanitizes external URLs and blocks javascript/data URIs', () => {
    expect(sanitizeHttpUrl('https://maps.google.com/?q=AIIMS')).toContain('https://maps.google.com');
    expect(sanitizeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });
});
