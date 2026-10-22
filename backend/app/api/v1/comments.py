"""Comment endpoints."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import enforce_write_rate_limit, get_principal
from app.core.db import get_db_session
from app.core.errors import ForbiddenError, NotFoundError
from app.core.security import Principal
from app.models.comment import Comment
from app.schemas.comment import CommentCreate, CommentOut
from app.services.sessions import get_session_or_404

router = APIRouter(prefix="/sessions", tags=["comments"])


@router.get("/{session_id}/comments", response_model=list[CommentOut])
async def index(
    session_id: uuid.UUID,
    limit: int = 50,
    session: AsyncSession = Depends(get_db_session),
) -> list[CommentOut]:
    """List the comments of a session."""
    await get_session_or_404(session, session_id)
    rows = (
        (
            await session.execute(
                sa.select(Comment)
                .where(Comment.session_id == session_id, Comment.deleted_at.is_(None))
                .order_by(Comment.created_at.asc())
                .limit(max(1, min(limit, 200)))
            )
        )
        .scalars()
        .all()
    )
    return [
        CommentOut(
            id=comment.id,
            session_id=comment.session_id,
            author_id=comment.author_id,
            body=comment.body,
            created_at=comment.created_at,
        )
        for comment in rows
    ]


@router.post(
    "/{session_id}/comments",
    response_model=CommentOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(enforce_write_rate_limit)],
)
async def create(
    session_id: uuid.UUID,
    payload: CommentCreate,
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> CommentOut:
    """Post a comment on a session."""
    await get_session_or_404(session, session_id)
    comment = Comment(
        session_id=session_id,
        author_id=principal.user_id,
        body=payload.body,
    )
    session.add(comment)
    await session.commit()
    await session.refresh(comment)
    return CommentOut(
        id=comment.id,
        session_id=comment.session_id,
        author_id=comment.author_id,
        body=comment.body,
        created_at=comment.created_at,
    )


@router.delete(
    "/{session_id}/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(enforce_write_rate_limit)],
)
async def remove(
    session_id: uuid.UUID,
    comment_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> Response:
    """Soft delete a comment."""
    comment = await session.get(Comment, comment_id)
    if comment is None or comment.deleted_at is not None:
        raise NotFoundError("Comment not found", code="comment_not_found")
    if comment.session_id != session_id:
        raise NotFoundError("Comment not found", code="comment_not_found")
    if comment.author_id is not None and comment.author_id != principal.user_id:
        raise ForbiddenError("You can only delete your own comments")
    comment.deleted_at = datetime.now(UTC)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
