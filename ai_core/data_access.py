"""Utility helpers for structured access to the FloatAI analytics database.

This module centralises read-only queries that power the dashboard endpoints.
It reuses the shared SQLAlchemy engine managed by :mod:`ai_core.main_agent`
so we avoid bootstrapping LangChain components multiple times per request.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import MetaData, Table, and_, desc, func, select, text
from sqlalchemy.engine import Engine, Result
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.sql.elements import ColumnElement

from .main_agent import get_sql_engine, initialize_ai_core


@dataclass
class FloatFilters:
    float_ids: Optional[List[str]] = None
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    status: Optional[List[str]] = None
    parameter: Optional[str] = None  # reserved for future server-side filtering


class DataAccessError(RuntimeError):
    """Raised when the database cannot be queried for operational dashboards."""


_METADATA = MetaData()
_ARGO_PROFILES: Optional[Table] = None


def _ensure_table(engine: Engine) -> Table:
    global _ARGO_PROFILES  # noqa: PLW0603
    if _ARGO_PROFILES is None:
        _ARGO_PROFILES = Table("argo_profiles", _METADATA, autoload_with=engine)
    return _ARGO_PROFILES


def _coerce_datetime(raw: Optional[Any]) -> Optional[datetime]:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    raise ValueError(f"Unexpected datetime payload: {raw!r}")


def fetch_database_stats() -> Dict[str, Any]:
    """Return fleet-wide metrics consumed by the dashboard header."""

    initialize_ai_core()
    engine = get_sql_engine()

    try:
        with engine.connect() as connection:
            total_floats = connection.execute(
                text("SELECT COUNT(DISTINCT float_id) FROM argo_profiles")
            ).scalar_one_or_none() or 0

            last_updated_raw = connection.execute(
                text("SELECT MAX(profile_date) FROM argo_profiles")
            ).scalar_one_or_none()

    except SQLAlchemyError as exc:  # pragma: no cover - defensive guard
        raise DataAccessError("Failed to compute database statistics.") from exc

    last_updated = None
    if last_updated_raw is not None:
        if isinstance(last_updated_raw, datetime):
            last_updated = (last_updated_raw if last_updated_raw.tzinfo else last_updated_raw.replace(tzinfo=timezone.utc)).isoformat()
        else:
            last_updated = str(last_updated_raw)

    return {
        "total_floats": int(total_floats),
        "last_updated": last_updated,
        "dataset": "ARGO operational subset",
    }


def _compute_status(last_contact: Optional[datetime]) -> str:
    if last_contact is None:
        return "unknown"

    delta_days = (datetime.now(timezone.utc) - last_contact).days
    if delta_days <= 30:
        return "active"
    if delta_days <= 90:
        return "delayed"
    return "inactive"


def _match_status_filter(status: Optional[List[str]], candidate: str) -> bool:
    if not status:
        return True
    candidate_lower = candidate.lower()
    return any(candidate_lower == value.lower() for value in status)


def fetch_float_catalog(filters: Optional[FloatFilters] = None, limit: int = 200) -> List[Dict[str, Any]]:
    initialize_ai_core()
    engine = get_sql_engine()
    table = _ensure_table(engine)

    filters = filters or FloatFilters()

    ranked = select(
        table.c.float_id,
        table.c.latitude,
        table.c.longitude,
        table.c.profile_date,
        table.c.temperature,
        table.c.salinity,
        func.row_number().over(
            partition_by=table.c.float_id,
            order_by=table.c.profile_date.desc(),
        ).label("profile_rank"),
    )

    conditions: List[ColumnElement[bool]] = [
        table.c.latitude.is_not(None),
        table.c.longitude.is_not(None),
    ]

    if filters.float_ids:
        conditions.append(table.c.float_id.in_(filters.float_ids))

    if filters.start is not None:
        conditions.append(table.c.profile_date >= filters.start)

    if filters.end is not None:
        conditions.append(table.c.profile_date <= filters.end)

    ranked = ranked.where(and_(*conditions))

    latest = ranked.subquery("latest")

    aggregated = (
        select(
            latest.c.float_id,
            func.max(latest.c.profile_date).label("last_contact"),
            func.avg(latest.c.temperature).label("temperature"),
            func.avg(latest.c.salinity).label("salinity"),
            func.max(latest.c.latitude).label("latitude"),
            func.max(latest.c.longitude).label("longitude"),
        )
        .where(latest.c.profile_rank == 1)
        .group_by(latest.c.float_id)
        .order_by(desc("last_contact"))
        .limit(limit)
    )

    try:
        with engine.connect() as connection:
            result: Result = connection.execute(aggregated)
            catalog = []
            for row in result.mappings():
                last_contact = _coerce_datetime(row["last_contact"]) if row["last_contact"] is not None else None
                status = _compute_status(last_contact)
                if not _match_status_filter(filters.status, status):
                    continue

                catalog.append(
                    {
                        "id": str(row["float_id"]),
                        "lat": float(row["latitude"]) if row["latitude"] is not None else 0.0,
                        "lon": float(row["longitude"]) if row["longitude"] is not None else 0.0,
                        "last_contact": last_contact.isoformat() if last_contact else None,
                        "temperature": float(row["temperature"]) if row["temperature"] is not None else None,
                        "salinity": float(row["salinity"]) if row["salinity"] is not None else None,
                        "trajectory": [],
                        "status": status,
                    }
                )
    except SQLAlchemyError as exc:  # pragma: no cover - defensive guard
        raise DataAccessError("Failed to load float catalog from PostgreSQL.") from exc

    return catalog


def fetch_float_profile(float_id: str, variable: str = "temperature") -> Dict[str, Any]:
    initialize_ai_core()
    engine = get_sql_engine()
    table = _ensure_table(engine)

    supported_variables = {"temperature", "salinity", "pressure"}
    if variable not in supported_variables:
        raise DataAccessError(f"Unsupported variable '{variable}'. Choose from {', '.join(sorted(supported_variables))}.")

    latest_profile_date_subquery = (
        select(table.c.profile_date)
        .where(table.c.float_id == float_id)
        .order_by(table.c.profile_date.desc())
        .limit(1)
    )

    stmt = (
        select(table.c.pressure, table.c.temperature, table.c.salinity)
        .where(
            and_(
                table.c.float_id == float_id,
                table.c.profile_date == latest_profile_date_subquery.scalar_subquery(),
            )
        )
        .order_by(table.c.pressure.asc())
        .limit(500)
    )

    try:
        with engine.connect() as connection:
            result = connection.execute(stmt)
            depths: List[float] = []
            values: List[Optional[float]] = []
            for row in result:
                depths.append(float(row.pressure) if row.pressure is not None else 0.0)
                if variable == "temperature":
                    values.append(float(row.temperature) if row.temperature is not None else None)
                elif variable == "salinity":
                    values.append(float(row.salinity) if row.salinity is not None else None)
                else:  # pressure
                    values.append(float(row.pressure) if row.pressure is not None else None)

    except SQLAlchemyError as exc:  # pragma: no cover - defensive guard
        raise DataAccessError("Failed to load float profile data.") from exc

    cleaned_values = [value for value in values if value is not None]
    return {
        "depth": depths,
        "values": [value if value is not None else None for value in values],
        "quality_flags": [],
        "metadata": {
            "variable": variable,
            "sample_count": len(cleaned_values),
        },
    }


def fetch_time_series(float_id: str, variable: str = "temperature", limit: int = 60) -> Dict[str, Any]:
    initialize_ai_core()
    engine = get_sql_engine()
    table = _ensure_table(engine)

    column = {
        "temperature": table.c.temperature,
        "salinity": table.c.salinity,
        "pressure": table.c.pressure,
    }.get(variable)

    if column is None:
        raise DataAccessError(f"Unsupported time series variable '{variable}'.")

    stmt = (
        select(
            table.c.profile_date.label("timestamp"),
            table.c.temperature,
            table.c.salinity,
            table.c.pressure,
        )
        .where(table.c.float_id == float_id)
        .order_by(table.c.profile_date.desc())
        .limit(limit)
    )

    try:
        with engine.connect() as connection:
            result = connection.execute(stmt)
            series = []
            for row in result.mappings():
                timestamp = _coerce_datetime(row["timestamp"])
                series.append(
                    {
                        "timestamp": timestamp.isoformat() if timestamp else None,
                        "temperature": float(row["temperature"]) if row["temperature"] is not None else None,
                        "salinity": float(row["salinity"]) if row["salinity"] is not None else None,
                        "pressure": float(row["pressure"]) if row["pressure"] is not None else None,
                    }
                )
    except SQLAlchemyError as exc:  # pragma: no cover - defensive guard
        raise DataAccessError("Failed to load float time series.") from exc

    series.reverse()  # chronological order
    return {"data": series, "sqlQuery": None}


def fetch_float_trajectory(float_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    initialize_ai_core()
    engine = get_sql_engine()
    table = _ensure_table(engine)

    stmt = (
        select(
            table.c.latitude,
            table.c.longitude,
            table.c.profile_date.label("timestamp"),
            table.c.temperature,
            table.c.salinity,
            table.c.pressure,
        )
        .where(table.c.float_id == float_id)
        .where(table.c.latitude.is_not(None), table.c.longitude.is_not(None))
        .order_by(table.c.profile_date.desc())
        .limit(limit)
    )

    try:
        with engine.connect() as connection:
            result = connection.execute(stmt)
            waypoints: List[Dict[str, Any]] = []
            for row in result.mappings():
                timestamp = _coerce_datetime(row["timestamp"])
                latitude = row["latitude"]
                longitude = row["longitude"]
                if timestamp is None or latitude is None or longitude is None:
                    continue

                waypoint = {
                    "lat": float(latitude),
                    "lon": float(longitude),
                    "timestamp": timestamp.isoformat(),
                    "temperature": float(row["temperature"]) if row["temperature"] is not None else None,
                    "salinity": float(row["salinity"]) if row["salinity"] is not None else None,
                    "pressure": float(row["pressure"]) if row["pressure"] is not None else None,
                }
                waypoints.append(waypoint)
    except SQLAlchemyError as exc:  # pragma: no cover - defensive guard
        raise DataAccessError("Failed to load float trajectory.") from exc

    waypoints.reverse()  # chronological order for plotting
    return waypoints


def fetch_quality_report(float_id: str) -> List[Dict[str, Any]]:
    initialize_ai_core()
    engine = get_sql_engine()
    table = _ensure_table(engine)

    stmt = select(
        func.count().label("total"),
        func.count(table.c.temperature).label("temperature_non_null"),
        func.count(table.c.salinity).label("salinity_non_null"),
        func.count(table.c.pressure).label("pressure_non_null"),
    ).where(table.c.float_id == float_id)

    try:
        with engine.connect() as connection:
            row = connection.execute(stmt).mappings().first()
    except SQLAlchemyError as exc:  # pragma: no cover - defensive guard
        raise DataAccessError("Failed to compute data quality metrics.") from exc

    if row is None:
        return []

    total = int(row["total"] or 0)
    if total == 0:
        return []

    def ratio(value: Optional[int]) -> float:
        return round(((value or 0) / total) * 100, 2)

    return [
        {
            "metric": "temperature_completeness",
            "value": ratio(row["temperature_non_null"]),
            "unit": "percent",
            "description": "Percentage of measurements with valid temperature readings.",
        },
        {
            "metric": "salinity_completeness",
            "value": ratio(row["salinity_non_null"]),
            "unit": "percent",
            "description": "Percentage of measurements with valid salinity readings.",
        },
        {
            "metric": "pressure_completeness",
            "value": ratio(row["pressure_non_null"]),
            "unit": "percent",
            "description": "Percentage of measurements with valid pressure readings.",
        },
    ]
