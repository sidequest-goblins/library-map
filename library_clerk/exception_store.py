"""
Shared intentional-exception storage for Library Clerk.

Exceptions are saved outside the workbooks. This module never edits or
saves an Excel workbook.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from library_clerk.models import (
    LibraryException,
    ScanIssue,
)


EXCEPTION_SCHEMA_VERSION = 1


class ExceptionStoreError(
    RuntimeError
):
    """
    Raised when the shared exception file cannot be read or saved safely.
    """


def clean_text(
    value: Any,
) -> str:
    """
    Convert a JSON value to trimmed text.
    """

    if value is None:
        return ""

    return str(
        value
    ).strip()


def exception_sort_key(
    exception: LibraryException,
) -> tuple[
    str,
    str,
    str,
]:
    """
    Return a predictable display and file-storage sort key.
    """

    return (
        exception.title.casefold(),
        exception.issue_code.casefold(),
        exception.book_id.casefold(),
    )


def exception_to_dict(
    exception: LibraryException,
) -> dict[str, str]:
    """
    Convert one exception to its JSON representation.
    """

    return {
        "book_id": exception.book_id,
        "issue_code": exception.issue_code,
        "reason": exception.reason,
        "note": exception.note,
        "title": exception.title,
        "author": exception.author,
        "created_at": exception.created_at,
    }


def exception_from_dict(
    value: Any,
    entry_number: int,
) -> LibraryException:
    """
    Validate and convert one JSON exception entry.
    """

    if not isinstance(
        value,
        dict,
    ):
        raise ExceptionStoreError(
            (
                "Exception entry "
                f"{entry_number} is not a JSON object."
            )
        )

    book_id = clean_text(
        value.get(
            "book_id"
        )
    )

    issue_code = clean_text(
        value.get(
            "issue_code"
        )
    )

    reason = clean_text(
        value.get(
            "reason"
        )
    )

    if not book_id:
        raise ExceptionStoreError(
            (
                "Exception entry "
                f"{entry_number} is missing Book ID."
            )
        )

    if not issue_code:
        raise ExceptionStoreError(
            (
                "Exception entry "
                f"{entry_number} is missing its issue code."
            )
        )

    if not reason:
        raise ExceptionStoreError(
            (
                "Exception entry "
                f"{entry_number} is missing its reason."
            )
        )

    return LibraryException(
        book_id=book_id,
        issue_code=issue_code,
        reason=reason,
        note=clean_text(
            value.get(
                "note"
            )
        ),
        title=clean_text(
            value.get(
                "title"
            )
        ),
        author=clean_text(
            value.get(
                "author"
            )
        ),
        created_at=clean_text(
            value.get(
                "created_at"
            )
        ),
    )


def load_exceptions(
    exceptions_path: Path,
) -> list[LibraryException]:
    """
    Load and validate the shared exception file.

    A missing file means no exceptions have been saved yet.
    Duplicate keys are collapsed so the final saved entry wins.
    """

    if not exceptions_path.exists():
        return []

    if not exceptions_path.is_file():
        raise ExceptionStoreError(
            (
                "The exception path exists but is not a file:\n"
                f"{exceptions_path}"
            )
        )

    try:
        payload = json.loads(
            exceptions_path.read_text(
                encoding="utf-8"
            )
        )

    except OSError as error:
        raise ExceptionStoreError(
            (
                "Library Clerk could not read the shared "
                "exception file.\n\n"
                f"{error}"
            )
        ) from error

    except json.JSONDecodeError as error:
        raise ExceptionStoreError(
            (
                "The shared exception file is not valid JSON.\n\n"
                f"Line {error.lineno}, column {error.colno}: "
                f"{error.msg}"
            )
        ) from error

    if not isinstance(
        payload,
        dict,
    ):
        raise ExceptionStoreError(
            "The shared exception file must contain a JSON object."
        )

    schema_version = payload.get(
        "schema_version"
    )

    if schema_version != EXCEPTION_SCHEMA_VERSION:
        raise ExceptionStoreError(
            (
                "The shared exception file uses unsupported "
                f"schema version {schema_version!r}. "
                f"Expected {EXCEPTION_SCHEMA_VERSION}."
            )
        )

    raw_exceptions = payload.get(
        "exceptions"
    )

    if not isinstance(
        raw_exceptions,
        list,
    ):
        raise ExceptionStoreError(
            (
                "The shared exception file must contain an "
                "'exceptions' list."
            )
        )

    exceptions_by_key: dict[
        str,
        LibraryException,
    ] = {}

    for entry_number, raw_exception in enumerate(
        raw_exceptions,
        start=1,
    ):
        exception = exception_from_dict(
            raw_exception,
            entry_number,
        )

        exceptions_by_key[
            exception.exception_key
        ] = exception

    return sorted(
        exceptions_by_key.values(),
        key=exception_sort_key,
    )


def save_exceptions(
    exceptions_path: Path,
    exceptions: list[LibraryException],
) -> None:
    """
    Save all shared exceptions using an atomic file replacement.
    """

    exceptions_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    exceptions_by_key = {
        exception.exception_key: exception
        for exception in exceptions
    }

    sorted_exceptions = sorted(
        exceptions_by_key.values(),
        key=exception_sort_key,
    )

    payload = {
        "schema_version": (
            EXCEPTION_SCHEMA_VERSION
        ),
        "exceptions": [
            exception_to_dict(
                exception
            )
            for exception in sorted_exceptions
        ],
    }

    temporary_path = (
        exceptions_path.with_name(
            (
                f".{exceptions_path.name}."
                f"{uuid4().hex}.tmp"
            )
        )
    )

    try:
        with temporary_path.open(
            mode="w",
            encoding="utf-8",
            newline="\n",
        ) as temporary_file:
            json.dump(
                payload,
                temporary_file,
                ensure_ascii=False,
                indent=2,
            )

            temporary_file.write(
                "\n"
            )

            temporary_file.flush()

            os.fsync(
                temporary_file.fileno()
            )

        os.replace(
            temporary_path,
            exceptions_path,
        )

    except OSError as error:
        raise ExceptionStoreError(
            (
                "Library Clerk could not safely save the "
                "shared exception file.\n\n"
                f"{error}"
            )
        ) from error

    finally:
        try:
            temporary_path.unlink(
                missing_ok=True
            )

        except OSError:
            pass


def create_exception_from_issue(
    issue: ScanIssue,
    reason: str,
    note: str = "",
) -> LibraryException:
    """
    Create a saved exception from one eligible clerical issue.
    """

    cleaned_reason = (
        reason.strip()
    )

    if not issue.is_exception_eligible:
        raise ExceptionStoreError(
            (
                "This issue cannot be saved as an exception "
                "because it does not have a stable Book ID "
                "and issue code."
            )
        )

    if not cleaned_reason:
        raise ExceptionStoreError(
            "An exception reason is required."
        )

    return LibraryException(
        book_id=issue.book_id.strip(),
        issue_code=issue.issue_code.strip(),
        reason=cleaned_reason,
        note=note.strip(),
        title=issue.title.strip(),
        author=issue.author.strip(),
        created_at=(
            datetime.now()
            .astimezone()
            .isoformat(
                timespec="seconds"
            )
        ),
    )


def upsert_exception(
    exceptions_path: Path,
    exception: LibraryException,
) -> list[LibraryException]:
    """
    Add or replace one exception and return the complete saved list.
    """

    exceptions_by_key = {
        saved_exception.exception_key: (
            saved_exception
        )
        for saved_exception in load_exceptions(
            exceptions_path
        )
    }

    exceptions_by_key[
        exception.exception_key
    ] = exception

    exceptions = sorted(
        exceptions_by_key.values(),
        key=exception_sort_key,
    )

    save_exceptions(
        exceptions_path,
        exceptions,
    )

    return exceptions


def remove_exception(
    exceptions_path: Path,
    book_id: str,
    issue_code: str,
) -> tuple[
    bool,
    list[LibraryException],
]:
    """
    Remove one exception and return whether it existed plus the saved list.
    """

    exception_key = (
        f"{book_id.strip().casefold()}::"
        f"{issue_code.strip().casefold()}"
    )

    exceptions_by_key = {
        saved_exception.exception_key: (
            saved_exception
        )
        for saved_exception in load_exceptions(
            exceptions_path
        )
    }

    removed_exception = (
        exceptions_by_key.pop(
            exception_key,
            None,
        )
    )

    exceptions = sorted(
        exceptions_by_key.values(),
        key=exception_sort_key,
    )

    if removed_exception is not None:
        save_exceptions(
            exceptions_path,
            exceptions,
        )

    return (
        removed_exception is not None,
        exceptions,
    )