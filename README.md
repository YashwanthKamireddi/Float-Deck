# FloatAI

Conversational ocean intelligence for the ARGO fleet. FloatAI turns plain-English questions into audited SQL, maps, profiles, and time-series insights with provenance you can trust.

## What you can do
- Ask for latest float locations, health, and trajectories.
- Pull temperature/salinity profiles and time-series rollups by float or region.
- Summarize fleet stats and QA completeness with graceful fallbacks if the DB is offline.
- Review the exact SQL run for every data answer.

## Architecture at a glance
- **Frontend**: Vite + React + TypeScript, Leaflet for the ocean map, Plotly for profiles/time series, polished UI with command palette and quick prompts.
- **API**: FastAPI serving `/api/ask` for AI responses plus operational routes for stats, floats, profiles, trajectories, quality, and time-series.
- **AI/RAG stack**: Gemini via `langchain-google-genai`, FAISS vector store, HuggingFace embeddings, LangChain router to classify conversational vs data intents, strict column allowlist on SQL.
- **Data layer**: PostgreSQL (`argo_profiles`), SQLAlchemy for access, ETL pipeline to load NetCDF (COPY-based) via `data_pipeline/build_database.py`.
- **Knowledge base**: Curated docs embedded into FAISS (`ai_core/faiss_index`) for schema/context grounding.
- **Resilience**: Sample data fallback for API routes when DB is unavailable; health endpoint surfaces config/DB/FAISS/key status.

## API surface (used by the frontend)
- `POST /api/ask` – main AI endpoint (conversational + text-to-SQL).
- `GET /api/stats` – fleet metrics.
- `GET /api/floats` – catalog with filters.
- `GET /api/floats/{id}/profiles/{variable}` – latest profile.
- `GET /api/floats/{id}/timeseries` – recent time series (temperature/salinity/pressure).
- `GET /api/floats/{id}/quality` – QA completeness metrics.
- `GET /api/floats/{id}/trajectory` – recent trajectory points.
- `GET /api/health` – readiness/config probe (DB/FAISS/API key).

## AI / Guardrails
- Gemini model via LangChain with a router to choose conversational vs data query mode.
- SQL generation constrained to approved columns: `float_id`, `profile_date`, `latitude`, `longitude`, `pressure`, `temperature`, `salinity`.
- Audited outputs: SQL receipts are returned with every data answer.
- Sample-data fallback keeps UX responsive when Postgres is down.

## Data pipeline (ETL)
- `data_pipeline/build_database.py`: COPY-based loader for NetCDF ARGO profiles into `argo_profiles`.
- Mandatory fields mapped and coerced (profile_date, lat/lon, pressure; optional temperature/salinity).
- Indexing and truncation switches for fast rebuilds or append-only runs.

## Frontend experience
- Command palette (Ctrl/Cmd+K) with quick actions and hover polish.
- Ocean map with live fleet markers, tooltips, trajectories, and health filters.
- Profiles and time-series charts with depth-aware rendering.
- Chat tray + main workspace: SQL tab, analysis table, map, and profiles.

## Tech stack
- **Frontend**: Vite, React, TypeScript, Tailwind/CSS, Leaflet, Plotly.
- **Backend**: FastAPI, SQLAlchemy, Pydantic, Uvicorn.
- **AI**: LangChain, Gemini (langchain-google-genai), HuggingFace embeddings, FAISS.
- **Data/ETL**: pandas, xarray, netCDF4, PostgreSQL, psycopg2.

## Notes
- Configure secrets via environment variables; keep `.env` out of version control.
- Health check at `/api/health` helps verify DB connectivity, FAISS presence, and API key before using the UI.
