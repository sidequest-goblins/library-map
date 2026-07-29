"""
Filesystem and workbook-discovery helpers for Library Clerk.

During development, Library Clerk looks for the normal synced
OneDrive MyLibrary folder.

After packaging, Library Clerk treats the folder containing
Library Clerk.exe as the shared workbook folder.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


WORKBOOK_DIRECTORY_ENV_VAR = "LIBRARY_CLERK_WORKBOOK_DIR"
SHARED_DATA_DIRECTORY_NAME = "Library Clerk Data"
EXCEPTIONS_FILE_NAME = "exceptions.json"

SUPPORTED_WORKBOOK_SUFFIXES = {
    ".xlsx",
    ".xlsm",
}

def is_packaged_application() -> bool:
    """
    Return True when Library Clerk is running as a packaged executable.
    """

    return bool(
        getattr(
            sys,
            "frozen",
            False,
        )
    )

def get_application_directory() -> Path:
    """
    Return the directory containing the application.

    During development, this returns the library-map repository root.

    After packaging, this returns the directory containing
    Library Clerk.exe.
    """

    if is_packaged_application():
        return Path(
            sys.executable
        ).resolve().parent

    return Path(
        __file__
    ).resolve().parent.parent

def get_default_workbook_directory() -> Path:
    """
    Return the expected per-user OneDrive MyLibrary folder.
    """

    return (
        Path.home()
        / "OneDrive"
        / "Shared Workbooks"
        / "MyLibrary"
    )

def get_workbook_directory() -> Path:
    """
    Resolve the shared workbook directory.

    Resolution order:

    1. LIBRARY_CLERK_WORKBOOK_DIR environment variable
    2. Directory containing Library Clerk.exe when packaged
    3. Current user's normal OneDrive MyLibrary folder
    """

    override = os.environ.get(
        WORKBOOK_DIRECTORY_ENV_VAR,
        "",
    ).strip()

    if override:
        return Path(
            override
        ).expanduser().resolve()

    if is_packaged_application():
        return get_application_directory()

    return get_default_workbook_directory().resolve()

def is_temporary_excel_file(
    path: Path,
) -> bool:
    """
    Return True for temporary Excel lock files such as ~$LIBRARY.xlsx.
    """

    return path.name.startswith("~$")

def get_shared_data_directory(
    workbook_directory: Path | None = None,
) -> Path:
    """
    Return the shared Library Clerk data directory.

    Shared catalog decisions belong beside the workbooks so CJ and Jade
    receive the same exception records through OneDrive.
    """

    resolved_workbook_directory = (
        workbook_directory
        if workbook_directory is not None
        else get_workbook_directory()
    )

    return (
        resolved_workbook_directory
        / SHARED_DATA_DIRECTORY_NAME
    )

def get_exceptions_path(
    workbook_directory: Path | None = None,
) -> Path:
    """
    Return the shared intentional-exceptions JSON path.
    """

    return (
        get_shared_data_directory(
            workbook_directory
        )
        / EXCEPTIONS_FILE_NAME
    )

def list_workbooks(
    workbook_directory: Path,
) -> list[Path]:
    """
    Return supported workbook files found directly inside the folder.

    Workbook names are intentionally not hardcoded.
    """

    if not workbook_directory.exists():
        return []

    if not workbook_directory.is_dir():
        return []

    workbook_paths: list[Path] = []

    for path in workbook_directory.iterdir():
        if not path.is_file():
            continue

        if is_temporary_excel_file(
            path
        ):
            continue

        if (
            path.suffix.lower()
            not in SUPPORTED_WORKBOOK_SUFFIXES
        ):
            continue

        workbook_paths.append(
            path.resolve()
        )

    return sorted(
        workbook_paths,
        key=lambda item: item.name.casefold(),
    )

def format_file_size(
    size_bytes: int,
) -> str:
    """
    Return a human-readable file-size label.
    """

    size = float(
        size_bytes
    )

    for unit in (
        "bytes",
        "KB",
        "MB",
        "GB",
    ):
        if (
            size < 1024
            or unit == "GB"
        ):
            if unit == "bytes":
                return f"{int(size)} {unit}"

            return f"{size:.1f} {unit}"

        size /= 1024

    return f"{size_bytes} bytes"