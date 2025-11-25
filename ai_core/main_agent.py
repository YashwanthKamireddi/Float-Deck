# This is the final, production-ready version of the AI agent.
# It now returns clean, JSON-serializable data for the frontend.

from __future__ import annotations

import logging
import os
import re
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, cast

import certifi

from dotenv import load_dotenv
from langchain_community.utilities import SQLDatabase
from langchain_community.vectorstores import FAISS
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_google_genai import ChatGoogleGenerativeAI
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from ai_core.config import get_settings


logger = logging.getLogger(__name__)


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid."""


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

load_dotenv()

# Ensure outbound HTTPS requests (Google Generative AI, HuggingFace) have a valid CA bundle.
DEFAULT_CERT_PATH = Path(certifi.where()).resolve()
if not DEFAULT_CERT_PATH.is_file():
    raise RuntimeError(
        "certifi CA bundle not found. Ensure certifi is installed and accessible."
    )
os.environ["SSL_CERT_FILE"] = str(DEFAULT_CERT_PATH)
os.environ["REQUESTS_CA_BUNDLE"] = str(DEFAULT_CERT_PATH)


# --- Global initialization caches ---
llm = None
db = None
db_engine: Optional[Engine] = None
rag_chain = None
conversation_chain = None
settings = get_settings()
QUERY_TIMEOUT_MS = settings.query_timeout_ms


def _get_google_api_key() -> str:
    api_key = settings.google_api_key
    if not api_key:
        raise ConfigError("GOOGLE_API_KEY is not configured. Add it to your .env file before starting the API server.")
    return api_key


def _get_database_uri() -> str:
    database_url = settings.database_url
    if database_url:
        return database_url

    password = settings.db_password
    if not password:
        raise ConfigError(
            "Database credentials are missing. Provide DATABASE_URL or DB_PASSWORD in your .env file."
        )

    user = settings.db_user
    host = settings.db_host
    port = settings.db_port
    db_name = settings.db_name

    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db_name}"


def _initialise_sql_engine() -> Engine:
    global db_engine

    if db_engine is not None:
        return db_engine

    database_uri = _get_database_uri()
    try:
        candidate_engine = create_engine(database_uri, pool_pre_ping=True)
        with candidate_engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - defensive guard
        db_engine = None
        logger.exception("Unable to establish PostgreSQL connection to %s", database_uri.rsplit("@", maxsplit=1)[-1])
        raise ConfigError(
            "Unable to connect to PostgreSQL. Double-check your DATABASE_URL/DB_* environment variables and ensure the database is reachable."
        ) from exc

    db_engine = candidate_engine
    logger.info("PostgreSQL connection established.")
    return db_engine


def _get_faiss_index_path() -> str:
    custom_path = settings.faiss_index_path
    default_path = Path(__file__).resolve().parent / "faiss_index"
    resolved_path = Path(custom_path) if custom_path else default_path

    if not resolved_path.exists():
        raise ConfigError(
            f"FAISS index not found at '{resolved_path}'. Run ai_core/create_vector_db.py to generate it."
        )

    return str(resolved_path)


def _get_retriever_k(default: int = 6) -> int:
    value = settings.rag_retriever_k
    if value < 1:
        logger.warning("Invalid RAG_RETRIEVER_K value '%s'. Falling back to %s.", value, default)
        return default
    return value


def _load_embedding_model():
    """Load the embedding model lazily to avoid heavy imports at module import time."""

    embeddings_model_name = settings.embeddings_model

    try:
        from langchain_huggingface import HuggingFaceEmbeddings  # type: ignore
    except ImportError:
        from langchain_community.embeddings import HuggingFaceEmbeddings  # type: ignore

    return HuggingFaceEmbeddings(model_name=embeddings_model_name)


def _normalize_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _normalize_records(records: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for record in records:
        normalized.append({key: _normalize_value(value) for key, value in record.items()})
    return normalized


def _looks_like_sql(query: str) -> bool:
    """Light heuristic to guard against non-SQL model outputs."""

    stripped = query.strip().lower()
    if not stripped:
        return False
    starters = ("select", "with", "insert", "update", "delete", "create", "drop")
    return stripped.startswith(starters)


def _validate_sql(query: str) -> None:
    """Reject obviously unsafe or non-read-only SQL emitted by the model."""

    lowered = query.strip().lower()
    if not lowered.startswith(("select", "with")):
        raise RuntimeError("The generated SQL must start with SELECT/CTE and cannot perform writes.")

    forbidden = (
        "insert",
        "update",
        "delete",
        "drop",
        "alter",
        "truncate",
        "grant",
        "revoke",
        "vacuum",
    )
    for keyword in forbidden:
        if re.search(rf"\\b{keyword}\\b", lowered):
            raise RuntimeError(f"Unsafe SQL detected: '{keyword}' is not allowed.")

    if ";" in lowered:
        raise RuntimeError("Multiple statements are blocked. Remove extra semicolons and retry.")

    if "argo_profiles" not in lowered:
        raise RuntimeError("Queries must target the argo_profiles table.")


def _build_data_messages(
    *,
    question: str,
    sql_query: str,
    rows: Sequence[Dict[str, Any]],
) -> List[Dict[str, str]]:
    row_count = len(rows)
    columns: List[str] = list(rows[0].keys()) if rows else []
    preview_columns = ", ".join(columns[:6]) if columns else "requested fields"

    summary_parts: List[str] = []
    question_excerpt = question.strip()
    if question_excerpt:
        summary_parts.append(
            f"For \"{question_excerpt[:96]}{'…' if len(question_excerpt) > 96 else ''}\", here is what I found."
        )
    if row_count:
        summary_parts.append(
            f"I executed the query and retrieved {row_count} row{'s' if row_count != 1 else ''} covering {preview_columns}."
        )
        focus_fields = [
            field for field in ("float_id", "profile_date", "latitude", "longitude", "pressure") if field in columns
        ]
        if focus_fields:
            sample_row = rows[0]
            highlighted = ", ".join(
                f"{field}={sample_row[field]}" for field in focus_fields if sample_row.get(field) is not None
            )
            if highlighted:
                summary_parts.append(f"Sample record: {highlighted}.")
    else:
        summary_parts.append(
            "The SQL ran successfully but returned no rows. Adjust the filters or date range and try again."
        )

    summary_parts.append("Let me know if you want a visualization, aggregation, or refined filter.")

    return [
        {
            "role": "assistant",
            "type": "summary",
            "title": "Result overview",
            "content": " ".join(summary_parts),
        },
        {
            "role": "assistant",
            "type": "sql",
            "title": "SQL executed",
            "content": f"```sql\n{sql_query}\n```",
        },
    ]


def _build_conversational_messages(
    response: str,
    *,
    variant: str = "conversation",
    title: str = "Response",
) -> List[Dict[str, str]]:
    return [
        {
            "role": "assistant",
            "type": variant,
            "title": title,
            "content": response,
        }
    ]


def _diagnose_exception(exc: Exception) -> Dict[str, Any]:
    message = "FloatAI hit an unexpected error while processing your request."
    lowered = str(exc).lower()

    metadata: Dict[str, Any] = {
        "category": "unexpected_error",
    }

    if "developers.generativeai.google" in lowered or "generativeai.google" in lowered:
        message = (
            "The upstream Google Generative AI service returned an internal error (HTTP 500). "
            "These are usually temporary—wait a few seconds and try again. "
            "If it keeps happening, review your API quota and the troubleshooting guide at "
            "https://developers.generativeai.google/guide/troubleshooting."
        )
        metadata.update(
            {
                "category": "provider_internal_error",
                "provider": "google-generative-ai",
                "status_code": 500,
            }
        )
    elif "api key" in lowered and "invalid" in lowered:
        message = (
            "The Google Generative AI API key appears to be invalid or revoked. "
            "Update the GOOGLE_API_KEY in your environment and restart the backend."
        )
        metadata.update(
            {
                "category": "credential_error",
                "provider": "google-generative-ai",
            }
        )

    return {"message": message, "metadata": metadata}


def get_health_report() -> Dict[str, Any]:
    """Return lightweight dependency health info without invoking the LLM."""

    checks: Dict[str, Dict[str, Any]] = {}

    api_key_present = bool(os.getenv("GOOGLE_API_KEY"))
    checks["google_api_key"] = {
        "ok": api_key_present,
        "detail": "Present" if api_key_present else "Missing GOOGLE_API_KEY",
    }

    try:
        engine = get_sql_engine()
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        checks["database"] = {"ok": True, "detail": "Connected to PostgreSQL"}
    except Exception as exc:
        checks["database"] = {"ok": False, "detail": str(exc)}

    try:
        index_path = Path(_get_faiss_index_path()).resolve()
        checks["faiss_index"] = {"ok": True, "detail": str(index_path)}
    except Exception as exc:  # pragma: no cover - defensive guard
        checks["faiss_index"] = {"ok": False, "detail": str(exc)}

    overall_ok = all(item.get("ok", False) for item in checks.values())
    return {"status": "ok" if overall_ok else "degraded", "checks": checks}


def _initialise_components() -> Dict[str, Any]:
    logger.info("--- 🧠 Initializing FloatAI RAG AI Core (first run)... ---")

    os.environ["GOOGLE_API_KEY"] = _get_google_api_key()

    llm_instance = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0.1)

    # Load embeddings lazily here to avoid import-time transformer overhead.
    embeddings_model_name = settings.embeddings_model
    try:
        embedding_model = _load_embedding_model()
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.exception("Failed to load embedding model %s", embeddings_model_name)
        raise ConfigError(f"Unable to load embeddings model '{embeddings_model_name}'.") from exc
    logger.info("Embedding model ready: %s", embeddings_model_name)

    vector_store_path = _get_faiss_index_path()
    try:
        vector_store = FAISS.load_local(
            vector_store_path,
            embedding_model,
            allow_dangerous_deserialization=True,
        )
        logger.info("FAISS index loaded from %s", vector_store_path)
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.exception("Failed to load FAISS index at %s", vector_store_path)
        raise ConfigError(
            f"Failed to load FAISS index from '{vector_store_path}'. Re-run ai_core/create_vector_db.py."
        ) from exc

    retriever = vector_store.as_retriever(search_kwargs={"k": _get_retriever_k()})

    rag_prompt_template = """
    You are a PostgreSQL expert. Based on the user's question and the provided context about the database schema, create a syntactically correct PostgreSQL query.
    **CRITICAL RULE: Only use the following columns: 'float_id', 'profile_date', 'latitude', 'longitude', 'pressure', 'temperature', 'salinity'. Do NOT use any other columns.**
    Unless specified, limit results to 50. Only return the SQL query.
    Context: {context}
    Question: {question}
    SQLQuery:
    """
    rag_prompt = PromptTemplate.from_template(rag_prompt_template)
    rag_chain_instance = (
        {"context": retriever, "question": RunnablePassthrough()}
        | rag_prompt
        | llm_instance
        | StrOutputParser()
    )

    convo_prompt_template = (
        "You are a friendly and helpful oceanographic research assistant named FloatAI. "
        "Answer the user's question concisely. If you don't know the answer, say so. Question: {question}"
    )
    convo_prompt = PromptTemplate.from_template(convo_prompt_template)
    conversation_chain_instance = convo_prompt | llm_instance | StrOutputParser()

    logger.info("--- ✅ AI Core Initialized Successfully ---")

    return {
        "llm": llm_instance,
        "rag_chain": rag_chain_instance,
        "conversation_chain": conversation_chain_instance,
    }


def initialize_ai_core() -> None:
    global llm, rag_chain, conversation_chain

    if all(component is not None for component in (llm, rag_chain, conversation_chain)):
        return

    components = _initialise_components()
    llm = components["llm"]
    rag_chain = components["rag_chain"]
    conversation_chain = components["conversation_chain"]


def get_sql_engine() -> Engine:
    """Return the shared SQLAlchemy engine without requiring the LLM components."""

    return _initialise_sql_engine()


def get_sql_database() -> SQLDatabase:
    """Return the shared SQLDatabase instance, ensuring the SQLAlchemy engine is ready."""

    global db

    if db is not None:
        if not isinstance(db, SQLDatabase):  # pragma: no cover - defensive guard
            raise RuntimeError("Unexpected database instance type encountered.")
        return cast(SQLDatabase, db)

    engine = get_sql_engine()
    db = SQLDatabase(engine)  # type: ignore[arg-type]
    return db


def run_ai_pipeline(question: str) -> Dict[str, Any]:
    try:
        initialize_ai_core()

        if not all((llm, rag_chain, conversation_chain)):
            raise RuntimeError("AI core components failed to initialize.")

        local_llm = cast(ChatGoogleGenerativeAI, llm)
        local_rag_chain = cast(Any, rag_chain)
        local_conversation_chain = cast(Any, conversation_chain)

        logger.info("Processing question: %s", question)

        router_prompt = (
            "Classify the user's intent as 'data_query' or 'conversational'. "
            f"Question: \"{question}\"\nIntent:"
        )
        intent_response = local_llm.invoke(router_prompt)
        intent = getattr(intent_response, "content", str(intent_response)).strip().lower()
        logger.info("Detected intent: %s", intent)

        if "data_query" in intent:
            sql_db = get_sql_database()
            local_db = cast(SQLDatabase, sql_db)

            generated_sql = local_rag_chain.invoke(question)
            generated_sql = (
                generated_sql.replace("```sql", "").replace("```", "").strip()
            )
            if not generated_sql:
                raise RuntimeError("The RAG chain returned an empty SQL query.")

            if not _looks_like_sql(generated_sql):
                logger.info("Model returned non-SQL content; answering conversationally instead.")
                response_text = local_conversation_chain.invoke({"question": question})
                messages = _build_conversational_messages(str(response_text))
                metadata = {"intent": "conversational_fallback", "question": question}
                return {
                    "sql_query": None,
                    "result_data": str(response_text),
                    "messages": messages,
                    "metadata": metadata,
                    "error": None,
                }

            logger.info("Generated SQL: %s", generated_sql)

            _validate_sql(generated_sql)

            with local_db._engine.connect() as connection:  # pylint: disable=protected-access
                with connection.begin():
                    connection.execute(text("SET LOCAL statement_timeout = :ms"), {"ms": QUERY_TIMEOUT_MS})
                    query_result = connection.execute(text(generated_sql))
                    result_data = [dict(row._mapping) for row in query_result]

            logger.info("Query Result: %s row(s) found.", len(result_data))

            normalized_result = _normalize_records(result_data)
            messages = _build_data_messages(question=question, sql_query=generated_sql, rows=normalized_result)

            sample_float: Optional[Any] = None
            for record in normalized_result:
                sample_float = record.get("float_id")
                if sample_float:
                    break

            metadata: Dict[str, Any] = {
                "intent": "data_query",
                "row_count": len(normalized_result),
                "columns": list(normalized_result[0].keys()) if normalized_result else [],
                "sample_float_id": sample_float,
                "question": question,
            }

            return {
                "sql_query": generated_sql,
                "result_data": normalized_result,
                "messages": messages,
                "metadata": metadata,
                "error": None,
            }

        response = local_conversation_chain.invoke({"question": question})
        response_text = str(response)
        messages = _build_conversational_messages(response_text)
        metadata = {"intent": "conversational", "question": question}
        return {
            "sql_query": None,
            "result_data": response_text,
            "messages": messages,
            "metadata": metadata,
            "error": None,
        }

    except ConfigError as config_error:
        logger.warning("Configuration issue while processing question '%s': %s", question, config_error)
        error_text = str(config_error)
        return {
            "sql_query": "Configuration error.",
            "result_data": None,
            "messages": _build_conversational_messages(
                error_text,
                variant="error",
                title="Configuration issue",
            ),
            "metadata": {"intent": "error", "question": question, "category": "configuration_error"},
            "error": error_text,
        }
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.exception("Unexpected error while processing question '%s'", question)
        exc_text = str(exc)
        diagnosis = _diagnose_exception(exc)
        user_message = diagnosis["message"]
        error_metadata = diagnosis.get("metadata", {})
        return {
            "sql_query": "Error generating query.",
            "result_data": None,
            "messages": _build_conversational_messages(
                user_message,
                variant="error",
                title="Service issue",
            ),
            "metadata": {"intent": "error", "question": question, **error_metadata},
            "error": exc_text,
        }
