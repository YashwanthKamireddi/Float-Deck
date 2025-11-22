# This script creates a FastAPI server to expose our AI pipeline to the web.
# This is the "engine" that our frontend will talk to.

import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
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
from ai_core.main_agent import run_ai_pipeline

# Load backend environment variables once at startup.
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
cors_origins_env = os.getenv("BACKEND_CORS_ORIGINS", "*")
parsed_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
allow_all_origins = "*" in parsed_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all_origins else parsed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pydantic Models for a clear API contract ---
class QueryRequest(BaseModel):
    question: str


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

# --- API Endpoint ---
@app.post("/api/ask", response_model=QueryResponse)
async def ask_question(request: QueryRequest) -> QueryResponse:
    """
    This is the main endpoint for the application. It receives a question,
    runs it through the AI pipeline, and returns the result.
    """
    print(f"Received question via API: {request.question}")
    response_payload = run_ai_pipeline(request.question)
    return QueryResponse.model_validate(response_payload)


def _parse_iso_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid datetime format: {value}") from exc


@app.get("/api/stats", response_model=DatabaseStats)
async def get_database_stats() -> DatabaseStats:
    try:
        stats = fetch_database_stats()
    except DataAccessError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return DatabaseStats.model_validate(stats)


@app.get("/api/floats", response_model=List[FloatSummary])
async def list_floats(
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
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return [FloatSummary.model_validate(item) for item in catalog]


@app.get("/api/floats/{float_id}/profiles/{variable}", response_model=FloatProfileResponse)
async def get_float_profile(float_id: str, variable: str) -> FloatProfileResponse:
    try:
        profile = fetch_float_profile(float_id, variable)
    except DataAccessError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return FloatProfileResponse.model_validate(profile)


@app.get("/api/floats/{float_id}/timeseries", response_model=TimeSeriesPayload)
async def get_float_time_series(float_id: str, variable: str = Query(default="temperature")) -> TimeSeriesPayload:
    try:
        payload = fetch_time_series(float_id, variable)
    except DataAccessError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return TimeSeriesPayload.model_validate(payload)


@app.get("/api/floats/{float_id}/quality", response_model=List[DataQualityMetric])
async def get_float_quality(float_id: str) -> List[DataQualityMetric]:
    try:
        metrics = fetch_quality_report(float_id)
    except DataAccessError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return [DataQualityMetric.model_validate(metric) for metric in metrics]


@app.get("/api/floats/{float_id}/trajectory", response_model=List[TrajectoryPoint])
async def get_float_trajectory(
    float_id: str,
    limit: int = Query(default=50, ge=2, le=200, description="Number of historical fixes to return."),
) -> List[TrajectoryPoint]:
    try:
        waypoints = fetch_float_trajectory(float_id=float_id, limit=limit)
    except DataAccessError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return [TrajectoryPoint.model_validate(point) for point in waypoints]

# --- Run the server ---
# This block allows you to run the server directly for testing.
if __name__ == "__main__":
    api_host = os.getenv("API_HOST", "0.0.0.0")
    api_port = int(os.getenv("API_PORT", "8000"))
    uvicorn.run(app, host=api_host, port=api_port)
