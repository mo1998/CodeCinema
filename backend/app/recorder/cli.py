"""Recorder CLI.

Usage::

    python -m app.recorder.cli record --repo . --agent claude-code \\
        --output session.ndjson -- claude "add a login page"
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path

from app.core.logging import configure_logging, get_logger
from app.recorder.session_recorder import RecorderConfig, SessionRecorder

logger = get_logger(__name__)


def build_parser() -> argparse.ArgumentParser:
    """Build the argument parser."""
    parser = argparse.ArgumentParser(prog="codecinema-recorder", description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    record = subparsers.add_parser("record", help="record a session")
    record.add_argument("--repo", default=".", help="repository to watch")
    record.add_argument("--agent", default="generic", help="agent name")
    record.add_argument("--output", default=None, help="write NDJSON to this path")
    record.add_argument("--api-url", default=None, help="CodeCinema API base URL")
    record.add_argument("--api-key", default=None, help="API key used for uploads")
    record.add_argument("--session-id", default=None, help="attach to an existing session")
    record.add_argument("--title", default=None, help="session title")
    record.add_argument("--duration", type=float, default=None, help="stop after N seconds")
    record.add_argument(
        "--poll-interval", type=float, default=0.4, help="polling interval in seconds"
    )
    record.add_argument(
        "--ignore",
        action="append",
        default=[],
        help="extra directory or file name to ignore (repeatable)",
    )
    record.add_argument(
        "argv",
        nargs=argparse.REMAINDER,
        help="command to run while recording (after --)",
    )
    return parser


async def _run_record(args: argparse.Namespace) -> int:
    command: list[str] = list(args.argv)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        command = []

    config = RecorderConfig(
        repo=Path(args.repo),
        agent=args.agent,
        output=Path(args.output) if args.output else None,
        api_url=args.api_url,
        api_key=args.api_key,
        session_id=uuid.UUID(args.session_id) if args.session_id else None,
        poll_interval=args.poll_interval,
        duration=args.duration,
        title=args.title,
        extra_ignores=frozenset(args.ignore or ()),
    )
    recorder = SessionRecorder(config)
    events = await recorder.record(command)

    if config.output:
        path = recorder.write_ndjson(events)
        logger.info("recorder.written", extra={"path": str(path), "events": len(events)})
        print(f"{len(events)} events written to {path}")
    elif config.api_url:
        session_id = await recorder.post(events)
        print(f"{len(events)} events uploaded to session {session_id}")
    else:
        for event in events:
            print(json.dumps(event.to_dict(), separators=(",", ":")))
    return 0


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    configure_logging()
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "record":
        try:
            return asyncio.run(_run_record(args))
        except KeyboardInterrupt:  # pragma: no cover - interactive
            return 130
    parser.error(f"unknown command {args.command}")
    return 2


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
