"""High-throughput ETL pipeline for loading NetCDF ARGO profiles into PostgreSQL.

This module intentionally opts into fast-path inserts (COPY) and rigorous data
normalisation so the analytics backend can comfortably query tens of millions of
rows. Run it after syncing new NetCDF drops into ``nc files/``::

    python data_pipeline/build_database.py

Use ``--limit`` during development to process only the first N files.
"""

from __future__ import annotations

import io
import logging
import os
import sys
from argparse import ArgumentParser
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Optional, Sequence

import pandas as pd
import xarray as xr
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("floatai.etl")


# ---------------------------------------------------------------------------
# Configuration helpers


MANDATORY_ALIASES: Mapping[str, Sequence[str]] = {
    "profile_date": ("profile_date", "JULD", "juld"),
    "latitude": ("latitude", "LATITUDE"),
    "longitude": ("longitude", "LONGITUDE"),
    "pressure": ("pres_adjusted", "PRES_ADJUSTED", "PRES"),
}

OPTIONAL_ALIASES: Mapping[str, Sequence[str]] = {
    "temperature": ("temp_adjusted", "TEMP_ADJUSTED", "TEMP"),
    "salinity": ("psal_adjusted", "PSAL_ADJUSTED", "PSAL"),
}

OUTPUT_ORDER: Sequence[str] = (
    "profile_date",
    "latitude",
    "longitude",
    "pressure",
    "temperature",
    "salinity",
    "float_id",
)


@dataclass(slots=True)
class PipelineConfig:
    root_data_folder: Path = Path("nc files")
    database_url: Optional[str] = None
    table_name: str = "argo_profiles"
    truncate_table: bool = True
    limit_files: Optional[int] = None
    create_indexes: bool = True


# ---------------------------------------------------------------------------
# Utility functions


def _resolve_env_config() -> PipelineConfig:
    load_dotenv()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        password = os.getenv("DB_PASSWORD")
        if not password:
            raise ValueError(
                "Provide DATABASE_URL or DB_PASSWORD/DB_USER/DB_HOST/DB_PORT/DB_NAME in your .env file."
            )

        user = os.getenv("DB_USER", "postgres")
        host = os.getenv("DB_HOST", "localhost")
        port = os.getenv("DB_PORT", "5432")
        name = os.getenv("DB_NAME", "float")
        database_url = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{name}"

    return PipelineConfig(database_url=database_url)


def _parse_args(config: PipelineConfig) -> PipelineConfig:
    parser = ArgumentParser(description="Load ARGO NetCDF profiles into PostgreSQL.")
    parser.add_argument(
        "--root",
        type=Path,
        default=config.root_data_folder,
        help="Root directory containing float profile subfolders (default: 'nc files').",
    )
    parser.add_argument(
        "--no-truncate",
        dest="truncate",
        action="store_false",
        help="Append to the target table instead of truncating it first.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process at most N NetCDF files (useful for smoke tests).",
    )
    parser.add_argument(
        "--skip-index",
        dest="create_indexes",
        action="store_false",
        help="Skip creating/updating supporting indexes at the end of the run.",
    )

    args = parser.parse_args()
    config.root_data_folder = args.root
    config.truncate_table = args.truncate
    config.limit_files = args.limit
    config.create_indexes = args.create_indexes
    return config


def _create_engine(database_url: str) -> Engine:
    logger.info("Connecting to PostgreSQL at %s", database_url.rsplit("@", maxsplit=1)[-1])
    return create_engine(database_url)


def _collect_profile_files(root: Path, limit: Optional[int]) -> List[Path]:
    if not root.exists():
        raise FileNotFoundError(f"Input root '{root}' does not exist.")

    collected: List[Path] = []
    for path in sorted(root.rglob("*.nc")):
        name = path.name
        if not (name.startswith("D") or name.startswith("R")):
            continue
        collected.append(path)
        if limit is not None and len(collected) >= limit:
            break

    if not collected:
        raise FileNotFoundError(f"No NetCDF profile files discovered under '{root}'.")

    logger.info("Discovered %s NetCDF profile files to process.", len(collected))
    return collected


def _ensure_table(engine: Engine, table_name: str) -> None:
    create_stmt = f"""
    CREATE TABLE IF NOT EXISTS {table_name} (
        id BIGSERIAL PRIMARY KEY,
        float_id INTEGER NOT NULL,
        profile_date TIMESTAMPTZ NOT NULL,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        pressure DOUBLE PRECISION,
        temperature DOUBLE PRECISION,
        salinity DOUBLE PRECISION
    );
    """

    with engine.begin() as conn:
        conn.execute(text(create_stmt))


def _truncate_table(engine: Engine, table_name: str) -> None:
    logger.info("Truncating table %s", table_name)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE TABLE {table_name} RESTART IDENTITY"))


def _create_supporting_indexes(engine: Engine, table_name: str) -> None:
    statements = (
        f"CREATE INDEX IF NOT EXISTS idx_{table_name}_float_date ON {table_name} (float_id, profile_date DESC)",
        f"CREATE INDEX IF NOT EXISTS idx_{table_name}_profile_date ON {table_name} (profile_date DESC)",
    )

    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
        conn.execute(text(f"ANALYZE {table_name}"))
    logger.info("Indexes ensured for %s", table_name)


def _extract_float_id(path: Path) -> int:
    stem = path.stem.split("_")[0]
    digits = "".join(ch for ch in stem if ch.isdigit())
    if not digits:
        raise ValueError(f"Could not determine float ID from filename '{path.name}'.")
    return int(digits)


def _select_columns(frame: pd.DataFrame, aliases: Mapping[str, Sequence[str]]) -> Dict[str, str]:
    resolved: Dict[str, str] = {}
    for clean_name, candidates in aliases.items():
        for candidate in candidates:
            if candidate in frame.columns:
                resolved[clean_name] = candidate
                break
        else:
            raise KeyError(f"Missing required column candidates {candidates!r}")
    return resolved


def _select_optional_columns(frame: pd.DataFrame, aliases: Mapping[str, Sequence[str]]) -> Dict[str, Optional[str]]:
    resolved: Dict[str, Optional[str]] = {}
    for clean_name, candidates in aliases.items():
        resolved[clean_name] = next((candidate for candidate in candidates if candidate in frame.columns), None)
    return resolved


def _normalise_profile_dataframe(raw: pd.DataFrame, float_id: int) -> pd.DataFrame:
    mandatory_map = _select_columns(raw, MANDATORY_ALIASES)
    optional_map = _select_optional_columns(raw, OPTIONAL_ALIASES)

    data: Dict[str, pd.Series] = {clean: raw[column] for clean, column in mandatory_map.items()}
    for clean, column in optional_map.items():
        data[clean] = raw[column] if column else pd.Series(pd.NA, index=raw.index)

    df = pd.DataFrame(data)
    df["float_id"] = float_id

    df["profile_date"] = pd.to_datetime(df["profile_date"], errors="coerce", utc=True)
    for column in ("latitude", "longitude", "pressure", "temperature", "salinity"):
        df[column] = pd.to_numeric(df[column], errors="coerce")

    df = df.dropna(subset=["profile_date", "latitude", "longitude", "pressure"])

    return df.reindex(columns=list(OUTPUT_ORDER))


def _dataset_to_dataframe(path: Path) -> pd.DataFrame:
    dataset = xr.open_dataset(path, mask_and_scale=True)
    try:
        frame = dataset.to_dataframe().reset_index()
    finally:
        dataset.close()
    return frame


def _copy_dataframe(engine: Engine, table_name: str, frame: pd.DataFrame) -> int:
    if frame.empty:
        return 0

    buffer = io.StringIO()
    frame.to_csv(buffer, index=False, header=False, na_rep="\\N")
    buffer.seek(0)

    copy_sql = (
        f"COPY {table_name} (profile_date, latitude, longitude, pressure, temperature, salinity, float_id)"
        " FROM STDIN WITH (FORMAT csv, NULL '\\N')"
    )

    raw_conn = engine.raw_connection()
    try:
        cursor = raw_conn.cursor()
        try:
            cursor.copy_expert(copy_sql, buffer)
        finally:
            cursor.close()
        raw_conn.commit()
    finally:
        raw_conn.close()

    return len(frame)


def _process_file(engine: Engine, table_name: str, path: Path) -> int:
    filename = path.name
    logger.debug("Processing %s", filename)

    try:
        raw = _dataset_to_dataframe(path)
        normalised = _normalise_profile_dataframe(raw, _extract_float_id(path))
        loaded = _copy_dataframe(engine, table_name, normalised)
        logger.info("%-35s ✅ %7d rows", filename, loaded)
        return loaded
    except Exception:  # pragma: no cover - defensive logging for operators
        logger.exception("Failed to process %s", filename)
        return 0


def run_pipeline(config: PipelineConfig) -> None:
    if config.database_url is None:
        raise ValueError("Database URL resolved to None; check environment variables.")

    engine = _create_engine(config.database_url)
    _ensure_table(engine, config.table_name)

    if config.truncate_table:
        _truncate_table(engine, config.table_name)

    files = _collect_profile_files(config.root_data_folder, config.limit_files)

    total_rows = 0
    for path in files:
        total_rows += _process_file(engine, config.table_name, path)

    if config.create_indexes:
        _create_supporting_indexes(engine, config.table_name)

    logger.info("Bulk ETL complete. Inserted %s rows from %s files.", total_rows, len(files))


def main() -> None:
    try:
        config = _parse_args(_resolve_env_config())
        run_pipeline(config)
    except Exception as exc:  # pragma: no cover - fatal operator feedback
        logger.error("Pipeline aborted: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
