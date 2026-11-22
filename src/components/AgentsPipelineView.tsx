import React, { useState } from 'react';
import {
  Play,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ExternalLink,
  ImagePlus,
  ShieldCheck,
  MapPin,
  Search,
} from 'lucide-react';
import type { AgentId, AgentRunResult, HouseholdState } from '../types/breatheasy.ts';

export const ORDERED_AGENTS: {
  id: AgentId;
  number: number;
  name: string;
  role: string;
  capability: string;
}[] = [
  {
    id: 'env_intelligence',
    number: 1,
    name: 'Environmental Intelligence Agent',
    role: 'Separates observed station snapshots from uncertainties & checks live CPCB/GRAP via Google Search.',
    capability: 'gemini-4-hydrogen + Google Search',
  },
  {
    id: 'predictive_risk',
    number: 2,
    name: 'Predictive Risk Agent',
    role: 'Assesses 1h/3h/6h/24h inversion & wind dispersion outlook with explicit confidence.',
    capability: 'gemini-4-hydrogen + Google Search',
  },
  {
    id: 'family_health',
    number: 3,
    name: 'Family Health Protection Agent',
    role: 'Prioritizes infants, respiratory-sensitive elders, kids & pets calmly with zero diagnosis.',
    capability: 'gemini-4-hydrogen (LOW thinking)',
  },
  {
    id: 'mobility_route',
    number: 4,
    name: 'Mobility & Route Agent',
    role: 'Finds real Metro/transit hubs & quieter corridors near your locality via Google Maps grounding.',
    capability: 'gemini-4-hydrogen + Google Maps',
  },
  {
    id: 'indoor_air',
    number: 5,
    name: 'Indoor Air Guardian Agent',
    role: 'Combines room photo vision + deterministic box model + ₹0-first budget actions.',
    capability: 'gemini-4-hydrogen Multimodal + Box Model',
  },
  {
    id: 'community_intel',
    number: 6,
    name: 'Community Intelligence Agent',
    role: 'Evaluates active Community Pulse reports, corroboration clusters & downwind precautions.',
    capability: 'gemini-4-hydrogen + Pulse Clustering',
  },
  {
    id: 'action_planner',
    number: 7,
    name: 'Action Planner Agent',
    role: 'Synthesizes prior agents into a conflict-free morning, commute, midday & evening routine.',
    capability: 'gemini-4-hydrogen (HIGH thinking)',
  },
  {
    id: 'verification_safety',
    number: 8,
    name: 'Verification & Safety Validator',
    role: 'Runs hard-coded clinical/guilt regexes + 7-point safety audit across all agent outputs.',
    capability: 'Deterministic Gate + gemini-4-hydrogen',
  },
];

interface Props {
  household: HouseholdState;
  outputs: Partial<Record<AgentId, AgentRunResult>>;
  runningAgent: AgentId | null;
  sequentialRunning: boolean;
  roomImageBase64?: string;
  roomImageMimeType?: string;
  onUploadRoomPhoto: (base64: string, mimeType: string) => void;
  onRunSingleAgent: (agentId: AgentId) => Promise<void>;
  onRunAllSequentially: () => Promise<void>;
}

export const AgentsPipelineView: React.FC<Props> = ({
  household,
  outputs,
  runningAgent,
  sequentialRunning,
  roomImageBase64,
  onUploadRoomPhoto,
  onRunSingleAgent,
  onRunAllSequentially,
}) => {
  const [expandedId, setExpandedId] = useState<AgentId | null>('env_intelligence');
  const completedCount = ORDERED_AGENTS.filter((a) => outputs[a.id]?.status === 'completed').length;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const match = result.match(/^data:(.+);base64,(.+)$/);
      if (match) {
        onUploadRoomPhoto(match[2], match[1]);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      {/* Pipeline Control Header */}
      <section className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <div className="text-xs font-medium uppercase tracking-wide text-[#0F766E] dark:text-[#2DD4BF]">
            Live Multi-Agent Orchestrator · {household.city.locality}, {household.city.name}
          </div>
          <h1 className="font-display text-2xl font-bold">
            8-Agent Pipeline (Run &amp; Verify One by One)
          </h1>
          <p className="text-sm text-[#4B5B59] dark:text-[#A7B8B5]">
            Run all 8 agents sequentially—passing prior context forward at every step—or trigger any
            individual agent to inspect live grounding links, latency, and Agent 8 safety verification.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs font-mono-tabular text-[#4B5B59] dark:text-[#A7B8B5]">
            Completed: <strong className="text-[#1A2423] dark:text-[#F1F5F4]">{completedCount}/8</strong>
          </div>
          <button
            type="button"
            onClick={onRunAllSequentially}
            disabled={sequentialRunning || runningAgent !== null}
            className="min-h-[46px] px-5 py-2.5 rounded-xl bg-[#0F766E] hover:bg-[#0D625B] disabled:opacity-55 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            {sequentialRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Running Agent Sequence...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run All 8 Agents One-by-One
              </>
            )}
          </button>
        </div>
      </section>

      {/* Agent Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {ORDERED_AGENTS.map((agent) => {
          const res = outputs[agent.id];
          const isRunning = runningAgent === agent.id;
          const isExpanded = expandedId === agent.id || isRunning || res?.status === 'completed';

          return (
            <article
              key={agent.id}
              className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-5 shadow-sm flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-mono-tabular text-[#4B5B59] dark:text-[#A7B8B5]">
                      Agent {agent.number} · {agent.capability}
                    </div>
                    <h3 className="font-display text-base font-bold mt-0.5">{agent.name}</h3>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setExpandedId(agent.id);
                      onRunSingleAgent(agent.id);
                    }}
                    disabled={sequentialRunning || runningAgent !== null}
                    className="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-[#0F766E] text-[#0F766E] dark:text-[#2DD4BF] dark:border-[#2DD4BF] hover:bg-[#0F766E]/10 disabled:opacity-45 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {isRunning ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Running
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" /> {res ? 'Re-Run' : 'Run Agent'}
                      </>
                    )}
                  </button>
                </div>

                <p className="text-xs text-[#4B5B59] dark:text-[#A7B8B5] leading-relaxed">
                  {agent.role}
                </p>

                {/* Optional Photo Uploader specifically on Agent 5 */}
                {agent.id === 'indoor_air' && (
                  <label className="inline-flex items-center gap-2 min-h-[38px] px-3 py-1.5 rounded-lg bg-[#F0ECE3] dark:bg-[#1E2B29] text-xs font-medium cursor-pointer hover:bg-[#E2DDD2] dark:hover:bg-[#283836]">
                    <ImagePlus className="w-3.5 h-3.5 text-[#0F766E] dark:text-[#2DD4BF]" />
                    {roomImageBase64
                      ? 'Room Photo Attached (Vision Active)'
                      : 'Attach Room / Stove Photo (Optional)'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                )}

                {/* Status / Error / Output */}
                {res?.status === 'error' && (
                  <div className="rounded-xl border border-[#C2410C]/40 bg-[#C2410C]/10 p-3 text-xs text-[#C2410C] dark:text-[#FB923C] flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{res.error || 'Agent execution failed.'}</span>
                  </div>
                )}

                {res?.status === 'completed' && isExpanded && (
                  <div className="rounded-xl bg-[#FAF7F2] dark:bg-[#0E1514] border border-[#E2DDD2] dark:border-[#283836] p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#4B5B59] dark:text-[#A7B8B5]">
                      <span className="flex items-center gap-1.5 font-semibold text-[#0F766E] dark:text-[#2DD4BF]">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Verified Output · Confidence: {res.confidence.toUpperCase()}
                      </span>
                      <span className="font-mono-tabular">
                        {res.modelUsed} · {(res.latencyMs / 1000).toFixed(2)}s
                      </span>
                    </div>

                    {res.agentId === 'verification_safety' && (
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md ${
                            res.verificationPassed
                              ? 'bg-[#0F766E]/12 text-[#0F766E] dark:text-[#2DD4BF]'
                              : 'bg-[#D97706]/15 text-[#B45309] dark:text-[#FBBF24]'
                          }`}
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          {res.verificationPassed
                            ? 'Deterministic & Safety Gate: PASS'
                            : 'Safety Gate: CAUTION FLAGGED'}
                        </span>
                        {res.warnings?.map((w) => (
                          <span key={w} className="text-[#B45309] dark:text-[#FBBF24]">
                            {w}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="text-xs sm:text-sm leading-relaxed whitespace-pre-line text-[#1A2423] dark:text-[#F1F5F4]">
                      {res.content}
                    </div>

                    {res.groundingLinks.length > 0 && (
                      <div className="pt-2 border-t border-[#E2DDD2] dark:border-[#283836] space-y-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#4B5B59] dark:text-[#A7B8B5] flex items-center gap-1">
                          {res.groundingType === 'googleMaps' ? (
                            <>
                              <MapPin className="w-3 h-3" /> Google Maps Grounded Sources
                            </>
                          ) : (
                            <>
                              <Search className="w-3 h-3" /> Google Search Grounded Sources
                            </>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                          {res.groundingLinks.map((g) => (
                            <a
                              key={g.uri}
                              href={g.uri}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-[#0F766E] dark:text-[#2DD4BF] hover:underline"
                            >
                              <ExternalLink className="w-3 h-3 shrink-0" />
                              <span className="truncate max-w-[260px]">{g.title}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};
