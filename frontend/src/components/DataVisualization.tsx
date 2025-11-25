// This component is responsible for displaying all the visualizations
// based on the data received from the AI.

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import CodeSnippet from "./CodeSnippet";
import InteractiveOceanMap from "@/components/InteractiveOceanMap";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { BarChart2, Globe2, LineChart, Code2, Copy, Check } from "lucide-react";
import type { DataFilters } from "@/services/api";

const Plot = lazy(() => import("react-plotly.js"));

type PersonaMode = "guided" | "expert";

type FocusMetric = "temperature" | "salinity" | "pressure" | "oxygen" | "density";

interface ExpertFilters {
  focusMetric: FocusMetric;
  floatId?: string;
  depthRange?: [number | null, number | null];
}

interface DataSynopsis {
  signature: string;
  headline: string;
  highlights: string[];
  columns: string[];
  sampleFloat?: string;
  dateWindow?: { start: string | null; end: string | null };
}

interface DataVisualizationProps {
  data: Record<string, any>[];
  sqlQuery: string;
  mode: PersonaMode;
  synopsis: DataSynopsis | null;
  filters: ExpertFilters;
  onFiltersChange: Dispatch<SetStateAction<ExpertFilters>>;
  activeTab: string;
  onTabChange: (nextTab: string) => void;
}

const metricLabels: Record<FocusMetric, string> = {
  temperature: "Temperature (°C)",
  salinity: "Salinity (PSU)",
  pressure: "Pressure (dbar)",
  oxygen: "Oxygen (µmol/kg)",
  density: "Density (kg/m³)",
};

const metricKeys: Record<FocusMetric, string> = {
  temperature: "temperature",
  salinity: "salinity",
  pressure: "pressure",
  oxygen: "oxygen",
  density: "density",
};

const formatNumber = (value: number | null, maximumFractionDigits = 2) => {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
};

const computeStats = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, val) => acc + val, 0);
  const mean = sum / values.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[(sorted.length - 1) / 2];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
  const stddev = Math.sqrt(variance);

  return { mean, median, min, max, stddev, count: values.length };
};

const extractNumericValues = (rows: Record<string, any>[], key: string) =>
  rows
    .map((row) => (typeof row[key] === "number" && !Number.isNaN(row[key]) ? (row[key] as number) : null))
    .filter((value): value is number => value !== null);

const normalizeCoordinate = (row: Record<string, any>, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
};

const PlotFallback = ({ label }: { label: string }) => (
  <div className="flex h-full min-h-[260px] w-full items-center justify-center text-[0.65rem] uppercase tracking-[0.28em] text-subtle">
    {label}
  </div>
);

const DataVisualization = ({
  data,
  sqlQuery,
  mode,
  synopsis,
  filters,
  onFiltersChange,
  activeTab,
  onTabChange,
}: DataVisualizationProps) => {
  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    const allowedTabs = ["analysis", "map", "profiles", "sql"];
    if (!allowedTabs.includes(activeTab)) {
      onTabChange("analysis");
    }
  }, [activeTab, onTabChange]);

  const safeActiveTab = useMemo(() => {
    const allowed = new Set(["analysis", "map", "profiles", "sql"]);
    return allowed.has(activeTab) ? activeTab : "analysis";
  }, [activeTab]);

  const filteredData = useMemo(() => {
    if (mode !== "expert") {
      return data;
    }

    let next = [...data];

    if (filters.floatId) {
      next = next.filter((row) => String(row.float_id) === filters.floatId);
    }

    if (filters.depthRange && filters.depthRange[0] !== null) {
      const [minDepth, maxDepth] = filters.depthRange;
      next = next.filter((row) => {
        const depth = row.pressure;
        if (typeof depth !== "number" || Number.isNaN(depth)) return false;
        if (minDepth !== null && depth < minDepth) return false;
        if (maxDepth !== null && depth > maxDepth) return false;
        return true;
      });
    }

    return next;
  }, [data, filters, mode]);

  const workingData = filteredData;

  const mapFilters = useMemo<DataFilters | undefined>(() => {
    const next: DataFilters = {};
    if (filters.floatId) {
      next.floatIds = [filters.floatId];
    }
    if (filters.focusMetric) {
      next.parameter = filters.focusMetric;
    }
    return Object.keys(next).length ? next : undefined;
  }, [filters.floatId, filters.focusMetric]);

  const highlightedFloatIds = useMemo(() => {
    if (filters.floatId) {
      return [filters.floatId];
    }

    const ids = new Set<string>();
    for (const row of workingData) {
      const candidate = row.float_id ?? row.float ?? row.id;
      if (typeof candidate === "string" && candidate.trim()) {
        ids.add(candidate.trim());
      } else if (typeof candidate === "number" && Number.isFinite(candidate)) {
        ids.add(String(candidate));
      }

      if (ids.size >= 12) {
        break;
      }
    }

    return Array.from(ids);
  }, [filters.floatId, workingData]);

  const locationPoints = useMemo(
    () =>
      workingData
        .map((row) => {
          const lat = normalizeCoordinate(row, ["latitude", "lat"]);
          const lon = normalizeCoordinate(row, ["longitude", "lon", "lng"]);

          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            return {
              lat,
              lon,
              floatId: row.float_id ?? "n/a",
            };
          }
          return null;
        })
        .filter((point): point is { lat: number; lon: number; floatId: string | number } => point !== null),
    [workingData],
  );

  const hasLocationData = locationPoints.length > 0;
  const hasTempProfileData = useMemo(
    () => workingData.length > 0 && "temperature" in workingData[0] && "pressure" in workingData[0],
    [workingData],
  );
  const hasSalProfileData = useMemo(
    () => workingData.length > 0 && "salinity" in workingData[0] && "pressure" in workingData[0],
    [workingData],
  );

  const floatOptions = useMemo(() => {
    const floats = new Set<string>();
    data.forEach((row) => {
      if (row.float_id !== undefined && row.float_id !== null) {
        floats.add(String(row.float_id));
      }
    });
    return Array.from(floats).slice(0, 24);
  }, [data]);

  const depthBounds = useMemo(() => {
    const depths = data
      .map((row) => (typeof row.pressure === "number" && !Number.isNaN(row.pressure) ? (row.pressure as number) : null))
      .filter((value): value is number => value !== null);
    if (!depths.length) return null;
    return {
      min: Math.min(...depths),
      max: Math.max(...depths),
    };
  }, [data]);

  const depthSliderValue = useMemo(() => {
    if (filters.depthRange) {
      return filters.depthRange.map((value, index) => {
        if (value === null && depthBounds) {
          return index === 0 ? depthBounds.min : depthBounds.max;
        }
        return value ?? 0;
      }) as [number, number];
    }

    if (depthBounds) {
      return [depthBounds.min, depthBounds.max] as [number, number];
    }

    return [0, 0] as [number, number];
  }, [filters.depthRange, depthBounds]);

  const metricValues = useMemo(
    () => extractNumericValues(workingData, metricKeys[filters.focusMetric]),
    [workingData, filters.focusMetric],
  );

  const metricStats = useMemo(() => computeStats(metricValues), [metricValues]);
  const overviewStats = useMemo(() => {
    const records = workingData.length;
    const columns = workingData.length ? Object.keys(workingData[0]).length : 0;
    const floats = new Set(
      workingData
        .map((row) => row.float_id ?? row.float ?? row.id)
        .filter((id) => id !== undefined && id !== null)
        .map((id) => String(id)),
    ).size;
    return { records, columns, floats };
  }, [workingData]);

  const sampleFloatId = useMemo(() => {
    for (const row of workingData) {
      const candidate = row.float_id ?? row.float ?? row.id;
      if (candidate !== undefined && candidate !== null) {
        return String(candidate);
      }
    }
    return null;
  }, [workingData]);

  const updateFilters = (partial: Partial<ExpertFilters>) => {
    onFiltersChange((prev) => ({ ...prev, ...partial }));
  };

  const handleDepthChange = (value: number[]) => {
    if (!depthBounds || value.length !== 2) return;
    updateFilters({ depthRange: [value[0], value[1]] });
  };

  const handleFloatChange = (value: string) => {
    updateFilters({ floatId: value === "all" ? undefined : value });
  };

  const selectedFloat = filters.floatId ?? "all";

  const isDepthFiltered = useMemo(() => {
    if (!depthBounds || !filters.depthRange) return false;
    const [min, max] = filters.depthRange;
    return (min !== null && min > depthBounds.min) || (max !== null && max < depthBounds.max);
  }, [depthBounds, filters.depthRange]);

  const trimmedSql = sqlQuery.trim();
  const hasSql = trimmedSql.length > 0;

  const sqlLineCount = useMemo(
    () => (hasSql ? trimmedSql.split(/\r?\n/).length : 0),
    [hasSql, trimmedSql],
  );

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (filters.floatId) {
      parts.push(`Float ${filters.floatId}`);
    }
    if (isDepthFiltered) {
      const [minDepth, maxDepth] = depthSliderValue;
      parts.push(`${Math.round(minDepth)}–${Math.round(maxDepth)} dbar`);
    }
    if (filters.focusMetric) {
      parts.push(metricLabels[filters.focusMetric]);
    }
    return parts.length ? parts.join(" • ") : "None";
  }, [depthSliderValue, filters.floatId, filters.focusMetric, isDepthFiltered]);

  const handleCopySql = useCallback(() => {
    if (!hasSql) return;

    navigator.clipboard
      ?.writeText(trimmedSql)
      .then(() => {
        setCopiedSql(true);
        window.setTimeout(() => setCopiedSql(false), 1200);
      })
      .catch(() => setCopiedSql(false));
  }, [hasSql, trimmedSql]);

  // This is the view when the app first loads or when a query returns no data.
  if (data.length === 0) {
    return (
      <div className="viewscreen-stage flex h-full flex-col items-center justify-center gap-6 text-center text-slate-700 dark:text-slate-200">
        <div className="relative z-10 max-w-sm space-y-4">
          <p className="control-label text-slate-500 dark:text-slate-300">Analysis workspace</p>
          <h3 className="text-2xl font-semibold">No results yet</h3>
          <p className="text-sm leading-relaxed text-subtle">
            Run a query to load profiles, maps, or tables. Use the Overview or Command Palette to pick a starting point.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 text-sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="control-label text-slate-500 dark:text-slate-300">Analysis workspace</p>
            <h2 className="mt-2 text-2xl font-semibold leading-tight">Mission telemetry</h2>
          </div>
          <div className="rounded-full border border-white/30 bg-white/70 px-4 py-1 text-[0.7rem] uppercase tracking-[0.32em] text-slate-500 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300">
            Live feed
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryChip label="Records" value={overviewStats.records.toLocaleString()} />
          <SummaryChip label="Fields" value={overviewStats.columns.toLocaleString()} />
          <SummaryChip label="Floats" value={overviewStats.floats.toLocaleString()} />
        </div>
      </div>

      {synopsis && (
        <div className="rounded-[24px] border border-white/25 bg-white/75 p-6 shadow-[0_25px_50px_-35px_rgba(15,23,42,0.5)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06]">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-300">Data briefing</p>
          <h4 className="mt-2 text-lg font-semibold text-slate-800 dark:text-slate-100">{synopsis.headline}</h4>
          <ul className="mt-4 grid gap-2 text-sm text-subtle md:grid-cols-2">
            {synopsis.highlights.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-sky-400" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          {synopsis.sampleFloat && (
            <p className="mt-4 text-xs uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
              Example float: {synopsis.sampleFloat}
            </p>
          )}
        </div>
      )}

      {mode === "expert" && metricStats && (
        <div className="grid gap-4 rounded-[24px] border border-white/20 bg-white/65 p-6 shadow-[0_25px_50px_-35px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.05]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="control-label text-slate-500 dark:text-slate-300">Metric spotlight</p>
              <h4 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{metricLabels[filters.focusMetric]}</h4>
            </div>
            <Badge className="rounded-full bg-slate-900 px-4 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.32em] text-white dark:bg-white/80 dark:text-slate-900">
              n = {metricStats.count}
            </Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatPill label="Mean" value={formatNumber(metricStats.mean)} />
            <StatPill label="Median" value={formatNumber(metricStats.median)} />
            <StatPill label="Min" value={formatNumber(metricStats.min)} />
            <StatPill label="Max" value={formatNumber(metricStats.max)} />
            <StatPill label="Std Dev" value={formatNumber(metricStats.stddev)} />
          </div>
        </div>
      )}

      {mode === "expert" && (
        <div className="rounded-[24px] border border-white/20 bg-white/65 p-6 shadow-[0_25px_50px_-40px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.06]">
          <div className="grid gap-6 md:grid-cols-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-300">Float focus</p>
              <Select value={selectedFloat} onValueChange={handleFloatChange}>
                <SelectTrigger className="w-full rounded-xl border border-white/30 bg-white/80 text-sm text-slate-600 shadow-sm focus:ring-0 dark:border-white/10 dark:bg-white/[0.08] dark:text-slate-100">
                  <SelectValue placeholder="All floats" />
                </SelectTrigger>
                <SelectContent className="max-h-60 overflow-y-auto rounded-xl border border-white/20 bg-white/95 dark:border-white/10 dark:bg-slate-900/95">
                  <SelectItem value="all">All floats</SelectItem>
                  {floatOptions.map((id) => (
                    <SelectItem key={id} value={id}>
                      Float {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3 md:col-span-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-300">Depth window (dbar)</p>
                  {isDepthFiltered && (
                    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.28em] text-sky-600 dark:bg-sky-400/20 dark:text-sky-300">
                      Active
                    </span>
                  )}
                </div>
                {depthBounds && isDepthFiltered && (
                  <button
                    onClick={() => updateFilters({ depthRange: [depthBounds.min, depthBounds.max] })}
                    className="text-xs font-medium text-sky-500 transition-colors hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300"
                  >
                    Reset
                  </button>
                )}
              </div>
              {depthBounds ? (
                <div className="space-y-3">
                  <Slider
                    value={depthSliderValue}
                    min={Math.floor(depthBounds.min)}
                    max={Math.ceil(depthBounds.max)}
                    step={10}
                    minStepsBetweenThumbs={1}
                    onValueChange={handleDepthChange}
                    className="w-full"
                  />
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200/60 bg-white/60 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
                      <span className="text-[0.65rem] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Min</span>
                      <span className="font-bold">{Math.round(depthSliderValue[0])}</span>
                    </div>
                    <div className="h-px flex-1 bg-gradient-to-r from-slate-200/60 via-slate-300/40 to-slate-200/60 dark:from-white/10 dark:via-white/5 dark:to-white/10" />
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200/60 bg-white/60 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
                      <span className="text-[0.65rem] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Max</span>
                      <span className="font-bold">{Math.round(depthSliderValue[1])}</span>
                    </div>
                  </div>
                  <p className="text-[0.7rem] text-slate-500 dark:text-slate-400">
                    Filtering {workingData.length} of {data.length} records in range
                  </p>
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-white/40 p-4 text-xs text-slate-500 dark:border-white/15 dark:text-slate-300">
                  Depth filtering unavailable for this result set.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-300">Metric lens</p>
              <Select value={filters.focusMetric} onValueChange={(value) => updateFilters({ focusMetric: value as FocusMetric })}>
                <SelectTrigger className="w-full rounded-xl border border-white/30 bg-white/80 text-sm text-slate-600 shadow-sm focus:ring-0 dark:border-white/10 dark:bg-white/[0.08] dark:text-slate-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border border-white/20 bg-white/95 dark:border-white/10 dark:bg-slate-900/95">
                  {Object.entries(metricLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      <Tabs value={safeActiveTab} onValueChange={onTabChange} className="flex flex-1 min-h-0 flex-col gap-6">
        <TabsList className="mx-auto inline-flex h-auto shrink-0 flex-wrap items-center justify-center gap-2 bg-transparent p-0 text-inherit">
          <TabsTrigger value="analysis" className="flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-center text-xs font-medium uppercase tracking-[0.28em] text-slate-500 transition data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm dark:data-[state=active]:bg-white/10 dark:data-[state=active]:text-white">
            <span className="inline-flex h-4 w-4 items-center justify-center"><BarChart2 className="h-3.5 w-3.5" /></span>
            Analysis
          </TabsTrigger>
          <TabsTrigger value="map" className="flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-center text-xs font-medium uppercase tracking-[0.28em] text-slate-500 transition data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm dark:data-[state=active]:bg-white/10 dark:data-[state=active]:text-white">
            <span className="inline-flex h-4 w-4 items-center justify-center"><Globe2 className="h-3.5 w-3.5" /></span>
            Ocean Map
          </TabsTrigger>
          <TabsTrigger value="profiles" className="flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-center text-xs font-medium uppercase tracking-[0.28em] text-slate-500 transition data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm dark:data-[state=active]:bg-white/10 dark:data-[state=active]:text-white">
            <span className="inline-flex h-4 w-4 items-center justify-center"><LineChart className="h-3.5 w-3.5" /></span>
            Profiles
          </TabsTrigger>
          <TabsTrigger value="sql" className="flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-center text-xs font-medium uppercase tracking-[0.28em] text-slate-500 transition data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm dark:data-[state=active]:bg-white/10 dark:data-[state=active]:text-white">
            <span className="inline-flex h-4 w-4 items-center justify-center"><Code2 className="h-3.5 w-3.5" /></span>
            SQL
          </TabsTrigger>
        </TabsList>

        {safeActiveTab === "analysis" && (
          <TabsContent value="analysis" className="mt-2 flex flex-1 min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/20 bg-white/85 p-6 shadow-[0_35px_70px_-50px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.05] dark:shadow-[0_45px_90px_-55px_rgba(2,6,23,0.85)]">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Raw data {`(${workingData.length} records)`}</h3>
            {workingData.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500 dark:text-slate-300">
                Filters removed all rows. Adjust your focus above to bring data back into view.
              </div>
            ) : (
              <div className="mt-4 flex-1 overflow-hidden">
                <ScrollArea className="data-scroll h-full max-h-[60vh] rounded-2xl border border-white/40 bg-white/75 shadow-lg shadow-slate-900/5 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.05] dark:shadow-black/30">
                  <div className="min-w-full">
                    <table className="min-w-full divide-y divide-slate-200 text-sm leading-relaxed dark:divide-white/10">
                      <thead className="sticky top-0 z-20 bg-white/95 text-[0.7rem] uppercase tracking-[0.28em] text-slate-500 shadow-[0_8px_16px_-12px_rgba(15,23,42,0.3)] backdrop-blur supports-[backdrop-filter]:bg-white/85 dark:bg-slate-950/85 dark:text-slate-200 dark:shadow-[0_8px_16px_-12px_rgba(2,6,23,0.65)]">
                        <tr>
                          {Object.keys(workingData[0]).map((key) => (
                            <th key={key} className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-100">
                              {key.replace(/_/g, " ")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/70 bg-white/80 text-slate-700 dark:divide-white/5 dark:bg-white/[0.03] dark:text-slate-100">
                        {workingData.map((row, i) => (
                          <tr key={i} className="transition-colors hover:bg-sky-50/80 dark:hover:bg-white/[0.08]">
                            {Object.values(row).map((val, j) => (
                              <td key={j} className="px-4 py-3 font-medium">
                                {String(val ?? "—")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </ScrollArea>
              </div>
            )}
          </TabsContent>
        )}

        {safeActiveTab === "map" && (
          <TabsContent value="map" className="mt-2 flex flex-1 min-h-0 overflow-hidden">
            <div className="flex flex-1 flex-col gap-4 overflow-hidden rounded-[28px] border border-white/5 bg-white/[0.03] p-4 shadow-[0_25px_60px_-50px_rgba(15,23,42,0.6)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.03]">
              <InteractiveOceanMap
                filters={mapFilters}
                highlightedFloats={highlightedFloatIds}
                queryPoints={hasLocationData ? locationPoints : undefined}
              />
              <p className="px-2 pb-1 text-xs text-muted-foreground">
                {hasLocationData
                  ? "Plotting your query results directly on the fleet map and highlighting matching telemetry."
                  : "Showing the live fleet from telemetry. Your latest query did not return coordinates, so only fleet context is shown."}
              </p>
            </div>
          </TabsContent>
        )}

        {safeActiveTab === "sql" && (
          <TabsContent value="sql" className="mt-2 flex flex-1 min-h-0 flex-col gap-5 overflow-hidden rounded-[28px] border border-white/20 bg-white/90 p-6 shadow-[0_35px_70px_-50px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.06]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="control-label text-slate-500 dark:text-slate-300">Query receipt</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-800 dark:text-slate-100">Audited SQL &amp; data contract</h3>
                <p className="text-sm text-subtle">
                  {hasSql
                    ? "Copy, audit, or share the exact SQL the assistant executed for this view."
                    : "Run any prompt to generate verifiable SQL. Results will land here instantly."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full border border-white/30 bg-white/70 px-4 font-semibold text-slate-700 shadow-sm backdrop-blur hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/[0.08] dark:text-slate-100"
                  onClick={() => onTabChange("analysis")}
                >
                  View data
                </Button>
                <Button
                  size="sm"
                  className="rounded-full bg-gradient-ocean px-4 font-semibold shadow-lg shadow-sky-500/20 transition hover:-translate-y-0.5"
                  onClick={handleCopySql}
                  disabled={!hasSql}
                >
                  {copiedSql ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                  {copiedSql ? "Copied" : "Copy SQL"}
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryChip label="Mode" value={mode === "expert" ? "Expert" : "Guided"} />
              <SummaryChip label="Filters" value={filterSummary} />
              <SummaryChip label="Lines" value={sqlLineCount ? sqlLineCount.toString() : "—"} />
            </div>

            <div className="flex min-h-[260px] flex-1 flex-col overflow-hidden rounded-[24px] border border-white/25 bg-slate-950/80 shadow-[0_30px_70px_-55px_rgba(15,23,42,0.65)] backdrop-blur-xl dark:border-white/15">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs uppercase tracking-[0.26em] text-slate-200/80">
                <span>SQL output</span>
                <span className="text-[0.65rem] text-slate-300">
                  {mode === "expert" ? "Manual filters" : "Guided"} · {sqlLineCount || "0"} lines
                </span>
              </div>
              <div className="flex-1 overflow-hidden">
                <CodeSnippet
                  code={hasSql ? trimmedSql : "No SQL available yet. Ask a question or run a prompt to generate the query."}
                  language="sql"
                  className="h-full bg-slate-950/70 text-slate-100"
                />
              </div>
            </div>

            {synopsis && (
              <div className="rounded-2xl border border-white/25 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.05]">
                <p className="text-[0.7rem] uppercase tracking-[0.26em] text-slate-500 dark:text-slate-300">Result context</p>
                <div className="mt-2 grid gap-2 text-sm text-subtle md:grid-cols-2">
                  {synopsis.highlights.map((line) => (
                    <div key={line} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-sky-400" />
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
                {synopsis.sampleFloat && (
                  <p className="mt-3 text-xs uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
                    Sample float: {synopsis.sampleFloat}
                  </p>
                )}
              </div>
            )}
          </TabsContent>
        )}

        {safeActiveTab === "profiles" && (
          <TabsContent value="profiles" className="mt-2 grid flex-1 min-h-0 grid-cols-1 gap-4 overflow-auto rounded-[28px] border border-white/20 bg-white/85 p-6 shadow-[0_35px_70px_-50px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.05] dark:shadow-[0_45px_90px_-55px_rgba(2,6,23,0.85)] md:grid-cols-2">
            {hasTempProfileData || hasSalProfileData ? (
              <>
                {hasTempProfileData ? (
                  <Suspense fallback={<PlotFallback label="Loading temperature profile" />}>
                    <Plot
                      data={[
                        {
                          x: workingData.map((r) => r.temperature),
                          y: workingData.map((r) => r.pressure),
                          mode: "lines+markers",
                          line: { color: "#0ea5e9", width: 3, shape: "spline", smoothing: 0.6 },
                          marker: { color: "#0ea5e9", size: 6, opacity: 0.8, symbol: "circle" },
                        },
                      ]}
                      layout={{
                        title: { text: "Temperature vs. Depth", font: { size: 14, color: "#e2e8f0" } },
                        paper_bgcolor: "rgba(0,0,0,0)",
                        plot_bgcolor: "rgba(15,23,42,0.25)",
                        font: { color: "#e2e8f0" },
                        yaxis: {
                          autorange: "reversed",
                          title: { text: "Pressure (dbar)", font: { color: "#cbd5e1" } },
                          tickfont: { color: "#cbd5e1" },
                          gridcolor: "rgba(148, 163, 184, 0.25)",
                          zeroline: false,
                        },
                        xaxis: {
                          title: { text: "Temperature (°C)", font: { color: "#cbd5e1" } },
                          tickfont: { color: "#cbd5e1" },
                          gridcolor: "rgba(148, 163, 184, 0.25)",
                          zeroline: false,
                        },
                        margin: { t: 24, r: 12, b: 48, l: 48 },
                        hoverlabel: { bgcolor: "#0f172a", bordercolor: "#0ea5e9", font: { color: "#e2e8f0" } },
                      }}
                      style={{ width: "100%", height: "360px" }}
                      useResizeHandler
                    />
                  </Suspense>
                ) : (
                  <div className="flex items-center justify-center rounded-2xl border border-dashed border-white/40 p-6 text-sm text-slate-500 dark:border-white/15 dark:text-slate-300">
                    Temperature profiles unavailable for this selection.
                  </div>
                )}

                {hasSalProfileData ? (
                  <Suspense fallback={<PlotFallback label="Loading salinity profile" />}>
                    <Plot
                      data={[
                        {
                          x: workingData.map((r) => r.salinity),
                          y: workingData.map((r) => r.pressure),
                          mode: "lines+markers",
                          line: { color: "#6366f1", width: 3, shape: "spline", smoothing: 0.6 },
                          marker: { color: "#6366f1", size: 6, opacity: 0.85, symbol: "square" },
                        },
                      ]}
                      layout={{
                        title: { text: "Salinity vs. Depth", font: { size: 14, color: "#e2e8f0" } },
                        paper_bgcolor: "rgba(0,0,0,0)",
                        plot_bgcolor: "rgba(15,23,42,0.25)",
                        font: { color: "#e2e8f0" },
                        yaxis: {
                          autorange: "reversed",
                          title: { text: "Pressure (dbar)", font: { color: "#cbd5e1" } },
                          tickfont: { color: "#cbd5e1" },
                          gridcolor: "rgba(148, 163, 184, 0.25)",
                          zeroline: false,
                        },
                        xaxis: {
                          title: { text: "Salinity (PSU)", font: { color: "#cbd5e1" } },
                          tickfont: { color: "#cbd5e1" },
                          gridcolor: "rgba(148, 163, 184, 0.25)",
                          zeroline: false,
                        },
                        margin: { t: 24, r: 12, b: 48, l: 48 },
                        hoverlabel: { bgcolor: "#0f172a", bordercolor: "##6366f1", font: { color: "#e2e8f0" } },
                      }}
                      style={{ width: "100%", height: "360px" }}
                      useResizeHandler
                    />
                  </Suspense>
                ) : (
                  <div className="flex items-center justify-center rounded-2xl border border-dashed border-white/40 p-6 text-sm text-slate-500 dark:border-white/15 dark:text-slate-300">
                    Salinity profiles unavailable for this selection.
                  </div>
                )}
              </>
            ) : (
              <div className="md:col-span-2">
                <div className="flex h-full flex-col justify-center gap-4 rounded-2xl border border-dashed border-white/30 bg-white/70 p-6 text-sm text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200">
                  <p className="text-base font-semibold">No profile data yet</p>
                  <p className="text-sm text-muted-foreground">
                    Profiles need temperature/salinity plus a depth/pressure column. Try requesting a profile for a specific float.
                  </p>
                  <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                    <li>Ask for: “Show the latest temperature profile for float {sampleFloatId ?? "XXXX"}.”</li>
                    <li>Ensure results include `pressure` (dbar) and a metric (temperature/salinity).</li>
                    <li>Switch to Expert mode and narrow depth or float filters for clearer plots.</li>
                  </ul>
                </div>
              </div>
            )}
          </TabsContent>
        )}

      </Tabs>
    </div>
  );
};

export default DataVisualization;

const StatPill = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-white/30 bg-white/80 p-4 shadow-[0_25px_45px_-35px_rgba(15,23,42,0.5)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.05]">
    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-300">{label}</p>
    <p className="mt-1 text-lg font-semibold text-slate-800 dark:text-slate-100">{value}</p>
  </div>
);

const SummaryChip = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-white/25 bg-white/75 px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.08] dark:text-slate-100">
    <p className="text-[0.7rem] uppercase tracking-[0.26em] text-slate-500 dark:text-slate-300">{label}</p>
    <p className="mt-1 text-lg">{value}</p>
  </div>
);
