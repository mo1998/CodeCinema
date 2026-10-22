"""Playwright based frame capture of the replay page."""

from __future__ import annotations

import shutil
from pathlib import Path

from app.core.logging import get_logger

logger = get_logger(__name__)

#: Marks the replay page as fully bootstrapped.
READY_FLAG = "window.__CODECINEMA_READY__ === true"
#: Marks the replay page as finished.
DONE_FLAG = "window.__CODECINEMA_DONE__ === true"

DEFAULT_VIEWPORT = {"width": 1920, "height": 1080}


class ExportError(RuntimeError):
    """Raised when a render cannot be produced."""


def playwright_available() -> bool:
    """True when the Playwright package is importable."""
    try:
        import playwright.sync_api  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True


def render_session(
    slug: str,
    *,
    public_url: str,
    out_dir: Path,
    timeout_ms: int = 180_000,
    viewport: dict[str, int] | None = None,
) -> Path:
    """Record the replay of a shared session and return the webm path.

    The frontend replay page is opened in ``?export=1&autoplay=1&speed=1``
    mode; the video is captured by Chromium's ``record_video_dir``.
    """
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # noqa: BLE001
        raise ExportError(
            "Playwright is not installed — install the 'export' extra to render videos"
        ) from exc

    out_dir.mkdir(parents=True, exist_ok=True)
    url = f"{public_url.rstrip('/')}/share/{slug}?export=1&autoplay=1&speed=1"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--autoplay-policy=no-user-gesture-required",
            ]
        )
        context = browser.new_context(
            record_video_dir=str(out_dir),
            viewport=viewport or DEFAULT_VIEWPORT,  # type: ignore[arg-type]
        )
        page = context.new_page()
        video = None
        try:
            page.goto(url, wait_until="load", timeout=timeout_ms)
            page.wait_for_function(READY_FLAG, timeout=timeout_ms)
            page.wait_for_function(DONE_FLAG, timeout=timeout_ms)
            video = page.video
        except Exception as exc:  # noqa: BLE001
            raise ExportError(f"Replay rendering failed: {exc}") from exc
        finally:
            try:
                page.close()
            except Exception:  # noqa: BLE001
                pass
            try:
                # Closing the context finalises the video file.
                context.close()
            except Exception:  # noqa: BLE001
                pass
            browser.close()

        if video is None:
            raise ExportError("Chromium did not produce a video")
        # The path has to be read while the Playwright connection is still
        # alive; reading it after the browser has exited raises
        # "Event loop is closed".
        path = Path(video.path())

    if not path.exists():
        raise ExportError("Recorded video is missing")
    return path


def find_webm(directory: Path) -> Path | None:
    """Locate the newest ``.webm`` file inside ``directory``."""
    if not directory.exists():
        return None
    candidates = sorted(directory.glob("*.webm"), key=lambda item: item.stat().st_mtime)
    if not candidates:
        return None
    return candidates[-1]


def has_chromium() -> bool:
    """True when a Chromium binary appears to be installed."""
    cache = Path.home() / ".cache" / "ms-playwright"
    if not cache.exists():
        return False
    return any(cache.glob("chromium*"))


def ffmpeg_binary() -> str | None:
    """Path of the ffmpeg binary, if it is on PATH."""
    return shutil.which("ffmpeg")


__all__ = [
    "DONE_FLAG",
    "ExportError",
    "READY_FLAG",
    "ffmpeg_binary",
    "find_webm",
    "has_chromium",
    "playwright_available",
    "render_session",
]
