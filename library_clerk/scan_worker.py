"""
Background Qt worker for workbook scanning.
"""

from __future__ import annotations

import traceback
from pathlib import Path

from PySide6.QtCore import (
    QObject,
    Signal,
    Slot,
)

from library_clerk.workbook_scanner import (
    scan_workbooks,
)


class ScanWorker(QObject):
    """
    Run the potentially slow workbook scan outside the UI thread.
    """

    progress = Signal(
        str
    )

    finished = Signal(
        object
    )

    failed = Signal(
        str
    )

    def __init__(
        self,
        workbook_paths: list[Path],
    ) -> None:
        super().__init__()

        self.workbook_paths = list(
            workbook_paths
        )

    @Slot()
    def run(
        self,
    ) -> None:
        """
        Execute one read-only workbook scan.
        """

        try:
            result = scan_workbooks(
                self.workbook_paths,
                progress_callback=(
                    self.progress.emit
                ),
            )

            self.finished.emit(
                result
            )

        except Exception as error:
            traceback.print_exc()

            self.failed.emit(
                (
                    f"{type(error).__name__}: "
                    f"{error}"
                )
            )