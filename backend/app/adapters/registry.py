"""Adapter registry — maps an agent name to its adapter and capabilities."""

from __future__ import annotations

from typing import Any

from app.adapters.aider import AiderAdapter
from app.adapters.base import AgentAdapter
from app.adapters.claude_code import ClaudeCodeAdapter
from app.adapters.cline import ClineAdapter
from app.adapters.cursor import CursorAdapter
from app.adapters.gemini_cli import GeminiCliAdapter
from app.adapters.generic import GenericAdapter
from app.adapters.opencode import OpenCodeAdapter
from app.adapters.roo_code import RooCodeAdapter
from app.core.errors import NotFoundError

_ADAPTERS: dict[str, AgentAdapter] = {
    adapter.name: adapter
    for adapter in (
        ClaudeCodeAdapter(),
        OpenCodeAdapter(),
        CursorAdapter(),
        GeminiCliAdapter(),
        AiderAdapter(),
        ClineAdapter(),
        RooCodeAdapter(),
        GenericAdapter(),
    )
}

#: Canonical order used by ``GET /v1/agents``.
ADAPTER_ORDER: tuple[str, ...] = (
    "claude-code",
    "opencode",
    "cursor",
    "gemini-cli",
    "aider",
    "cline",
    "roo-code",
    "generic",
)


def get_adapter(name: str) -> AgentAdapter:
    """Return the adapter registered under ``name``."""
    key = (name or "").strip().lower()
    adapter = _ADAPTERS.get(key)
    if adapter is None:
        raise NotFoundError(
            f"Unknown agent '{name}'",
            code="unknown_agent",
            details={"available": list(ADAPTER_ORDER)},
        )
    return adapter


def list_adapters() -> list[dict[str, Any]]:
    """Registry listing used by ``GET /v1/agents``."""
    return [
        {
            "name": name,
            "display_name": _ADAPTERS[name].display_name,
            "capabilities": sorted(_ADAPTERS[name].capabilities),
        }
        for name in ADAPTER_ORDER
        if name in _ADAPTERS
    ]


def adapter_names() -> list[str]:
    """Names of every registered adapter."""
    return list(ADAPTER_ORDER)


__all__ = ["ADAPTER_ORDER", "adapter_names", "get_adapter", "list_adapters"]
