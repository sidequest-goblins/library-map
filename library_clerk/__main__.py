"""
Executable entry point for Library Clerk.

Development command:

    python -m library_clerk
"""

from __future__ import annotations

import sys

from PySide6.QtGui import (
    QColor,
    QPalette,
)
from PySide6.QtWidgets import (
    QApplication,
)

from library_clerk import APP_NAME
from library_clerk.main_window import MainWindow


def build_application_palette() -> QPalette:
    """
    Build Library Clerk's fixed light palette.

    This palette intentionally ignores the operating system's light or
    dark appearance so every control remains readable and consistent.
    """

    palette = QPalette()

    palette.setColor(
        QPalette.ColorRole.Window,
        QColor(
            "#f7f4ef"
        ),
    )

    palette.setColor(
        QPalette.ColorRole.WindowText,
        QColor(
            "#27231f"
        ),
    )

    palette.setColor(
        QPalette.ColorRole.Base,
        QColor(
            "#fffdf9"
        ),
    )

    palette.setColor(
        QPalette.ColorRole.AlternateBase,
        QColor(
            "#f8f4ee"
        ),
    )

    palette.setColor(
        QPalette.ColorRole.ToolTipBase,
        QColor(
            "#fffdf9"
        ),
    )

    palette.setColor(
        QPalette.ColorRole.ToolTipText,
        QColor(
            "#27231f"
        ),
    )

    palette.setColor(
        QPalette.ColorRole.Text,
        QColor(
            "#27231f"
        ),
    )

    palette.setColor(
        QPalette.ColorRole.Button,
        QColor(
            "#eee8df"
        ),
    )

    palette.setColor(
        QPalette.ColorRole.ButtonText,
        QColor(
            "#27231f"
        ),
    )

    palette.setColor(
        QPalette.ColorRole.BrightText,
        QColor(
            "#ffffff"
        ),
    )

    palette.setColor(
        QPalette.ColorRole.Link,
        QColor(
            "#6552a4"
        ),
    )

    palette.setColor(
        QPalette.ColorRole.Highlight,
        QColor(
            "#dcd4f3"
        ),
    )

    palette.setColor(
        QPalette.ColorRole.HighlightedText,
        QColor(
            "#27231f"
        ),
    )

    palette.setColor(
        QPalette.ColorRole.PlaceholderText,
        QColor(
            "#8a8279"
        ),
    )

    palette.setColor(
        QPalette.ColorGroup.Disabled,
        QPalette.ColorRole.Text,
        QColor(
            "#9a9289"
        ),
    )

    palette.setColor(
        QPalette.ColorGroup.Disabled,
        QPalette.ColorRole.WindowText,
        QColor(
            "#9a9289"
        ),
    )

    palette.setColor(
        QPalette.ColorGroup.Disabled,
        QPalette.ColorRole.ButtonText,
        QColor(
            "#9a9289"
        ),
    )

    palette.setColor(
        QPalette.ColorGroup.Disabled,
        QPalette.ColorRole.Base,
        QColor(
            "#eeeae4"
        ),
    )

    return palette


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

    application.setStyle(
        "Fusion"
    )

    application.setPalette(
        build_application_palette()
    )

    window = MainWindow()

    window.show()

    return application.exec()


if __name__ == "__main__":
    raise SystemExit(
        main()
    )