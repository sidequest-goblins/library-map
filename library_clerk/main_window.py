"""
Main desktop window for Library Clerk.
"""

from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime

import os
from pathlib import Path
from openpyxl.utils.cell import get_column_letter

from PySide6.QtCore import (
    Qt,
    QThread,
)
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QSizePolicy,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from library_clerk import (
    APP_NAME,
    APP_VERSION,
)
from library_clerk.excel_navigation import (
    ExcelNavigationError,
    open_excel_cell,
)
from library_clerk.models import (
    LibraryException,
    ScanIssue,
    ScanResult,
)
from library_clerk.paths import (
    get_exceptions_path,
    get_workbook_directory,
    list_workbooks,
)
from library_clerk.scan_worker import (
    ScanWorker,
)
from library_clerk.exception_dialog import (
    ExceptionDialog,
)
from library_clerk.exception_store import (
    ExceptionStoreError,
    create_exception_from_issue,
    load_exceptions,
    remove_exception,
    upsert_exception,
)

ISSUE_CODE_LABELS = {
    "missing-isbn": "Missing ISBN",
    "missing-year": "Missing Year",
    "missing-pages": "Missing Pages",
    "missing-bookcase": "Missing Bookcase",
    "missing-shelf": "Missing Shelf",
    "missing-office-position": (
        "Missing Office Position"
    ),
}


@dataclass(frozen=True)
class IssueQueueEntry:
    """
    One row displayed in the active or exception work queue.
    """

    issue: ScanIssue | None = None
    exception: LibraryException | None = None

class MainWindow(QMainWindow):
    """
    Main Library Clerk application window.
    """

    def __init__(
        self,
    ) -> None:
        super().__init__()

        self.workbook_directory = (
            get_workbook_directory()
        )

        self.exceptions_path = (
            get_exceptions_path(
                self.workbook_directory
            )
        )

        self.workbook_paths: list[
            Path
        ] = []

        self.saved_exceptions: list[
            LibraryException
        ] = []

        self.scan_result: (
            ScanResult
            | None
        ) = None

        self.visible_queue_entries: list[
            IssueQueueEntry
        ] = []

        self.scan_thread: (
            QThread
            | None
        ) = None

        self.scan_worker: (
            ScanWorker
            | None
        ) = None

        self.excel_application = None

        self.setWindowTitle(
            f"{APP_NAME} {APP_VERSION}"
        )

        self.setMinimumSize(
            960,
            720,
        )

        self.resize(
            1180,
            840,
        )

        self._build_interface()
        self._apply_styles()
        self.refresh_workbook_sources()

    def _build_interface(
        self,
    ) -> None:
        """
        Build the main desktop interface.
        """

        central_widget = QWidget()

        root_layout = QVBoxLayout(
            central_widget
        )

        root_layout.setContentsMargins(
            24,
            22,
            24,
            20,
        )

        root_layout.setSpacing(
            14
        )

        title_label = QLabel(
            APP_NAME
        )

        title_font = QFont()
        title_font.setPointSize(
            22
        )
        title_font.setBold(
            True
        )

        title_label.setFont(
            title_font
        )

        subtitle_label = QLabel(
            "Find missing information and workbook "
            "problems without digging through every row."
        )

        subtitle_label.setObjectName(
            "SubtitleLabel"
        )

        root_layout.addWidget(
            title_label
        )

        root_layout.addWidget(
            subtitle_label
        )

        root_layout.addWidget(
            self._create_directory_card()
        )

        action_layout = QHBoxLayout()

        self.scan_button = QPushButton(
            "Scan workbooks"
        )

        self.scan_button.setObjectName(
            "PrimaryButton"
        )

        self.scan_button.clicked.connect(
            self.start_scan
        )

        action_layout.addWidget(
            self.scan_button
        )

        self.scan_progress = QProgressBar()

        self.scan_progress.setRange(
            0,
            0,
        )

        self.scan_progress.setTextVisible(
            False
        )

        self.scan_progress.setMaximumWidth(
            180
        )

        self.scan_progress.hide()

        action_layout.addWidget(
            self.scan_progress
        )

        action_layout.addStretch()

        self.last_scan_label = QLabel(
            "Not scanned yet"
        )

        self.last_scan_label.setObjectName(
            "MutedLabel"
        )

        action_layout.addWidget(
            self.last_scan_label
        )

        root_layout.addLayout(
            action_layout
        )

        root_layout.addLayout(
            self._create_summary_row()
        )

        filter_layout = QHBoxLayout()

        self.search_box = QLineEdit()

        self.search_box.setPlaceholderText(
            "Search title, author, Book ID, "
            "problem, workbook, or row…"
        )

        self.search_box.setClearButtonEnabled(
            True
        )

        self.search_box.textChanged.connect(
            self.apply_issue_filters
        )

        filter_layout.addWidget(
            self.search_box,
            stretch=1,
        )

        self.area_filter = QComboBox()

        self.area_filter.addItems(
            [
                "All active issues",
                "System integrity",
                "Clerical",
                "Exceptions",
            ]
        )

        self.area_filter.currentTextChanged.connect(
            self.apply_issue_filters
        )

        filter_layout.addWidget(
            self.area_filter
        )

        root_layout.addLayout(
            filter_layout
        )

        self.issue_table = QTableWidget()

        self.issue_table.setColumnCount(
            8
        )

        self.issue_table.setHorizontalHeaderLabels(
            [
                "Type",
                "Problem",
                "Title",
                "Author",
                "Field",
                "Row",
                "Workbook",
                "Book ID",
            ]
        )

        self.issue_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )

        self.issue_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )

        self.issue_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )

        self.issue_table.setAlternatingRowColors(
            True
        )

        self.issue_table.setSortingEnabled(
            True
        )

        self.issue_table.setMinimumHeight(
            220
        )

        self.issue_table.itemSelectionChanged.connect(
            self._update_issue_detail_panel
        )

        self.issue_table.cellDoubleClicked.connect(
            self._handle_issue_double_click
        )

        header = (
            self.issue_table.horizontalHeader()
        )

        header.setStretchLastSection(
            False
        )

        header.setSectionResizeMode(
            QHeaderView.ResizeMode.Interactive
        )

        header.setSectionResizeMode(
            0,
            QHeaderView.ResizeMode.ResizeToContents,
        )

        header.setSectionResizeMode(
            1,
            QHeaderView.ResizeMode.ResizeToContents,
        )

        header.setSectionResizeMode(
            2,
            QHeaderView.ResizeMode.Stretch,
        )

        header.setSectionResizeMode(
            3,
            QHeaderView.ResizeMode.Interactive,
        )

        header.setSectionResizeMode(
            4,
            QHeaderView.ResizeMode.ResizeToContents,
        )

        header.setSectionResizeMode(
            5,
            QHeaderView.ResizeMode.ResizeToContents,
        )

        header.setSectionResizeMode(
            6,
            QHeaderView.ResizeMode.Interactive,
        )

        header.setSectionResizeMode(
            7,
            QHeaderView.ResizeMode.Interactive,
        )

        self.issue_table.setColumnWidth(
            3,
            165,
        )

        self.issue_table.setColumnWidth(
            6,
            140,
        )

        self.issue_table.setColumnWidth(
            7,
            175,
        )

        root_layout.addWidget(
            self.issue_table,
            stretch=1,
        )

        root_layout.addWidget(
            self._create_issue_detail_panel()
        )

        self.status_label = QLabel()

        self.status_label.setObjectName(
            "StatusLabel"
        )

        self.status_label.setWordWrap(
            True
        )

        root_layout.addWidget(
            self.status_label
        )

        footer_layout = QHBoxLayout()

        safety_label = QLabel(
            "Read-only: Library Clerk does not edit "
            "or save any workbook."
        )

        safety_label.setObjectName(
            "SafetyLabel"
        )

        footer_layout.addWidget(
            safety_label
        )

        footer_layout.addStretch()

        version_label = QLabel(
            f"Version {APP_VERSION}"
        )

        version_label.setObjectName(
            "MutedLabel"
        )

        footer_layout.addWidget(
            version_label
        )

        root_layout.addLayout(
            footer_layout
        )

        self.setCentralWidget(
            central_widget
        )

    def _create_directory_card(
        self,
    ) -> QFrame:
        """
        Create the shared-workbook folder card.
        """

        card = QFrame()

        card.setObjectName(
            "DirectoryCard"
        )

        card_layout = QVBoxLayout(
            card
        )

        card_layout.setContentsMargins(
            16,
            13,
            16,
            13,
        )

        heading_layout = QHBoxLayout()

        heading_label = QLabel(
            "Shared workbook folder"
        )

        heading_font = QFont()
        heading_font.setBold(
            True
        )

        heading_label.setFont(
            heading_font
        )

        heading_layout.addWidget(
            heading_label
        )

        heading_layout.addStretch()

        refresh_button = QPushButton(
            "Refresh files"
        )

        refresh_button.clicked.connect(
            self.refresh_workbook_sources
        )

        heading_layout.addWidget(
            refresh_button
        )

        open_folder_button = QPushButton(
            "Open folder"
        )

        open_folder_button.clicked.connect(
            self.open_workbook_directory
        )

        heading_layout.addWidget(
            open_folder_button
        )

        card_layout.addLayout(
            heading_layout
        )

        self.directory_path_label = QLabel(
            str(
                self.workbook_directory
            )
        )

        self.directory_path_label.setObjectName(
            "DirectoryPathLabel"
        )

        self.directory_path_label.setTextInteractionFlags(
            Qt.TextInteractionFlag.TextSelectableByMouse
        )

        card_layout.addWidget(
            self.directory_path_label
        )

        self.source_summary_label = QLabel()

        self.source_summary_label.setObjectName(
            "MutedLabel"
        )

        card_layout.addWidget(
            self.source_summary_label
        )

        return card

    def _create_summary_row(
        self,
    ) -> QHBoxLayout:
        """
        Create the scan-summary cards.
        """

        layout = QHBoxLayout()

        (
            books_card,
            self.books_value_label,
        ) = self._create_summary_card(
            "Books scanned"
        )

        (
            system_card,
            self.system_value_label,
        ) = self._create_summary_card(
            "System issues"
        )

        (
            clerical_card,
            self.clerical_value_label,
        ) = self._create_summary_card(
            "Active clerical issues"
        )

        (
            integrity_card,
            self.integrity_value_label,
        ) = self._create_summary_card(
            "Integrity"
        )

        for card in (
            books_card,
            system_card,
            clerical_card,
            integrity_card,
        ):
            layout.addWidget(
                card
            )

        return layout

    def _create_summary_card(
        self,
        label: str,
    ) -> tuple[
        QFrame,
        QLabel,
    ]:
        """
        Create one dashboard count card.
        """

        card = QFrame()

        card.setObjectName(
            "SummaryCard"
        )

        card_layout = QVBoxLayout(
            card
        )

        card_layout.setContentsMargins(
            14,
            10,
            14,
            10,
        )

        caption = QLabel(
            label
        )

        caption.setObjectName(
            "MutedLabel"
        )

        value_label = QLabel(
            "—"
        )

        value_label.setObjectName(
            "SummaryValue"
        )

        card_layout.addWidget(
            caption
        )

        card_layout.addWidget(
            value_label
        )

        return (
            card,
            value_label,
        )

    def _create_detail_value_label(
        self,
    ) -> QLabel:
        """
        Create a selectable, wrapping value label for the detail panel.
        """

        label = QLabel(
            "—"
        )

        label.setObjectName(
            "DetailValue"
        )

        label.setWordWrap(
            True
        )

        label.setTextInteractionFlags(
            Qt.TextInteractionFlag.TextSelectableByMouse
        )

        label.setSizePolicy(
            QSizePolicy.Policy.Expanding,
            QSizePolicy.Policy.Preferred,
        )

        return label

    def _create_issue_detail_panel(
        self,
    ) -> QFrame:
        """
        Create the friendly detail card for the selected issue.
        """

        panel = QFrame()

        panel.setObjectName(
            "IssueDetailCard"
        )

        panel.setMinimumHeight(
            260
        )

        panel_layout = QVBoxLayout(
            panel
        )

        panel_layout.setContentsMargins(
            18,
            15,
            18,
            15,
        )

        panel_layout.setSpacing(
            9
        )

        heading_layout = QHBoxLayout()

        self.detail_problem_label = QLabel(
            "Select an issue"
        )

        self.detail_problem_label.setObjectName(
            "IssueDetailHeading"
        )

        self.detail_problem_label.setWordWrap(
            True
        )

        heading_layout.addWidget(
            self.detail_problem_label,
            stretch=1,
        )

        self.detail_area_label = QLabel(
            "No selection"
        )

        self.detail_area_label.setObjectName(
            "IssueDetailBadge"
        )

        heading_layout.addWidget(
            self.detail_area_label,
            alignment=(
                Qt.AlignmentFlag.AlignTop
                | Qt.AlignmentFlag.AlignRight
            ),
        )

        panel_layout.addLayout(
            heading_layout
        )

        self.detail_message_label = QLabel(
            "Choose a row from the work queue to see "
            "exactly what needs attention."
        )

        self.detail_message_label.setObjectName(
            "IssueDetailMessage"
        )

        self.detail_message_label.setWordWrap(
            True
        )

        panel_layout.addWidget(
            self.detail_message_label
        )

        details_grid = QGridLayout()

        details_grid.setHorizontalSpacing(
            18
        )

        details_grid.setVerticalSpacing(
            5
        )

        details_grid.setColumnStretch(
            1,
            1,
        )

        details_grid.setColumnStretch(
            3,
            1,
        )

        self.detail_title_value = (
            self._create_detail_value_label()
        )

        self.detail_author_value = (
            self._create_detail_value_label()
        )

        self.detail_book_id_value = (
            self._create_detail_value_label()
        )

        self.detail_workbook_value = (
            self._create_detail_value_label()
        )

        self.detail_sheet_value = (
            self._create_detail_value_label()
        )

        self.detail_location_value = (
            self._create_detail_value_label()
        )

        def add_detail_field(
            caption_text: str,
            value_label: QLabel,
            row: int,
            caption_column: int,
            value_column: int,
            value_column_span: int = 1,
        ) -> None:
            caption = QLabel(
                caption_text
            )

            caption.setObjectName(
                "DetailCaption"
            )

            caption.setAlignment(
                Qt.AlignmentFlag.AlignTop
            )

            details_grid.addWidget(
                caption,
                row,
                caption_column,
                alignment=(
                    Qt.AlignmentFlag.AlignTop
                ),
            )

            details_grid.addWidget(
                value_label,
                row,
                value_column,
                1,
                value_column_span,
            )

        add_detail_field(
            "Title",
            self.detail_title_value,
            0,
            0,
            1,
        )

        add_detail_field(
            "Author",
            self.detail_author_value,
            0,
            2,
            3,
        )

        add_detail_field(
            "Book ID",
            self.detail_book_id_value,
            1,
            0,
            1,
            3,
        )

        add_detail_field(
            "Workbook",
            self.detail_workbook_value,
            2,
            0,
            1,
        )

        add_detail_field(
            "Sheet",
            self.detail_sheet_value,
            2,
            2,
            3,
        )

        add_detail_field(
            "Exact location",
            self.detail_location_value,
            3,
            0,
            1,
            3,
        )

        panel_layout.addLayout(
            details_grid
        )

        additional_caption = QLabel(
            "Additional details"
        )

        additional_caption.setObjectName(
            "DetailCaption"
        )

        panel_layout.addWidget(
            additional_caption
        )

        self.detail_additional_value = QLabel(
            "No issue selected."
        )

        self.detail_additional_value.setObjectName(
            "DetailAdditionalValue"
        )

        self.detail_additional_value.setWordWrap(
            True
        )

        self.detail_additional_value.setTextInteractionFlags(
            Qt.TextInteractionFlag.TextSelectableByMouse
        )

        self.detail_additional_value.setSizePolicy(
            QSizePolicy.Policy.Expanding,
            QSizePolicy.Policy.MinimumExpanding,
        )

        self.detail_additional_value.setMinimumHeight(
            48
        )

        panel_layout.addWidget(
            self.detail_additional_value
        )

        action_layout = QHBoxLayout()

        action_layout.setSpacing(
            10
        )

        self.detail_target_hint_label = QLabel(
            "Choose an issue with an exact workbook cell."
        )

        self.detail_target_hint_label.setObjectName(
            "DetailTargetHint"
        )

        self.detail_target_hint_label.setWordWrap(
            True
        )

        self.detail_target_hint_label.setAlignment(
            (
                Qt.AlignmentFlag.AlignLeft
                | Qt.AlignmentFlag.AlignVCenter
            )
        )

        action_layout.addWidget(
            self.detail_target_hint_label,
            stretch=1,
        )

        self.detail_exception_button = QPushButton(
            "Mark as intentional exception"
        )

        self.detail_exception_button.setObjectName(
            "ExceptionActionButton"
        )

        self.detail_exception_button.setMinimumSize(
            220,
            44,
        )

        self.detail_exception_button.setEnabled(
            False
        )

        self.detail_exception_button.clicked.connect(
            self._handle_exception_action
        )

        action_layout.addWidget(
            self.detail_exception_button
        )

        self.detail_open_excel_button = QPushButton(
            "Open in Excel"
        )

        self.detail_open_excel_button.setObjectName(
            "DetailOpenButton"
        )

        self.detail_open_excel_button.setMinimumSize(
            220,
            48,
        )

        self.detail_open_excel_button.setEnabled(
            False
        )

        self.detail_open_excel_button.setToolTip(
            "Open the correct workbook and select "
            "the exact cell for this issue."
        )

        self.detail_open_excel_button.clicked.connect(
            self.open_selected_issue_in_excel
        )

        action_layout.addWidget(
            self.detail_open_excel_button
        )

        panel_layout.addLayout(
            action_layout
        )

        return panel

    def _reload_saved_exceptions(
        self,
    ) -> str:
        """
        Reload the shared exception file.

        Return an error message when the file could not be read.
        """

        self.exceptions_path = (
            get_exceptions_path(
                self.workbook_directory
            )
        )

        try:
            self.saved_exceptions = (
                load_exceptions(
                    self.exceptions_path
                )
            )

        except ExceptionStoreError as error:
            self.saved_exceptions = []

            return str(
                error
            )

        return ""

    def _exception_lookup(
        self,
    ) -> dict[
        str,
        LibraryException,
    ]:
        """
        Return saved exceptions indexed by stable exception key.
        """

        return {
            exception.exception_key: exception
            for exception in self.saved_exceptions
        }

    def _current_issue_lookup(
        self,
    ) -> dict[
        str,
        ScanIssue,
    ]:
        """
        Return currently scanned issues indexed by exception key.
        """

        if self.scan_result is None:
            return {}

        return {
            issue.exception_key: issue
            for issue in self.scan_result.issues
            if issue.exception_key
        }

    def _active_issues(
        self,
    ) -> list[ScanIssue]:
        """
        Return scan findings that are not intentionally excepted.
        """

        if self.scan_result is None:
            return []

        exception_keys = set(
            self._exception_lookup()
        )

        return [
            issue
            for issue in self.scan_result.issues
            if not (
                issue.is_exception_eligible
                and issue.exception_key
                in exception_keys
            )
        ]

    def _active_clerical_issue_count(
        self,
    ) -> int:
        """
        Return the number of active clerical findings.
        """

        return sum(
            1
            for issue in self._active_issues()
            if issue.area == "Clerical"
        )

    def _update_summary_counts(
        self,
    ) -> None:
        """
        Refresh scan-summary cards using active issue counts.
        """

        if self.scan_result is None:
            return

        self.books_value_label.setText(
            str(
                self.scan_result.books_scanned
            )
        )

        self.system_value_label.setText(
            str(
                self.scan_result
                .system_issue_count
            )
        )

        self.clerical_value_label.setText(
            str(
                self._active_clerical_issue_count()
            )
        )

        self.integrity_value_label.setText(
            (
                "PASS"
                if self.scan_result.integrity_passed
                else "CHECK"
            )
        )

    def _friendly_issue_name(
        self,
        issue_code: str,
    ) -> str:
        """
        Return a friendly label for one stable issue code.
        """

        cleaned_issue_code = (
            issue_code
            .strip()
            .casefold()
        )

        known_label = ISSUE_CODE_LABELS.get(
            cleaned_issue_code
        )

        if known_label:
            return known_label

        if not cleaned_issue_code:
            return "Saved exception"

        return (
            cleaned_issue_code
            .replace(
                "-",
                " ",
            )
            .title()
        )

    def _format_exception_created_at(
        self,
        created_at: str,
    ) -> str:
        """
        Format an exception timestamp for friendly display.
        """

        cleaned_created_at = (
            created_at.strip()
        )

        if not cleaned_created_at:
            return ""

        try:
            created_datetime = (
                datetime.fromisoformat(
                    cleaned_created_at
                )
            )

        except ValueError:
            return cleaned_created_at

        date_label = (
            created_datetime.strftime(
                "%b %d, %Y"
            )
        )

        time_label = (
            created_datetime.strftime(
                "%I:%M %p"
            )
            .lstrip(
                "0"
            )
        )

        return (
            f"{date_label} at "
            f"{time_label}"
        )
    
    def refresh_workbook_sources(
        self,
    ) -> None:
        """
        Refresh workbook files and shared Library Clerk data.
        """

        self.workbook_directory = (
            get_workbook_directory()
        )

        self.directory_path_label.setText(
            str(
                self.workbook_directory
            )
        )

        self.workbook_paths = list_workbooks(
            self.workbook_directory
        )

        exception_error = (
            self._reload_saved_exceptions()
        )

        workbook_names = ", ".join(
            path.name
            for path in self.workbook_paths
        )

        if self.scan_result is not None:
            self._update_summary_counts()
            self.apply_issue_filters()

        if self.workbook_paths:
            self.source_summary_label.setText(
                (
                    f"Found {len(self.workbook_paths)} "
                    f"workbook file"
                    f"{'' if len(self.workbook_paths) == 1 else 's'}: "
                    f"{workbook_names}"
                )
            )

            self.scan_button.setEnabled(
                True
            )

            if exception_error:
                self._set_status(
                    (
                        "Workbook files are ready, but the "
                        "shared exception list could not be "
                        "loaded. No issues will be suppressed. "
                        + exception_error.replace(
                            "\n",
                            " ",
                        )
                    ),
                    "error",
                )

            else:
                self._set_status(
                    (
                        "Workbook files are ready. "
                        f"Loaded {len(self.saved_exceptions)} "
                        "intentional exception"
                        f"{'' if len(self.saved_exceptions) == 1 else 's'}. "
                        "Press Scan workbooks to build "
                        "the clerical queue."
                    ),
                    "success",
                )

        else:
            self.source_summary_label.setText(
                "No supported workbook files were found."
            )

            self.scan_button.setEnabled(
                False
            )

            self._set_status(
                (
                    "Library Clerk could not find any "
                    ".xlsx or .xlsm files in the "
                    "shared workbook folder."
                ),
                "error",
            )

    def start_scan(
        self,
    ) -> None:
        """
        Begin a read-only workbook scan.
        """

        if self.scan_thread is not None:
            return

        self.refresh_workbook_sources()

        if not self.workbook_paths:
            return

        self.scan_button.setEnabled(
            False
        )

        self.scan_progress.show()

        self.issue_table.setRowCount(
            0
        )

        self.books_value_label.setText(
            "…"
        )

        self.system_value_label.setText(
            "…"
        )

        self.clerical_value_label.setText(
            "…"
        )

        self.integrity_value_label.setText(
            "Scanning"
        )

        self._set_status(
            (
                "Beginning read-only workbook scan. "
                "The large embedded-cover workbook "
                "may take a little while."
            ),
            "warning",
        )

        self.scan_thread = QThread()

        self.scan_worker = ScanWorker(
            self.workbook_paths
        )

        self.scan_worker.moveToThread(
            self.scan_thread
        )

        self.scan_thread.started.connect(
            self.scan_worker.run
        )

        self.scan_worker.progress.connect(
            self._handle_scan_progress
        )

        self.scan_worker.finished.connect(
            self._handle_scan_finished
        )

        self.scan_worker.failed.connect(
            self._handle_scan_failed
        )

        self.scan_worker.finished.connect(
            self.scan_thread.quit
        )

        self.scan_worker.failed.connect(
            self.scan_thread.quit
        )

        self.scan_worker.finished.connect(
            self.scan_worker.deleteLater
        )

        self.scan_worker.failed.connect(
            self.scan_worker.deleteLater
        )

        self.scan_thread.finished.connect(
            self.scan_thread.deleteLater
        )

        self.scan_thread.finished.connect(
            self._handle_scan_thread_finished
        )

        self.scan_thread.start()

    def _handle_scan_progress(
        self,
        message: str,
    ) -> None:
        """
        Display scanner progress.
        """

        self._set_status(
            message,
            "warning",
        )

    def _handle_scan_finished(
        self,
        result: ScanResult,
    ) -> None:
        """
        Display a completed workbook scan.
        """

        self.scan_result = result

        exception_error = (
            self._reload_saved_exceptions()
        )

        self._update_summary_counts()

        self.last_scan_label.setText(
            (
                f"Completed in "
                f"{result.duration_seconds:.1f} seconds"
            )
        )

        self.apply_issue_filters()

        if result.list_view_workbook is None:
            source_label = (
                "List View could not be identified."
            )

        else:
            source_label = (
                f"Using "
                f"{result.list_view_workbook.name}"
                f" → {result.list_view_sheet}."
            )

        active_clerical_count = (
            self._active_clerical_issue_count()
        )

        status_parts = [
            source_label,
            (
                f"Found "
                f"{result.system_issue_count} "
                f"system issue"
                f"{'' if result.system_issue_count == 1 else 's'} "
                f"and "
                f"{active_clerical_count} "
                f"active clerical issue"
                f"{'' if active_clerical_count == 1 else 's'}."
            ),
            (
                f"Loaded "
                f"{len(self.saved_exceptions)} "
                f"intentional exception"
                f"{'' if len(self.saved_exceptions) == 1 else 's'}."
            ),
        ]

        if result.additional_data_headers:
            status_parts.append(
                (
                    "Additional clerical columns "
                    "were detected safely: "
                    + ", ".join(
                        result.additional_data_headers
                    )
                    + "."
                )
            )

        if result.warnings:
            status_parts.append(
                (
                    f"{len(result.warnings)} "
                    "workbook warning"
                    f"{'' if len(result.warnings) == 1 else 's'} "
                    "was recorded."
                )
            )

        if exception_error:
            status_parts.append(
                (
                    "The shared exception list could "
                    "not be loaded, so no findings were "
                    "suppressed. "
                    + exception_error.replace(
                        "\n",
                        " ",
                    )
                )
            )

        self._set_status(
            " ".join(
                status_parts
            ),
            (
                "error"
                if (
                    not result.integrity_passed
                    or bool(
                        exception_error
                    )
                )
                else "success"
            ),
        )

    def _handle_scan_failed(
        self,
        message: str,
    ) -> None:
        """
        Display an unexpected scanner failure.
        """

        self.books_value_label.setText(
            "—"
        )

        self.system_value_label.setText(
            "—"
        )

        self.clerical_value_label.setText(
            "—"
        )

        self.integrity_value_label.setText(
            "ERROR"
        )

        self._set_status(
            (
                "The workbook scan stopped unexpectedly: "
                f"{message}"
            ),
            "error",
        )

    def _handle_scan_thread_finished(
        self,
    ) -> None:
        """
        Restore the interface after the worker thread exits.
        """

        self.scan_progress.hide()

        self.scan_button.setEnabled(
            bool(
                self.workbook_paths
            )
        )

        self.scan_worker = None
        self.scan_thread = None

    def apply_issue_filters(
        self,
    ) -> None:
        """
        Apply search and queue-area filters.
        """

        search_text = (
            self.search_box.text()
            .strip()
            .casefold()
        )

        selected_area = (
            self.area_filter.currentText()
        )

        visible_entries: list[
            IssueQueueEntry
        ] = []

        if selected_area == "Exceptions":
            current_issue_lookup = (
                self._current_issue_lookup()
            )

            for exception in self.saved_exceptions:
                current_issue = (
                    current_issue_lookup.get(
                        exception.exception_key
                    )
                )

                workbook_name = (
                    current_issue.workbook_path.name
                    if (
                        current_issue is not None
                        and current_issue.workbook_path
                        is not None
                    )
                    else ""
                )

                searchable_parts = [
                    "exception",
                    exception.issue_code,
                    self._friendly_issue_name(
                        exception.issue_code
                    ),
                    exception.reason,
                    exception.note,
                    exception.title,
                    exception.author,
                    exception.book_id,
                    exception.created_at,
                    workbook_name,
                ]

                if current_issue is not None:
                    searchable_parts.extend(
                        [
                            current_issue.area,
                            current_issue.category,
                            current_issue.message,
                            current_issue.column_name,
                            current_issue.sheet_name,
                            (
                                str(
                                    current_issue.row_number
                                )
                                if current_issue.row_number
                                is not None
                                else ""
                            ),
                            current_issue.details,
                        ]
                    )

                searchable_text = " ".join(
                    searchable_parts
                ).casefold()

                if (
                    search_text
                    and search_text
                    not in searchable_text
                ):
                    continue

                visible_entries.append(
                    IssueQueueEntry(
                        issue=current_issue,
                        exception=exception,
                    )
                )

        else:
            if self.scan_result is None:
                self.visible_queue_entries = []
                self._populate_issue_table(
                    []
                )

                return

            for issue in self._active_issues():
                if (
                    selected_area
                    != "All active issues"
                    and issue.area
                    != selected_area
                ):
                    continue

                workbook_name = (
                    issue.workbook_path.name
                    if issue.workbook_path
                    is not None
                    else ""
                )

                searchable_text = " ".join(
                    [
                        issue.area,
                        issue.category,
                        issue.issue_code,
                        issue.message,
                        issue.title,
                        issue.author,
                        issue.column_name,
                        issue.book_id,
                        workbook_name,
                        issue.sheet_name,
                        (
                            str(
                                issue.row_number
                            )
                            if issue.row_number
                            is not None
                            else ""
                        ),
                        issue.details,
                    ]
                ).casefold()

                if (
                    search_text
                    and search_text
                    not in searchable_text
                ):
                    continue

                visible_entries.append(
                    IssueQueueEntry(
                        issue=issue
                    )
                )

        self.visible_queue_entries = (
            visible_entries
        )

        self._populate_issue_table(
            visible_entries
        )

    def _populate_issue_table(
        self,
        entries: list[
            IssueQueueEntry
        ],
    ) -> None:
        """
        Display active issues or saved exceptions in the work queue.

        Each visible row stores its complete IssueQueueEntry so sorting
        cannot disconnect the row from its issue or exception record.
        """

        self.issue_table.setSortingEnabled(
            False
        )

        self.issue_table.clearSelection()

        self.issue_table.setRowCount(
            len(
                entries
            )
        )

        for row_index, entry in enumerate(
            entries
        ):
            issue = entry.issue
            exception = entry.exception

            if exception is not None:
                workbook_name = (
                    issue.workbook_path.name
                    if (
                        issue is not None
                        and issue.workbook_path
                        is not None
                    )
                    else "—"
                )

                problem_label = (
                    issue.category
                    if issue is not None
                    else self._friendly_issue_name(
                        exception.issue_code
                    )
                )

                title_label = (
                    exception.title
                    or (
                        issue.title
                        if issue is not None
                        else ""
                    )
                    or "—"
                )

                author_label = (
                    exception.author
                    or (
                        issue.author
                        if issue is not None
                        else ""
                    )
                    or "—"
                )

                field_label = (
                    issue.column_name
                    if issue is not None
                    and issue.column_name
                    else self._friendly_issue_name(
                        exception.issue_code
                    )
                )

                row_label = (
                    str(
                        issue.row_number
                    )
                    if (
                        issue is not None
                        and issue.row_number
                        is not None
                    )
                    else "Resolved"
                )

                values = (
                    "Exception",
                    problem_label,
                    title_label,
                    author_label,
                    field_label,
                    row_label,
                    workbook_name,
                    exception.book_id or "—",
                )

                tooltip_parts = [
                    (
                        "Intentional exception: "
                        f"{exception.reason}"
                    )
                ]

                if exception.note:
                    tooltip_parts.append(
                        exception.note
                    )

                if exception.created_at:
                    tooltip_parts.append(
                        (
                            "Saved "
                            + self._format_exception_created_at(
                                exception.created_at
                            )
                        )
                    )

                if issue is None:
                    tooltip_parts.append(
                        (
                            "The original issue is no longer "
                            "active in the current workbook scan."
                        )
                    )

            else:
                assert issue is not None

                workbook_name = (
                    issue.workbook_path.name
                    if issue.workbook_path
                    is not None
                    else "—"
                )

                values = (
                    issue.area,
                    issue.category,
                    issue.title or "—",
                    issue.author or "—",
                    issue.column_name or "—",
                    (
                        str(
                            issue.row_number
                        )
                        if issue.row_number
                        is not None
                        else "—"
                    ),
                    workbook_name,
                    issue.book_id or "—",
                )

                tooltip_parts = [
                    issue.message
                ]

                if issue.details:
                    tooltip_parts.append(
                        issue.details
                    )

            tooltip = "\n\n".join(
                tooltip_parts
            )

            for column_index, value in enumerate(
                values
            ):
                item = QTableWidgetItem(
                    value
                )

                item.setToolTip(
                    tooltip
                )

                if column_index == 0:
                    item.setData(
                        Qt.ItemDataRole.UserRole,
                        entry,
                    )

                self.issue_table.setItem(
                    row_index,
                    column_index,
                    item,
                )

        self.issue_table.setSortingEnabled(
            True
        )

        self._update_issue_detail_panel()

    def _get_selected_queue_entry(
        self,
    ) -> IssueQueueEntry | None:
        """
        Return the complete queue entry attached to the selected row.
        """

        selected_rows = (
            self.issue_table
            .selectionModel()
            .selectedRows()
        )

        if not selected_rows:
            return None

        selected_row = (
            selected_rows[0].row()
        )

        entry_item = self.issue_table.item(
            selected_row,
            0,
        )

        if entry_item is None:
            return None

        entry = entry_item.data(
            Qt.ItemDataRole.UserRole
        )

        if not isinstance(
            entry,
            IssueQueueEntry,
        ):
            return None

        return entry

    def _get_selected_issue(
        self,
    ) -> ScanIssue | None:
        """
        Return the current issue attached to the selected queue row.
        """

        entry = (
            self._get_selected_queue_entry()
        )

        if entry is None:
            return None

        return entry.issue

    def _get_selected_exception(
        self,
    ) -> LibraryException | None:
        """
        Return the saved exception attached to the selected queue row.
        """

        entry = (
            self._get_selected_queue_entry()
        )

        if entry is None:
            return None

        return entry.exception

    def _issue_has_excel_target(
        self,
        issue: ScanIssue | None,
    ) -> bool:
        """
        Return True when an issue points to one exact workbook cell.
        """

        if issue is None:
            return False

        return (
            issue.workbook_path is not None
            and bool(
                issue.sheet_name
            )
            and issue.row_number is not None
            and issue.column_number is not None
            and issue.row_number > 0
            and issue.column_number > 0
        )

    def _format_issue_location(
        self,
        issue: ScanIssue,
    ) -> str:
        """
        Build a friendly exact-cell description for one issue.
        """

        row_number = issue.row_number
        column_number = issue.column_number

        column_name = (
            issue.column_name.strip()
            if issue.column_name
            else ""
        )

        if (
            row_number is not None
            and row_number > 0
            and column_number is not None
            and column_number > 0
        ):
            cell_reference = (
                f"{get_column_letter(column_number)}"
                f"{row_number}"
            )

            if column_name:
                return (
                    f"{cell_reference} — "
                    f"{column_name} column, "
                    f"row {row_number}"
                )

            return (
                f"{cell_reference} — "
                f"row {row_number}, "
                f"column {column_number}"
            )

        if (
            row_number is not None
            and row_number > 0
        ):
            return (
                f"Row {row_number}"
            )

        if (
            column_number is not None
            and column_number > 0
        ):
            if column_name:
                return (
                    f"{column_name} column "
                    f"(column {column_number})"
                )

            return (
                f"Column {column_number}"
            )

        return (
            "No exact cell target was recorded."
        )

    def _update_issue_detail_panel(
        self,
    ) -> None:
        """
        Show the complete issue or exception attached to the selected row.
        """

        entry = (
            self._get_selected_queue_entry()
        )

        if entry is None:
            self.detail_problem_label.setText(
                "Select an issue"
            )

            self.detail_area_label.setText(
                "No selection"
            )

            self.detail_message_label.setText(
                "Choose a row from the work queue to see "
                "exactly what needs attention."
            )

            self.detail_title_value.setText(
                "—"
            )

            self.detail_author_value.setText(
                "—"
            )

            self.detail_book_id_value.setText(
                "—"
            )

            self.detail_workbook_value.setText(
                "—"
            )

            self.detail_sheet_value.setText(
                "—"
            )

            self.detail_location_value.setText(
                "—"
            )

            self.detail_additional_value.setText(
                "No issue selected."
            )

            self.detail_open_excel_button.setEnabled(
                False
            )

            self.detail_exception_button.setText(
                "Mark as intentional exception"
            )

            self.detail_exception_button.setEnabled(
                False
            )

            self.detail_target_hint_label.setText(
                "Choose an issue with an exact workbook cell."
            )

            return

        issue = entry.issue
        exception = entry.exception

        if exception is not None:
            self.detail_problem_label.setText(
                (
                    issue.category
                    if issue is not None
                    else self._friendly_issue_name(
                        exception.issue_code
                    )
                )
            )

            self.detail_area_label.setText(
                "Intentional exception"
            )

            self.detail_message_label.setText(
                exception.reason
            )

            self.detail_title_value.setText(
                (
                    exception.title
                    or (
                        issue.title
                        if issue is not None
                        else ""
                    )
                    or "Not available"
                )
            )

            self.detail_author_value.setText(
                (
                    exception.author
                    or (
                        issue.author
                        if issue is not None
                        else ""
                    )
                    or "Not available"
                )
            )

            self.detail_book_id_value.setText(
                exception.book_id
                or "Not available"
            )

            if issue is not None:
                workbook_name = (
                    issue.workbook_path.name
                    if issue.workbook_path
                    is not None
                    else "Not available"
                )

                self.detail_workbook_value.setText(
                    workbook_name
                )

                self.detail_sheet_value.setText(
                    issue.sheet_name
                    or "Not available"
                )

                self.detail_location_value.setText(
                    self._format_issue_location(
                        issue
                    )
                )

            else:
                self.detail_workbook_value.setText(
                    "No active workbook issue"
                )

                self.detail_sheet_value.setText(
                    "—"
                )

                self.detail_location_value.setText(
                    (
                        "The original issue no longer "
                        "appears in the current scan."
                    )
                )

            additional_parts = []

            if exception.note:
                additional_parts.append(
                    exception.note
                )

            else:
                additional_parts.append(
                    "No research note was recorded."
                )

            formatted_created_at = (
                self._format_exception_created_at(
                    exception.created_at
                )
            )

            if formatted_created_at:
                additional_parts.append(
                    (
                        "Exception saved "
                        f"{formatted_created_at}."
                    )
                )

            self.detail_additional_value.setText(
                "\n\n".join(
                    additional_parts
                )
            )

            has_excel_target = (
                self._issue_has_excel_target(
                    issue
                )
            )

            self.detail_open_excel_button.setEnabled(
                has_excel_target
            )

            self.detail_exception_button.setText(
                "Restore issue"
            )

            self.detail_exception_button.setEnabled(
                True
            )

            if has_excel_target:
                assert issue is not None

                self.detail_target_hint_label.setText(
                    (
                        "This exception still matches an "
                        "active workbook issue. You can open "
                        "its current cell or restore it."
                    )
                )

            else:
                self.detail_target_hint_label.setText(
                    (
                        "This issue no longer appears in the "
                        "current workbook scan, but the saved "
                        "exception can still be removed."
                    )
                )

            return

        assert issue is not None

        workbook_name = (
            issue.workbook_path.name
            if issue.workbook_path is not None
            else "Not available"
        )

        self.detail_problem_label.setText(
            issue.category
            or "Workbook issue"
        )

        self.detail_area_label.setText(
            issue.area
            or "Issue"
        )

        self.detail_message_label.setText(
            issue.message
            or "This record needs attention."
        )

        self.detail_title_value.setText(
            issue.title
            or "Not available"
        )

        self.detail_author_value.setText(
            issue.author
            or "Not available"
        )

        self.detail_book_id_value.setText(
            issue.book_id
            or "Not available"
        )

        self.detail_workbook_value.setText(
            workbook_name
        )

        self.detail_sheet_value.setText(
            issue.sheet_name
            or "Not available"
        )

        self.detail_location_value.setText(
            self._format_issue_location(
                issue
            )
        )

        self.detail_additional_value.setText(
            issue.details.strip()
            if (
                issue.details
                and issue.details.strip()
            )
            else "No additional details were recorded."
        )

        has_excel_target = (
            self._issue_has_excel_target(
                issue
            )
        )

        self.detail_open_excel_button.setEnabled(
            has_excel_target
        )

        self.detail_exception_button.setText(
            "Mark as intentional exception"
        )

        self.detail_exception_button.setEnabled(
            issue.is_exception_eligible
        )

        if has_excel_target:
            self.detail_target_hint_label.setText(
                (
                    f"Open {workbook_name} at "
                    f"{self._format_issue_location(issue)}."
                )
            )

        else:
            self.detail_target_hint_label.setText(
                "This issue does not point to one exact cell."
            )

    def _handle_exception_action(
        self,
    ) -> None:
        """
        Mark the selected issue or restore the selected exception.
        """

        selected_exception = (
            self._get_selected_exception()
        )

        if selected_exception is not None:
            self._restore_selected_exception()

            return

        self._mark_selected_issue_as_exception()

    def _mark_selected_issue_as_exception(
        self,
    ) -> None:
        """
        Save the selected clerical issue as an intentional exception.
        """

        issue = self._get_selected_issue()

        if (
            issue is None
            or not issue.is_exception_eligible
        ):
            QMessageBox.information(
                self,
                "Exception unavailable",
                (
                    "This finding cannot be saved as an "
                    "intentional exception. Only clerical "
                    "issues with a valid permanent Book ID "
                    "and stable issue code are eligible."
                ),
            )

            return

        dialog = ExceptionDialog(
            issue,
            self,
        )

        if not dialog.exec():
            return

        try:
            exception = (
                create_exception_from_issue(
                    issue=issue,
                    reason=(
                        dialog.selected_reason()
                    ),
                    note=(
                        dialog.research_note()
                    ),
                )
            )

            self.saved_exceptions = (
                upsert_exception(
                    self.exceptions_path,
                    exception,
                )
            )

        except ExceptionStoreError as error:
            QMessageBox.critical(
                self,
                "Could not save exception",
                str(
                    error
                ),
            )

            self._set_status(
                (
                    "The intentional exception could "
                    f"not be saved. {error}"
                ),
                "error",
            )

            return

        self._update_summary_counts()
        self.apply_issue_filters()

        self._set_status(
            (
                f"Saved “{issue.category}” as an "
                f"intentional exception for "
                f"{issue.title or issue.book_id}."
            ),
            "success",
        )

    def _restore_selected_exception(
        self,
    ) -> None:
        """
        Remove the selected saved exception.
        """

        exception = (
            self._get_selected_exception()
        )

        if exception is None:
            return

        title_label = (
            exception.title
            or exception.book_id
        )

        answer = QMessageBox.question(
            self,
            "Restore issue",
            (
                "Remove this intentional exception?\n\n"
                f"{title_label}\n"
                f"{self._friendly_issue_name(exception.issue_code)}\n\n"
                "If the underlying workbook value is still "
                "missing, the issue will return to the active "
                "clerical queue."
            ),
            (
                QMessageBox.StandardButton.Yes
                | QMessageBox.StandardButton.No
            ),
            QMessageBox.StandardButton.No,
        )

        if (
            answer
            != QMessageBox.StandardButton.Yes
        ):
            return

        try:
            (
                removed,
                self.saved_exceptions,
            ) = remove_exception(
                exceptions_path=(
                    self.exceptions_path
                ),
                book_id=(
                    exception.book_id
                ),
                issue_code=(
                    exception.issue_code
                ),
            )

        except ExceptionStoreError as error:
            QMessageBox.critical(
                self,
                "Could not restore issue",
                str(
                    error
                ),
            )

            self._set_status(
                (
                    "The intentional exception could "
                    f"not be removed. {error}"
                ),
                "error",
            )

            return

        if not removed:
            QMessageBox.information(
                self,
                "Exception already removed",
                (
                    "That exception is no longer present "
                    "in the shared exception file."
                ),
            )

        self._update_summary_counts()
        self.apply_issue_filters()

        self._set_status(
            (
                f"Restored "
                f"{self._friendly_issue_name(exception.issue_code)} "
                f"for {title_label}."
            ),
            "success",
        )

    def _handle_issue_double_click(
        self,
        _row_number: int,
        _column_number: int,
    ) -> None:
        """
        Open a double-clicked issue when it has an Excel target.
        """

        issue = self._get_selected_issue()

        if not self._issue_has_excel_target(
            issue
        ):
            return

        self.open_selected_issue_in_excel()

    def open_selected_issue_in_excel(
        self,
    ) -> None:
        """
        Open the selected issue's exact workbook cell in Excel.
        """

        issue = self._get_selected_issue()

        if not self._issue_has_excel_target(
            issue
        ):
            QMessageBox.information(
                self,
                "No exact cell available",
                (
                    "This issue does not point to one exact "
                    "workbook cell."
                ),
            )

            return

        assert issue is not None
        assert issue.workbook_path is not None
        assert issue.row_number is not None
        assert issue.column_number is not None

        try:
            self.excel_application = open_excel_cell(
                workbook_path=(
                    issue.workbook_path
                ),
                sheet_name=(
                    issue.sheet_name
                ),
                row_number=(
                    issue.row_number
                ),
                column_number=(
                    issue.column_number
                ),
            )

        except ExcelNavigationError as error:
            QMessageBox.critical(
                self,
                "Could not open Excel cell",
                str(
                    error
                ),
            )

            self._set_status(
                (
                    "Excel navigation failed. "
                    f"{error}"
                ),
                "error",
            )

            return

        title_label = (
            issue.title
            or "the selected record"
        )

        self._set_status(
            (
                f"Opened {issue.workbook_path.name}"
                f" → {issue.sheet_name}"
                f" → row {issue.row_number}, "
                f"{issue.column_name} "
                f"for {title_label}."
            ),
            "success",
        )

    def open_workbook_directory(
        self,
    ) -> None:
        """
        Open the shared workbook folder in File Explorer.
        """

        if not self.workbook_directory.exists():
            QMessageBox.warning(
                self,
                "Folder not found",
                (
                    "The shared workbook folder does not "
                    "currently exist:\n\n"
                    f"{self.workbook_directory}"
                ),
            )

            return

        try:
            os.startfile(
                self.workbook_directory
            )

        except OSError as error:
            QMessageBox.critical(
                self,
                "Could not open folder",
                (
                    "Library Clerk could not open the "
                    "shared workbook folder.\n\n"
                    f"{error}"
                ),
            )

    def _set_status(
        self,
        message: str,
        status_type: str,
    ) -> None:
        """
        Update the status banner and its visual state.
        """

        self.status_label.setText(
            message
        )

        self.status_label.setProperty(
            "statusType",
            status_type,
        )

        style = self.status_label.style()

        style.unpolish(
            self.status_label
        )

        style.polish(
            self.status_label
        )

        self.status_label.update()

    def _apply_styles(
        self,
    ) -> None:
        """
        Apply Library Clerk styling.
        """

        self.setStyleSheet(
            """
            QMainWindow {
                background: #f7f4ef;
            }

            QWidget {
                color: #27231f;
                font-family: "Segoe UI";
                font-size: 10.5pt;
            }

            QLabel#SubtitleLabel {
                color: #665f57;
                font-size: 11pt;
            }

            QLabel#MutedLabel {
                color: #746d65;
                font-size: 9.5pt;
            }

            QLabel#SummaryValue {
                font-size: 17pt;
                font-weight: 700;
            }

            QFrame#DirectoryCard,
            QFrame#SummaryCard,
            QFrame#IssueDetailCard {
                background: #fffdf9;
                border: 1px solid #ddd5ca;
                border-radius: 10px;
            }

            QFrame#IssueDetailCard {
                border-color: #cfc5e2;
            }

            QLabel#DirectoryPathLabel {
                color: #514a43;
                font-family: "Consolas";
                font-size: 9.5pt;
            }

            QLabel#IssueDetailHeading {
                font-size: 15pt;
                font-weight: 700;
            }

            QLabel#IssueDetailBadge {
                background: #eee8df;
                border: 1px solid #d5cbbf;
                border-radius: 9px;
                color: #5d554d;
                font-size: 9pt;
                font-weight: 700;
                padding: 3px 9px;
            }

            QLabel#IssueDetailMessage {
                color: #4f4841;
                font-size: 10.5pt;
            }

            QLabel#DetailCaption {
                color: #746d65;
                font-size: 9pt;
                font-weight: 700;
            }

            QLabel#DetailValue {
                color: #302b26;
            }

            QLabel#DetailAdditionalValue {
                background: #f8f4ee;
                border-radius: 7px;
                color: #4f4841;
                padding: 7px 10px;
            }

            QLabel#DetailTargetHint {
                color: #746d65;
                font-size: 9pt;
                padding-right: 8px;
            }

            QLabel#ExceptionDialogTitle {
                font-size: 16pt;
                font-weight: 700;
            }

            QLabel#ExceptionDialogBook {
                color: #4e4567;
                font-size: 11pt;
                font-weight: 700;
            }

            QLabel#ExceptionDialogExplanation {
                color: #665f57;
            }

            QLineEdit,
            QComboBox,
            QPlainTextEdit {
                background: #fffdf9;
                border: 1px solid #d1c8bd;
                border-radius: 7px;
                color: #27231f;
                padding: 7px 9px;
                selection-background-color: #dcd4f3;
                selection-color: #27231f;
            }

            QLineEdit:disabled,
            QComboBox:disabled,
            QPlainTextEdit:disabled {
                background: #eeeae4;
                color: #9a9289;
            }

            QTableWidget {
                background: #fffdf9;
                alternate-background-color: #f8f4ee;
                border: 1px solid #d8d0c6;
                border-radius: 8px;
                gridline-color: #e5ded5;
                outline: none;
            }

            QTableWidget::item:selected {
                background: #dcd4f3;
                color: #27231f;
            }

            QHeaderView::section {
                background: #eee8df;
                border: none;
                border-right: 1px solid #d8d0c6;
                border-bottom: 1px solid #d8d0c6;
                padding: 7px;
                font-weight: 700;
            }

            QPushButton {
                background: #eee8df;
                border: 1px solid #cfc5b8;
                border-radius: 7px;
                padding: 7px 13px;
                font-weight: 600;
            }

            QPushButton:hover {
                background: #e5ddd2;
            }

            QPushButton:pressed {
                background: #d8cec1;
            }

            QPushButton:disabled {
                background: #eeeae4;
                border-color: #d9d2c9;
                color: #9a9289;
            }

            QPushButton#PrimaryButton {
                background: #dcd4f3;
                border-color: #bdb2df;
                padding-left: 18px;
                padding-right: 18px;
            }

            QPushButton#PrimaryButton:hover {
                background: #d0c6ef;
            }

            QPushButton#DetailOpenButton {
                background: #7662b4;
                border-color: #6552a4;
                color: #ffffff;
                font-size: 11pt;
                font-weight: 700;
                padding: 12px 20px;
            }

            QPushButton#DetailOpenButton:hover {
                background: #6955aa;
            }

            QPushButton#DetailOpenButton:pressed {
                background: #5c4998;
            }

            QPushButton#DetailOpenButton:disabled {
                background: #d9d2e5;
                border-color: #ccc3da;
                color: #8a8295;
            }

            QPushButton#ExceptionActionButton {
                background: #f4efe7;
                border-color: #cfc5b8;
                color: #4f4841;
                padding: 9px 14px;
            }

            QPushButton#ExceptionActionButton:hover {
                background: #e9e1d6;
            }

            QPushButton#ExceptionActionButton:pressed {
                background: #ddd3c6;
            }

            QPushButton#ExceptionActionButton:disabled {
                background: #eeeae4;
                border-color: #d9d2c9;
                color: #9a9289;
            }

            QDialog#ExceptionDialog {
                background: #f7f4ef;
            }

            QLabel#StatusLabel {
                padding: 10px 12px;
                border-radius: 7px;
            }

            QLabel#StatusLabel[statusType="success"] {
                background: #e8f2e7;
                color: #28542b;
            }

            QLabel#StatusLabel[statusType="warning"] {
                background: #fff2d5;
                color: #765616;
            }

            QLabel#StatusLabel[statusType="error"] {
                background: #f8dddd;
                color: #762d2d;
            }

            QLabel#SafetyLabel {
                color: #655e56;
                font-style: italic;
            }

            QProgressBar {
                border: 1px solid #cfc5b8;
                border-radius: 6px;
                background: #fffdf9;
            }

            QProgressBar::chunk {
                background: #c9bee9;
                border-radius: 5px;
            }
            """
        )