"""Aggregate router for API v1."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import agents, auth, comments, events, exports, health, sessions, shares, websocket

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(sessions.router)
api_router.include_router(events.router)
api_router.include_router(exports.router)
api_router.include_router(shares.router)
api_router.include_router(comments.router)
api_router.include_router(agents.router)
api_router.include_router(websocket.router)

__all__ = ["api_router"]
