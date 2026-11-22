import React, { useEffect, useState } from 'react';
import { Clock, IndianRupee, Leaf, Gauge } from 'lucide-react';
import { AirQuality3DScene } from './AirQuality3DScene.tsx';
import { runDigitalTwinSimulation } from '../lib/deterministicEngines.ts';
import type {
  HouseholdState,
  TwinScenarioInput,
  TwinScenarioResult,
} from '../types/breatheasy.ts';

interface Props {
  household: HouseholdState;
}

const PRESETS: { id: TwinScenarioInput['presetId']; label: string }[] = [
  { id: 'leave_earlier', label: 'Leave 30 mins earlier' },
  { id: 'metro_vs_auto', label: 'Metro vs Open Auto' },
  { id: 'exercise_indoors', label: 'Move Walk Indoors' },
  { id: 'seal_bedroom', label: 'Seal Bedroom Gaps' },
  { id: 'purifier_4h', label: 'Run HEPA Purifier 4h' },
];

export const DigitalTwinView: React.FC<Props> = ({ household }) => {
  const [presetId, setPresetId] = useState<TwinScenarioInput['presetId']>('metro_vs_auto');
  const [roomSealed, setRoomSealed] = useState(true);
  const [purifierActive, setPurifierActive] = useState(true);
  const [purifierHours, setPurifierHours] = useState(4);
  const [result, setResult] = useState<TwinScenarioResult>(() =>
    runDigitalTwinSimulation({
      presetId: 'metro_vs_auto',
      ambientPm25: household.city.baselinePm25,
      roomSqft: household.roomSqft,
      durationMin: 35,
      purifierHours: 4,
      roomSealed: true,
    }),
  );

  useEffect(() => {
    let active = true;
    const payload: TwinScenarioInput = {
      presetId,
      ambientPm25: household.city.baselinePm25,
      roomSqft: household.roomSqft,
      durationMin: 35,
      purifierHours,
      roomSealed,
    };
    fetch('/api/twin/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((data) => {
        if (active && data?.title) setResult(data);
      })
      .catch(() => {
        if (active) setResult(runDigitalTwinSimulation(payload));
      });
    return () => {
      active = false;
    };
  }, [presetId, household.city.baselinePm25, household.roomSqft, purifierHours, roomSealed]);

  return (
    <div className="space-y-6">
      {/* Interactive 3D Airshed & Household Safe Room */}
      <AirQuality3DScene
        pm25={household.city.baselinePm25}
        windKmh={household.city.windKmh}
        roomSealed={roomSealed}
        purifierActive={purifierActive}
        commuteMode={household.commuteMode}
        onToggleSeal={() => setRoomSealed((v) => !v)}
        onTogglePurifier={() => setPurifierActive((v) => !v)}
      />

      {/* Digital Twin Lite What-If Simulator */}
      <section className="rounded-2xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-[#0F766E] dark:text-[#2DD4BF]">
              Deterministic Physics &amp; Impact Translator · Modeled Estimates Only
            </div>
            <h2 className="font-display text-xl font-bold mt-0.5">
              Air Quality Digital Twin — &quot;What-If&quot; Scenario Comparison
            </h2>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-2 font-medium">
              Purifier Runtime:
              <input
                type="range"
                min={1}
                max={12}
                value={purifierHours}
                onChange={(e) => setPurifierHours(Number(e.target.value))}
                className="accent-[#0F766E]"
              />
              <span className="font-mono-tabular font-semibold">{purifierHours}h</span>
            </label>
          </div>
        </div>

        {/* Scenario Selector */}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPresetId(p.id)}
              className={`min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                presetId === p.id
                  ? 'bg-[#0F766E] text-white'
                  : 'bg-[#F0ECE3] dark:bg-[#1E2B29] text-[#1A2423] dark:text-[#F1F5F4] hover:bg-[#E2DDD2] dark:hover:bg-[#283836]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Impact Card */}
        <div className="rounded-2xl bg-[#FAF7F2] dark:bg-[#0E1514] border border-[#E2DDD2] dark:border-[#283836] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-lg font-bold">{result.title}</h3>
            <span className="text-xs font-medium text-[#4B5B59] dark:text-[#A7B8B5]">
              Confidence: <strong className="uppercase">{result.confidence}</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-3.5">
              <div className="text-xs text-[#4B5B59] dark:text-[#A7B8B5] flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-[#0F766E] dark:text-[#2DD4BF]" /> Modeled PM2.5 Change
              </div>
              <div className="font-mono-tabular text-xl font-bold text-[#0F766E] dark:text-[#2DD4BF] mt-1">
                {result.exposureChangePctRange[0]}% to {result.exposureChangePctRange[1]}%
              </div>
              <div className="text-[11px] text-[#4B5B59] dark:text-[#A7B8B5] font-mono-tabular mt-0.5">
                {result.baselineRangeUgM3[0]}–{result.baselineRangeUgM3[1]} →{' '}
                {result.whatIfRangeUgM3[0]}–{result.whatIfRangeUgM3[1]} µg/m³
              </div>
            </div>

            <div className="rounded-xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-3.5">
              <div className="text-xs text-[#4B5B59] dark:text-[#A7B8B5] flex items-center gap-1.5">
                <IndianRupee className="w-3.5 h-3.5 text-[#0F766E] dark:text-[#2DD4BF]" /> Estimated Cost Impact
              </div>
              <div className="font-mono-tabular text-xl font-bold mt-1">
                {result.costDiffInr === 0
                  ? '₹0'
                  : result.costDiffInr < 0
                    ? `Saves ₹${Math.abs(result.costDiffInr)}`
                    : `+₹${result.costDiffInr}`}
              </div>
              <div className="text-[11px] text-[#4B5B59] dark:text-[#A7B8B5] mt-0.5">
                Budget-transparent comparison
              </div>
            </div>

            <div className="rounded-xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-3.5">
              <div className="text-xs text-[#4B5B59] dark:text-[#A7B8B5] flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#0F766E] dark:text-[#2DD4BF]" /> Schedule Trade-off
              </div>
              <div className="font-mono-tabular text-xl font-bold mt-1">
                {result.timeDiffMin === 0
                  ? 'Same duration'
                  : result.timeDiffMin < 0
                    ? `${Math.abs(result.timeDiffMin)}m faster`
                    : `+${result.timeDiffMin}m`}
              </div>
              <div className="text-[11px] text-[#4B5B59] dark:text-[#A7B8B5] mt-0.5">
                Routine timing impact
              </div>
            </div>

            <div className="rounded-xl bg-[#FFFFFF] dark:bg-[#16201F] border border-[#E2DDD2] dark:border-[#283836] p-3.5">
              <div className="text-xs text-[#4B5B59] dark:text-[#A7B8B5] flex items-center gap-1.5">
                <Leaf className="w-3.5 h-3.5 text-[#0F766E] dark:text-[#2DD4BF]" /> Carbon Impact
              </div>
              <div className="font-mono-tabular text-xl font-bold mt-1">
                {result.co2Defensible && result.co2SavedKg !== null
                  ? `${result.co2SavedKg} kg CO₂e`
                  : 'Health Protection Only'}
              </div>
              <div className="text-[11px] text-[#4B5B59] dark:text-[#A7B8B5] mt-0.5">
                {result.co2Defensible ? 'DEFRA modal shift factor' : 'Omitted when non-defensible'}
              </div>
            </div>
          </div>

          <p className="text-sm font-medium text-[#1A2423] dark:text-[#F1F5F4]">{result.verdict}</p>

          <ul className="text-xs text-[#4B5B59] dark:text-[#A7B8B5] list-disc pl-5 space-y-1">
            {result.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
};
