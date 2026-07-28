"""
Main desktop window for Library Clerk.
"""

from __future__ import annotations

import os
from pathlib import Path

from PySide6.QtCore import (
    Qt,
    QThread,
)
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
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
    ScanIssue,
    ScanResult,
)
from library_clerk.paths import (
    get_workbook_directory,
    list_workbooks,
)
from library_clerk.scan_worker import (
    ScanWorker,
)


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

        self.workbook_paths: list[
            Path
        ] = []

        self.scan_result: (
            ScanResult
            | None
        ) = None

        self.visible_issues: list[
            ScanIssue
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
            900,
            620,
        )

        self.resize(
            1120,
            760,
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
                "All issues",
                "System integrity",
                "Clerical",
            ]
        )

        self.area_filter.currentTextChanged.connect(
            self.apply_issue_filters
        )

        filter_layout.addWidget(
            self.area_filter
        )

        self.open_excel_button = QPushButton(
            "Open selected in Excel"
        )

        self.open_excel_button.setEnabled(
            False
        )

        self.open_excel_button.setToolTip(
            (
                "Open the correct workbook and select "
                "the exact cell for the chosen issue."
            )
        )

        self.open_excel_button.clicked.connect(
            self.open_selected_issue_in_excel
        )

        filter_layout.addWidget(
            self.open_excel_button
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

        self.issue_table.itemSelectionChanged.connect(
            self._update_excel_button
        )

        self.issue_table.cellDoubleClicked.connect(
            self._handle_issue_double_click
        )

        header = (
            self.issue_table.horizontalHeader()
        )

        header.setSectionResizeMode(
            QHeaderView.ResizeMode.ResizeToContents
        )

        header.setSectionResizeMode(
            2,
            QHeaderView.ResizeMode.Stretch,
        )

        root_layout.addWidget(
            self.issue_table,
            stretch=1,
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
            "Clerical issues"
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

    def refresh_workbook_sources(
        self,
    ) -> None:
        """
        Refresh the workbook files available in the shared folder.
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

        workbook_names = ", ".join(
            path.name
            for path in self.workbook_paths
        )

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

            self._set_status(
                (
                    "Workbook files are ready. "
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

        self.books_value_label.setText(
            str(
                result.books_scanned
            )
        )

        self.system_value_label.setText(
            str(
                result.system_issue_count
            )
        )

        self.clerical_value_label.setText(
            str(
                result.clerical_issue_count
            )
        )

        self.integrity_value_label.setText(
            (
                "PASS"
                if result.integrity_passed
                else "CHECK"
            )
        )

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

        status_parts = [
            source_label,
            (
                f"Found "
                f"{result.system_issue_count} "
                f"system issue"
                f"{'' if result.system_issue_count == 1 else 's'} "
                f"and "
                f"{result.clerical_issue_count} "
                f"clerical issue"
                f"{'' if result.clerical_issue_count == 1 else 's'}."
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

        self._set_status(
            " ".join(
                status_parts
            ),
            (
                "success"
                if result.integrity_passed
                else "error"
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
        Apply the search box and issue-area filter.
        """

        if self.scan_result is None:
            self.issue_table.setRowCount(
                0
            )

            return

        search_text = (
            self.search_box.text()
            .strip()
            .casefold()
        )

        selected_area = (
            self.area_filter.currentText()
        )

        visible_issues: list[
            ScanIssue
        ] = []

        for issue in self.scan_result.issues:
            if (
                selected_area != "All issues"
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

            visible_issues.append(
                issue
            )

        self.visible_issues = (
            visible_issues
        )

        self._populate_issue_table(
            visible_issues
        )

    def _populate_issue_table(
        self,
        issues: list[ScanIssue],
    ) -> None:
        """
        Display issues in the main work queue.

        Each table row stores its complete ScanIssue object so sorting the
        visible table does not disconnect the row from its workbook target.
        """

        self.issue_table.setSortingEnabled(
            False
        )

        self.issue_table.setRowCount(
            len(
                issues
            )
        )

        for row_index, issue in enumerate(
            issues
        ):
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
                        issue,
                    )

                self.issue_table.setItem(
                    row_index,
                    column_index,
                    item,
                )

        self.issue_table.setSortingEnabled(
            True
        )

        self._update_excel_button()

    def _get_selected_issue(
        self,
    ) -> ScanIssue | None:
        """
        Return the ScanIssue attached to the selected table row.
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

        issue_item = self.issue_table.item(
            selected_row,
            0,
        )

        if issue_item is None:
            return None

        issue = issue_item.data(
            Qt.ItemDataRole.UserRole
        )

        if not isinstance(
            issue,
            ScanIssue,
        ):
            return None

        return issue

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

    def _update_excel_button(
        self,
    ) -> None:
        """
        Enable Excel navigation only for issues with exact cell targets.
        """

        issue = self._get_selected_issue()

        self.open_excel_button.setEnabled(
            self._issue_has_excel_target(
                issue
            )
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
            QFrame#SummaryCard {
                background: #fffdf9;
                border: 1px solid #ddd5ca;
                border-radius: 10px;
            }

            QLabel#DirectoryPathLabel {
                color: #514a43;
                font-family: "Consolas";
                font-size: 9.5pt;
            }

            QLineEdit,
            QComboBox {
                background: #fffdf9;
                border: 1px solid #d1c8bd;
                border-radius: 7px;
                padding: 7px 9px;
            }

            QTableWidget {
                background: #fffdf9;
                alternate-background-color: #f8f4ee;
                border: 1px solid #d8d0c6;
                border-radius: 8px;
                gridline-color: #e5ded5;
                outline: none;
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

            QPushButton#PrimaryButton {
                background: #dcd4f3;
                border-color: #bdb2df;
                padding-left: 18px;
                padding-right: 18px;
            }

            QPushButton#PrimaryButton:hover {
                background: #d0c6ef;
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