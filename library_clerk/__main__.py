"""
Executable entry point for Library Clerk.

Development command:

    python -m library_clerk
"""

from __future__ import annotations

import sys

from PySide6.QtWidgets import QApplication

from library_clerk import APP_NAME
from library_clerk.main_window import MainWindow


def main() -> int:
    """
    Start the Library Clerk desktop application.
    """

    application = QApplication(
        sys.argv
    )

    application.setApplicationName(
        APP_NAME
    )

    application.setOrganizationName(
        "Sidequest Goblins"
    )

    window = MainWindow()

    window.show()

    return application.exec()


if __name__ == "__main__":
    raise SystemExit(
        main()
    )