"""
Excel navigation helpers for Library Clerk.

This module uses Excel COM automation only to:

- Connect to or start desktop Excel
- Open the intended workbook when necessary
- Activate the intended worksheet
- Select and reveal one intended cell

It does not write values or save workbooks.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import win32com.client


class ExcelNavigationError(RuntimeError):
    """
    Raised when Library Clerk cannot navigate to an Excel cell.
    """


def normalize_windows_path(
    path: str | Path,
) -> str:
    """
    Normalize a Windows path for case-insensitive comparison.
    """

    return os.path.normcase(
        os.path.abspath(
            os.fspath(
                path
            )
        )
    )


def get_or_create_excel_application() -> Any:
    """
    Connect to running Excel or start a new Excel application.
    """

    try:
        excel = (
            win32com.client.GetActiveObject(
                "Excel.Application"
            )
        )

    except Exception:
        try:
            excel = (
                win32com.client.DispatchEx(
                    "Excel.Application"
                )
            )

        except Exception as error:
            raise ExcelNavigationError(
                "Microsoft Excel could not be started."
            ) from error

    try:
        excel.Visible = True

    except Exception as error:
        raise ExcelNavigationError(
            "Excel started, but its window could not be shown."
        ) from error

    return excel


def find_open_workbook(
    excel: Any,
    workbook_path: Path,
) -> Any | None:
    """
    Find an already-open workbook by its complete file path.
    """

    target_path = normalize_windows_path(
        workbook_path
    )

    try:
        workbook_count = int(
            excel.Workbooks.Count
        )

    except Exception as error:
        raise ExcelNavigationError(
            "Library Clerk could not inspect Excel's open workbooks."
        ) from error

    for workbook_index in range(
        1,
        workbook_count + 1,
    ):
        workbook = (
            excel.Workbooks.Item(
                workbook_index
            )
        )

        try:
            open_path = normalize_windows_path(
                workbook.FullName
            )

        except Exception:
            continue

        if open_path == target_path:
            return workbook

    return None


def get_or_open_workbook(
    excel: Any,
    workbook_path: Path,
) -> Any:
    """
    Return the target workbook, opening it when necessary.
    """

    open_workbook = find_open_workbook(
        excel,
        workbook_path,
    )

    if open_workbook is not None:
        return open_workbook

    try:
        # Positional arguments:
        #
        # Filename
        # UpdateLinks = 0
        # ReadOnly = False
        #
        # The workbook is opened normally so Jade can edit it.
        # Library Clerk itself still does not change or save cells.
        return excel.Workbooks.Open(
            str(
                workbook_path
            ),
            0,
            False,
        )

    except Exception as error:
        raise ExcelNavigationError(
            (
                "Excel could not open the workbook:\n\n"
                f"{workbook_path}"
            )
        ) from error


def open_excel_cell(
    workbook_path: Path,
    sheet_name: str,
    row_number: int,
    column_number: int,
) -> Any:
    """
    Open and reveal one workbook cell in desktop Excel.

    The returned Excel application object should remain referenced by
    the main window while Library Clerk is running.
    """

    workbook_path = (
        workbook_path.resolve()
    )

    if not workbook_path.exists():
        raise ExcelNavigationError(
            (
                "The workbook no longer exists at the "
                "scanned location:\n\n"
                f"{workbook_path}"
            )
        )

    if row_number < 1:
        raise ExcelNavigationError(
            "The requested Excel row number is invalid."
        )

    if column_number < 1:
        raise ExcelNavigationError(
            "The requested Excel column number is invalid."
        )

    excel = get_or_create_excel_application()

    workbook = get_or_open_workbook(
        excel,
        workbook_path,
    )

    try:
        worksheet = (
            workbook.Worksheets.Item(
                sheet_name
            )
        )

    except Exception as error:
        raise ExcelNavigationError(
            (
                "Excel opened the workbook, but the "
                f"worksheet '{sheet_name}' could not be found."
            )
        ) from error

    try:
        workbook.Activate()
        worksheet.Activate()

        target_cell = worksheet.Cells(
            row_number,
            column_number,
        )

        excel.Goto(
            target_cell,
            True,
        )

        excel.Visible = True

    except Exception as error:
        raise ExcelNavigationError(
            (
                "Excel opened the workbook, but Library Clerk "
                "could not select the intended cell."
            )
        ) from error

    return excel