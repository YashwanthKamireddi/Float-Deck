"""Lightweight sample payloads used when the database is unavailable.

These keep the dashboard responsive in demo environments without PostgreSQL.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional


def _now() -> datetime:
    return datetime.now(timezone.utc)


def stats() -> Dict[str, Any]:
    return {
        "total_floats": 3,
        "last_updated": (_now() - timedelta(days=2)).isoformat(),
        "dataset": "Sample data (offline)",
    }


def float_catalog() -> List[Dict[str, Any]]:
    base_time = _now() - timedelta(days=1)
    return [
        {"id": "5905612", "lat": -33.5, "lon": 151.3, "last_contact": base_time.isoformat(), "temperature": 15.4, "salinity": 35.1, "trajectory": [], "status": "active"},
        {"id": "5905613", "lat": -12.1, "lon": 145.2, "last_contact": (base_time - timedelta(days=3)).isoformat(), "temperature": 12.9, "salinity": 34.7, "trajectory": [], "status": "active"},
        {"id": "5905614", "lat": 2.5, "lon": -150.8, "last_contact": (base_time - timedelta(days=12)).isoformat(), "temperature": 10.2, "salinity": 34.9, "trajectory": [], "status": "delayed"},
        {"id": "3901774", "lat": 46.5, "lon": -17.8, "last_contact": (base_time - timedelta(days=2)).isoformat(), "temperature": 9.1, "salinity": 35.4, "trajectory": [], "status": "active"},
        {"id": "2902273", "lat": 14.2, "lon": -38.6, "last_contact": (base_time - timedelta(days=1)).isoformat(), "temperature": 20.3, "salinity": 36.1, "trajectory": [], "status": "active"},
        {"id": "3901621", "lat": -47.8, "lon": 12.4, "last_contact": (base_time - timedelta(days=50)).isoformat(), "temperature": 6.4, "salinity": 34.6, "trajectory": [], "status": "inactive"},
    ]


def profile(variable: str = "temperature") -> Dict[str, Any]:
    depths = [0, 25, 50, 100, 200, 400, 800, 1000]
    values = {
        "temperature": [18.2, 16.9, 15.3, 12.1, 8.2, 5.4, 3.9, 3.5],
        "salinity": [35.2, 35.3, 35.1, 34.9, 34.8, 34.7, 34.6, 34.5],
        "pressure": depths,
    }.get(variable, depths)

    return {
        "depth": depths,
        "values": values,
        "quality_flags": [],
        "metadata": {"variable": variable, "sample_count": len(values)},
    }


def time_series(variable: str = "temperature") -> Dict[str, Any]:
    base = _now()
    data: List[Dict[str, Optional[float]]] = []
    for idx, delta in enumerate(range(0, 30, 5)):
        timestamp = (base - timedelta(days=delta)).isoformat()
        data.append(
            {
                "timestamp": timestamp,
                "temperature": 12.0 + idx * 0.1 if variable == "temperature" else None,
                "salinity": 34.5 + idx * 0.01 if variable == "salinity" else None,
                "pressure": 10.0 + idx * 2.0 if variable == "pressure" else None,
            }
        )

    return {"data": data, "sqlQuery": None}


def trajectory() -> List[Dict[str, Any]]:
    base = _now()
    points: List[Dict[str, Any]] = []
    lats = [-33.5, -33.45, -33.4, -33.35, -33.3]
    lons = [151.3, 151.32, 151.35, 151.37, 151.4]
    for idx, (lat, lon) in enumerate(zip(lats, lons, strict=False)):
        points.append(
            {
                "lat": lat,
                "lon": lon,
                "timestamp": (base - timedelta(days=idx)).isoformat(),
                "temperature": 15.0 - idx * 0.1,
                "salinity": 35.0 + idx * 0.01,
                "pressure": 5.0 + idx * 0.5,
            }
        )
    return points


def quality() -> List[Dict[str, Any]]:
    return [
        {
            "metric": "temperature_completeness",
            "value": 98.2,
            "unit": "percent",
            "description": "Sample completeness for temperature readings.",
        },
        {
            "metric": "salinity_completeness",
            "value": 96.4,
            "unit": "percent",
            "description": "Sample completeness for salinity readings.",
        },
        {
            "metric": "pressure_completeness",
            "value": 99.9,
            "unit": "percent",
            "description": "Sample completeness for pressure readings.",
        },
    ]
