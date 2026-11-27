import { z } from 'zod';

export const cityPresetSchema = z.object({
  id: z.string().min(2).max(64).regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(80),
  locality: z.string().min(1).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  baselinePm25: z.number().min(1).max(1500),
  baselinePm10: z.number().min(1).max(2500),
  baselineNo2: z.number().min(0).max(1000),
  windKmh: z.number().min(0).max(200),
  tempC: z.number().min(-30).max(60),
  humidityPct: z.number().min(0).max(100),
});

export const familyMemberSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  label: z.string().min(1).max(80),
  category: z.enum([
    'adult',
    'child',
    'infant',
    'elderly',
    'respiratory_sensitive',
    'pet',
  ]),
  sensitivity: z.enum(['standard', 'elevated', 'high_protection']),
  privacyMasked: z.boolean(),
});

export const householdSchema = z.object({
  city: cityPresetSchema,
  language: z.enum(['en', 'hi', 'bn']),
  eli10: z.boolean(),
  budgetTier: z.enum(['inr_0', 'under_500', 'under_2000', 'under_5000', 'under_10000']),
  roomSqft: z.number().min(40).max(5000),
  hasPets: z.boolean(),
  hasToddler: z.boolean(),
  housingType: z.enum(['high_rise', 'independent_flat', 'ground_floor_roadside']),
  commuteMode: z.enum(['metro', 'car_ac', 'auto_rickshaw', 'walk']),
  schoolTime: z.string().min(1).max(32),
  members: z.array(familyMemberSchema).max(20),
});

export const communityReportSchema = z.object({
  cityId: z.string().min(2).max(64).regex(/^[a-z0-9_]+$/),
  category: z.enum([
    'smoke',
    'garbage_burning',
    'construction_dust',
    'traffic_congestion',
    'industrial_emissions',
    'unusual_odor',
    'visibility_problems',
    'local_pollution_event',
  ]),
  severity: z.enum(['mild', 'moderate', 'severe']),
  note: z.string().max(240).optional().default(''),
});

export const twinSimulateSchema = z.object({
  presetId: z.enum([
    'leave_earlier',
    'metro_vs_auto',
    'exercise_indoors',
    'seal_bedroom',
    'purifier_4h',
  ]),
  ambientPm25: z.number().min(1).max(1500),
  roomSqft: z.number().min(40).max(5000),
  durationMin: z.number().min(1).max(600),
  purifierHours: z.number().min(0).max(24),
  roomSealed: z.boolean(),
});

export const indoorSimulateSchema = z.object({
  outdoorPm25: z.number().min(1).max(1500),
  roomSqft: z.number().min(40).max(5000),
  sealGaps: z.boolean(),
  stopIncense: z.boolean(),
  coverCooking: z.boolean(),
  diyBoxFan: z.boolean(),
  hepaPurifier: z.boolean(),
});

export const agentRunSchema = z.object({
  agentId: z.enum([
    'env_intelligence',
    'predictive_risk',
    'family_health',
    'mobility_route',
    'indoor_air',
    'community_intel',
    'action_planner',
    'verification_safety',
  ]),
  household: householdSchema,
  priorOutputs: z.record(z.string(), z.unknown()).optional().default({}),
  roomImageBase64: z
    .string()
    .max(4_000_000)
    .regex(/^[A-Za-z0-9+/=]+$/, 'Invalid base64 image payload')
    .optional(),
  roomImageMimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
  indoorNote: z.string().max(240).optional(),
  customPm25: z.number().min(1).max(1500).optional(),
});

export const askSchema = z.object({
  question: z.string().trim().min(1, 'Question cannot be empty.').max(600),
  household: householdSchema,
});

export const emergencyResourcesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  cityName: z.string().trim().min(2).max(120),
});

export function redactPiiFromNote(rawNote: string): string {
  return rawNote
    .replace(/\b(?:\+?\d[\d\s-]{8,14}\d)\b/g, '[redacted-phone]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .trim()
    .slice(0, 240);
}
