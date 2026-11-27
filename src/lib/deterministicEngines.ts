import {
  BudgetTier,
  CityPreset,
  FamilyMemberProfile,
  TwinScenarioInput,
  TwinScenarioResult,
} from '../types/breatheasy.ts';

export const CITY_PRESETS: CityPreset[] = [
  {
    id: 'delhi_mayur_vihar',
    name: 'Delhi NCR',
    locality: 'Mayur Vihar Phase 1',
    lat: 28.6091,
    lng: 77.2945,
    baselinePm25: 298,
    baselinePm10: 412,
    baselineNo2: 74,
    windKmh: 3.2,
    tempC: 14,
    humidityPct: 68,
  },
  {
    id: 'gurugram_dlf',
    name: 'Gurugram',
    locality: 'DLF Phase 2',
    lat: 28.4894,
    lng: 77.0888,
    baselinePm25: 256,
    baselinePm10: 368,
    baselineNo2: 66,
    windKmh: 4.5,
    tempC: 15,
    humidityPct: 62,
  },
  {
    id: 'kolkata_salt_lake',
    name: 'Kolkata',
    locality: 'Salt Lake Sector V',
    lat: 22.5726,
    lng: 88.4339,
    baselinePm25: 178,
    baselinePm10: 245,
    baselineNo2: 52,
    windKmh: 6.1,
    tempC: 21,
    humidityPct: 71,
  },
  {
    id: 'mumbai_bandra',
    name: 'Mumbai',
    locality: 'Bandra East',
    lat: 19.0607,
    lng: 72.8462,
    baselinePm25: 124,
    baselinePm10: 196,
    baselineNo2: 49,
    windKmh: 11.4,
    tempC: 26,
    humidityPct: 64,
  },
  {
    id: 'bengaluru_indiranagar',
    name: 'Bengaluru',
    locality: 'Indiranagar',
    lat: 12.9784,
    lng: 77.6408,
    baselinePm25: 58,
    baselinePm10: 94,
    baselineNo2: 34,
    windKmh: 12.8,
    tempC: 22,
    humidityPct: 58,
  },
];

export const DEFAULT_MEMBERS: FamilyMemberProfile[] = [
  {
    id: 'mem_aarav',
    label: 'Aarav (6y)',
    category: 'child',
    sensitivity: 'high_protection',
    privacyMasked: false,
  },
  {
    id: 'mem_meera',
    label: 'Meera ji (68y)',
    category: 'elderly',
    sensitivity: 'high_protection',
    privacyMasked: true,
  },
  {
    id: 'mem_priya',
    label: 'Priya (34y)',
    category: 'adult',
    sensitivity: 'standard',
    privacyMasked: false,
  },
  {
    id: 'mem_bruno',
    label: 'Bruno (Dog)',
    category: 'pet',
    sensitivity: 'elevated',
    privacyMasked: false,
  },
];

export interface CpcbVerdict {
  aqiApprox: number;
  category: 'Good' | 'Satisfactory' | 'Moderate' | 'Poor' | 'Very Poor' | 'Severe';
  verdictTier: 'safe' | 'caution' | 'avoid' | 'emergency';
  humanHeadline: string;
}

export function getCpcbVerdict(pm25: number): CpcbVerdict {
  if (pm25 <= 30) {
    return {
      aqiApprox: Math.round((pm25 / 30) * 50),
      category: 'Good',
      verdictTier: 'safe',
      humanHeadline: 'Outdoor play and normal ventilation are comfortable today.',
    };
  }
  if (pm25 <= 60) {
    return {
      aqiApprox: Math.round(51 + ((pm25 - 30) / 30) * 49),
      category: 'Satisfactory',
      verdictTier: 'safe',
      humanHeadline: 'Air is acceptable for most routines; keep sensitive elders paced.',
    };
  }
  if (pm25 <= 90) {
    return {
      aqiApprox: Math.round(101 + ((pm25 - 60) / 30) * 99),
      category: 'Moderate',
      verdictTier: 'caution',
      humanHeadline: 'Moderate haze: prefer midday outdoor windows for children.',
    };
  }
  if (pm25 <= 120) {
    return {
      aqiApprox: Math.round(201 + ((pm25 - 90) / 30) * 99),
      category: 'Poor',
      verdictTier: 'caution',
      humanHeadline: 'Limit vigorous outdoor sports for kids and sensitive elders.',
    };
  }
  if (pm25 <= 250) {
    return {
      aqiApprox: Math.round(301 + ((pm25 - 120) / 130) * 99),
      category: 'Very Poor',
      verdictTier: 'avoid',
      humanHeadline: 'Keep children and elders indoors; use N95 for essential travel.',
    };
  }
  return {
    aqiApprox: Math.min(500, Math.round(401 + ((pm25 - 250) / 150) * 99)),
    category: 'Severe',
    verdictTier: 'emergency',
    humanHeadline: 'Severe pollution: seal a clean sleeping room and avoid outdoor exertion.',
  };
}

export function runIndoorBoxSimulation(opts: {
  outdoorPm25: number;
  roomSqft: number;
  sealGaps: boolean;
  stopIncense: boolean;
  coverCooking: boolean;
  diyBoxFan: boolean;
  hepaPurifier: boolean;
}) {
  const volumeM3 = Math.max(15, opts.roomSqft * 0.0929 * 2.9);
  const baseInf = opts.sealGaps ? 0.42 : 0.95;
  const penetration = opts.sealGaps ? 0.65 : 0.82;
  const dep = 0.25;

  let sourceUgPerHr = 0;
  if (!opts.stopIncense) sourceUgPerHr += 1800;
  if (!opts.coverCooking) sourceUgPerHr += 2400;

  let cadr = 0;
  if (opts.hepaPurifier) cadr += 300;
  else if (opts.diyBoxFan) cadr += 170;

  const baselineC = Math.round(
    (penetration * 0.95 * opts.outdoorPm25 + 4200 / volumeM3) / (0.95 + dep),
  );
  const simC = Math.round(
    (penetration * baseInf * opts.outdoorPm25 + sourceUgPerHr / volumeM3) /
      (baseInf + dep + cadr / volumeM3),
  );

  const low = Math.max(12, Math.round(simC * 0.84));
  const high = Math.max(low + 6, Math.round(simC * 1.16));
  const dropLow = Math.max(0, Math.round(((baselineC - high) / baselineC) * 100));
  const dropHigh = Math.max(dropLow, Math.round(((baselineC - low) / baselineC) * 100));

  return {
    baselineMid: baselineC,
    simulatedRange: [low, high] as [number, number],
    dropPctRange: [dropLow, dropHigh] as [number, number],
  };
}

export function runDigitalTwinSimulation(input: TwinScenarioInput): TwinScenarioResult {
  const base = input.ambientPm25;
  const maskFactor =
    input.maskProtection === 'n95'
      ? 0.25
      : input.maskProtection === 'surgical'
        ? 0.72
        : 1.0;
  const durationScale = Math.max(0.5, Math.min(2.0, input.durationMin / 35));
  const maskNote =
    input.maskProtection === 'n95'
      ? 'Fitted N95 (~75% real-world filtration factor applied).'
      : input.maskProtection === 'surgical'
        ? 'Surgical mask (~28% particle barrier applied; gap leakage remains).'
        : 'Unmasked baseline exposure.';

  switch (input.presetId) {
    case 'leave_earlier': {
      const baseLow = Math.round(base * 0.92 * durationScale);
      const baseHigh = Math.round(base * 1.22 * durationScale);
      const altLow = Math.round(base * 0.72 * maskFactor * durationScale);
      const altHigh = Math.round(base * 0.95 * maskFactor * durationScale);
      const pctLow = Math.max(-90, Math.round(((altLow - baseHigh) / baseHigh) * 100));
      const pctHigh = Math.min(-5, Math.round(((altHigh - baseLow) / baseLow) * 100));
      return {
        title: `Leave 30 mins earlier (${input.timeSlot || '07:15 AM'} · ${input.durationMin}m)`,
        exposureChangePctRange: [Math.min(pctLow, pctHigh), Math.max(pctLow, pctHigh)],
        baselineRangeUgM3: [baseLow, baseHigh],
        whatIfRangeUgM3: [altLow, altHigh],
        costDiffInr: 0,
        timeDiffMin: -6,
        co2SavedKg: null,
        co2Defensible: false,
        confidence: 'medium',
        assumptions: [
          'Assumes typical 15%–20% lower arterial rush-hour NO2/exhaust density 30 mins earlier.',
          maskNote,
          'Modeled range only — not a personal wearable air measurement.',
        ],
        verdict: 'Leaving 30 mins earlier avoids peak school-gate idling and saves ~6 mins in transit.',
      };
    }
    case 'metro_vs_auto': {
      const baseLow = Math.round(base * 1.1 * durationScale);
      const baseHigh = Math.round(base * 1.45 * durationScale);
      const altLow = Math.round(base * 0.48 * maskFactor * durationScale);
      const altHigh = Math.round(base * 0.68 * maskFactor * durationScale);
      const pctLow = Math.max(-92, Math.round(((altLow - baseHigh) / baseHigh) * 100));
      const pctHigh = Math.min(-18, Math.round(((altHigh - baseLow) / baseLow) * 100));
      return {
        title: `Switch open auto to Metro + covered walk (${input.durationMin}m)`,
        exposureChangePctRange: [Math.min(pctLow, pctHigh), Math.max(pctLow, pctHigh)],
        baselineRangeUgM3: [baseLow, baseHigh],
        whatIfRangeUgM3: [altLow, altHigh],
        costDiffInr: -35,
        timeDiffMin: 4,
        co2SavedKg: Number((1.85 * durationScale).toFixed(2)),
        co2Defensible: true,
        confidence: 'medium',
        assumptions: [
          'Assumes Metro coach filtration factor (~0.45–0.55 I/O) vs. roadside open auto (~1.25x ambient).',
          maskNote,
          'Defensible CO2 savings derived from DEFRA passenger-km modal shift factor.',
        ],
        verdict: 'Substantial exposure drop for children and saves ~₹35 per round trip.',
      };
    }
    case 'exercise_indoors': {
      const baseLow = Math.round(base * 2.4);
      const baseHigh = Math.round(base * 3.3);
      const altLow = Math.round(base * 0.65);
      const altHigh = Math.round(base * 1.05);
      return {
        title: 'Move 30-min brisk walk/jog indoors',
        exposureChangePctRange: [-72, -55],
        baselineRangeUgM3: [baseLow, baseHigh],
        whatIfRangeUgM3: [altLow, altHigh],
        costDiffInr: 0,
        timeDiffMin: 0,
        co2SavedKg: null,
        co2Defensible: false,
        confidence: 'high',
        assumptions: [
          'Accounts for ~3.2x minute-ventilation increase during moderate outdoor exercise.',
          'Assumes closed interior windows (I/O ratio 0.45–0.60); pure health-protection win (no carbon claim).',
        ],
        verdict: 'Moving cardio indoors removes the single largest daily inhaled PM2.5 spike.',
      };
    }
    case 'seal_bedroom': {
      const sim = runIndoorBoxSimulation({
        outdoorPm25: base,
        roomSqft: input.roomSqft,
        sealGaps: true,
        stopIncense: true,
        coverCooking: true,
        diyBoxFan: false,
        hepaPurifier: false,
      });
      return {
        title: 'Improve bedroom envelope (seal gaps + wet mop)',
        exposureChangePctRange: [-sim.dropPctRange[1], -sim.dropPctRange[0]],
        baselineRangeUgM3: [Math.round(sim.baselineMid * 0.85), Math.round(sim.baselineMid * 1.15)],
        whatIfRangeUgM3: sim.simulatedRange,
        costDiffInr: 250,
        timeDiffMin: 15,
        co2SavedKg: null,
        co2Defensible: false,
        confidence: 'medium',
        assumptions: [
          `Estimated for a ${input.roomSqft} sq ft room with EPDM foam tape / wet towel gap sealing.`,
          'Assumes no indoor smoking, incense, or unvented combustion.',
        ],
        verdict: 'Low-cost sealing prevents outdoor haze seepage during overnight inversion peaks.',
      };
    }
    case 'purifier_4h':
    default: {
      const sim = runIndoorBoxSimulation({
        outdoorPm25: base,
        roomSqft: input.roomSqft,
        sealGaps: input.roomSealed,
        stopIncense: true,
        coverCooking: true,
        diyBoxFan: false,
        hepaPurifier: true,
      });
      const kwh = 0.045 * input.purifierHours;
      const inrCost = Math.round(kwh * 7.5 * 10) / 10;
      return {
        title: `Run True HEPA H13 purifier for ${input.purifierHours}h`,
        exposureChangePctRange: [-sim.dropPctRange[1], -sim.dropPctRange[0]],
        baselineRangeUgM3: [Math.round(sim.baselineMid * 0.85), Math.round(sim.baselineMid * 1.15)],
        whatIfRangeUgM3: sim.simulatedRange,
        costDiffInr: inrCost,
        timeDiffMin: 0,
        co2SavedKg: null,
        co2Defensible: false,
        confidence: 'high',
        assumptions: [
          `Assumes CADR 300 m³/h in ${input.roomSqft} sq ft room, medium fan (45W @ ₹7.5/kWh).`,
          input.roomSealed
            ? 'Windows sealed during operation.'
            : 'Warning: unsealed windows reduce purifier effectiveness by ~30%.',
        ],
        verdict: `Running HEPA on medium for ${input.purifierHours}h costs ~₹${inrCost} and keeps sleeping air cleaner.`,
      };
    }
  }
}

export interface CleanRoomTierPlan {
  id: 'zero' | 'budget' | 'best_value';
  label: string;
  costInr: number;
  annualMaintInr: number;
  estimatedDrop: string;
  withinBudget: boolean;
  steps: string[];
  needed: string[];
  doNotBuy: string[];
}

export function getBudgetCeilingInr(budget: BudgetTier, customBudgetInr?: number): number {
  switch (budget) {
    case 'inr_0':
      return 0;
    case 'under_500':
      return 500;
    case 'under_2000':
      return 2000;
    case 'under_5000':
      return 5000;
    case 'under_10000':
      return 10000;
    case 'custom':
      return Math.max(0, Math.min(100000, Math.round(customBudgetInr ?? 2000)));
  }
}

export function getCleanRoomPlans(
  budget: BudgetTier,
  roomSqft: number,
  hasPets: boolean,
  hasToddler: boolean,
  customBudgetInr?: number,
) {
  const ceilingInr = getBudgetCeilingInr(budget, customBudgetInr);
  const plans: CleanRoomTierPlan[] = [
    {
      id: 'zero',
      label: '₹0 Immediate Plan',
      costInr: 0,
      annualMaintInr: 0,
      estimatedDrop: '20%–32% indoor PM2.5 drop (modeled)',
      withinBudget: true,
      steps: [
        'Wet-mop bedroom floor daily instead of dry sweeping.',
        'Press a rolled damp towel along the bottom gap of the bedroom door.',
        'Cover pots with lids while cooking and keep the bedroom door shut.',
      ],
      needed: ['Existing wet mop', 'Cotton towel', 'Pot lids'],
      doNotBuy: ['Camphor, dhoop, or scented candles (these add fine smoke particles).'],
    },
    {
      id: 'budget',
      label: ceilingInr < 1650 && ceilingInr >= 250 ? 'Gap-Seal Starter (₹250)' : 'Budget Plan (Under ₹2,000)',
      costInr: ceilingInr < 1650 && ceilingInr >= 250 ? 250 : 1650,
      annualMaintInr: ceilingInr < 1650 && ceilingInr >= 250 ? 250 : 1600,
      estimatedDrop:
        ceilingInr < 1650 && ceilingInr >= 250
          ? `30%–42% PM2.5 drop in ~${roomSqft} sq ft`
          : `50%–65% PM2.5 drop in ~${roomSqft} sq ft`,
      withinBudget: ceilingInr >= 250,
      steps:
        ceilingInr < 1650 && ceilingInr >= 250
          ? [
              'Apply EPDM D-profile foam weatherstripping on window & balcony gaps.',
              'Wet-mop floor and seal under-door gap with a damp cotton towel.',
              'Keep exhaust running during cooking; avoid incense/candles.',
            ]
          : [
              'Apply EPDM D-profile foam weatherstripping on window & balcony gaps.',
              'Attach a genuine cylindrical H13 HEPA replacement filter to an existing 300mm table/exhaust fan.',
              'Run on medium speed in one designated sleeping room with door shut.',
            ],
      needed:
        ceilingInr < 1650 && ceilingInr >= 250
          ? ['EPDM foam tape (~₹250)', 'Cotton towel', 'Wet mop']
          : ['EPDM foam tape (~₹250)', 'True H13 replacement cylinder (~₹1,400)', 'Existing fan'],
      doNotBuy: ['₹800–₹1,500 USB desktop "ionizers" (negligible CADR & potential trace ozone).'],
    },
    {
      id: 'best_value',
      label: 'Best-Value HEPA Plan',
      costInr: 8999,
      annualMaintInr: 2200,
      estimatedDrop: `75%–85% PM2.5 drop in ~${roomSqft} sq ft`,
      withinBudget: ceilingInr >= 8999,
      steps: [
        'Seal perimeter gaps with EPDM foam strip.',
        'Place a CADR >= 300 m³/h True HEPA H13 unit 30 cm away from walls.',
        'Vacuum the outer pre-filter mesh every 14 days to double HEPA filter life.',
      ],
      needed: ['Verified True HEPA H13 unit (CADR >= 300 m³/h)', 'EPDM tape (~₹250)'],
      doNotBuy: ['₹35,000+ purifiers with UV-C/ozone gimmicks or proprietary locked filter chips.'],
    },
  ];

  const safePlants = [
    {
      name: 'Areca Palm (Dypsis lutescens)',
      safe: true,
      note: 'Non-toxic to dogs, cats & toddlers. Adds gentle humidity in dry winter.',
    },
    {
      name: 'Spider Plant (Chlorophytum comosum)',
      safe: true,
      note: 'Low maintenance, pet & toddler safe. Keep elevated away from crawling toddlers.',
    },
  ];

  const excludedPlants = [];
  if (hasPets || hasToddler) {
    excludedPlants.push(
      'Peace Lily & Snake Plant excluded (toxic if chewed by pets or toddlers).',
    );
  }

  return {
    ceilingInr,
    plans,
    safePlants,
    excludedPlants,
    plantDisclaimer:
      'Evidence Note: Houseplants do NOT meaningfully remove PM2.5 winter smog and never replace HEPA filtration, sealing gaps, or stopping indoor smoke.',
  };
}

const DISTRESS_PATTERNS = [
  /chest\s*pain/i,
  /can'?t\s*breathe/i,
  /cannot\s*breathe/i,
  /difficulty\s*breathing/i,
  /shortness\s*of\s*breath/i,
  /blue\s*lips/i,
  /fainting|unconscious|passed\s*out/i,
  /सांस\s*नहीं|सीने\s*में\s*दर्द|दम\s*घुट/i,
  /শ্বাসকষ্ট|বুকে\s*ব্যথা|অজ্ঞান/i,
];

export function detectClinicalEmergencyDistress(text: string): boolean {
  return DISTRESS_PATTERNS.some((rx) => rx.test(text));
}

export function sanitizeHttpUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export interface PredictiveHorizon {
  horizonLabel: string;
  isObserved: boolean;
  pm25Range: [number, number];
  confidence: 'high' | 'medium' | 'low';
  driver: string;
  timestampIso: string;
  inversionRisk: 'elevated' | 'moderate' | 'low';
}

export function getPredictiveHourlyOutlook(city: CityPreset): {
  insufficientData: boolean;
  horizons: PredictiveHorizon[];
  advisory: string;
} {
  if (!Number.isFinite(city.baselinePm25) || city.baselinePm25 <= 0) {
    return {
      insufficientData: true,
      horizons: [],
      advisory: 'Insufficient station data to produce a short-term outlook safely.',
    };
  }

  const now = Date.now();
  const base = city.baselinePm25;
  const lowWind = city.windKmh < 5;
  const inversionRisk: 'elevated' | 'moderate' | 'low' =
    lowWind && city.tempC < 18 ? 'elevated' : city.windKmh < 8 ? 'moderate' : 'low';

  const h1Low = Math.max(12, Math.round(base * (lowWind ? 0.96 : 0.88)));
  const h1High = Math.round(base * (lowWind ? 1.12 : 1.04));

  const h3Low = Math.max(12, Math.round(base * (lowWind ? 0.85 : 0.78)));
  const h3High = Math.round(base * (lowWind ? 1.06 : 0.96));

  const h6Low = Math.max(12, Math.round(base * (lowWind ? 1.04 : 0.86)));
  const h6High = Math.round(base * (lowWind ? 1.28 : 1.08));

  const h24Low = Math.max(12, Math.round(base * 0.76));
  const h24High = Math.round(base * 1.24);

  return {
    insufficientData: false,
    horizons: [
      {
        horizonLabel: 'Observed Now',
        isObserved: true,
        pm25Range: [base, base],
        confidence: 'high',
        driver: `Station snapshot · Wind ${city.windKmh} km/h · RH ${city.humidityPct}%`,
        timestampIso: new Date(now).toISOString(),
        inversionRisk,
      },
      {
        horizonLabel: '+1h Forecast',
        isObserved: false,
        pm25Range: [h1Low, h1High],
        confidence: 'high',
        driver: lowWind ? 'Weak dispersion; local traffic plume persistence' : 'Moderate boundary mixing',
        timestampIso: new Date(now + 3600 * 1000).toISOString(),
        inversionRisk,
      },
      {
        horizonLabel: '+3h Outlook',
        isObserved: false,
        pm25Range: [h3Low, h3High],
        confidence: 'medium',
        driver: 'Afternoon solar warming temporarily lifts mixing layer',
        timestampIso: new Date(now + 3 * 3600 * 1000).toISOString(),
        inversionRisk: inversionRisk === 'elevated' ? 'moderate' : 'low',
      },
      {
        horizonLabel: '+6h Outlook',
        isObserved: false,
        pm25Range: [h6Low, h6High],
        confidence: 'medium',
        driver: lowWind
          ? 'Evening cooling + shallow inversion lid likely traps road emissions'
          : 'Evening rush traffic with steady breeze',
        timestampIso: new Date(now + 6 * 3600 * 1000).toISOString(),
        inversionRisk,
      },
      {
        horizonLabel: '+24h Range',
        isObserved: false,
        pm25Range: [h24Low, h24High],
        confidence: 'low',
        driver: 'Synoptic wind & regional humidity uncertainty beyond 12 hours',
        timestampIso: new Date(now + 24 * 3600 * 1000).toISOString(),
        inversionRisk,
      },
    ],
    advisory:
      inversionRisk === 'elevated'
        ? 'Pollution may build before your evening commute due to cooling inversion. Consider completing outdoor errands during the warmer midday window.'
        : 'Conditions favor steadier dispersion midday; check short-term updates before evening outdoor exercise.',
  };
}

export interface DailyJourneyStage {
  id: 'morning' | 'commute' | 'midday' | 'evening';
  title: string;
  windowLabel: string;
  nudge: string;
  exposureBenefit: string;
}

export function getDailyJourneyStages(
  city: CityPreset,
  commuteMode: 'metro' | 'car_ac' | 'auto_rickshaw' | 'walk',
  schoolTime: string,
): DailyJourneyStage[] {
  const highSmog = city.baselinePm25 > 120;
  return [
    {
      id: 'morning',
      title: 'Morning Smog Brief',
      windowLabel: '06:30 – 07:30 AM',
      nudge: highSmog
        ? 'Keep morning stretches indoors today and check N95 fit before stepping out.'
        : 'Calm early walk is comfortable; pace elders away from main arterial intersections.',
      exposureBenefit: highSmog ? 'Avoids ~3x exercise inhalation spike' : 'Supports steady morning routine',
    },
    {
      id: 'commute',
      title: 'School & Work Commute',
      windowLabel: schoolTime,
      nudge:
        commuteMode === 'auto_rickshaw' || commuteMode === 'walk'
          ? 'Leaving 15–30 minutes earlier or choosing enclosed Metro lowers kerbside exhaust intake.'
          : 'Keep cabin recirculation on in heavy traffic corridors.',
      exposureBenefit: 'Est. 18%–45% lower commute PM2.5 exposure',
    },
    {
      id: 'midday',
      title: 'Midday Window Check',
      windowLabel: '13:00 – 15:30 PM',
      nudge:
        'Brief 15-minute cross-ventilation works best mid-afternoon when sunlight lifts inversion haze.',
      exposureBenefit: 'Refreshes indoor CO₂ when outdoor haze dips',
    },
    {
      id: 'evening',
      title: 'Evening Safe Room Routine',
      windowLabel: '18:30 – 22:00 PM',
      nudge:
        'Seal bedroom window gaps, wet-mop floor, and skip incense or candles so the family sleeps in cleaner air.',
      exposureBenefit: 'Protects 8 hours of overnight recovery',
    },
  ];
}

export interface SmartAlertDecision {
  shouldNotify: boolean;
  suppressedReason?: string;
  severity: 'info' | 'advisory' | 'high';
  whatChanged: string;
  whyItMatters: string;
  confidence: 'high' | 'medium' | 'low';
  doThisNow: string;
}

/**
 * Feature L — Anti-spam Smart Alert Intelligence.
 * Suppresses minor fluctuations within cooldown windows unless conditions cross into Severe.
 */
export function evaluateSmartAlert(opts: {
  city: CityPreset;
  previousPm25?: number;
  lastAlertAtMs?: number;
  nowMs?: number;
  notificationStyle?: 'calm_essential' | 'detailed_shifts';
}): SmartAlertDecision {
  const now = opts.nowMs ?? Date.now();
  const prev = opts.previousPm25 ?? opts.city.baselinePm25;
  const curr = opts.city.baselinePm25;
  const deltaPct = prev > 0 ? Math.abs(curr - prev) / prev : 0;
  const cooldownMs = opts.notificationStyle === 'detailed_shifts' ? 20 * 60 * 1000 : 45 * 60 * 1000;
  const inCooldown = typeof opts.lastAlertAtMs === 'number' && now - opts.lastAlertAtMs < cooldownMs;
  const isSevere = curr > 250;
  const lowWindInversion = opts.city.windKmh < 5 && opts.city.tempC < 18;

  if (inCooldown && !isSevere) {
    return {
      shouldNotify: false,
      suppressedReason: 'Anti-spam cooldown active — no severe escalation detected.',
      severity: 'info',
      whatChanged: `${opts.city.locality} PM2.5 remains ~${curr} µg/m³.`,
      whyItMatters: 'Steady readings do not require repeated interruptions.',
      confidence: 'high',
      doThisNow: 'Continue your current safe-room or midday schedule calmly.',
    };
  }

  if (!isSevere && deltaPct < 0.15 && !lowWindInversion) {
    return {
      shouldNotify: false,
      suppressedReason: 'Minor fluctuation (<15%) — suppressed to prevent notification fatigue.',
      severity: 'info',
      whatChanged: `PM2.5 shifted by less than 15% (~${curr} µg/m³).`,
      whyItMatters: 'Small hourly ripples do not change safe activity choices.',
      confidence: 'medium',
      doThisNow: 'Keep standard outdoor/indoor pacing; check again before evening commute.',
    };
  }

  return {
    shouldNotify: true,
    severity: isSevere ? 'high' : 'advisory',
    whatChanged:
      prev !== curr
        ? `${opts.city.locality} PM2.5 moved from ~${prev} to ~${curr} µg/m³ (wind ${opts.city.windKmh} km/h).`
        : `${opts.city.locality} is at ~${curr} µg/m³ with ${lowWindInversion ? 'low-wind evening inversion risk' : 'elevated particulate load'}.`,
    whyItMatters:
      curr > 120
        ? 'Young children, elders, and respiratory-sensitive members inhale higher fine-particle doses near roads.'
        : 'Moderate haze can add irritation during sustained outdoor exertion.',
    confidence: lowWindInversion || isSevere ? 'high' : 'medium',
    doThisNow: isSevere
      ? 'Move vulnerable family members indoors, seal gaps in one clean sleeping room, and use fitted N95 for essential travel.'
      : 'Shift errands toward the midday window (13:00–15:30) and prefer enclosed transit.',
  };
}

export interface DataSourceStatus {
  source: string;
  data: string;
  frequency: string;
  reliability: 'high' | 'medium' | 'low';
  stale: boolean;
  lastUpdatedIso: string;
  fallbackAction: string;
}

export function getDataSourceStatuses(
  city: CityPreset,
  observedTimestampIso?: string,
): DataSourceStatus[] {
  const ts = observedTimestampIso || new Date().toISOString();
  const ageMinutes = (Date.now() - new Date(ts).getTime()) / 60000;
  const stale = !Number.isFinite(ageMinutes) || ageMinutes > 90;

  return [
    {
      source: 'CPCB / State PCB Station Snapshot',
      data: `PM2.5 ~${city.baselinePm25}, PM10 ~${city.baselinePm10}, NO₂ ~${city.baselineNo2} µg/m³`,
      frequency: 'Hourly station snapshot',
      reliability: stale ? 'low' : 'high',
      stale,
      lastUpdatedIso: ts,
      fallbackAction: 'Use last timestamped reading with lowered confidence and verify via Agent 1 Search.',
    },
    {
      source: 'Google Search Grounding (Agent 1 & 2)',
      data: 'Live CPCB bulletins, GRAP alerts & regional weather wind forecast',
      frequency: 'On-demand per run',
      reliability: 'high',
      stale: false,
      lastUpdatedIso: ts,
      fallbackAction: 'Display deterministic inversion model labeled explicitly as modeled estimate.',
    },
    {
      source: 'Google Maps Grounding (Agent 4 & Emergency)',
      data: 'Verified Metro/transit hubs, quieter corridors & 24h emergency hospitals',
      frequency: 'On-demand with city coordinates',
      reliability: 'high',
      stale: false,
      lastUpdatedIso: ts,
      fallbackAction: 'Show direct 112 / 102 dial links without inventing unverified landmarks.',
    },
    {
      source: 'Community Pulse 2.0 Clusters',
      data: 'Neighborhood smoke, burning & dust reports (PII redacted)',
      frequency: 'Real-time 45-min H3 corroboration',
      reliability: 'medium',
      stale: false,
      lastUpdatedIso: ts,
      fallbackAction: 'Treat <3 reports as unconfirmed single observations.',
    },
  ];
}


