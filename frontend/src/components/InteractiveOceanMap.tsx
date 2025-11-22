import { useState, useEffect, useMemo, useCallback, Suspense, lazy } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  Compass,
  Droplets,
  Map as MapIcon,
  MapPin,
  Navigation,
  RefreshCw,
  Thermometer,
  Waves,
} from "lucide-react";
import {
  floatAIAPI,
  ArgoFloat,
  ArgoProfile,
  DataFilters,
  DataQualityReport,
  TimeSeriesResponse,
  TrajectoryPoint,
} from "@/services/api";

const Plot = lazy(() => import("react-plotly.js"));

type OceanVariable = "temperature" | "salinity" | "pressure";
type StatusKey = "active" | "delayed" | "inactive";

type FloatDetailState = {
  trajectory: TrajectoryPoint[];
  quality: DataQualityReport[];
  profile: ArgoProfile | null;
  timeSeries: Partial<Record<OceanVariable, TimeSeriesResponse>>;
};

const STATUS_OPTIONS: Array<{ key: StatusKey; label: string; color: string }> = [
  { key: "active", label: "Active", color: "bg-emerald-500" },
  { key: "delayed", label: "Delayed", color: "bg-amber-500" },
  { key: "inactive", label: "Inactive", color: "bg-rose-500" },
];

const VARIABLE_OPTIONS: Array<{ value: OceanVariable; label: string; unit: string }> = [
  { value: "temperature", label: "Temperature", unit: "°C" },
  { value: "salinity", label: "Salinity", unit: "PSU" },
  { value: "pressure", label: "Pressure", unit: "dbar" },
];

// Fix for default markers in React-Leaflet
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const createFloatIcon = (status: string, isHighlighted = false) => {
  const base = status.toLowerCase();
  const color = base === "active" ? "#10b981" : base === "delayed" ? "#f59e0b" : "#ef4444";
  const size = isHighlighted ? 22 : 14;

  return L.divIcon({
    html: `<div style="background-color:${color};width:${size}px;height:${size}px;border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(16,24,40,0.35);"></div>`,
    className: "custom-float-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

interface InteractiveOceanMapProps {
  filters?: DataFilters;
  highlightedFloats?: string[];
  queryPoints?: Array<{ lat: number; lon: number; floatId?: string | number }>;
}

const DEFAULT_STATUS_FILTERS = STATUS_OPTIONS.map((option) => option.key);

const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const computeTotalDistanceKm = (trajectory: TrajectoryPoint[]) => {
  if (!trajectory?.length || trajectory.length < 2) return 0;

  return trajectory.reduce((acc, current, index) => {
    if (index === 0) return acc;
    const prev = trajectory[index - 1];
    return acc + haversineKm(prev.lat, prev.lon, current.lat, current.lon);
  }, 0);
};

const formatTimestamp = (value?: string | null) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const RecenterOnSelect = ({ position }: { position: [number, number] | null }) => {
  const map = useMap();

  useEffect(() => {
    if (!position) return;
    map.flyTo(position, Math.max(map.getZoom(), 4), { duration: 1.2 });
  }, [map, position]);

  return null;
};

const FitToQueryPoints = ({
  points,
  disabled,
}: {
  points: Array<{ lat: number; lon: number }>;
  disabled: boolean;
}) => {
  const map = useMap();

  useEffect(() => {
    if (disabled || !points.length) return;

    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lon]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 6 });
  }, [disabled, map, points]);

  return null;
};

const InvalidateSizeOnLoad = () => {
  const map = useMap();

  useEffect(() => {
    const resize = () => {
      map.invalidateSize({ animate: false });
    };
    const timeout = setTimeout(resize, 150);
    window.addEventListener("resize", resize);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("resize", resize);
    };
  }, [map]);

  return null;
};

const PlotFallback = ({ label }: { label: string }) => (
  <div className="flex h-40 w-full items-center justify-center rounded-lg border border-dashed border-slate-200">
    <span className="text-xs text-muted-foreground">{label}</span>
  </div>
);

const InteractiveOceanMap = ({ filters, highlightedFloats = [], queryPoints = [] }: InteractiveOceanMapProps) => {
  const [floats, setFloats] = useState<ArgoFloat[]>([]);
  const [statusFilters, setStatusFilters] = useState<StatusKey[]>(DEFAULT_STATUS_FILTERS);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFloatId, setSelectedFloatId] = useState<string | null>(null);
  const [selectedFloat, setSelectedFloat] = useState<ArgoFloat | null>(null);
  const [variable, setVariable] = useState<OceanVariable>("temperature");
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [details, setDetails] = useState<FloatDetailState | null>(null);

  const statusCounts = useMemo(() => {
    return floats.reduce(
      (acc, current) => {
        const key = current.status?.toLowerCase() as StatusKey;
        if (!acc[key]) acc[key] = 0;
        acc[key] += 1;
        return acc;
      },
      { active: 0, delayed: 0, inactive: 0 } as Record<StatusKey, number>,
    );
  }, [floats]);

  const filteredFloats = useMemo(() => {
    const lowercaseSearch = searchTerm.trim().toLowerCase();
    return floats.filter((item) => {
      const matchesStatus = statusFilters.includes(item.status?.toLowerCase() as StatusKey);
      const matchesSearch = lowercaseSearch ? item.id.toLowerCase().includes(lowercaseSearch) : true;
      return matchesStatus && matchesSearch;
    });
  }, [floats, statusFilters, searchTerm]);

  const queryMarkers = useMemo(() => {
    if (!queryPoints.length) return [];

    return queryPoints
      .map((point) => {
        const lat = Number(point.lat);
        const lon = Number(point.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          return null;
        }
        return { lat, lon, floatId: point.floatId };
      })
      .filter(
        (value): value is { lat: number; lon: number; floatId?: string | number } =>
          value !== null,
      );
  }, [queryPoints]);

  const selectedTrajectory = details?.trajectory ?? [];
  const latestTrajectoryPoint = selectedTrajectory.length
    ? selectedTrajectory[selectedTrajectory.length - 1]
    : null;
  const totalDistance = useMemo(() => computeTotalDistanceKm(selectedTrajectory), [selectedTrajectory]);

  const trajectoryTimespanDays = useMemo(() => {
    if (!selectedTrajectory.length) return null;
    const first = selectedTrajectory[0];
    const last = selectedTrajectory[selectedTrajectory.length - 1];
    const start = new Date(first.timestamp);
    const end = new Date(last.timestamp);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const diff = Math.max(end.getTime() - start.getTime(), 0);
    return diff / (1000 * 60 * 60 * 24);
  }, [selectedTrajectory]);

  const selectedVariableSeries = details?.timeSeries?.[variable]?.data ?? [];
  const seriesUnit = VARIABLE_OPTIONS.find((option) => option.value === variable)?.unit ?? "";

  const refreshFloats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const requestFilters: DataFilters = { ...(filters ?? {}) };
      const normalizedStatus = statusFilters.length ? statusFilters : DEFAULT_STATUS_FILTERS;
      if (normalizedStatus.length > 0 && normalizedStatus.length !== DEFAULT_STATUS_FILTERS.length) {
        requestFilters.status = normalizedStatus;
      }
      const catalog = await floatAIAPI.getArgoFloats(requestFilters);
      setFloats(catalog);
      if (!catalog.length) {
        setSelectedFloatId(null);
        setSelectedFloat(null);
        setDetails(null);
      }
    } catch (err) {
      console.error("FloatAI: failed to load floats", err);
      setError("Unable to load floats from the telemetry service.");
    } finally {
      setIsLoading(false);
    }
  }, [filters, statusFilters]);

  useEffect(() => {
    refreshFloats();
  }, [refreshFloats]);

  useEffect(() => {
    if (!selectedFloatId) {
      setSelectedFloat(null);
      return;
    }
    const match = floats.find((item) => item.id === selectedFloatId) ?? null;
    setSelectedFloat(match);
  }, [floats, selectedFloatId]);

  const loadFloatDetails = useCallback(
    async (floatId: string, variableToLoad: OceanVariable) => {
      setDetailsLoading(true);
      try {
        const [trajectory, quality] = await Promise.all([
          floatAIAPI.getFloatTrajectory(floatId, 60),
          floatAIAPI.getDataQuality(floatId),
        ]);

        const [profile, series] = await Promise.all([
          floatAIAPI.getFloatProfile(floatId, "temperature"),
          floatAIAPI.getTimeSeriesData(floatId, variableToLoad),
        ]);

        setDetails({
          trajectory,
          quality,
          profile,
          timeSeries: { [variableToLoad]: series },
        });
      } catch (err) {
        console.warn("FloatAI: unable to load float detail payload", { floatId, err });
        setDetails({
          trajectory: [],
          quality: [],
          profile: null,
          timeSeries: {},
        });
      } finally {
        setDetailsLoading(false);
      }
    },
    [],
  );

  const ensureSeriesForVariable = useCallback(
    async (floatId: string, currentDetails: FloatDetailState | null, variableToLoad: OceanVariable) => {
      if (!floatId || !currentDetails) return;
      if (currentDetails.timeSeries[variableToLoad]) return;

      try {
        const series = await floatAIAPI.getTimeSeriesData(floatId, variableToLoad);
        setDetails((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            timeSeries: {
              ...prev.timeSeries,
              [variableToLoad]: series,
            },
          };
        });
      } catch (err) {
        console.warn("FloatAI: failed to extend time series", { floatId, variableToLoad, err });
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectedFloatId) {
      setDetails(null);
      return;
    }

    loadFloatDetails(selectedFloatId, variable);
  }, [loadFloatDetails, selectedFloatId, variable]);

  useEffect(() => {
    if (!selectedFloatId) return;
    ensureSeriesForVariable(selectedFloatId, details, variable);
  }, [ensureSeriesForVariable, selectedFloatId, details, variable]);

  useEffect(() => {
    if (filteredFloats.length === 0) {
      setSelectedFloatId(null);
      return;
    }
    if (!selectedFloatId) {
      setSelectedFloatId(filteredFloats[0].id);
    }
  }, [filteredFloats, selectedFloatId]);

  const handleSelectFloat = useCallback(
    (floatItem: ArgoFloat) => {
      setSelectedFloatId(floatItem.id);
      setVariable("temperature");
      loadFloatDetails(floatItem.id, "temperature");
    },
    [loadFloatDetails],
  );

  const recenterPosition = selectedFloat ? ([selectedFloat.lat, selectedFloat.lon] as [number, number]) : null;
  const disableQueryFit = Boolean(selectedFloatId);

  const daysSinceLastContact = useMemo(() => {
    if (!selectedFloat?.last_contact) return null;
    const last = new Date(selectedFloat.last_contact);
    if (Number.isNaN(last.getTime())) return null;
    const diff = Date.now() - last.getTime();
    return Math.round(diff / (1000 * 60 * 60 * 24));
  }, [selectedFloat]);

  const visibleBadgeLabel = useMemo(() => {
    const totalVisible = filteredFloats.length;
    const activeVisible = filteredFloats.filter((item) => item.status === "active").length;
    return `${activeVisible}/${totalVisible} visible`;
  }, [filteredFloats]);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 shadow-[0_15px_40px_-30px_rgba(15,23,42,0.65)] backdrop-blur dark:bg-white/[0.04]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <MapIcon className="h-5 w-5 text-blue-600" /> Ocean map
            </h3>
            <p className="text-sm text-muted-foreground">
              Live fleet with lightweight filters, query overlays, and a focused detail panel.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs uppercase tracking-wider">
              {visibleBadgeLabel}
            </Badge>
            <Button onClick={refreshFloats} disabled={isLoading} size="sm" variant="outline">
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/20 bg-white/70 px-4 py-3 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/[0.06]">
        {STATUS_OPTIONS.map((option) => {
          const active = statusFilters.includes(option.key);
          return (
            <Button
              key={option.key}
              type="button"
              size="sm"
              variant={active ? "default" : "outline"}
              className="rounded-full"
              onClick={() =>
                setStatusFilters((prev) =>
                  active ? prev.filter((value) => value !== option.key) : [...prev, option.key],
                )
              }
            >
              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${option.color}`} />
              {option.label}
            </Button>
          );
        })}
        <div className="h-6 w-px bg-slate-200/70 dark:bg-white/10" />
        <Input
          placeholder="Search float ID"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          className="h-9 w-[180px] text-sm"
        />
        <div className="flex items-center gap-2">
          {VARIABLE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={option.value === variable ? "default" : "ghost"}
              className="text-xs"
              onClick={() => setVariable(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid min-h-[520px] gap-4 lg:grid-cols-[2fr,1.05fr]">
        <Card className="relative overflow-hidden rounded-2xl border border-white/20 shadow-[0_25px_60px_-45px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.05]">
          <CardContent className="p-0">
            <div className="relative h-full min-h-[520px]">
              {isLoading && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 dark:bg-slate-900/80">
                  <div className="text-center">
                    <RefreshCw className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-600" />
                    <p className="text-sm text-muted-foreground">Refreshing ocean telemetry…</p>
                  </div>
                </div>
              )}
              {error && !isLoading && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/90 px-6 text-center text-sm text-rose-600 dark:bg-slate-900/90">
                  {error}
                </div>
              )}

              <div className="absolute left-4 top-4 z-10 space-y-2 rounded-xl bg-white/85 px-4 py-3 text-xs shadow-md backdrop-blur dark:bg-slate-900/80">
                <div className="flex items-center justify-between gap-3 font-semibold text-slate-700 dark:text-slate-100">
                  <span>Visible</span>
                  <span className="text-sm">{visibleBadgeLabel}</span>
                </div>
                <div className="flex flex-wrap gap-3 text-[0.75rem] text-muted-foreground">
                  {STATUS_OPTIONS.map((option) => (
                    <span key={option.key} className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${option.color}`} />
                      {option.label} ({statusCounts[option.key] ?? 0})
                    </span>
                  ))}
                </div>
              </div>

              {queryMarkers.length > 0 && !disableQueryFit && (
                <div className="absolute bottom-4 right-4 z-10 rounded-full bg-purple-600/90 px-3 py-2 text-xs font-semibold text-white shadow-lg">
                  Query overlay active
                </div>
              )}

              <MapContainer
                center={[15, 0]}
                zoom={2}
                minZoom={2}
                worldCopyJump
                className="h-full w-full rounded-2xl overflow-hidden"
                style={{ minHeight: 520 }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <RecenterOnSelect position={recenterPosition} />
                <FitToQueryPoints points={queryMarkers} disabled={disableQueryFit} />
                <InvalidateSizeOnLoad />

                {filteredFloats.map((floatItem) => {
                  const isHighlighted = highlightedFloats.includes(floatItem.id);
                  const isSelected = floatItem.id === selectedFloatId;
                  return (
                    <Marker
                      key={floatItem.id}
                      position={[floatItem.lat, floatItem.lon]}
                      icon={createFloatIcon(floatItem.status, isHighlighted || isSelected)}
                      eventHandlers={{
                        click: () => handleSelectFloat(floatItem),
                      }}
                    >
                      <Popup>
                        <div className="space-y-2 text-xs">
                          <div className="flex items-center justify-between gap-4">
                            <span className="font-semibold uppercase tracking-wide text-slate-600">
                              Float {floatItem.id}
                            </span>
                            <Badge variant={floatItem.status === "active" ? "default" : "secondary"} className="capitalize">
                              {floatItem.status}
                            </Badge>
                          </div>
                          <div className="grid gap-1.5">
                            <div className="flex items-center justify-between">
                              <span>Lat / Lon</span>
                              <span>
                                {floatItem.lat.toFixed(3)}°, {floatItem.lon.toFixed(3)}°
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span>Last contact</span>
                              <span>{formatTimestamp(floatItem.last_contact)}</span>
                            </div>
                            {typeof floatItem.temperature === "number" && (
                              <div className="flex items-center justify-between">
                                <span>Temperature</span>
                                <span>{floatItem.temperature.toFixed(2)} °C</span>
                              </div>
                            )}
                            {typeof floatItem.salinity === "number" && (
                              <div className="flex items-center justify-between">
                                <span>Salinity</span>
                                <span>{floatItem.salinity.toFixed(2)} PSU</span>
                              </div>
                            )}
                          </div>
                          <Button size="sm" className="w-full" onClick={() => handleSelectFloat(floatItem)}>
                            Focus here
                          </Button>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}

                {queryMarkers.map((point, index) => (
                  <CircleMarker
                    key={`query-${index}-${point.lat}-${point.lon}`}
                    center={[point.lat, point.lon]}
                    radius={4}
                    pathOptions={{
                      color: "#a855f7",
                      fillColor: "#c084fc",
                      fillOpacity: 0.85,
                      weight: 1.5,
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -4]}>
                      <div className="space-y-1 text-xs">
                        <div className="font-semibold text-purple-700 dark:text-purple-200">Query result</div>
                        {point.floatId && <div>Float: {point.floatId}</div>}
                        <div>
                          {point.lat.toFixed(3)}°, {point.lon.toFixed(3)}°
                        </div>
                      </div>
                    </Tooltip>
                  </CircleMarker>
                ))}

                {selectedTrajectory.length > 1 && (
                  <>
                    <Polyline
                      positions={selectedTrajectory.map((point) => [point.lat, point.lon])}
                      color="#2563eb"
                      weight={3}
                      opacity={0.65}
                    />
                    {selectedTrajectory.map((point, index) => (
                      <CircleMarker
                        key={`${point.timestamp}-${index}`}
                        center={[point.lat, point.lon]}
                        radius={index === selectedTrajectory.length - 1 ? 4 : 3}
                        pathOptions={{
                          color: index === selectedTrajectory.length - 1 ? "#1d4ed8" : "#60a5fa",
                          fillOpacity: 0.9,
                        }}
                      >
                        <Tooltip direction="top" offset={[0, -4]}>
                          <div className="space-y-1 text-xs">
                            <div className="font-medium">{formatTimestamp(point.timestamp)}</div>
                            <div>Lat: {point.lat.toFixed(3)}°</div>
                            <div>Lon: {point.lon.toFixed(3)}°</div>
                            {typeof point.temperature === "number" && <div>T: {point.temperature.toFixed(2)} °C</div>}
                            {typeof point.salinity === "number" && <div>S: {point.salinity.toFixed(2)} PSU</div>}
                          </div>
                        </Tooltip>
                      </CircleMarker>
                    ))}
                  </>
                )}
              </MapContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="flex h-full max-h-[82vh] flex-col rounded-2xl border border-white/20 shadow-[0_25px_60px_-45px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.05]">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" /> Float detail
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col overflow-hidden">
            {selectedFloat ? (
              <ScrollArea className="h-full pr-3">
                <div className="space-y-3 pr-1">
                  <div className="rounded-xl border border-slate-200/70 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.06]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Float</p>
                        <h4 className="text-lg font-semibold leading-tight">{selectedFloat.id}</h4>
                        <p className="text-xs text-muted-foreground">Last contact {formatTimestamp(selectedFloat.last_contact)}</p>
                      </div>
                      <Badge variant={selectedFloat.status === "active" ? "default" : "secondary"} className="capitalize">
                        {selectedFloat.status}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-blue-600" />
                        <span>
                          {selectedFloat.lat.toFixed(3)}°, {selectedFloat.lon.toFixed(3)}°
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Navigation className="h-4 w-4 text-emerald-600" />
                        <span>{daysSinceLastContact !== null ? `${daysSinceLastContact} days ago` : "–"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Thermometer className="h-4 w-4 text-orange-500" />
                        <span>
                          {typeof selectedFloat.temperature === "number" ? `${selectedFloat.temperature.toFixed(2)} °C` : "—"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Droplets className="h-4 w-4 text-sky-500" />
                        <span>
                          {typeof selectedFloat.salinity === "number" ? `${selectedFloat.salinity.toFixed(2)} PSU` : "—"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/70 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.06]">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-slate-700 dark:text-slate-100">Trajectory</span>
                      <Compass className="h-4 w-4 text-indigo-500" />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-muted-foreground">
                      <div>
                        <p className="text-[0.7rem] uppercase tracking-[0.18em]">Distance</p>
                        <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
                          {totalDistance ? `${totalDistance.toFixed(1)} km` : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[0.7rem] uppercase tracking-[0.18em]">Window</p>
                        <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
                          {trajectoryTimespanDays ? `${trajectoryTimespanDays.toFixed(0)} days` : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[0.7rem] uppercase tracking-[0.18em]">Waypoints</p>
                        <p className="text-base font-semibold text-slate-800 dark:text-slate-100">{selectedTrajectory.length || "—"}</p>
                      </div>
                      <div>
                        <p className="text-[0.7rem] uppercase tracking-[0.18em]">Latest fix</p>
                        <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
                          {formatTimestamp(latestTrajectoryPoint?.timestamp)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/70 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.06]">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Time series</span>
                      <div className="flex items-center gap-1">
                        {VARIABLE_OPTIONS.map((option) => (
                          <Button
                            key={option.value}
                            size="sm"
                            variant={option.value === variable ? "default" : "ghost"}
                            className="h-7 px-2 text-[0.75rem]"
                            onClick={() => setVariable(option.value)}
                          >
                            {option.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    {detailsLoading && !selectedVariableSeries.length ? (
                      <Skeleton className="h-40 w-full rounded-lg" />
                    ) : selectedVariableSeries.length ? (
                      <Suspense fallback={<PlotFallback label="Loading time-series" />}>
                        <Plot
                          data={[
                            {
                              type: "scatter",
                              mode: "lines+markers",
                              x: selectedVariableSeries.map((point) => point.timestamp),
                              y: selectedVariableSeries.map((point) => {
                                if (variable === "temperature") return point.temperature ?? null;
                                if (variable === "salinity") return point.salinity ?? null;
                                return point.pressure ?? null;
                              }),
                              marker: { color: "#38bdf8", size: 6, symbol: "circle", opacity: 0.9 },
                              line: { color: "#0ea5e9", width: 3, shape: "spline", smoothing: 0.55 },
                              hovertemplate: "%{y:.2f} " + seriesUnit + "<br>%{x}<extra></extra>",
                              name: variable,
                            },
                          ]}
                          layout={{
                            autosize: true,
                            height: 240,
                            margin: { l: 38, r: 14, t: 18, b: 42 },
                            paper_bgcolor: "rgba(0,0,0,0)",
                            plot_bgcolor: "rgba(15,23,42,0.25)",
                            font: { color: "#e2e8f0" },
                            xaxis: { title: { text: "Timestamp", font: { color: "#cbd5e1" } }, showgrid: false, zeroline: false, tickfont: { color: "#cbd5e1" } },
                            yaxis: {
                              title: {
                                text: `${variable.charAt(0).toUpperCase()}${variable.slice(1)} (${seriesUnit})`,
                              },
                              gridcolor: "rgba(148,163,184,0.25)",
                              zeroline: false,
                            },
                            hoverlabel: { bgcolor: "#0f172a", bordercolor: "#0ea5e9", font: { color: "#e2e8f0" } },
                          }}
                          config={{ displayModeBar: false, responsive: true, displaylogo: false, staticPlot: true, scrollZoom: false }}
                        />
                      </Suspense>
                    ) : (
                      <PlotFallback label="No time-series available" />
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200/70 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.06]">
                    <div className="mb-2 flex items-center gap-2">
                      <Waves className="h-4 w-4 text-sky-500" />
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Latest temperature profile</span>
                    </div>
                    {detailsLoading && !details?.profile ? (
                      <Skeleton className="h-40 w-full rounded-lg" />
                    ) : details?.profile?.values?.length ? (
                      <Suspense fallback={<PlotFallback label="Loading vertical profile" />}>
                        <Plot
                          data={[
                            {
                              type: "scatter",
                              mode: "lines+markers",
                              x: details.profile.values,
                              y: details.profile.depth,
                              line: { color: "#14b8a6", width: 3, shape: "spline", smoothing: 0.55 },
                              marker: { color: "#14b8a6", size: 5, symbol: "diamond" },
                              hovertemplate: "%{x:.2f} °C<br>%{y:.0f} dbar<extra></extra>",
                            },
                          ]}
                          layout={{
                            autosize: true,
                            height: 220,
                            margin: { l: 48, r: 12, t: 14, b: 40 },
                            paper_bgcolor: "rgba(0,0,0,0)",
                            plot_bgcolor: "rgba(15,23,42,0.25)",
                            font: { color: "#e2e8f0" },
                            yaxis: {
                              title: { text: "Depth (dbar)" },
                              autorange: "reversed",
                              gridcolor: "rgba(148,163,184,0.25)",
                              tickfont: { color: "#cbd5e1" },
                              titlefont: { color: "#cbd5e1" },
                            },
                            xaxis: {
                              title: { text: "Temperature (°C)" },
                              gridcolor: "rgba(148,163,184,0.25)",
                              tickfont: { color: "#cbd5e1" },
                              titlefont: { color: "#cbd5e1" },
                            },
                            hoverlabel: { bgcolor: "#0f172a", bordercolor: "#14b8a6", font: { color: "#e2e8f0" } },
                          }}
                          config={{ displayModeBar: false, responsive: true, displaylogo: false, staticPlot: true, scrollZoom: false }}
                        />
                      </Suspense>
                    ) : (
                      <PlotFallback label="No recent profile" />
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200/70 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.06]">
                    <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Data quality</p>
                    {detailsLoading && !details?.quality?.length ? (
                      <Skeleton className="h-20 w-full rounded-lg" />
                    ) : details?.quality?.length ? (
                      <div className="space-y-2 text-sm">
                        {details.quality.map((metric) => (
                          <div
                            key={metric.metric}
                            className="flex items-center justify-between rounded-lg border border-white/50 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/[0.05]"
                          >
                            <div>
                              <p className="font-medium capitalize">{metric.metric.replace(/_/g, " ")}</p>
                              {metric.description && (
                                <p className="text-xs text-muted-foreground">{metric.description}</p>
                              )}
                            </div>
                            <span className="text-sm font-semibold">
                              {metric.value}
                              {metric.unit === "percent" ? "%" : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No quality metrics reported.</p>
                    )}
                  </div>
                </div>
              </ScrollArea>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                <MapPin className="h-10 w-10 opacity-50" />
                <p>Select a float marker to inspect its trajectory and sensor history.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default InteractiveOceanMap;
