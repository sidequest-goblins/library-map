"""
Friendly dialog for saving an intentional Library Clerk exception.
"""

from __future__ import annotations

from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLabel,
    QPlainTextEdit,
    QVBoxLayout,
    QWidget,
)

from library_clerk.models import (
    ScanIssue,
)


EXCEPTION_REASONS = (
    "No identifier exists",
    "Edition cannot be confirmed",
    "Not applicable to this book",
    "Research complete; information unavailable",
    "Other intentional exception",
)


class ExceptionDialog(QDialog):
    """
    Collect a reason and optional research note for one exception.
    """

    def __init__(
        self,
        issue: ScanIssue,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(
            parent
        )

        self.issue = issue

        self.setObjectName(
            "ExceptionDialog"
        )

        self.setWindowTitle(
            "Mark intentional exception"
        )

        self.setModal(
            True
        )

        self.setMinimumWidth(
            540
        )

        root_layout = QVBoxLayout(
            self
        )

        root_layout.setContentsMargins(
            22,
            20,
            22,
            20,
        )

        root_layout.setSpacing(
            14
        )

        title_label = QLabel(
            "Mark as an intentional exception"
        )

        title_label.setObjectName(
            "ExceptionDialogTitle"
        )

        root_layout.addWidget(
            title_label
        )

        book_label = QLabel(
            issue.title
            or "Selected book"
        )

        book_label.setObjectName(
            "ExceptionDialogBook"
        )

        book_label.setWordWrap(
            True
        )

        root_layout.addWidget(
            book_label
        )

        explanation_label = QLabel(
            (
                f"Library Clerk will stop showing "
                f"“{issue.category}” as unfinished work "
                "for this specific Book ID. The exception "
                "can be reviewed or restored later."
            )
        )

        explanation_label.setObjectName(
            "ExceptionDialogExplanation"
        )

        explanation_label.setWordWrap(
            True
        )

        root_layout.addWidget(
            explanation_label
        )

        form_layout = QFormLayout()

        form_layout.setHorizontalSpacing(
            16
        )

        form_layout.setVerticalSpacing(
            12
        )

        self.reason_combo = QComboBox()

        self.reason_combo.addItems(
            list(
                EXCEPTION_REASONS
            )
        )

        form_layout.addRow(
            "Reason",
            self.reason_combo,
        )

        self.note_edit = QPlainTextEdit()

        self.note_edit.setPlaceholderText(
            (
                "Optional research note, edition details, "
                "sources checked, or anything useful to "
                "remember later…"
            )
        )

        self.note_edit.setMinimumHeight(
            120
        )

        form_layout.addRow(
            "Research note",
            self.note_edit,
        )

        root_layout.addLayout(
            form_layout
        )

        button_box = QDialogButtonBox(
            (
                QDialogButtonBox.StandardButton.Save
                | QDialogButtonBox.StandardButton.Cancel
            )
        )

        save_button = button_box.button(
            QDialogButtonBox.StandardButton.Save
        )

        save_button.setText(
            "Save exception"
        )

        save_button.setObjectName(
            "PrimaryButton"
        )

        button_box.accepted.connect(
            self.accept
        )

        button_box.rejected.connect(
            self.reject
        )

        root_layout.addWidget(
            button_box
        )

    def selected_reason(
        self,
    ) -> str:
        """
        Return the selected friendly exception reason.
        """

        return (
            self.reason_combo
            .currentText()
            .strip()
        )

    def research_note(
        self,
    ) -> str:
        """
        Return the optional research note.
        """

        return (
            self.note_edit
            .toPlainText()
            .strip()
        )