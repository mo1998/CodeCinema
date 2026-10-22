"""ffmpeg muxing helpers (webm -> mp4 / gif)."""

from __future__ import annotations

import subprocess
from pathlib import Path

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

MP4_ARGS = (
    "-y",
    "-i",
    "{source}",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "{target}",
)

GIF_ARGS = (
    "-y",
    "-i",
    "{source}",
    "-vf",
    "fps=15,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
    "{target}",
)


class ExportError(RuntimeError):
    """Raised when ffmpeg is missing or fails."""


def ffmpeg_path() -> str:
    """Resolve the ffmpeg binary (raises :class:`ExportError` when missing)."""
    import shutil

    binary = get_settings().export_ffmpeg_binary
    resolved = shutil.which(binary)
    if resolved is None:
        raise ExportError(
            f"ffmpeg is required for video exports but '{binary}' was not found on PATH"
        )
    return resolved


def _run(args: tuple[str, ...], *, source: Path, target: Path) -> Path:
    binary = ffmpeg_path()
    command = [binary, *[arg.format(source=source, target=target) for arg in args]]
    logger.info("export.ffmpeg_started", extra={"command": command[0], "target": str(target)})
    try:
        completed = subprocess.run(  # noqa: S603 - fixed argument vector
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=900,
        )
    except subprocess.TimeoutExpired as exc:
        raise ExportError("ffmpeg timed out") from exc
    if completed.returncode != 0:
        tail = (completed.stderr or "").strip().splitlines()[-5:]
        raise ExportError("ffmpeg failed: " + " | ".join(tail))
    if not target.exists():
        raise ExportError("ffmpeg produced no output file")
    return target


def webm_to_mp4(source: Path, target: Path) -> Path:
    """Convert a recorded webm into an mp4."""
    target.parent.mkdir(parents=True, exist_ok=True)
    return _run(MP4_ARGS, source=source, target=target)


def webm_to_gif(source: Path, target: Path) -> Path:
    """Convert a recorded webm into an optimised gif."""
    target.parent.mkdir(parents=True, exist_ok=True)
    return _run(GIF_ARGS, source=source, target=target)


__all__ = ["ExportError", "ffmpeg_path", "webm_to_gif", "webm_to_mp4"]
