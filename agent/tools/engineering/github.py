"""GitHub tools for the Engineering department agent.

Auth priority:
  1. IntegrationConnection row for integrationSlug='github' + spaceId
  2. GITHUB_TOKEN environment variable

All tools return plain strings — the agent reads string results.
Rate-limit and auth errors are returned as strings rather than raised
so the agent can surface them to the founder cleanly.
"""

from __future__ import annotations

import base64
import os
from typing import Any

import httpx
import structlog

from agents import function_tool
from db import supabase

logger = structlog.get_logger(__name__)

_GITHUB_API = "https://api.github.com"
_TIMEOUT = 20.0  # seconds


async def _get_github_token(space_id: str) -> str | None:
    """Resolve a GitHub token for the given space.

    Checks IntegrationConnection first (Composio OAuth flow stores tokens
    there). Falls back to GITHUB_TOKEN env var for dev/CI use.
    """
    if space_id:
        try:
            db = await supabase()
            res = await (
                db.table("IntegrationConnection")
                .select("accessToken")
                .eq("spaceId", space_id)
                .eq("integrationSlug", "github")
                .eq("status", "active")
                .maybe_single()
                .execute()
            )
            if res.data and res.data.get("accessToken"):
                return res.data["accessToken"]
        except Exception as err:  # noqa: BLE001
            logger.warning(
                "github_token_lookup_failed",
                space_id=space_id,
                error=str(err)[:200],
            )

    return os.environ.get("GITHUB_TOKEN")


def _auth_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _handle_response(resp: httpx.Response, action: str) -> str | None:
    """Return an error string if the response indicates failure, else None."""
    if resp.status_code == 429:
        return f"GitHub rate limit hit for {action}. Retry after cooldown."
    if resp.status_code == 401:
        return f"GitHub auth failed for {action}. Check token or reconnect GitHub in settings."
    if resp.status_code == 403:
        return f"GitHub permission denied for {action}. Token may lack required scopes."
    if resp.status_code == 422:
        body = resp.json() if resp.content else {}
        return f"GitHub validation error for {action}: {body.get('message', resp.text[:200])}"
    if not resp.is_success:
        body = resp.json() if resp.content else {}
        return f"GitHub API error {resp.status_code} for {action}: {body.get('message', resp.text[:200])}"
    return None


@function_tool
async def github_create_repo(
    name: str,
    description: str = "",
    private: bool = False,
    space_id: str = "",
) -> str:
    """Create a new GitHub repository. Returns the repo URL.

    ACTION REQUIRES APPROVAL before execution — the manager gates this.
    """
    token = await _get_github_token(space_id)
    if not token:
        return "No GitHub token found. Connect GitHub in settings or set GITHUB_TOKEN."

    payload: dict[str, Any] = {
        "name": name,
        "description": description,
        "private": private,
        "auto_init": True,
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{_GITHUB_API}/user/repos",
            headers=_auth_headers(token),
            json=payload,
        )

    err = _handle_response(resp, "create_repo")
    if err:
        return err

    data = resp.json()
    url = data.get("html_url", "")
    logger.info("github_repo_created", space_id=space_id, repo=name, url=url)
    return f"Created repo: {url}"


@function_tool
async def github_create_file(
    repo: str,
    path: str,
    content: str,
    message: str,
    branch: str = "main",
    space_id: str = "",
) -> str:
    """Create or update a file in a GitHub repo.

    repo: 'owner/repo-name'
    path: file path within the repo, e.g. 'src/index.ts'
    content: raw file content (will be base64-encoded)
    message: commit message
    branch: target branch (never commit directly to main — use a feature branch)

    ACTION REQUIRES APPROVAL if branch is 'main'.
    """
    if branch == "main":
        return (
            "ACTION REQUIRES APPROVAL: committing directly to main. "
            "Create a feature branch instead and open a PR."
        )

    token = await _get_github_token(space_id)
    if not token:
        return "No GitHub token found. Connect GitHub in settings or set GITHUB_TOKEN."

    encoded = base64.b64encode(content.encode()).decode()

    # Check if file already exists to get its sha (required for updates)
    owner_repo = repo
    file_url = f"{_GITHUB_API}/repos/{owner_repo}/contents/{path}"
    params = {"ref": branch}

    sha: str | None = None
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        check = await client.get(
            file_url,
            headers=_auth_headers(token),
            params=params,
        )
        if check.status_code == 200:
            sha = check.json().get("sha")

        payload: dict[str, Any] = {
            "message": message,
            "content": encoded,
            "branch": branch,
        }
        if sha:
            payload["sha"] = sha

        resp = await client.put(file_url, headers=_auth_headers(token), json=payload)

    err = _handle_response(resp, f"create_file {path}")
    if err:
        return err

    data = resp.json()
    commit_url = (data.get("commit") or {}).get("html_url", "")
    action = "Updated" if sha else "Created"
    return f"{action} {path} in {repo} on branch {branch}. Commit: {commit_url}"


@function_tool
async def github_open_pr(
    repo: str,
    title: str,
    body: str,
    head: str,
    base: str = "main",
    space_id: str = "",
) -> str:
    """Open a pull request. Returns the PR URL.

    repo: 'owner/repo-name'
    head: source branch (the branch with your changes)
    base: target branch (almost always 'main')

    ACTION REQUIRES APPROVAL — founder reviews and merges the PR.
    """
    token = await _get_github_token(space_id)
    if not token:
        return "No GitHub token found. Connect GitHub in settings or set GITHUB_TOKEN."

    payload = {
        "title": title,
        "body": body,
        "head": head,
        "base": base,
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{_GITHUB_API}/repos/{repo}/pulls",
            headers=_auth_headers(token),
            json=payload,
        )

    err = _handle_response(resp, "open_pr")
    if err:
        return err

    data = resp.json()
    pr_url = data.get("html_url", "")
    pr_number = data.get("number", "")
    logger.info("github_pr_opened", space_id=space_id, repo=repo, pr=pr_number, url=pr_url)
    return f"PR #{pr_number} opened: {pr_url}"


@function_tool
async def github_read_file(
    repo: str,
    path: str,
    branch: str = "main",
    space_id: str = "",
) -> str:
    """Read a file from a GitHub repo. Returns file contents as text.

    repo: 'owner/repo-name'
    path: file path within the repo, e.g. 'src/index.ts'
    """
    token = await _get_github_token(space_id)
    if not token:
        return "No GitHub token found. Connect GitHub in settings or set GITHUB_TOKEN."

    url = f"{_GITHUB_API}/repos/{repo}/contents/{path}"

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            url,
            headers=_auth_headers(token),
            params={"ref": branch},
        )

    err = _handle_response(resp, f"read_file {path}")
    if err:
        return err

    data = resp.json()
    encoded = data.get("content", "")
    if not encoded:
        return f"{path} is empty or is a directory."

    # GitHub returns content with newlines in the base64 string
    decoded = base64.b64decode(encoded.replace("\n", "")).decode("utf-8", errors="replace")
    return decoded
