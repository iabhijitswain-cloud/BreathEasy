import express, { type NextFunction, type Request, type Response } from 'express';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  detectClinicalEmergencyDistress,
  getCpcbVerdict,
  runDigitalTwinSimulation,
  runIndoorBoxSimulation,
} from '../lib/deterministicEngines.ts';
import type { CommunityReport } from '../types/breatheasy.ts';
import {
  executeAgent,
  extractGroundingLinks,
  languageLabel,
  type PriorAgentSnippet,
} from './agents.ts';
import {
  agentRunSchema,
  askSchema,
  communityReportSchema,
  emergencyResourcesSchema,
  indoorSimulateSchema,
  redactPiiFromNote,
  twinSimulateSchema,
} from './validation.ts';

interface GeminiHttpErrorShape {
  status?: number;
  message?: string;
}

let cachedAiKey: string | null = null;
let cachedAiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server environment.');
  }
  if (!cachedAiClient || cachedAiKey !== apiKey) {
    cachedAiKey = apiKey;
    cachedAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: 45000,
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedAiClient;
}

function formatGeminiError(err: unknown, fallback: string): { status: number; message: string } {
  const shaped = err as GeminiHttpErrorShape | null;
  const raw = err instanceof Error ? err.message : String(shaped?.message || fallback);
  if (shaped?.status === 429 || raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message:
        'Gemini API quota/rate limit reached (429 RESOURCE_EXHAUSTED). Please verify your Gemini API billing/quota or retry shortly.',
    };
  }
  const status =
    typeof shaped?.status === 'number' && shaped.status >= 400 && shaped.status < 600
      ? shaped.status
      : 500;
  return { status, message: raw };
}

/**
 * Bounded sliding-window rate limiter with periodic stale-entry pruning
 * so memory remains O(active clients) over long server uptime.
 */
function createRateLimiter(windowMs: number, maxRequests: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'local';
    const now = Date.now();
    if (hits.size > 250) {
      for (const [k, timestamps] of hits) {
        if (timestamps.every((t) => now - t >= windowMs)) {
          hits.delete(k);
        }
      }
    }
    const valid = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (valid.length >= maxRequests) {
      res.status(429).json({
        error: 'Too many requests. Please wait a few seconds before retrying.',
      });
      return;
    }
    valid.push(now);
    hits.set(key, valid);
    next();
  };
}

function createInitialReports(): CommunityReport[] {
  return [
    {
      id: 'rep_seed_1',
      cityId: 'delhi_mayur_vihar',
      h3Zone: 'H3-883da112-NW',
      category: 'garbage_burning',
      severity: 'moderate',
      note: 'Dry leaf and plastic smoke near Pocket-C boundary park.',
      corroborations: 3,
      confidence: 0.76,
      status: 'community_corroborated',
      createdAtIso: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
    },
    {
      id: 'rep_seed_2',
      cityId: 'delhi_mayur_vihar',
      h3Zone: 'H3-883da114-E',
      category: 'construction_dust',
      severity: 'mild',
      note: 'Uncovered sand unloading near metro pillar corridor.',
      corroborations: 1,
      confidence: 0.28,
      status: 'unconfirmed_single',
      createdAtIso: new Date(Date.now() - 41 * 60 * 1000).toISOString(),
    },
    {
      id: 'rep_seed_3',
      cityId: 'gurugram_dlf',
      h3Zone: 'H3-883da409-S',
      category: 'traffic_congestion',
      severity: 'moderate',
      note: 'Heavy diesel idling along service lane junction.',
      corroborations: 2,
      confidence: 0.58,
      status: 'community_corroborated',
      createdAtIso: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    },
  ];
}

export function createApiApp(options?: {
  disableRateLimit?: boolean;
  rateLimitMax?: number;
}) {
  const app = express();
  const communityReports = createInitialReports();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));

  // Hardened HTTP headers (iframe-safe; omits X-Frame-Options)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)');
    next();
  });

  if (!options?.disableRateLimit) {
    const maxPerMin = options?.rateLimitMax ?? 40;
    app.use('/api/agents/run', createRateLimiter(60_000, maxPerMin));
    app.use('/api/ask', createRateLimiter(60_000, Math.min(maxPerMin, 30)));
    app.use('/api/community/reports', createRateLimiter(60_000, maxPerMin));
    app.use('/api/emergency/resources', createRateLimiter(60_000, Math.min(maxPerMin, 20)));
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'BreathEasy AI', timestamp: new Date().toISOString() });
  });

  app.get('/api/community/reports', (req, res) => {
    const rawCity = typeof req.query.cityId === 'string' ? req.query.cityId.trim() : undefined;
    if (rawCity && !/^[a-z0-9_]+$/.test(rawCity)) {
      return res.status(400).json({ error: 'Invalid cityId parameter.' });
    }
    const filtered = rawCity
      ? communityReports.filter((r) => r.cityId === rawCity)
      : communityReports;
    return res.json({ reports: filtered });
  });

  app.post('/api/community/reports', (req, res) => {
    const parsed = communityReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid community report payload.',
      });
    }

    const { cityId, category, severity, note } = parsed.data;
    const cleanNote = redactPiiFromNote(note);

    const cutoff = Date.now() - 45 * 60 * 1000;
    const existing = communityReports.find(
      (r) =>
        r.cityId === cityId &&
        r.category === category &&
        new Date(r.createdAtIso).getTime() >= cutoff,
    );

    if (existing) {
      existing.corroborations += 1;
      existing.confidence = Math.min(0.95, Number((existing.confidence + 0.22).toFixed(2)));
      existing.status =
        existing.corroborations >= 3 ? 'community_corroborated' : 'unconfirmed_single';
      existing.createdAtIso = new Date().toISOString();
      return res.json({ report: existing, clustered: true });
    }

    const created: CommunityReport = {
      id: `rep_${Date.now()}`,
      cityId,
      h3Zone: `H3-${cityId.slice(0, 5)}-local`,
      category,
      severity,
      note: cleanNote || `${category.replace(/_/g, ' ')} observed nearby.`,
      corroborations: 1,
      confidence: 0.28,
      status: 'unconfirmed_single',
      createdAtIso: new Date().toISOString(),
    };
    communityReports.unshift(created);
    if (communityReports.length > 200) {
      communityReports.length = 200;
    }
    return res.status(201).json({ report: created, clustered: false });
  });

  app.post('/api/twin/simulate', (req, res) => {
    const parsed = twinSimulateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid simulation parameters.',
      });
    }
    return res.json(runDigitalTwinSimulation(parsed.data));
  });

  app.post('/api/indoor/simulate', (req, res) => {
    const parsed = indoorSimulateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid indoor simulation parameters.',
      });
    }
    return res.json(runIndoorBoxSimulation(parsed.data));
  });

  app.post('/api/agents/run', async (req, res) => {
    const parsed = agentRunSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Valid agentId and household state are required.',
      });
    }

    try {
      const {
        agentId,
        household,
        priorOutputs,
        roomImageBase64,
        roomImageMimeType,
        indoorNote,
        customPm25,
      } = parsed.data;

      const result = await executeAgent({
        ai: getAiClient(),
        agentId,
        household,
        priorOutputs: priorOutputs as Partial<Record<typeof agentId, PriorAgentSnippet>>,
        cityReports: communityReports.filter((r) => r.cityId === household.city.id),
        roomImageBase64,
        roomImageMimeType,
        indoorNote,
        customPm25,
      });

      return res.json(result);
    } catch (err: unknown) {
      console.error('Agent run error:', err);
      const formatted = formatGeminiError(err, 'Agent execution failed.');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/ask', async (req, res) => {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Question cannot be empty.',
      });
    }

    try {
      const { question, household } = parsed.data;

      if (detectClinicalEmergencyDistress(question)) {
        return res.json({
          emergencyTriggered: true,
          answer:
            'Emergency signals detected. Please contact local emergency services (112 / 102) or seek urgent medical care immediately. Do not wait for AI conversation.',
          groundingLinks: [],
        });
      }

      const ai = getAiClient();
      const pm25 = household.city.baselinePm25;
      const verdict = getCpcbVerdict(pm25);
      const langDesc = languageLabel(household.language);

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `User question: "${question}"
Household context: ${household.city.locality}, ${household.city.name} (PM2.5 ~${pm25} ug/m3, CPCB ${verdict.category}). Budget: ${household.budgetTier}. Members: ${household.members.map((m) => m.label).join(', ')}.
Respond in ${langDesc}. ${household.eli10 ? 'Use Explain-Like-Im-10 simplicity.' : 'Keep it calm, concise, and under 130 words.'}
End with: "Guidance only — not medical advice."`,
        config: {
          systemInstruction:
            'You are BreathEasy Ask AI. Ground answers with Google Search when current conditions/advisories help. Never diagnose or prescribe. Be calm, practical, and budget-aware.',
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      return res.json({
        emergencyTriggered: false,
        answer: response.text || 'I could not generate a response right now.',
        groundingLinks: extractGroundingLinks(response, 'google_search'),
      });
    } catch (err: unknown) {
      console.error('Ask error:', err);
      const formatted = formatGeminiError(err, 'Ask BreathEasy failed.');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/emergency/resources', async (req, res) => {
    const parsed = emergencyResourcesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid location parameters.',
      });
    }

    try {
      const { lat, lng, cityName } = parsed.data;
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Find the nearest open 24-hour emergency hospitals and 24-hour pharmacies near ${cityName}. List up to 4 verified places clearly with short distances/areas.`,
        config: {
          systemInstruction:
            'You assist during an emergency checklist lookup. List only verified nearby hospitals/ERs and pharmacies concisely. Never give medical diagnoses.',
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: { latitude: lat, longitude: lng },
            },
          },
        },
      });

      return res.json({
        summary:
          response.text || 'Call 112 / 102 or proceed to nearest verified hospital emergency room.',
        places: extractGroundingLinks(response, 'google_maps'),
      });
    } catch (err: unknown) {
      console.error('Emergency Maps lookup error:', err);
      const formatted = formatGeminiError(err, 'Emergency resource lookup failed.');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  return app;
}
