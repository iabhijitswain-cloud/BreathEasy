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
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { AGENT_SEQUENCE } from '../lib/agentCatalog.ts';
import { sanitizeHttpUrl } from '../lib/deterministicEngines.ts';
import type { AgentId, AgentRunResult, HouseholdState } from '../types/breatheasy.ts';

export const ORDERED_AGENTS = AGENT_SEQUENCE;

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

export const AgentsPipelineView: React.FC<Props> = React.memo(function AgentsPipelineView({
  household,
  outputs,
  runningAgent,
  sequentialRunning,
  roomImageBase64,
  onUploadRoomPhoto,
  onRunSingleAgent,
  onRunAllSequentially,
}) {
  const [expandedId, setExpandedId] = useState<AgentId | null>('env_intelligence');
  const [openSpecId, setOpenSpecId] = useState<AgentId | null>(null);
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
      <section
        aria-labelledby="pipeline-heading"
        className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-6 shadow-sm flex flex-wrap items-center justify-between gap-4"
      >
        <div className="space-y-1 max-w-2xl">
          <div className="text-xs font-medium uppercase tracking-wide text-[#0F766E] dark:text-[#2DD4BF]">
            Live Multi-Agent Orchestrator · {household.city.locality}, {household.city.name}
          </div>
          <h1 id="pipeline-heading" className="font-display text-2xl font-bold">
            8-Agent Pipeline (Run &amp; Verify One by One)
          </h1>
          <p className="text-sm text-[#4B5B59] dark:text-[#A7B8B5]">
            Run all 8 agents sequentially—passing prior context forward at every step—or trigger any
            individual agent to inspect live grounding links, prompt governance, and Agent 8 safety
            verification.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            aria-live="polite"
            className="text-xs font-mono-tabular text-[#4B5B59] dark:text-[#A7B8B5]"
          >
            Completed: <strong className="text-[#1A2423] dark:text-[#F1F5F4]">{completedCount}/8</strong>
            {runningAgent ? ` · Running ${runningAgent}` : ''}
          </div>
          <button
            type="button"
            onClick={() => void onRunAllSequentially()}
            disabled={sequentialRunning || runningAgent !== null}
            className="min-h-[46px] px-5 py-2.5 rounded-xl bg-[#0F766E] hover:bg-[#0D625B] disabled:opacity-55 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            {sequentialRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Running Agent Sequence...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" aria-hidden="true" />
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
          const isSpecOpen = openSpecId === agent.id;

          return (
            <article
              key={agent.id}
              className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-5 shadow-sm flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-mono-tabular text-[#4B5B59] dark:text-[#A7B8B5]">
                      Agent {agent.number} · {agent.capability} · {agent.promptVersion}
                    </div>
                    <h2 className="font-display text-base font-bold mt-0.5">{agent.name}</h2>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setExpandedId(agent.id);
                      void onRunSingleAgent(agent.id);
                    }}
                    disabled={sequentialRunning || runningAgent !== null}
                    className="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-[#0F766E] text-[#0F766E] dark:text-[#2DD4BF] dark:border-[#2DD4BF] hover:bg-[#0F766E]/10 disabled:opacity-45 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {isRunning ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Running
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" aria-hidden="true" /> {res ? 'Re-Run' : 'Run Agent'}
                      </>
                    )}
                  </button>
                </div>

                <p className="text-xs text-[#4B5B59] dark:text-[#A7B8B5] leading-relaxed">
                  {agent.role}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-expanded={isSpecOpen}
                    onClick={() => setOpenSpecId(isSpecOpen ? null : agent.id)}
                    className="min-h-[34px] px-2.5 py-1 rounded-lg border border-[#E2DDD2] dark:border-[#283836] text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                  >
                    {isSpecOpen ? (
                      <ChevronUp className="w-3 h-3" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="w-3 h-3" aria-hidden="true" />
                    )}
                    Prompt Spec &amp; Guardrails
                  </button>

                  {agent.id === 'indoor_air' && (
                    <label className="inline-flex items-center gap-2 min-h-[34px] px-3 py-1 rounded-lg bg-[#F0ECE3] dark:bg-[#1E2B29] text-xs font-medium cursor-pointer hover:bg-[#E2DDD2] dark:hover:bg-[#283836]">
                      <ImagePlus
                        className="w-3.5 h-3.5 text-[#0F766E] dark:text-[#2DD4BF]"
                        aria-hidden="true"
                      />
                      {roomImageBase64
                        ? 'Room Photo Attached (Vision Active)'
                        : 'Attach Room / Stove Photo'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                {isSpecOpen && (
                  <div className="rounded-xl bg-[#F0ECE3]/70 dark:bg-[#1E2B29] p-3 text-[11px] space-y-1 text-[#4B5B59] dark:text-[#A7B8B5]">
                    <div>
                      <strong className="text-[#1A2423] dark:text-[#F1F5F4]">Guardrails:</strong>{' '}
                      {agent.guardrails}
                    </div>
                    <div>
                      <strong className="text-[#1A2423] dark:text-[#F1F5F4]">Refusal Policy:</strong>{' '}
                      {agent.refusalPolicy}
                    </div>
                  </div>
                )}

                {res?.status === 'error' && (
                  <div
                    role="alert"
                    className="rounded-xl border border-[#C2410C]/40 bg-[#C2410C]/10 p-3 text-xs text-[#C2410C] dark:text-[#FB923C] flex items-start gap-2"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{res.error || 'Agent execution failed.'}</span>
                  </div>
                )}

                {res?.status === 'completed' && isExpanded && (
                  <div className="rounded-xl bg-[#FAF7F2] dark:bg-[#0E1514] border border-[#E2DDD2] dark:border-[#283836] p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#4B5B59] dark:text-[#A7B8B5]">
                      <span className="flex items-center gap-1.5 font-semibold text-[#0F766E] dark:text-[#2DD4BF]">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
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
                          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
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
                              <MapPin className="w-3 h-3" aria-hidden="true" /> Google Maps Grounded
                              Sources
                            </>
                          ) : (
                            <>
                              <Search className="w-3 h-3" aria-hidden="true" /> Google Search Grounded
                              Sources
                            </>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                          {res.groundingLinks.map((g) => {
                            const safeHref = sanitizeHttpUrl(g.uri);
                            if (!safeHref) return null;
                            return (
                              <a
                                key={safeHref}
                                href={safeHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-[#0F766E] dark:text-[#2DD4BF] hover:underline"
                              >
                                <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                                <span className="truncate max-w-[260px]">{g.title}</span>
                              </a>
                            );
                          })}
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
});
