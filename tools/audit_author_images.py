from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import pythoncom
import win32com.client


WORKBOOK_PATH = Path(
    r"C:\Users\cjade\OneDrive\Shared Workbooks\MyLibrary\AUTHORS.xlsx"
)

SHEET_NAME = "Authors"

REPORT_PATH = Path(__file__).with_name(
    "author-image-audit.txt"
)

PHOTO_COLUMN = 1
FIRST_COLUMN = 2
LAST_COLUMN = 3
AUTHOR_ID_COLUMN = 6

XL_UP = -4162


def clean(value: Any) -> str:
    if value is None:
        return ""

    return str(value).strip()


def get_cell_formula(cell: Any) -> str:
    """
    Return whichever formula representation this
    version of Excel exposes.

    Formula2 is preferred for newer Excel features,
    but older versions may not support it.
    """

    for property_name in (
        "Formula2",
        "Formula",
    ):
        try:
            value = getattr(
                cell,
                property_name,
            )

            text = clean(value)

            if text:
                return text
        except Exception:
            continue

    return ""


def cell_contains_picture(cell: Any) -> bool:
    """
    Detect pictures stored directly in the Photo cell.

    This intentionally accepts any nonblank value or
    formula because column A is reserved exclusively
    for author photos.
    """

    try:
        if bool(cell.HasFormula):
            return True
    except Exception:
        pass

    formula = get_cell_formula(cell)

    if formula:
        return True

    for property_name in (
        "Value2",
        "Value",
        "Text",
    ):
        try:
            value = getattr(
                cell,
                property_name,
            )

            if clean(value):
                return True
        except Exception:
            continue

    return False


def get_floating_picture_rows(
    sheet: Any,
) -> set[int]:
    """
    Find floating pictures whose upper-left corner
    is anchored in column A.

    The sync workbook already treats column A as the
    photo column, so a picture anchored there belongs
    to that author row.
    """

    picture_rows: set[int] = set()

    try:
        shape_count = int(
            sheet.Shapes.Count
        )
    except Exception:
        return picture_rows

    for shape_index in range(
        1,
        shape_count + 1,
    ):
        try:
            shape = sheet.Shapes.Item(
                shape_index
            )

            anchor = shape.TopLeftCell

            if (
                int(anchor.Column)
                == PHOTO_COLUMN
            ):
                picture_rows.add(
                    int(anchor.Row)
                )
        except Exception:
            # Some modern in-cell pictures are not
            # exposed as ordinary floating shapes.
            # Those are checked through the cell itself.
            continue

    return picture_rows


def author_display_name(
    first_name: str,
    last_name: str,
) -> str:
    parts = [
        value
        for value in (
            first_name,
            last_name,
        )
        if value
    ]

    return " ".join(parts) or "(Unnamed author)"


def main() -> None:
    if not WORKBOOK_PATH.exists():
        raise FileNotFoundError(
            "Could not find AUTHORS.xlsx:\n"
            f"{WORKBOOK_PATH}"
        )

    excel = None
    workbook = None

    pythoncom.CoInitialize()

    try:
        excel = (
            win32com.client.DispatchEx(
                "Excel.Application"
            )
        )

        excel.Visible = False
        excel.DisplayAlerts = False

        workbook = excel.Workbooks.Open(
            str(WORKBOOK_PATH),
            UpdateLinks=0,
            ReadOnly=True,
        )

        try:
            sheet = workbook.Worksheets(
                SHEET_NAME
            )
        except Exception as exc:
            raise ValueError(
                "Could not find worksheet "
                f"'{SHEET_NAME}' in AUTHORS.xlsx."
            ) from exc

        expected_headers = {
            PHOTO_COLUMN: "Photo",
            FIRST_COLUMN: "First",
            LAST_COLUMN: "Last",
            AUTHOR_ID_COLUMN: "Author ID",
        }

        for column_number, expected in (
            expected_headers.items()
        ):
            actual = clean(
                sheet.Cells(
                    1,
                    column_number,
                ).Value
            )

            if actual != expected:
                raise ValueError(
                    "Unexpected AUTHORS.xlsx layout.\n"
                    f"Column {column_number} expected "
                    f"'{expected}' but found '{actual}'."
                )

        last_row = max(
            int(
                sheet.Cells(
                    sheet.Rows.Count,
                    AUTHOR_ID_COLUMN,
                )
                .End(XL_UP)
                .Row
            ),
            int(
                sheet.Cells(
                    sheet.Rows.Count,
                    LAST_COLUMN,
                )
                .End(XL_UP)
                .Row
            ),
            int(
                sheet.Cells(
                    sheet.Rows.Count,
                    FIRST_COLUMN,
                )
                .End(XL_UP)
                .Row
            ),
        )

        floating_picture_rows = (
            get_floating_picture_rows(
                sheet
            )
        )

        total_authors = 0
        authors_with_images = 0
        missing_authors: list[
            tuple[int, str, str]
        ] = []

        for row_number in range(
            2,
            last_row + 1,
        ):
            first_name = clean(
                sheet.Cells(
                    row_number,
                    FIRST_COLUMN,
                ).Value
            )

            last_name = clean(
                sheet.Cells(
                    row_number,
                    LAST_COLUMN,
                ).Value
            )

            author_id = clean(
                sheet.Cells(
                    row_number,
                    AUTHOR_ID_COLUMN,
                ).Value
            )

            # Ignore entirely empty or stray rows.
            if not (
                first_name
                or last_name
                or author_id
            ):
                continue

            total_authors += 1

            photo_cell = sheet.Cells(
                row_number,
                PHOTO_COLUMN,
            )

            has_image = (
                row_number
                in floating_picture_rows
                or cell_contains_picture(
                    photo_cell
                )
            )

            if has_image:
                authors_with_images += 1
                continue

            missing_authors.append(
                (
                    row_number,
                    author_display_name(
                        first_name,
                        last_name,
                    ),
                    author_id,
                )
            )

        missing_count = len(
            missing_authors
        )

        completion_percent = (
            (
                authors_with_images
                / total_authors
            )
            * 100
            if total_authors
            else 0
        )

        report_lines = [
            "AUTHORS.xlsx IMAGE AUDIT",
            "=" * 60,
            "",
            (
                "Audited: "
                + datetime.now().strftime(
                    "%Y-%m-%d %H:%M:%S"
                )
            ),
            f"Workbook: {WORKBOOK_PATH}",
            f"Worksheet: {SHEET_NAME}",
            "",
            f"Total authors: {total_authors}",
            (
                "Authors with images: "
                f"{authors_with_images}"
            ),
            (
                "Authors missing images: "
                f"{missing_count}"
            ),
            (
                "Completion: "
                f"{completion_percent:.1f}%"
            ),
            "",
            "AUTHORS MISSING IMAGES",
            "-" * 60,
        ]

        if missing_authors:
            for (
                row_number,
                display_name,
                author_id,
            ) in missing_authors:
                id_suffix = (
                    f" [{author_id}]"
                    if author_id
                    else ""
                )

                report_lines.append(
                    f"Row {row_number}: "
                    f"{display_name}"
                    f"{id_suffix}"
                )
        else:
            report_lines.append(
                "None. Jade has achieved "
                "author-photo supremacy."
            )

        REPORT_PATH.write_text(
            "\n".join(report_lines) + "\n",
            encoding="utf-8",
        )

        print()
        print(
            "AUTHORS.xlsx image audit"
        )
        print(
            "  Total authors: "
            f"{total_authors}"
        )
        print(
            "  Authors with images: "
            f"{authors_with_images}"
        )
        print(
            "  Authors missing images: "
            f"{missing_count}"
        )
        print(
            "  Completion: "
            f"{completion_percent:.1f}%"
        )
        print()
        print(
            "Missing-author report:"
        )
        print(
            f"  {REPORT_PATH}"
        )

    finally:
        if workbook is not None:
            workbook.Close(
                SaveChanges=False
            )

        if excel is not None:
            excel.Quit()

        pythoncom.CoUninitialize()


if __name__ == "__main__":
    main()