"""Supabase tools for inspecting the founder's connected project.

Targets the FOUNDER'S Supabase (project URL + service-role key from
IntegrationConnection or SUPABASE_TARGET_* env vars), NOT the platform's
own Supabase.

SELECT-only at runtime: any DDL/DML keyword in a query is rejected.
Migrations are STAGED, never executed — the founder must apply DDL by hand
after review.
"""

from __future__ import annotations

import os
import re
from typing import Any

import httpx
import structlog

from agents import function_tool
from db import supabase

logger = structlog.get_logger(__name__)

_TIMEOUT = 20.0

# Forbidden in supabase_run_select. Word boundaries so column names that
# happen to contain these substrings (e.g. 'created_at') aren't blocked.
_FORBIDDEN_KEYWORDS = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b",
    re.IGNORECASE,
)


async def _get_supabase_target(space_id: str) -> tuple[str | None, str | None]:
    """Return (project_url, service_role_key) for the founder's Supabase."""
    if space_id:
        try:
            db = await supabase()
            res = await (
                db.table("IntegrationConnection")
                .select("metadata,accessToken")
                .eq("spaceId", space_id)
                .eq("toolkit", "supabase")
                .eq("status", "active")
                .maybe_single()
                .execute()
            )
            if res.data:
                meta = res.data.get("metadata") or {}
                url = meta.get("projectUrl") or meta.get("project_url")
                key = meta.get("serviceRoleKey") or meta.get("service_role_key") or res.data.get("accessToken")
                if url and key:
                    return url, key
        except Exception as err:  # noqa: BLE001
            logger.warning("supabase_target_lookup_failed", space_id=space_id, error=str(err)[:200])

    return os.environ.get("SUPABASE_TARGET_URL"), os.environ.get("SUPABASE_TARGET_SERVICE_KEY")


def _auth_headers(key: str) -> dict[str, str]:
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _handle_response(resp: httpx.Response, action: str) -> str | None:
    if resp.status_code in {401, 403}:
        return f"Supabase auth failed for {action}. Check service role key."
    if not resp.is_success:
        try:
            body = resp.json()
            msg = body.get("message") or body.get("hint") or resp.text[:200]
        except Exception:  # noqa: BLE001
            msg = resp.text[:200]
        return f"Supabase API error {resp.status_code} for {action}: {msg}"
    return None


async def _query_information_schema(url: str, key: str, sql: str) -> tuple[str | None, list[dict[str, Any]]]:
    """Run a SELECT against the founder's project via the postgres-meta /query
    endpoint. Returns (error_string_or_None, rows)."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        # PostgREST RPC endpoint we expect the founder to have set up; if
        # not, fall back to the built-in meta endpoint exposed at /pg/query
        # by the Supabase platform. Most projects expose `pg-meta` only
        # behind the dashboard, so we use the standard PostgREST `/rpc`
        # convention with a function the founder is asked to provision.
        resp = await client.post(
            f"{url.rstrip('/')}/rest/v1/rpc/exec_sql",
            headers=_auth_headers(key),
            json={"query": sql},
        )

    err = _handle_response(resp, "query")
    if err:
        return err, []
    try:
        data = resp.json()
    except Exception:  # noqa: BLE001
        return "Supabase returned non-JSON response.", []
    if isinstance(data, list):
        return None, data
    return None, [data] if data else []


@function_tool
async def supabase_list_tables(space_id: str = "") -> str:
    """List user tables in the public schema of the founder's Supabase project."""
    url, key = await _get_supabase_target(space_id)
    if not url or not key:
        return (
            "No Supabase target configured. Connect Supabase in settings or set "
            "SUPABASE_TARGET_URL + SUPABASE_TARGET_SERVICE_KEY."
        )

    sql = (
        "select table_name from information_schema.tables "
        "where table_schema='public' and table_type='BASE TABLE' "
        "order by table_name"
    )
    err, rows = await _query_information_schema(url, key, sql)
    if err:
        return err
    if not rows:
        return "No tables in public schema."
    return "\n".join(r.get("table_name", "?") for r in rows)


@function_tool
async def supabase_describe_table(table: str, space_id: str = "") -> str:
    """Return columns/types and indexes for a table in the public schema."""
    url, key = await _get_supabase_target(space_id)
    if not url or not key:
        return (
            "No Supabase target configured. Connect Supabase in settings or set "
            "SUPABASE_TARGET_URL + SUPABASE_TARGET_SERVICE_KEY."
        )

    safe_table = table.replace("'", "''")
    cols_sql = (
        "select column_name, data_type, is_nullable from information_schema.columns "
        f"where table_schema='public' and table_name='{safe_table}' order by ordinal_position"
    )
    idx_sql = (
        "select indexname, indexdef from pg_indexes "
        f"where schemaname='public' and tablename='{safe_table}' order by indexname"
    )
    err, cols = await _query_information_schema(url, key, cols_sql)
    if err:
        return err
    if not cols:
        return f"Table '{table}' not found in public schema."

    err, indexes = await _query_information_schema(url, key, idx_sql)
    if err:
        return err

    out = [f"Table: {table}", "Columns:"]
    for c in cols:
        nullable = "NULL" if c.get("is_nullable") == "YES" else "NOT NULL"
        out.append(f"  {c.get('column_name')}  {c.get('data_type')}  {nullable}")
    out.append("Indexes:")
    if not indexes:
        out.append("  (none)")
    else:
        for idx in indexes:
            out.append(f"  {idx.get('indexname')}: {idx.get('indexdef')}")
    return "\n".join(out)


@function_tool
async def supabase_run_select(query: str, limit: int = 100, space_id: str = "") -> str:
    """Run a read-only SELECT against the founder's Supabase. Caps LIMIT at 100.

    Rejects any query containing INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/
    TRUNCATE/GRANT/REVOKE. This is a defensive guard, not a SQL parser —
    the underlying RPC is also expected to enforce read-only.
    """
    if _FORBIDDEN_KEYWORDS.search(query):
        return "Rejected: only SELECT queries are allowed via this tool."
    if not re.match(r"^\s*select\b", query, re.IGNORECASE):
        return "Rejected: query must start with SELECT."

    url, key = await _get_supabase_target(space_id)
    if not url or not key:
        return (
            "No Supabase target configured. Connect Supabase in settings or set "
            "SUPABASE_TARGET_URL + SUPABASE_TARGET_SERVICE_KEY."
        )

    capped_limit = max(1, min(limit, 100))
    # Wrap in an outer LIMIT so we cap regardless of the query's own LIMIT.
    wrapped = f"select * from ({query.rstrip(';')}) _q limit {capped_limit}"
    err, rows = await _query_information_schema(url, key, wrapped)
    if err:
        return err
    if not rows:
        return "0 rows."
    return f"{len(rows)} rows:\n" + "\n".join(str(r) for r in rows[:capped_limit])


@function_tool
async def supabase_stage_migration(name: str, sql: str, space_id: str = "") -> str:
    """Stage a SQL migration for founder review. DOES NOT EXECUTE.

    Tries to insert into a `StagedMigration` audit table on the platform's
    own Supabase; if that table doesn't exist, returns a description string
    telling the founder to apply the migration by hand.
    """
    try:
        db = await supabase()
        await (
            db.table("StagedMigration")
            .insert(
                {
                    "spaceId": space_id,
                    "name": name,
                    "sql": sql,
                }
            )
            .execute()
        )
        return (
            f"ACTION REQUIRES APPROVAL: staged migration '{name}'. "
            f"No DDL was executed. The founder must apply it after review."
        )
    except Exception as err:  # noqa: BLE001
        logger.info("staged_migration_table_unavailable", error=str(err)[:200])
        return (
            f"ACTION REQUIRES APPROVAL: stage migration '{name}'\n"
            f"```sql\n{sql}\n```\n"
            f"No migration was executed. The founder must apply this manually after review."
        )
