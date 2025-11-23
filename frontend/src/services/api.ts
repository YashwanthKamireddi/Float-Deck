// This file contains the functions for communicating with our Python AI backend.

const resolveApiUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl;
  }

  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    const normalizedProtocol = protocol === "file:" ? "http:" : protocol;

    const sanitizedHost = hostname === "::1" ? "127.0.0.1" : hostname;

    if (sanitizedHost === "localhost" || sanitizedHost === "127.0.0.1") {
      return "http://127.0.0.1:8000/api/ask";
    }

    return `${normalizedProtocol}//${sanitizedHost}:8000/api/ask`;
  }

  return "http://127.0.0.1:8000/api/ask";
};

const API_URL = resolveApiUrl();
const API_BASE_URL = API_URL.replace(/\/?ask$/, "");

const ensureTrailingSlash = (value: string) => (value.endsWith("/") ? value : `${value}/`);

const buildApiUrl = (path: string) => {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const normalized = path.startsWith("/") ? path.slice(1) : path;
  return `${ensureTrailingSlash(API_BASE_URL)}${normalized}`;
};

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return (await response.json()) as T;
}

// Shared API contracts -----------------------------------------------------
export interface BackendAssistantMessage {
  role: string;
  content: string | { text?: string } | null;
  type?: string | null;
  title?: string | null;
  metadata?: Record<string, any>;
}

export interface AIResponse {
  sql_query: string | null;
  result_data: Record<string, any>[] | string | null;
  messages?: BackendAssistantMessage[];
  metadata?: Record<string, any>;
  error: string | null;
}

export interface DataFilters {
  floatIds?: string[];
  status?: string[];
  parameter?: string;
  dateRange?: { start?: string | null; end?: string | null };
  [key: string]: unknown;
}

export interface ArgoFloat {
  id: string;
  lat: number;
  lon: number;
  last_contact: string;
  temperature?: number | null;
  salinity?: number | null;
  trajectory?: [number, number][];
  status: "active" | "inactive" | "delayed" | string;
}

export interface ArgoProfile {
  depth: number[];
  values: number[];
  quality_flags: (number | string)[];
  metadata?: Record<string, unknown>;
}

export interface TimeSeriesPoint {
  timestamp: string;
  temperature?: number;
  salinity?: number;
  oxygen?: number;
  pressure?: number;
  [key: string]: number | string | undefined;
}

export interface TimeSeriesResponse {
  data: TimeSeriesPoint[];
  sqlQuery?: string;
}

export interface DataQualityReport {
  metric: string;
  value: number;
  unit?: string;
  flag?: string;
  description?: string;
}

export interface TrajectoryPoint {
  lat: number;
  lon: number;
  timestamp: string;
  temperature?: number | null;
  salinity?: number | null;
  pressure?: number | null;
}

export interface DatabaseStats {
  total_floats: number;
  last_updated?: string | null;
  dataset?: string | null;
}

export type DataSource = "live" | "sample";

export interface ArgoFloatsResult {
  data: ArgoFloat[];
  source: DataSource;
}

const SAMPLE_FLOATS: ArgoFloat[] = [
  { id: "5905612", lat: -33.500, lon: 151.300, last_contact: "2025-11-20T12:00:00Z", temperature: 15.4, salinity: 35.1, trajectory: [[-33.50,151.30],[-33.45,151.32],[-33.40,151.35]], status: "active" },
  { id: "5905613", lat: -12.100, lon: 145.200, last_contact: "2025-11-15T09:00:00Z", temperature: 12.9, salinity: 34.7, trajectory: [[-12.10,145.20],[-12.06,145.28],[-12.00,145.35]], status: "active" },
  { id: "5905614", lat: 2.500, lon: -150.800, last_contact: "2025-10-05T18:00:00Z", temperature: 10.2, salinity: 34.9, trajectory: [[2.50,-150.80],[2.55,-150.70],[2.60,-150.60]], status: "delayed" },
  { id: "3901774", lat: 46.500, lon: -17.800, last_contact: "2025-11-10T04:00:00Z", temperature: 9.1, salinity: 35.4, trajectory: [[46.45,-17.90],[46.50,-17.80],[46.60,-17.65]], status: "active" },
  { id: "2902273", lat: 14.200, lon: -38.600, last_contact: "2025-11-18T07:00:00Z", temperature: 20.3, salinity: 36.1, trajectory: [[14.10,-38.70],[14.20,-38.60],[14.25,-38.55]], status: "active" },
  { id: "3901621", lat: -47.800, lon: 12.400, last_contact: "2025-09-29T10:00:00Z", temperature: 6.4, salinity: 34.6, trajectory: [[-47.90,12.30],[-47.82,12.38],[-47.75,12.50]], status: "inactive" },
];

const SAMPLE_PROFILE: ArgoProfile = {
  depth: [0, 200, 500, 1000],
  values: [20.2, 15.1, 8.3, 4.2],
  quality_flags: [1, 1, 1, 2],
  metadata: {
    variable: "temperature",
    units: "°C",
  },
};

const SAMPLE_TIME_SERIES: TimeSeriesResponse = {
  data: Array.from({ length: 12 }, (_, index) => {
    const baseDate = new Date("2024-01-01T00:00:00Z");
    baseDate.setDate(baseDate.getDate() + index * 7);
    return {
      timestamp: baseDate.toISOString(),
      temperature: 18 - index * 0.3,
      salinity: 35 + Math.sin(index / 2) * 0.2,
      pressure: 1013 + index * 2,
    };
  }),
  sqlQuery: "SELECT * FROM argo_profiles WHERE float_id = 'float_2903953' ORDER BY profile_date DESC LIMIT 12;",
};

const SAMPLE_QUALITY: DataQualityReport[] = [
  {
    metric: "temperature_qc",
    value: 1,
    unit: "qc",
    flag: "A",
    description: "All temperature readings passed Argo delayed-mode quality checks.",
  },
  {
    metric: "salinity_qc",
    value: 1,
    unit: "qc",
    flag: "A",
    description: "Salinity aligns with climatology within acceptable tolerances.",
  },
  {
    metric: "profile_completeness",
    value: 0.94,
    unit: "ratio",
    description: "94% of expected depth levels reported for the latest cycle.",
  },
];

const serializeFilters = (filters?: DataFilters): string => {
  if (!filters) return "";

  const params = new URLSearchParams();

  if (filters.floatIds?.length) {
    params.set("float_ids", filters.floatIds.join(","));
  }

  if (filters.status?.length) {
    params.set("status", filters.status.join(","));
  }

  if (filters.parameter) {
    params.set("parameter", filters.parameter);
  }

  if (filters.dateRange?.start) {
    params.set("start", filters.dateRange.start);
  }

  if (filters.dateRange?.end) {
    params.set("end", filters.dateRange.end);
  }

  for (const [key, value] of Object.entries(filters)) {
    if (["floatIds", "status", "parameter", "dateRange"].includes(key)) {
      continue;
    }
    if (value === undefined || value === null) {
      continue;
    }
    params.set(key, String(value));
  }

  return params.toString();
};

export const floatAIAPI = {
  async getDatabaseStats(): Promise<DatabaseStats> {
    try {
      return await fetchJson<DatabaseStats>("stats");
    } catch (error) {
      console.warn("FloatAI API: falling back to sample database stats", error);
      return {
        total_floats: SAMPLE_FLOATS.length,
        last_updated: null,
        dataset: "Sample dataset",
      };
    }
  },

  async getArgoFloats(filters?: DataFilters): Promise<ArgoFloatsResult> {
    try {
      const query = serializeFilters(filters);
      const path = query ? `floats?${query}` : "floats";
      const data = await fetchJson<ArgoFloat[]>(path);
      return { data, source: "live" };
    } catch (error) {
      console.warn("FloatAI API: falling back to sample float catalog", error);
      return { data: SAMPLE_FLOATS, source: "sample" };
    }
  },

  async getFloatProfile(floatId: string, variable: string): Promise<ArgoProfile> {
    try {
      return await fetchJson<ArgoProfile>(`floats/${floatId}/profiles/${variable}`);
    } catch (error) {
      console.warn("FloatAI API: falling back to sample profile", { floatId, variable, error });
      return SAMPLE_PROFILE;
    }
  },

  async getTimeSeriesData(floatId: string, variable: string): Promise<TimeSeriesResponse> {
    try {
      const query = new URLSearchParams({ variable }).toString();
      return await fetchJson<TimeSeriesResponse>(`floats/${floatId}/timeseries?${query}`);
    } catch (error) {
      console.warn("FloatAI API: falling back to sample time series", { floatId, variable, error });
      return SAMPLE_TIME_SERIES;
    }
  },

  async getDataQuality(floatId: string): Promise<DataQualityReport[]> {
    try {
      return await fetchJson<DataQualityReport[]>(`floats/${floatId}/quality`);
    } catch (error) {
      console.warn("FloatAI API: falling back to sample quality report", { floatId, error });
      return SAMPLE_QUALITY;
    }
  },

  async getFloatTrajectory(floatId: string, limit = 50): Promise<TrajectoryPoint[]> {
    try {
      const query = new URLSearchParams({ limit: String(limit) }).toString();
      return await fetchJson<TrajectoryPoint[]>(`floats/${floatId}/trajectory?${query}`);
    } catch (error) {
      console.warn("FloatAI API: falling back to synthetic trajectory", { floatId, error });
      const now = Date.now();
      return Array.from({ length: Math.min(limit, 10) }, (_, index) => ({
        lat: 40.7 + index * 0.02,
        lon: -74 + index * 0.015,
        timestamp: new Date(now - (limit - index) * 86400000).toISOString(),
        temperature: 18.5 - index * 0.1,
        salinity: 35.2 - index * 0.02,
        pressure: 1000 + index * 5,
      }));
    }
  },
};

/**
 * Sends a question to the FloatAI backend.
 * @param question The user's question as a string.
 * @returns A promise that resolves to the AI's response payload.
 */
export const askAI = async (question: string): Promise<AIResponse> => {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const payload = await response.json();
    return payload as AIResponse;
  } catch (error) {
    console.error("Failed to fetch from AI backend:", error);
    return {
      sql_query: "Error connecting to backend.",
      result_data: null,
      messages: undefined,
      metadata: undefined,
      error: "Could not connect to the AI server. Is it running?",
    };
  }
};
