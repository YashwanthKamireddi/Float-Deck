# This script creates a FastAPI server to expose our AI pipeline to the web.
# This is the "engine" that our frontend will talk to.

import logging
import os
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
import uvicorn

# We import the brain of our application from the ai_core module
from ai_core.data_access import (
    DataAccessError,
    FloatFilters,
    fetch_database_stats,
    fetch_float_catalog,
    fetch_float_profile,
    fetch_float_trajectory,
    fetch_quality_report,
    fetch_time_series,
)
from ai_core.main_agent import ConfigError, get_health_report, run_ai_pipeline
from ai_core import sample_data
from ai_core.config import get_settings
import threading

settings = get_settings()
_RATE_LIMIT_WINDOW = 60.0
_rate_lock = threading.Lock()
_rate_cache: dict[str, list[float]] = {}

# Load backend environment variables once at startup.
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("floatai.api")

load_dotenv()

# Create the FastAPI app instance
app = FastAPI(
    title="FloatAI Core",
    description="API for the FloatAI RAG-based Text-to-SQL pipeline for ARGO data.",
    version="1.0.0"
)

# --- CORS Middleware ---
# This is a critical security step. It allows your frontend application (running on a different port)
# to make requests to this backend server.
cors_origins_env = settings.cors_origins or "*"
parsed_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
allow_all_origins = "*" in parsed_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all_origins else parsed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    start_time = time.perf_counter()
    response = None
    try:
        response = await call_next(request)
    except Exception:  # pragma: no cover - defensive
        logger.exception("Request failed: %s %s", request.method, request.url.path)
        raise
    finally:
        duration_ms = (time.perf_counter() - start_time) * 1000
        logger.info(
            "HTTP %s %s completed in %.2f ms",
            request.method,
            request.url.path,
            duration_ms,
        )
    if response is not None:
        response.headers["X-Request-ID"] = request_id
    return response or JSONResponse(status_code=500, content={"detail": "Internal server error"})


def _enforce_rate_limit(request: Request) -> None:
    limit = max(1, settings.rate_limit_per_minute)
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    window_start = now - _RATE_LIMIT_WINDOW

    with _rate_lock:
        history = _rate_cache.get(key, [])
        history = [ts for ts in history if ts >= window_start]
        if len(history) >= limit:
            raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again shortly.")
        history.append(now)
        _rate_cache[key] = history


def enforce_auth_and_rate_limit(request: Request) -> None:
    shared_key = settings.api_shared_key
    if shared_key:
        provided = request.headers.get("x-api-key")
        if not provided or provided != shared_key:
            raise HTTPException(status_code=401, detail="Invalid or missing API key.")

    _enforce_rate_limit(request)


@app.exception_handler(ConfigError)
async def handle_config_error(request: Request, exc: ConfigError):  # pragma: no cover - defensive
    logger.warning("Configuration error: %s", exc)
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.exception_handler(DataAccessError)
async def handle_data_access_error(request: Request, exc: DataAccessError):  # pragma: no cover - defensive
    logger.warning("Data access error: %s", exc)
    return JSONResponse(status_code=503, content={"detail": str(exc)})

# --- Pydantic Models for a clear API contract ---
class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=600)


class AssistantMessage(BaseModel):
    role: str
    content: str
    type: Optional[str] = None
    title: Optional[str] = None


class QueryResponse(BaseModel):
    sql_query: Optional[str]
    result_data: Any
    messages: List[AssistantMessage]
    metadata: Dict[str, Any]
    error: Optional[str]


class DatabaseStats(BaseModel):
    total_floats: int
    last_updated: Optional[str] = None
    dataset: Optional[str] = None


class FloatSummary(BaseModel):
    id: str
    lat: float
    lon: float
    last_contact: Optional[str] = None
    temperature: Optional[float] = None
    salinity: Optional[float] = None
    trajectory: List[List[float]] = Field(default_factory=list)  # small list of [lat, lon]
    status: str


class FloatProfileResponse(BaseModel):
    depth: List[float]
    values: List[Optional[float]]
    quality_flags: List[Any] = Field(default_factory=list)
    metadata: Optional[Dict[str, Any]] = None


class TimeSeriesPoint(BaseModel):
    timestamp: Optional[str]
    temperature: Optional[float] = None
    salinity: Optional[float] = None
    pressure: Optional[float] = None


class TimeSeriesPayload(BaseModel):
    data: List[TimeSeriesPoint]
    sqlQuery: Optional[str] = None


class DataQualityMetric(BaseModel):
    metric: str
    value: float
    unit: Optional[str] = None
    description: Optional[str] = None


class TrajectoryPoint(BaseModel):
    lat: float
    lon: float
    timestamp: str
    temperature: Optional[float] = None
    salinity: Optional[float] = None
    pressure: Optional[float] = None


class HealthResponse(BaseModel):
    status: str
    checks: Dict[str, Any]

# --- API Endpoint ---
@app.post("/api/ask", response_model=QueryResponse)
async def ask_question(request: QueryRequest, _: None = Depends(enforce_auth_and_rate_limit)) -> QueryResponse:
    """
    This is the main endpoint for the application. It receives a question,
    runs it through the AI pipeline, and returns the result.
    """
    cleaned_question = request.question.strip()
    if not cleaned_question:
        raise HTTPException(status_code=422, detail="Question cannot be empty.")

    logger.info("Received question via API")
    try:
        response_payload = await run_in_threadpool(run_ai_pipeline, cleaned_question)
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.exception("ask_question failed")
        raise HTTPException(status_code=500, detail="Unexpected error processing question.") from exc

    return QueryResponse.model_validate(response_payload)


def _parse_iso_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid datetime format: {value}") from exc


@app.get("/api/health", response_model=HealthResponse)
async def get_health(_: None = Depends(enforce_auth_and_rate_limit)) -> HealthResponse:
    """
    Lightweight readiness probe that surfaces configuration issues without invoking the LLM.
    """
    return HealthResponse.model_validate(get_health_report())


@app.get("/api/stats", response_model=DatabaseStats)
async def get_database_stats(_: None = Depends(enforce_auth_and_rate_limit)) -> DatabaseStats:
    try:
        stats = fetch_database_stats()
    except DataAccessError as exc:
        logger.warning("Falling back to sample stats: %s", exc)
        stats = sample_data.stats()
    return DatabaseStats.model_validate(stats)


@app.get("/api/floats", response_model=List[FloatSummary])
async def list_floats(
    _: None = Depends(enforce_auth_and_rate_limit),
    float_ids: Optional[str] = Query(default=None, description="Comma-separated list of float IDs to include."),
    status: Optional[str] = Query(default=None, description="Comma-separated list of status filters (active, delayed, inactive)."),
    start: Optional[str] = Query(default=None, description="ISO timestamp lower bound for profile_date."),
    end: Optional[str] = Query(default=None, description="ISO timestamp upper bound for profile_date."),
    parameter: Optional[str] = Query(default=None, description="Reserved for future parameter-specific filtering."),
    limit: int = Query(default=200, ge=1, le=1000),
) -> List[FloatSummary]:
    filters = FloatFilters(
        float_ids=[value.strip() for value in float_ids.split(",") if value.strip()] if float_ids else None,
        status=[value.strip() for value in status.split(",") if value.strip()] if status else None,
        start=_parse_iso_dt(start),
        end=_parse_iso_dt(end),
        parameter=parameter,
    )

    try:
        catalog = fetch_float_catalog(filters=filters, limit=limit)
    except DataAccessError as exc:
        logger.warning("Falling back to sample float catalog: %s", exc)
        catalog = sample_data.float_catalog()

    return [FloatSummary.model_validate(item) for item in catalog]


@app.get("/api/floats/{float_id}/profiles/{variable}", response_model=FloatProfileResponse)
async def get_float_profile(float_id: str, variable: str, _: None = Depends(enforce_auth_and_rate_limit)) -> FloatProfileResponse:
    try:
        profile = fetch_float_profile(float_id, variable)
    except DataAccessError as exc:
        logger.warning("Falling back to sample profile for %s: %s", float_id, exc)
        profile = sample_data.profile(variable)

    return FloatProfileResponse.model_validate(profile)


@app.get("/api/floats/{float_id}/timeseries", response_model=TimeSeriesPayload)
async def get_float_time_series(
    float_id: str,
    variable: str = Query(default="temperature"),
    limit: int = Query(default=60, ge=1, le=200),
    _: None = Depends(enforce_auth_and_rate_limit),
) -> TimeSeriesPayload:
    try:
        payload = fetch_time_series(float_id, variable, limit=limit)
    except DataAccessError as exc:
        logger.warning("Falling back to sample time series for %s: %s", float_id, exc)
        payload = sample_data.time_series(variable)

    return TimeSeriesPayload.model_validate(payload)


@app.get("/api/floats/{float_id}/quality", response_model=List[DataQualityMetric])
async def get_float_quality(float_id: str, _: None = Depends(enforce_auth_and_rate_limit)) -> List[DataQualityMetric]:
    try:
        metrics = fetch_quality_report(float_id)
    except DataAccessError as exc:
        logger.warning("Falling back to sample quality metrics for %s: %s", float_id, exc)
        metrics = sample_data.quality()

    return [DataQualityMetric.model_validate(metric) for metric in metrics]


@app.get("/api/floats/{float_id}/trajectory", response_model=List[TrajectoryPoint])
async def get_float_trajectory(
    float_id: str,
    limit: int = Query(default=50, ge=2, le=200, description="Number of historical fixes to return."),
    _: None = Depends(enforce_auth_and_rate_limit),
) -> List[TrajectoryPoint]:
    try:
        waypoints = fetch_float_trajectory(float_id=float_id, limit=limit)
    except DataAccessError as exc:
        logger.warning("Falling back to sample trajectory for %s: %s", float_id, exc)
        waypoints = sample_data.trajectory()

    return [TrajectoryPoint.model_validate(point) for point in waypoints]

# --- Run the server ---
# This block allows you to run the server directly for testing.
if __name__ == "__main__":
    api_host = os.getenv("API_HOST", "0.0.0.0")
    api_port = int(os.getenv("API_PORT", "8000"))
    uvicorn.run(app, host=api_host, port=api_port)
