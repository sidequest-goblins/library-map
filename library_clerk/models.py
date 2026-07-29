"""
Shared data models used by the workbook scanner and desktop interface.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class ScanIssue:
    """
    One workbook problem shown in the Library Clerk work queue.
    """

    issue_id: str
    area: str
    category: str
    message: str

    workbook_path: Path | None
    sheet_name: str

    issue_code: str = ""

    row_number: int | None = None
    column_name: str = ""
    column_number: int | None = None

    book_id: str = ""
    title: str = ""
    author: str = ""
    details: str = ""

    @property
    def exception_key(
        self,
    ) -> str:
        """
        Return the stable key used to match a saved exception.
        """

        normalized_book_id = (
            self.book_id
            .strip()
            .casefold()
        )

        normalized_issue_code = (
            self.issue_code
            .strip()
            .casefold()
        )

        if (
            not normalized_book_id
            or not normalized_issue_code
        ):
            return ""

        return (
            f"{normalized_book_id}::"
            f"{normalized_issue_code}"
        )

    @property
    def is_exception_eligible(
        self,
    ) -> bool:
        """
        Return True when this issue may be intentionally excepted.
        """

        return (
            self.area == "Clerical"
            and bool(
                self.exception_key
            )
        )


@dataclass(frozen=True)
class LibraryException:
    """
    One intentional catalog exception saved outside the workbooks.
    """

    book_id: str
    issue_code: str
    reason: str

    note: str = ""
    title: str = ""
    author: str = ""
    created_at: str = ""

    @property
    def exception_key(
        self,
    ) -> str:
        """
        Return the stable Book ID and issue-code key.
        """

        normalized_book_id = (
            self.book_id
            .strip()
            .casefold()
        )

        normalized_issue_code = (
            self.issue_code
            .strip()
            .casefold()
        )

        return (
            f"{normalized_book_id}::"
            f"{normalized_issue_code}"
        )

    def matches_issue(
        self,
        issue: ScanIssue,
    ) -> bool:
        """
        Return True when this exception applies to the issue.
        """

        return (
            bool(
                issue.exception_key
            )
            and self.exception_key
            == issue.exception_key
        )


@dataclass
class ScanResult:
    """
    Complete result from one Library Clerk scan.
    """

    workbook_count: int = 0
    books_scanned: int = 0

    list_view_workbook: Path | None = None
    list_view_sheet: str = ""

    discovered_headers: list[str] = field(
        default_factory=list
    )

    additional_data_headers: list[str] = field(
        default_factory=list
    )

    additional_system_headers: list[str] = field(
        default_factory=list
    )

    warnings: list[str] = field(
        default_factory=list
    )

    issues: list[ScanIssue] = field(
        default_factory=list
    )

    duration_seconds: float = 0.0

    @property
    def system_issue_count(
        self,
    ) -> int:
        """
        Return the number of structural or identity problems.
        """

        return sum(
            1
            for issue in self.issues
            if issue.area == "System integrity"
        )

    @property
    def clerical_issue_count(
        self,
    ) -> int:
        """
        Return the number of ordinary missing-data findings.
        """

        return sum(
            1
            for issue in self.issues
            if issue.area == "Clerical"
        )

    @property
    def integrity_passed(
        self,
    ) -> bool:
        """
        Return True when no system-integrity problems were found.
        """

        return self.system_issue_count == 0