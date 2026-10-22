"""Language detection — Python projection of ``frontend/lib/engine/languages.ts``."""

from __future__ import annotations

EXTENSION_MAP: dict[str, str] = {
    "ts": "typescript",
    "tsx": "typescriptreact",
    "mts": "typescript",
    "cts": "typescript",
    "js": "javascript",
    "jsx": "javascriptreact",
    "mjs": "javascript",
    "cjs": "javascript",
    "py": "python",
    "pyi": "python",
    "rs": "rust",
    "go": "go",
    "java": "java",
    "kt": "kotlin",
    "kts": "kotlin",
    "swift": "swift",
    "rb": "ruby",
    "php": "php",
    "cs": "csharp",
    "c": "c",
    "h": "c",
    "cpp": "cpp",
    "cc": "cpp",
    "hpp": "cpp",
    "cshtml": "razor",
    "sql": "sql",
    "sh": "shell",
    "bash": "shell",
    "zsh": "shell",
    "fish": "shell",
    "ps1": "powershell",
    "json": "json",
    "jsonc": "jsonc",
    "yaml": "yaml",
    "yml": "yaml",
    "toml": "toml",
    "ini": "ini",
    "xml": "xml",
    "html": "html",
    "htm": "html",
    "css": "css",
    "scss": "scss",
    "less": "less",
    "vue": "vue",
    "svelte": "svelte",
    "md": "markdown",
    "mdx": "mdx",
    "ipynb": "jupyter",
    "graphql": "graphql",
    "gql": "graphql",
    "proto": "protobuf",
    "tf": "hcl",
    "hcl": "hcl",
    "dockerfile": "dockerfile",
    "lua": "lua",
    "r": "r",
    "dart": "dart",
    "ex": "elixir",
    "exs": "elixir",
    "scala": "scala",
    "pl": "perl",
    "vuehtml": "html",
    "txt": "plaintext",
    "env": "ini",
    "gitignore": "plaintext",
    "lock": "plaintext",
}

FILENAME_MAP: dict[str, str] = {
    "dockerfile": "dockerfile",
    "makefile": "makefile",
    "cmakelists": "cmake",
    "cmakelists.txt": "cmake",
    "pipfile": "toml",
    "gemfile": "ruby",
    "rakefile": "ruby",
    ".gitignore": "plaintext",
    ".env": "ini",
    ".eslintrc": "json",
    ".prettierrc": "json",
    "vite.config.ts": "typescript",
    "next.config.js": "javascript",
}


def detect_language(path: str) -> str:
    """Infer a syntax-highlighting language id from a repo-relative path."""
    lower = path.lower()
    base = lower.rsplit("/", 1)[-1]

    if base in FILENAME_MAP:
        return FILENAME_MAP[base]
    if base == "dockerfile" or base.startswith("dockerfile."):
        return "dockerfile"
    if base == "makefile":
        return "makefile"

    dot = base.rfind(".")
    if dot < 0 or dot == len(base) - 1:
        return "plaintext"
    return EXTENSION_MAP.get(base[dot + 1 :], "plaintext")


LANGUAGE_LABELS: dict[str, str] = {
    "typescript": "TypeScript",
    "typescriptreact": "TypeScript React",
    "javascript": "JavaScript",
    "javascriptreact": "JavaScript React",
    "python": "Python",
    "rust": "Rust",
    "go": "Go",
    "java": "Java",
    "kotlin": "Kotlin",
    "swift": "Swift",
    "ruby": "Ruby",
    "php": "PHP",
    "csharp": "C#",
    "c": "C",
    "cpp": "C++",
    "razor": "Razor",
    "sql": "SQL",
    "shell": "Shell",
    "powershell": "PowerShell",
    "json": "JSON",
    "jsonc": "JSON with Comments",
    "yaml": "YAML",
    "toml": "TOML",
    "ini": "INI",
    "xml": "XML",
    "html": "HTML",
    "css": "CSS",
    "scss": "SCSS",
    "less": "Less",
    "vue": "Vue",
    "svelte": "Svelte",
    "markdown": "Markdown",
    "mdx": "MDX",
    "jupyter": "Jupyter",
    "graphql": "GraphQL",
    "protobuf": "Protocol Buffers",
    "hcl": "HCL",
    "dockerfile": "Dockerfile",
    "makefile": "Makefile",
    "cmake": "CMake",
    "lua": "Lua",
    "r": "R",
    "dart": "Dart",
    "elixir": "Elixir",
    "scala": "Scala",
    "perl": "Perl",
    "plaintext": "Plain Text",
}


def language_label(language: str) -> str:
    """Human readable label for a language id."""
    return LANGUAGE_LABELS.get(language, language)
