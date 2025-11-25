// This is the main orchestrator for your entire frontend application.

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { LucideIcon } from "lucide-react";
import { Compass, CalendarDays, Database, X } from "lucide-react";
import ChatInterface from "@/components/ChatInterface";
import DataVisualization from "@/components/DataVisualization";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { askAI, floatAIAPI } from "@/services/api";
import CommandPalette from "@/components/CommandPalette";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ErrorBoundary from "@/components/ErrorBoundary";
import LandingPage from "@/components/LandingPage";

export interface AppData {
  data: Record<string, any>[];
  sqlQuery: string;
}

type PersonaMode = "guided" | "expert";

interface DataSynopsis {
  signature: string;
  headline: string;
  highlights: string[];
  columns: string[];
  sampleFloat?: string;
  dateWindow?: { start: string | null; end: string | null };
}

interface ExpertFilters {
  focusMetric: "temperature" | "salinity" | "pressure" | "oxygen" | "density";
  floatId?: string;
  depthRange?: [number | null, number | null];
}

const COMPLEXITY_THRESHOLD = 4;

const GUIDED_EXAMPLES = [
  "Where are the newest floats deployed this month?",
  "Compare temperature and salinity for float 2902273 at 1000 dbar.",
  "Summarize oxygen levels for floats in the North Atlantic.",
  "Explain the recent trends in mixed layer depth near 45°N, 30°W.",
];

type BackendStatus = "operational" | "degraded" | "offline";

const BACKEND_STATUS_MAP: Record<BackendStatus, { label: string; description: string; indicatorClass: string; pillClass: string }> = {
  operational: {
    label: "Operational",
    description: "All systems nominal.",
    indicatorClass: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]",
    pillClass: "bg-white/60 dark:bg-white/10",
  },
  degraded: {
    label: "Degraded",
    description: "Serving cached insights while the backend stabilizes.",
    indicatorClass: "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.45)]",
    pillClass: "bg-amber-50/90 dark:bg-amber-500/10",
  },
  offline: {
    label: "Offline",
    description: "Backend unreachable — verify the Python API server.",
    indicatorClass: "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.6)]",
    pillClass: "bg-rose-50/90 dark:bg-rose-500/10",
  },
};

const WELCOME_CACHE_KEY = "floatai::welcome-cache::v1";

const createDataSynopsis = (data: Record<string, any>[]): DataSynopsis | null => {
  if (!data.length) return null;

  const columns = Object.keys(data[0]);
  const floatIds = Array.from(
    new Set(
      data
        .map((row) => {
          const raw = row.float_id ?? row.float ?? row.id;
          if (raw === undefined || raw === null) return null;
          if (typeof raw === "string") {
            const trimmed = raw.trim();
            return trimmed.length ? trimmed : null;
          }
          try {
            return String(raw);
          } catch (error) {
            console.warn("createDataSynopsis: unable to normalize float identifier", error, { raw });
            return null;
          }
        })
        .filter((value): value is string => Boolean(value))
    )
  );

  const dateCandidates = [
    "profile_date",
    "observation_date",
    "date",
    "time",
  ];

  const parseDate = (value: unknown) => {
    if (!value) return null;
    const parsed = new Date(value as string);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  let earliest: Date | null = null;
  let latest: Date | null = null;

  for (const row of data) {
    for (const key of dateCandidates) {
      if (row[key]) {
        const parsed = parseDate(row[key]);
        if (!parsed) continue;
        if (!earliest || parsed < earliest) earliest = parsed;
        if (!latest || parsed > latest) latest = parsed;
      }
    }
  }

  const headline = `${data.length.toLocaleString()} records across ${floatIds.length || "several"} floats`;
  const highlights: string[] = [];

  if (floatIds.length) {
    highlights.push(`Sample float: ${floatIds.slice(0, 1).join(", ")}`);
  }

  if (earliest || latest) {
    const format = (date: Date | null) =>
      date
        ? date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : null;
    highlights.push(
      `Date window: ${format(earliest) || "n/a"} → ${format(latest) || "n/a"}`,
    );
  }

  const numericColumns = columns.filter((column) =>
    data.some((row) => typeof row[column] === "number" && !Number.isNaN(row[column]))
  );

  if (numericColumns.length) {
    highlights.push(`Numeric fields detected: ${numericColumns.slice(0, 3).join(", ")}${
      numericColumns.length > 3 ? "…" : ""
    }`);
  }

  return {
    signature: `${data.length}-${columns.join("|")}-${floatIds.length}`,
    headline,
    highlights,
    columns,
    sampleFloat: floatIds[0],
    dateWindow: {
      start: earliest ? earliest.toISOString() : null,
      end: latest ? latest.toISOString() : null,
    },
  };
};

function App() {
  const [appData, setAppData] = useState<AppData>({ data: [], sqlQuery: "" });
  const [showLanding, setShowLanding] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage?.getItem("floatai::landing-dismissed") !== "1";
  });
  const [isLoading, setIsLoading] = useState(true); // For the initial welcome map
  const [mode, setMode] = useState<PersonaMode>("guided");
  const [complexityScore, setComplexityScore] = useState(0);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showChatTray, setShowChatTray] = useState(true);
  const [dataSynopsis, setDataSynopsis] = useState<DataSynopsis | null>(null);
  const [activeTab, setActiveTab] = useState("analysis");
  const [expertFilters, setExpertFilters] = useState<ExpertFilters>({ focusMetric: "temperature" });
  const hasAutoOpenedPaletteRef = useRef(false);
  const [palettePrefill, setPalettePrefill] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("operational");
  const [backendStatusDetail, setBackendStatusDetail] = useState<string>(BACKEND_STATUS_MAP.operational.description);
  const [chatInstanceKey, setChatInstanceKey] = useState(0);
  const [fleetOverview, setFleetOverview] = useState<{
    totalFloats: number | null;
    activeFloats: number | null;
    lastUpdated: string | null;
  } | null>(null);

  const depthFilterLabel = useMemo(() => {
    if (!expertFilters.depthRange) return null;
    const [minDepth, maxDepth] = expertFilters.depthRange;
    if (minDepth !== null && maxDepth !== null) {
      return `${Math.round(minDepth)}-${Math.round(maxDepth)} dbar`;
    }
    if (minDepth !== null) return `≥ ${Math.round(minDepth)} dbar`;
    if (maxDepth !== null) return `≤ ${Math.round(maxDepth)} dbar`;
    return null;
  }, [expertFilters.depthRange]);

  const updateBackendStatus = useCallback((status: BackendStatus, detail?: string) => {
    setBackendStatus(status);
    const baseline = BACKEND_STATUS_MAP[status].description;
    setBackendStatusDetail(detail && detail.trim() ? detail : baseline);
  }, []);

  const persistWelcomeData = useCallback((payload: AppData) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage?.setItem(WELCOME_CACHE_KEY, JSON.stringify(payload));
    } catch (error) {
  console.warn("FloatAI: unable to persist welcome dataset", error);
    }
  }, []);

  const loadCachedWelcomeData = useCallback((): AppData | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage?.getItem(WELCOME_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.data) && typeof parsed.sqlQuery === "string") {
        return { data: parsed.data, sqlQuery: parsed.sqlQuery };
      }
    } catch (error) {
  console.warn("FloatAI: unable to load cached welcome dataset", error);
    }
    return null;
  }, []);

  const fetchInitialData = useCallback(async () => {
    const initialQuestion = "Show me the location of 100 recent floats.";
    console.log("Fetching initial data for welcome map...");

    updateBackendStatus("operational", "Requesting welcome telemetry...");
    setIsLoading(true);

    const maxAttempts = 3;
    let success = false;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await askAI(initialQuestion);

        if (response && !response.error && Array.isArray(response.result_data) && response.sql_query) {
          const payload: AppData = { data: response.result_data, sqlQuery: response.sql_query };
          setAppData(payload);
          setDataSynopsis(createDataSynopsis(response.result_data));
          persistWelcomeData(payload);
          updateBackendStatus("operational", "Live telemetry synced.");
          success = true;
          break;
        }

        if (response?.error) {
          console.warn("FloatAI: welcome fetch error", response.error);
        }
      } catch (error) {
  console.warn("FloatAI: welcome fetch attempt failed", error);
      }

      if (success) {
        break;
      }

      if (attempt < maxAttempts - 1) {
        const backoff = 400 * (attempt + 1) * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }

    if (!success) {
      const cached = loadCachedWelcomeData();
      if (cached) {
        setAppData(cached);
        setDataSynopsis(createDataSynopsis(cached.data));
        updateBackendStatus("degraded", "Loaded cached telemetry while the backend recovers.");
      } else {
        setAppData({ data: [], sqlQuery: "" });
        setDataSynopsis(null);
        updateBackendStatus("offline", "Initial telemetry failed. Backend unreachable.");
      }
    }

    setIsLoading(false);
  }, [loadCachedWelcomeData, persistWelcomeData, updateBackendStatus]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  useEffect(() => {
    let isMounted = true;

    const loadFleetSnapshot = async () => {
      try {
        const [stats, floats] = await Promise.all([
          floatAIAPI.getDatabaseStats(),
          floatAIAPI.getArgoFloats(),
        ]);

        if (!isMounted) {
          return;
        }

        const totalFloats = typeof stats?.total_floats === "number" ? stats.total_floats : Array.isArray(floats.data) ? floats.data.length : null;
        const activeFloats = Array.isArray(floats.data)
          ? floats.data.filter((item) => item.status?.toLowerCase() === "active").length
          : null;

        const lastUpdated = stats?.last_updated
          ?? (Array.isArray(floats.data) && floats.data.length ? floats.data[0]?.last_contact ?? null : null);

        setFleetOverview({
          totalFloats,
          activeFloats,
          lastUpdated,
        });
      } catch (error) {
        console.warn("FloatAI: failed to load fleet overview", error);
      }
    };

    loadFleetSnapshot();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key?.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "k") {
        event.preventDefault();
        setShowCommandPalette(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (mode === "expert" && complexityScore >= COMPLEXITY_THRESHOLD && !hasAutoOpenedPaletteRef.current) {
      hasAutoOpenedPaletteRef.current = true;
      setShowCommandPalette(true);
    }
  }, [mode, complexityScore]);

  const oceanMetrics = useMemo(() => {
    const baseMetrics = (() => {
      if (!appData.data.length) {
        return {
          totalRecords: "Waiting for data",
          uniqueFloats: "—",
          lastObservation: "—",
        };
      }

      const totalRecords = appData.data.length.toLocaleString();
      const uniqueFloats = new Set(
        appData.data
          .map((row) => row.float_id)
          .filter((id) => id !== undefined && id !== null)
      ).size;

      const mostRecentDate = appData.data
        .map((row) => row.profile_date || row.date || row.observation_date)
        .map((value) => {
          const parsed = value ? new Date(value) : null;
          return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
        })
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => b.getTime() - a.getTime())[0];

      return {
        totalRecords,
        uniqueFloats: uniqueFloats ? uniqueFloats.toLocaleString() : "—",
        lastObservation: mostRecentDate
          ? mostRecentDate.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "—",
      };
    })();

    if (!fleetOverview) {
      return baseMetrics;
    }

    const { totalFloats, activeFloats, lastUpdated } = fleetOverview;
    const merged = { ...baseMetrics };

    if (totalFloats !== null) {
      const activeDisplay =
        activeFloats !== null
          ? `${activeFloats.toLocaleString()} active / ${totalFloats.toLocaleString()} total`
          : totalFloats.toLocaleString();
      merged.uniqueFloats = activeDisplay;

      if (baseMetrics.totalRecords === "Waiting for data") {
        merged.totalRecords = totalFloats.toLocaleString();
      }
    }

    if (lastUpdated) {
      const parsed = new Date(lastUpdated);
      if (!Number.isNaN(parsed.getTime())) {
        merged.lastObservation = parsed.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
      }
    }

    return merged;
  }, [appData.data, fleetOverview]);

  const missionStatusDescriptor = useMemo(() => {
    const base = BACKEND_STATUS_MAP[backendStatus];
    const detail = backendStatusDetail && backendStatusDetail.trim() ? backendStatusDetail : base.description;
    return {
      ...base,
      description: detail,
    };
  }, [backendStatus, backendStatusDetail]);

  const handleDataReceived = (data: Record<string, any>[], sqlQuery: string) => {
    setAppData({ data, sqlQuery });
    setDataSynopsis(createDataSynopsis(data));
    setActiveTab("analysis");
    if (data.length) {
      setIsLoading(false);
    }
  };

  const handleModeChange = (nextMode: PersonaMode) => {
    if (nextMode === "guided") {
      setMode("guided");
      setComplexityScore(0);
      hasAutoOpenedPaletteRef.current = false;
      setExpertFilters({ focusMetric: "temperature" });
    } else {
      setMode("expert");
    }
  };

  const handleComplexitySignal = (delta: number, query: string) => {
    if (query && query.trim()) {
      setRecentQueries((prev) => {
        const next = [query.trim(), ...prev.filter((entry) => entry !== query.trim())];
        return next.slice(0, 8);
      });
    }

    setComplexityScore((prev) => {
      const next = Math.max(0, prev + delta);
      if (mode === "guided" && next >= COMPLEXITY_THRESHOLD) {
        setMode("expert");
      }
      return next;
    });
  };

  const handleCommandAction = (action: string, payload?: string) => {
    switch (action) {
      case "switch-guided":
        handleModeChange("guided");
        break;
      case "switch-expert":
        setMode("expert");
        break;
      case "open-analysis":
        setActiveTab("analysis");
        break;
      case "open-map":
        setActiveTab("map");
        break;
      case "open-profiles":
        setActiveTab("profiles");
        break;
      case "open-sql":
        setActiveTab("sql");
        break;
      case "focus-temperature":
      case "focus-salinity":
      case "focus-pressure":
      case "focus-oxygen":
      case "focus-density":
        setExpertFilters((prev) => ({
          ...prev,
          focusMetric: (payload as ExpertFilters["focusMetric"]) || "temperature",
        }));
        break;
      case "clear-filters":
        setExpertFilters({ focusMetric: "temperature" });
        break;
      case "prefill-query":
        if (payload) {
          setPalettePrefill(payload);
        }
        break;
      default:
        break;
    }

    setShowCommandPalette(false);
  };

  const handlePrefillConsumed = useCallback(() => {
    setPalettePrefill(null);
  }, []);

  const handleBackendStatusChange = useCallback((status: BackendStatus, detail?: string) => {
    updateBackendStatus(status, detail);
  }, [updateBackendStatus]);

  const quickQueries = useMemo(() => {
    const suggestions: { label: string; prompt: string }[] = [];

    const floatIds = Array.from(
      new Set(
        appData.data
          .map((row) => row.float_id ?? row.float ?? row.id)
          .filter((value) => value !== undefined && value !== null)
          .map((value) => {
            try {
              return String(value).trim();
            } catch (error) {
              console.warn("FloatAI: unable to normalize float id for quick queries", error, { value });
              return "";
            }
          })
          .filter((value) => value.length > 0)
      )
    ).slice(0, 6);

    floatIds.forEach((floatId) => {
      suggestions.push({
        label: `Latest profile for float ${floatId}`,
        prompt: `Show me the most recent profile for float ${floatId}.`,
      });
    });

    if (dataSynopsis?.dateWindow?.start && dataSynopsis.dateWindow.end) {
      const start = new Date(dataSynopsis.dateWindow.start);
      const end = new Date(dataSynopsis.dateWindow.end);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        const rangeLabel = `${start.toLocaleDateString()} → ${end.toLocaleDateString()}`;
        suggestions.push({
          label: `Summarize metrics for ${rangeLabel}`,
          prompt: `Summarize the key ocean metrics for floats observed between ${rangeLabel}.`,
        });
      }
    }

    GUIDED_EXAMPLES.slice(0, 3).forEach((example) => {
      if (!suggestions.some((suggestion) => suggestion.prompt === example)) {
        suggestions.push({ label: example, prompt: example });
      }
    });

    return suggestions.slice(0, 10);
  }, [appData.data, dataSynopsis]);

  const handleChatHardReset = useCallback(() => {
    setChatInstanceKey((prev) => prev + 1);
    setAppData({ data: [], sqlQuery: "" });
    setDataSynopsis(null);
    setActiveTab("analysis");
    setExpertFilters({ focusMetric: "temperature" });
    setRecentQueries([]);
    setPalettePrefill(null);
    setComplexityScore(0);
    setMode("guided");
    hasAutoOpenedPaletteRef.current = false;
    setShowCommandPalette(false);
    updateBackendStatus("operational", "Interface reset. Requesting fresh telemetry...");
    fetchInitialData();
  }, [fetchInitialData, updateBackendStatus]);

  const dismissLanding = useCallback(() => {
    setShowLanding(false);
    if (typeof window !== "undefined") {
      window.localStorage?.setItem("floatai::landing-dismissed", "1");
    }
  }, []);

  const handleShowLanding = useCallback(() => {
    setShowLanding(true);
    if (typeof window !== "undefined") {
      window.localStorage?.removeItem("floatai::landing-dismissed");
    }
  }, []);

  const toggleChatTray = useCallback(() => {
    setShowChatTray((prev) => !prev);
  }, []);

  if (showLanding) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <LandingPage onLaunch={dismissLanding} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <div className="relative min-h-screen w-full overflow-hidden bg-control-room text-slate-900 transition-colors duration-500 dark:text-slate-100">
        <div className="pointer-events-none absolute inset-0 ambient-veils opacity-60" />
        <div className="pointer-events-none absolute inset-0 grid-overlay opacity-20" />
        <div className="pointer-events-none absolute -top-56 -left-40 h-[420px] w-[420px] rounded-full gradient-ring blur-3xl opacity-40" />
        <div className="pointer-events-none absolute -bottom-64 right-[-20%] h-[520px] w-[520px] rounded-full gradient-ring blur-3xl opacity-30" />

        <main className="relative z-10 flex min-h-screen flex-col">
          <header className="w-full px-6 py-6 lg:px-10 lg:py-6">
            <div className="flex flex-wrap items-center justify-between gap-4 lg:gap-6">
              <div className="space-y-2">
                <div className={`inline-flex items-center gap-3 rounded-full px-4 py-1.5 shadow-sm backdrop-blur-md ${missionStatusDescriptor.pillClass}`}>
                  <span className={`h-2 w-2 rounded-full ${missionStatusDescriptor.indicatorClass}`} />
                  <span className="text-[0.6rem] font-semibold uppercase tracking-[0.45em] text-slate-600 dark:text-slate-200">Mission Status</span>
                  <span className="text-[0.625rem] font-medium text-slate-600 dark:text-slate-200">{missionStatusDescriptor.label}</span>
                </div>
                <h1 className="text-3xl font-semibold leading-tight md:text-4xl">FloatAI Command Deck</h1>
                <p className="max-w-2xl text-sm text-subtle md:text-base">
                  Guide autonomous ocean missions, query the ARGO archive, and direct the analysis as the viewscreen responds in real time.
                </p>
                <p className="text-xs text-subtle">{missionStatusDescriptor.description}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-full bg-slate-900/70 px-3 py-2 shadow-[0_12px_28px_-14px_rgba(15,23,42,0.55)] backdrop-blur dark:bg-slate-800/80">
                <ThemeToggle />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleShowLanding}
                  className="rounded-full bg-slate-800/80 px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-white shadow-inner shadow-slate-900/40 hover:-translate-y-0.5 hover:bg-slate-700"
                >
                  Overview
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowCommandPalette(true)}
                  className="rounded-full bg-slate-800/70 px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-white shadow-inner shadow-slate-900/40 hover:-translate-y-0.5 hover:bg-slate-700"
                  aria-label="Open command palette"
                >
                  Command Palette
                </Button>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                icon={Database}
                label="Records processed"
                value={oceanMetrics.totalRecords}
                helper="Latest pipeline output"
              />
              <StatCard
                icon={Compass}
                label="Active float signatures"
                value={oceanMetrics.uniqueFloats}
                helper="Distinct IDs in scope"
              />
              <StatCard
                icon={CalendarDays}
                label="Latest observation"
                value={oceanMetrics.lastObservation}
                helper="Timestamp auto-synced"
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/25 bg-white/80 px-4 py-3 shadow-[0_20px_50px_-38px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.06]">
              <div className="flex flex-wrap items-center gap-3">
                <span className="control-label text-slate-500 dark:text-slate-300">Persona</span>
                <div className="inline-flex items-center gap-1 rounded-full bg-white/80 p-1 shadow-sm shadow-slate-900/5 dark:bg-white/[0.08] dark:shadow-black/30">
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === "guided" ? "default" : "ghost"}
                    className="rounded-full px-4 text-xs font-semibold uppercase tracking-[0.24em]"
                    onClick={() => handleModeChange("guided")}
                  >
                    Guided
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === "expert" ? "default" : "ghost"}
                    className="rounded-full px-4 text-xs font-semibold uppercase tracking-[0.24em]"
                    onClick={() => handleModeChange("expert")}
                  >
                    Expert
                  </Button>
                </div>
                <p className="text-xs text-subtle">
                  {mode === "guided"
                    ? "Onboarding prompts, summaries, and automatic guardrails."
                    : "Full control of filters, SQL receipts, and focused metrics."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="rounded-full border-white/40 bg-white/70 px-3 py-1 text-[0.7rem] uppercase tracking-[0.18em] text-slate-700 dark:border-white/10 dark:bg-white/[0.08] dark:text-slate-100">
                  Focus: {expertFilters.focusMetric}
                </Badge>
                {expertFilters.floatId && (
                  <Badge variant="outline" className="rounded-full border-white/40 bg-white/80 px-3 py-1 text-[0.7rem] uppercase tracking-[0.18em] text-slate-700 dark:border-white/10 dark:bg-white/[0.08] dark:text-slate-100">
                    Float {expertFilters.floatId}
                  </Badge>
                )}
                {depthFilterLabel && (
                  <Badge variant="outline" className="rounded-full border-white/40 bg-white/80 px-3 py-1 text-[0.7rem] uppercase tracking-[0.18em] text-slate-700 dark:border-white/10 dark:bg-white/[0.08] dark:text-slate-100">
                    {depthFilterLabel}
                  </Badge>
                )}
              </div>
            </div>
          </header>

          <section className="flex w-full flex-1 flex-col px-6 pb-16 lg:px-10 min-h-0">
            <div className="viewscreen-shell flex min-h-[520px] flex-1 flex-col p-8">
              <div className="relative z-10 flex h-full min-h-0 flex-col">
                {isLoading ? (
                  <div className="flex flex-1 flex-col justify-center gap-6">
                    <LoadingPanel />
                  </div>
                ) : (
                  <DataVisualization
                    data={appData.data}
                    sqlQuery={appData.sqlQuery}
                    mode={mode}
                    synopsis={dataSynopsis}
                    filters={expertFilters}
                    onFiltersChange={setExpertFilters}
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                  />
                )}
              </div>
            </div>
          </section>
        </main>

        <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3 pointer-events-none">
          {showChatTray ? (
            <div className="pointer-events-auto w-[480px] max-w-[95vw] max-h-[82vh] overflow-hidden rounded-3xl border border-white/10 bg-white/10 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.6)] backdrop-blur-sm transition-all duration-200 ease-out dark:border-white/10 dark:bg-slate-900/40">
              <div className="relative flex h-[640px] max-h-[82vh] flex-col">
                <button
                  type="button"
                  onClick={() => setShowChatTray(false)}
                  className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/70 text-white shadow hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 dark:bg-white/20"
                  aria-label="Close chat"
                >
                  <X className="h-4 w-4" />
                </button>
                <ErrorBoundary onReset={handleChatHardReset}>
                  <ChatInterface
                    key={chatInstanceKey}
                    onDataReceived={handleDataReceived}
                    onComplexitySignal={handleComplexitySignal}
                    dataSummary={dataSynopsis}
                    palettePrefill={palettePrefill}
                    onPrefillConsumed={handlePrefillConsumed}
                    onBackendStatusChange={handleBackendStatusChange}
                    variant="tray"
                  />
                </ErrorBoundary>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowChatTray(true)}
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-slate-900/85 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/40 backdrop-blur focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 dark:bg-white/20"
              aria-label="Open chat"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M5.5 4.75h13a1.75 1.75 0 011.75 1.75v8.5A1.75 1.75 0 0118.5 16.75h-3.69a.75.75 0 00-.53.22l-2.21 2.21a.75.75 0 01-1.28-.53v-1.9a.75.75 0 00-.75-.75H5.5A1.75 1.75 0 013.75 15V6.5A1.75 1.75 0 015.5 4.75z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M8.5 10h7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M8.5 12.75h4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Chat
            </button>
          )}
        </div>
        <CommandPalette
          open={showCommandPalette}
          onOpenChange={setShowCommandPalette}
          mode={mode}
          onAction={handleCommandAction}
          recentQueries={recentQueries}
          filters={expertFilters}
          activeTab={activeTab}
          quickQueries={quickQueries}
        />
      </div>
    </ThemeProvider>
  );
}

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  helper: string;
}

const StatCard = ({ icon: Icon, label, value, helper }: StatCardProps) => (
  <div className="glass-panel relative flex items-center gap-4 rounded-2xl border border-white/30 px-4 py-3">
    <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-gradient-ocean text-white shadow-lg shadow-sky-500/30">
      <Icon className="h-5 w-5" />
      <div className="pointer-events-none absolute inset-0 bg-white/35 mix-blend-overlay" />
    </div>
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-300">
        {label}
      </p>
      <p className="mt-0.5 text-xl font-semibold text-slate-900 dark:text-white">{value}</p>
      <p className="text-[0.65rem] text-slate-500 dark:text-slate-300">{helper}</p>
    </div>
  </div>
);

const LoadingPanel = () => (
  <div className="grid gap-6">
    <div className="space-y-4">
      <div className="h-4 w-40 rounded-full bg-white/70 shadow-inner shadow-slate-200/40 dark:bg-white/10" />
      <div className="h-6 w-64 rounded-full bg-white/80 shadow-inner shadow-slate-200/40 dark:bg-white/10" />
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="h-28 rounded-2xl border border-white/30 bg-white/75 shadow-[0_25px_45px_-35px_rgba(15,23,42,0.5)] backdrop-blur-md dark:border-white/10 dark:bg-white/[0.05]" />
      <div className="h-28 rounded-2xl border border-white/30 bg-white/75 shadow-[0_25px_45px_-35px_rgba(15,23,42,0.5)] backdrop-blur-md dark:border-white/10 dark:bg-white/[0.05]" />
    </div>
    <div className="h-64 rounded-[32px] border border-white/30 bg-white/70 shadow-[0_35px_70px_-45px_rgba(15,23,42,0.5)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.05]" />
  </div>
);

export default App;
