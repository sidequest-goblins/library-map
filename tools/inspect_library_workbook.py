from pathlib import Path
from openpyxl import load_workbook

WORKBOOK_PATH = Path("C:/library_app/source/LIBRARY.xlsx")

def main():
    if not WORKBOOK_PATH.exists():
        raise FileNotFoundError(f"Could not find workbook: {WORKBOOK_PATH}")

    print(f"Loading workbook: {WORKBOOK_PATH}")
    workbook = load_workbook(WORKBOOK_PATH, read_only=True, data_only=True)

    sheet = workbook.worksheets[-1]
    print(f"Using last sheet: {sheet.title}")
    print(f"Rows: {sheet.max_row}")
    print(f"Columns: {sheet.max_column}")

    header_row = next(sheet.iter_rows(min_row=1, max_row=1, values_only=True))

    print("\nHeaders:")
    for index, value in enumerate(header_row, start=1):
        print(f"{index}: {value}")

    print("\nFirst 5 data rows:")
    for row_index, row in enumerate(
        sheet.iter_rows(min_row=2, max_row=6, values_only=True),
        start=2,
    ):
        print(f"\nRow {row_index}:")
        for header, value in zip(header_row, row):
            if value not in (None, ""):
                print(f"  {header}: {value}")

if __name__ == "__main__":
    main()