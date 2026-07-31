from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

import pythoncom
import win32com.client


REPO_ROOT = Path(__file__).resolve().parents[1]

REGISTRY_PATH = (
    REPO_ROOT
    / "tools"
    / "library-author-identities.json"
)

ACTIVE_AUTHORS_PATH = (
    REPO_ROOT
    / "public"
    / "data"
    / "library-authors.json"
)

WORKBOOK_PATH = Path(
    "C:/Users/cjade/OneDrive/"
    "Shared Workbooks/MyLibrary/"
    "AUTHORS.xlsx"
)

BACKUP_DIR = (
    REPO_ROOT
    / "tools"
    / "authors-workbook-backups"
)

MAX_BACKUPS = 5

SHEET_NAME = "Authors"

HEADERS = [
    "Photo",
    "Author",
    "Books",
    "SYSTEM COLUMNS - AUTOMATION ONLY",
    "Author ID",
]

AUTHOR_ID_PATTERN = re.compile(
    r"^author-"
    r"[0-9a-f]{8}-"
    r"[0-9a-f]{4}-"
    r"[0-9a-f]{4}-"
    r"[0-9a-f]{4}-"
    r"[0-9a-f]{12}$"
)

XL_UP = -4162
XL_CENTER = -4108
XL_OPENXML_WORKBOOK = 51


def clean(value: Any) -> str:
    return str(value or "").strip()


def load_json(path: Path) -> Any:
    if not path.exists():
        raise FileNotFoundError(
            f"Could not find required file: {path}"
        )

    return json.loads(
        path.read_text(
            encoding="utf-8"
        )
    )


def validate_author_id(
    author_id: str,
) -> None:
    if not AUTHOR_ID_PATTERN.fullmatch(
        author_id
    ):
        raise ValueError(
            f"Malformed Author ID: {author_id!r}"
        )

    uuid_text = author_id.removeprefix(
        "author-"
    )

    try:
        parsed = UUID(uuid_text)
    except ValueError as error:
        raise ValueError(
            f"Malformed Author ID: {author_id!r}"
        ) from error

    if (
        parsed.version != 4
        or str(parsed) != uuid_text
    ):
        raise ValueError(
            "Expected a canonical version-4 "
            f"Author ID: {author_id!r}"
        )


def load_author_data() -> tuple[
    list[dict[str, Any]],
    dict[str, int],
]:
    registry = load_json(
        REGISTRY_PATH
    )

    active_authors = load_json(
        ACTIVE_AUTHORS_PATH
    )

    if not isinstance(
        registry,
        dict,
    ):
        raise ValueError(
            "Author registry must be an object."
        )

    registry_authors = registry.get(
        "authors"
    )

    if not isinstance(
        registry_authors,
        list,
    ):
        raise ValueError(
            "Author registry authors must "
            "be an array."
        )

    if not isinstance(
        active_authors,
        list,
    ):
        raise ValueError(
            "Generated authors must "
            "be an array."
        )

    registry_ids: set[str] = set()

    for author in registry_authors:
        author_id = clean(
            author.get("authorId")
        )

        validate_author_id(
            author_id
        )

        if author_id in registry_ids:
            raise ValueError(
                "Duplicate Author ID in "
                f"registry: {author_id}"
            )

        registry_ids.add(
            author_id
        )

    active_book_counts: dict[
        str,
        int,
    ] = {}

    for author in active_authors:
        author_id = clean(
            author.get("authorId")
        )

        validate_author_id(
            author_id
        )

        if author_id not in registry_ids:
            raise ValueError(
                "Generated active author is "
                "missing from the registry: "
                f"{author_id}"
            )

        if author_id in active_book_counts:
            raise ValueError(
                "Duplicate active Author ID: "
                f"{author_id}"
            )

        active_book_counts[
            author_id
        ] = int(
            author.get("bookCount")
            or 0
        )

    return (
        registry_authors,
        active_book_counts,
    )


def get_worksheet(
    workbook,
    sheet_name: str,
):
    for index in range(
        1,
        workbook.Worksheets.Count + 1,
    ):
        sheet = workbook.Worksheets(
            index
        )

        if sheet.Name == sheet_name:
            return sheet

    return None


def get_last_data_row(
    sheet,
) -> int:
    author_row = sheet.Cells(
        sheet.Rows.Count,
        2,
    ).End(XL_UP).Row

    id_row = sheet.Cells(
        sheet.Rows.Count,
        5,
    ).End(XL_UP).Row

    return max(
        int(author_row),
        int(id_row),
        1,
    )


def read_existing_rows(
    sheet,
) -> tuple[
    dict[str, int],
    int,
]:
    current_headers = [
        clean(
            sheet.Cells(
                1,
                column,
            ).Value
        )
        for column in range(
            1,
            len(HEADERS) + 1,
        )
    ]

    if not any(current_headers):
        return {}, 1

    if current_headers != HEADERS:
        raise ValueError(
            "The Authors sheet headers do "
            "not match the expected layout."
            f"\nExpected: {HEADERS}"
            f"\nFound:    {current_headers}"
        )

    last_row = get_last_data_row(
        sheet
    )

    rows_by_author_id: dict[
        str,
        int,
    ] = {}

    for row_number in range(
        2,
        last_row + 1,
    ):
        display_name = clean(
            sheet.Cells(
                row_number,
                2,
            ).Value
        )

        author_id = clean(
            sheet.Cells(
                row_number,
                5,
            ).Value
        )

        if (
            not display_name
            and not author_id
        ):
            continue

        if not author_id:
            raise ValueError(
                "Authors sheet row "
                f"{row_number} has visible "
                "author data but no Author ID."
            )

        validate_author_id(
            author_id
        )

        if author_id in rows_by_author_id:
            raise ValueError(
                "Duplicate Author ID in "
                "AUTHORS.xlsx rows "
                f"{rows_by_author_id[author_id]} "
                f"and {row_number}: "
                f"{author_id}"
            )

        rows_by_author_id[
            author_id
        ] = row_number

    return (
        rows_by_author_id,
        last_row,
    )


def make_backup() -> Path | None:
    if not WORKBOOK_PATH.exists():
        return None

    BACKUP_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    timestamp = datetime.now().strftime(
        "%Y%m%d-%H%M%S"
    )

    backup_path = (
        BACKUP_DIR
        / (
            "AUTHORS-before-sync-"
            f"{timestamp}.xlsx"
        )
    )

    shutil.copy2(
        WORKBOOK_PATH,
        backup_path,
    )

    backups = sorted(
        BACKUP_DIR.glob(
            "AUTHORS-before-sync-*.xlsx"
        ),
        key=lambda path:
            path.stat().st_mtime,
        reverse=True,
    )

    for stale_backup in backups[
        MAX_BACKUPS:
    ]:
        stale_backup.unlink()

    return backup_path


def excel_color(
    red: int,
    green: int,
    blue: int,
) -> int:
    return (
        red
        + green * 256
        + blue * 65536
    )


def initialize_headers(
    sheet,
) -> None:
    for column, header in enumerate(
        HEADERS,
        start=1,
    ):
        sheet.Cells(
            1,
            column,
        ).Value = header


def format_sheet(
    excel,
    sheet,
    last_row: int,
) -> None:
    initialize_headers(
        sheet
    )

    header_range = sheet.Range(
        "A1:E1"
    )

    header_range.Font.Bold = True
    header_range.Interior.Color = (
        excel_color(
            221,
            232,
            211,
        )
    )

    header_range.Font.Color = (
        excel_color(
            66,
            48,
            36,
        )
    )

    header_range.VerticalAlignment = (
        XL_CENTER
    )

    sheet.Rows(1).RowHeight = 28

    sheet.Columns("A").ColumnWidth = 14
    sheet.Columns("B").ColumnWidth = 34
    sheet.Columns("C").ColumnWidth = 10
    sheet.Columns("D").ColumnWidth = 30
    sheet.Columns("E").ColumnWidth = 44

    sheet.Columns("C").HorizontalAlignment = (
        XL_CENTER
    )

    sheet.Columns("D:E").Hidden = True

    if last_row >= 2:
        sheet.Range(
            f"A2:E{last_row}"
        ).VerticalAlignment = XL_CENTER

    sheet.Activate()

    active_window = excel.ActiveWindow

    if active_window is not None:
        active_window.SplitRow = 1
        active_window.FreezePanes = True

    if not sheet.AutoFilterMode:
        sheet.Range(
            "A1:E1"
        ).AutoFilter()


def create_new_workbook(
    excel,
):
    workbook = (
        excel.Workbooks.Add()
    )

    sheet = workbook.Worksheets(
        1
    )

    sheet.Name = SHEET_NAME

    while (
        workbook.Worksheets.Count
        > 1
    ):
        workbook.Worksheets(
            workbook.Worksheets.Count
        ).Delete()

    return workbook, sheet


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Safely create or synchronize "
            "the MyLibrary AUTHORS.xlsx "
            "photo workbook."
        )
    )

    parser.add_argument(
        "--write",
        action="store_true",
        help=(
            "Create or update AUTHORS.xlsx. "
            "Without this flag, preview only."
        ),
    )

    args = parser.parse_args()

    (
        registry_authors,
        active_book_counts,
    ) = load_author_data()

    registry_ids = {
        clean(
            author.get("authorId")
        )
        for author in registry_authors
    }

    workbook_exists = (
        WORKBOOK_PATH.exists()
    )

    excel = None
    workbook = None
    sheet = None
    backup_path = None

    pythoncom.CoInitialize()

    try:
        if workbook_exists:
            excel = (
                win32com.client.DispatchEx(
                    "Excel.Application"
                )
            )

            excel.Visible = False
            excel.DisplayAlerts = False

            if args.write:
                backup_path = make_backup()

            workbook = (
                excel.Workbooks.Open(
                    str(WORKBOOK_PATH),
                    UpdateLinks=0,
                    ReadOnly=not args.write,
                )
            )

            if (
                args.write
                and workbook.ReadOnly
            ):
                raise RuntimeError(
                    "AUTHORS.xlsx opened "
                    "read-only. Close it in "
                    "Excel before syncing."
                )

            sheet = get_worksheet(
                workbook,
                SHEET_NAME,
            )

        existing_rows: dict[
            str,
            int,
        ] = {}

        last_row = 1

        if sheet is not None:
            (
                existing_rows,
                last_row,
            ) = read_existing_rows(
                sheet
            )

        unknown_workbook_ids = sorted(
            set(existing_rows)
            - registry_ids
        )

        missing_registry_ids = sorted(
            registry_ids
            - set(existing_rows)
        )

        matched_ids = (
            registry_ids
            & set(existing_rows)
        )

        inactive_author_count = sum(
            1
            for author_id in registry_ids
            if active_book_counts.get(
                author_id,
                0,
            )
            == 0
        )

        print(
            "\nAUTHORS.xlsx sync preview"
        )

        print(
            "  Registry authors: "
            f"{len(registry_authors)}"
        )

        print(
            "  Currently credited authors: "
            f"{len(active_book_counts)}"
        )

        print(
            "  Existing workbook rows "
            "matched: "
            f"{len(matched_ids)}"
        )

        print(
            "  New rows to append: "
            f"{len(missing_registry_ids)}"
        )

        print(
            "  Preserved inactive authors: "
            f"{inactive_author_count}"
        )

        print(
            "  Unknown workbook Author IDs: "
            f"{len(unknown_workbook_ids)}"
        )

        print(
            "  Photo cells to modify: 0"
        )

        if unknown_workbook_ids:
            print(
                "\nUnknown workbook IDs:"
            )

            for author_id in (
                unknown_workbook_ids[:10]
            ):
                print(
                    f"  - {author_id}"
                )

            raise ValueError(
                "AUTHORS.xlsx contains "
                "Author IDs missing from the "
                "permanent registry."
            )

        if not args.write:
            print(
                "\nPreview only. No workbook "
                "was changed."
            )

            print(
                "Run again with --write "
                "after reviewing this summary."
            )

            return

        WORKBOOK_PATH.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        if not workbook_exists:
            if excel is None:
                excel = (
                    win32com.client.DispatchEx(
                        "Excel.Application"
                    )
                )

                excel.Visible = False
                excel.DisplayAlerts = False

            (
                workbook,
                sheet,
            ) = create_new_workbook(
                excel
            )

            existing_rows = {}
            last_row = 1

        elif sheet is None:
            sheet = (
                workbook.Worksheets.Add(
                    After=workbook.Worksheets(
                        workbook.Worksheets.Count
                    )
                )
            )

            sheet.Name = SHEET_NAME

        initialize_headers(
            sheet
        )

        next_row = max(
            last_row + 1,
            2,
        )

        updated_count = 0
        appended_count = 0

        for author in registry_authors:
            author_id = clean(
                author.get("authorId")
            )

            display_name = clean(
                author.get("displayName")
            )

            book_count = (
                active_book_counts.get(
                    author_id,
                    0,
                )
            )

            row_number = (
                existing_rows.get(
                    author_id
                )
            )

            if row_number is None:
                row_number = next_row
                next_row += 1

                sheet.Rows(
                    row_number
                ).RowHeight = 72

                appended_count += 1
            else:
                updated_count += 1

            # Column A is intentionally
            # untouched so Jade's pictures
            # are never overwritten.
            sheet.Cells(
                row_number,
                2,
            ).Value = display_name

            sheet.Cells(
                row_number,
                3,
            ).Value = book_count

            sheet.Cells(
                row_number,
                4,
            ).Value = ""

            sheet.Cells(
                row_number,
                5,
            ).Value = author_id

        final_last_row = max(
            next_row - 1,
            last_row,
            1,
        )

        format_sheet(
            excel,
            sheet,
            final_last_row,
        )

        if workbook_exists:
            workbook.Save()
        else:
            workbook.SaveAs(
                str(WORKBOOK_PATH),
                FileFormat=(
                    XL_OPENXML_WORKBOOK
                ),
            )

        print(
            "\nAUTHORS.xlsx synchronized."
        )

        print(
            "  Existing authors updated: "
            f"{updated_count}"
        )

        print(
            "  New authors appended: "
            f"{appended_count}"
        )

        print(
            "  Total author rows: "
            f"{len(registry_authors)}"
        )

        print(
            "  Photo cells modified: 0"
        )

        print(
            "  Workbook: "
            f"{WORKBOOK_PATH}"
        )

        if backup_path is not None:
            print(
                "  Backup: "
                f"{backup_path}"
            )

    finally:
        if workbook is not None:
            try:
                workbook.Close(
                    SaveChanges=False
                )
            except Exception:
                pass

        if excel is not None:
            try:
                excel.Quit()
            except Exception:
                pass

        pythoncom.CoUninitialize()


if __name__ == "__main__":
    main()