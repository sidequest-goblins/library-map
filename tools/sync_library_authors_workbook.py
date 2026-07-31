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
    "First",
    "Last",
    "Books",
    "SYSTEM COLUMNS - AUTOMATION ONLY",
    "Author ID",
]

LEGACY_HEADERS = [
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
XL_ASCENDING = 1
XL_YES = 1
XL_NO = 2
XL_TOP_TO_BOTTOM = 1
XL_MOVE_AND_SIZE = 1
XL_PATTERN_NONE = -4142

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
    first_name_row = sheet.Cells(
        sheet.Rows.Count,
        2,
    ).End(XL_UP).Row

    last_name_row = sheet.Cells(
        sheet.Rows.Count,
        3,
    ).End(XL_UP).Row

    author_id_row = sheet.Cells(
        sheet.Rows.Count,
        6,
    ).End(XL_UP).Row

    return max(
        int(first_name_row),
        int(last_name_row),
        int(author_id_row),
        1,
    )

def read_existing_rows(
    sheet,
) -> tuple[
    dict[str, int],
    int,
    str,
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
        return {}, 1, "empty"

    if current_headers == HEADERS:
        layout = "current"
        author_id_column = 6
        visible_name_columns = (2, 3)

    elif (
        current_headers[
            :len(LEGACY_HEADERS)
        ]
        == LEGACY_HEADERS
        and not current_headers[
            len(LEGACY_HEADERS)
        ]
    ):
        layout = "legacy"
        author_id_column = 5
        visible_name_columns = (2,)

    else:
        raise ValueError(
            "The Authors sheet headers do "
            "not match a supported layout."
            f"\nCurrent: {HEADERS}"
            f"\nLegacy:  {LEGACY_HEADERS}"
            f"\nFound:   {current_headers}"
        )

    last_row = max(
        *[
            int(
                sheet.Cells(
                    sheet.Rows.Count,
                    column,
                ).End(XL_UP).Row
            )
            for column in (
                *visible_name_columns,
                author_id_column,
            )
        ],
        1,
    )

    rows_by_author_id: dict[
        str,
        int,
    ] = {}

    for row_number in range(
        2,
        last_row + 1,
    ):
        row_values = [
            clean(
                sheet.Cells(
                    row_number,
                    column,
                ).Value
            )
            for column in range(
                1,
                len(HEADERS) + 1,
            )
        ]

        is_current_header_copy = (
            layout == "current"
            and row_values == HEADERS
        )

        is_legacy_header_copy = (
            layout == "legacy"
            and row_values[
                :len(LEGACY_HEADERS)
            ]
            == LEGACY_HEADERS
            and not row_values[
                len(LEGACY_HEADERS)
            ]
        )

        if (
            is_current_header_copy
            or is_legacy_header_copy
        ):
            continue

        visible_names = [
            clean(
                sheet.Cells(
                    row_number,
                    column,
                ).Value
            )
            for column
            in visible_name_columns
        ]

        author_id = clean(
            sheet.Cells(
                row_number,
                author_id_column,
            ).Value
        )

        if (
            not any(visible_names)
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
        layout,
    )

def find_stray_header_rows(
    sheet,
) -> list[int]:
    last_row = max(
        *[
            int(
                sheet.Cells(
                    sheet.Rows.Count,
                    column,
                ).End(XL_UP).Row
            )
            for column in range(
                1,
                len(HEADERS) + 1,
            )
        ],
        1,
    )

    stray_rows: list[int] = []

    for row_number in range(
        2,
        last_row + 1,
    ):
        row_values = [
            clean(
                sheet.Cells(
                    row_number,
                    column,
                ).Value
            )
            for column in range(
                1,
                len(HEADERS) + 1,
            )
        ]

        is_current_header_copy = (
            row_values == HEADERS
        )

        is_legacy_header_copy = (
            row_values[
                :len(LEGACY_HEADERS)
            ]
            == LEGACY_HEADERS
            and not row_values[
                len(LEGACY_HEADERS)
            ]
        )

        if (
            is_current_header_copy
            or is_legacy_header_copy
        ):
            stray_rows.append(
                row_number
            )

    return stray_rows

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
        "A1:F1"
    )

    header_range.Font.Bold = True

    # Headers are identified by bold text
    # only. Clear any fill left behind by
    # older versions of the workbook.
    header_range.Interior.Pattern = (
        XL_PATTERN_NONE
    )

    header_range.VerticalAlignment = (
        XL_CENTER
    )

    sheet.Rows(1).RowHeight = 28

    sheet.Columns("A").ColumnWidth = 14
    sheet.Columns("B").ColumnWidth = 22
    sheet.Columns("C").ColumnWidth = 28
    sheet.Columns("D").ColumnWidth = 10
    sheet.Columns("E").ColumnWidth = 30
    sheet.Columns("F").ColumnWidth = 44

    sheet.Columns("D").HorizontalAlignment = (
        XL_CENTER
    )

    sheet.Columns("E:F").Hidden = True

    if last_row >= 2:
        sheet.Range(
            f"A2:F{last_row}"
        ).VerticalAlignment = XL_CENTER

    sheet.Activate()

    active_window = excel.ActiveWindow

    if active_window is not None:
        active_window.SplitRow = 1
        active_window.FreezePanes = True

    if sheet.AutoFilterMode:
        sheet.AutoFilterMode = False

    sheet.Range(
        "A1:F1"
    ).AutoFilter()

def migrate_legacy_layout(
    sheet,
) -> None:
    # Insert a new Last column between
    # the old Author and Books columns.
    # Existing photos, book counts,
    # system marker, and Author IDs
    # remain on their original rows.
    sheet.Columns("C:C").Insert()

    initialize_headers(
        sheet
    )

def normalize_photo_placement(
    sheet,
) -> int:
    normalized_count = 0

    for shape_index in range(
        1,
        sheet.Shapes.Count + 1,
    ):
        shape = sheet.Shapes.Item(
            shape_index
        )

        try:
            # Make floating pictures move
            # and resize with their cells.
            shape.Placement = (
                XL_MOVE_AND_SIZE
            )

            normalized_count += 1
        except Exception:
            # Modern in-cell pictures may
            # not behave like ordinary
            # floating shapes. They already
            # travel with their cell.
            continue

    return normalized_count

def sort_author_rows(
    sheet,
    last_row: int,
) -> None:
    if last_row < 2:
        return

    # Remove any active filter before
    # sorting. The filter will be rebuilt
    # afterward by format_sheet().
    if sheet.AutoFilterMode:
        sheet.AutoFilterMode = False

    # Sort DATA ONLY. Row 1 is deliberately
    # excluded so Excel cannot move or copy
    # the header into the author rows.
    data_range = sheet.Range(
        f"A2:F{last_row}"
    )

    data_range.Sort(
        Key1=sheet.Range("C2"),
        Order1=XL_ASCENDING,
        Key2=sheet.Range("B2"),
        Order2=XL_ASCENDING,
        Key3=sheet.Range("F2"),
        Order3=XL_ASCENDING,
        Header=XL_NO,
        Orientation=XL_TOP_TO_BOTTOM,
    )

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
        sheet_layout = "missing"

        stray_header_rows: list[
            int
        ] = []

        if sheet is not None:
            stray_header_rows = (
                find_stray_header_rows(
                    sheet
                )
            )

            if (
                args.write
                and stray_header_rows
            ):
                # Delete from bottom to top
                # so row numbers do not shift
                # before later deletions.
                for row_number in reversed(
                    stray_header_rows
                ):
                    sheet.Rows(
                        row_number
                    ).Delete()

            (
                existing_rows,
                last_row,
                sheet_layout,
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
            "  Workbook layout: "
            f"{sheet_layout}"
        )

        print(
            "  Layout migration needed: "
            f"{'yes' if sheet_layout == 'legacy' else 'no'}"
        )

        print(
            "  Stray header rows found: "
            f"{len(stray_header_rows)}"
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
            sheet_layout = "empty"

        elif sheet is None:
            sheet = (
                workbook.Worksheets.Add(
                    After=workbook.Worksheets(
                        workbook.Worksheets.Count
                    )
                )
            )

            sheet.Name = SHEET_NAME
            sheet_layout = "empty"

        if sheet_layout == "legacy":
            migrate_legacy_layout(
                sheet
            )

            print(
                "\nMigrated AUTHORS.xlsx "
                "from Author to First/Last "
                "columns."
            )

            sheet_layout = "current"

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

            first_name = clean(
                author.get("firstName")
            )

            last_name = clean(
                author.get("lastName")
            )

            # Keep mononyms and organizations
            # in Last so they sort naturally.
            if (
                first_name
                and not last_name
            ):
                last_name = first_name
                first_name = ""

            if (
                not first_name
                and not last_name
            ):
                last_name = display_name

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
            ).Value = first_name

            sheet.Cells(
                row_number,
                3,
            ).Value = last_name

            sheet.Cells(
                row_number,
                4,
            ).Value = book_count

            sheet.Cells(
                row_number,
                5,
            ).Value = ""

            sheet.Cells(
                row_number,
                6,
            ).Value = author_id

        final_last_row = max(
            next_row - 1,
            last_row,
            1,
        )

        normalized_photo_count = (
            normalize_photo_placement(
                sheet
            )
        )

        sort_author_rows(
            sheet,
            final_last_row,
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
            "  Stray header rows removed: "
            f"{len(stray_header_rows)}"
        )
        
        print(
            "  Authors sorted: "
            "Last, then First"
        )

        print(
            "  Floating photo anchors "
            "normalized: "
            f"{normalized_photo_count}"
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