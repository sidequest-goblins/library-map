#!/usr/bin/env python
"""Patch MyLibrary for book-level workbook BIPOC metadata.

Default repo:
    C:\\library_app\\library-map

Run from the repo root:
    .\\.venv\\Scripts\\python.exe <path-to-this-file>

The patch validates every expected source block before writing anything and
rolls all files back if Python validation fails.
"""

from __future__ import annotations

import argparse
import py_compile
import sys
from dataclasses import dataclass
from pathlib import Path


DEFAULT_REPO = Path(r"C:\library_app\library-map")


@dataclass
class PlannedWrite:
    path: Path
    original: str
    updated: str


class PatchError(RuntimeError):
    pass


def replace_once(text: str, old: str, new: str, *, label: str) -> str:
    count = text.count(old)

    if count == 0:
        if new in text:
            return text
        raise PatchError(f"Could not find the expected source block for {label}.")

    if count != 1:
        raise PatchError(
            f"Expected exactly one source block for {label}, but found {count}."
        )

    return text.replace(old, new, 1)


def patch_inspector(text: str) -> str:
    return replace_once(
        text,
        '    "CJ",\n    "JC",\n    "LGBTQ+",\n',
        '    "CJ",\n    "JC",\n    "BIPOC",\n    "LGBTQ+",\n',
        label="List View expected BIPOC header",
    )


def patch_library_types(text: str) -> str:
    return replace_once(
        text,
        '  cj?: boolean;\n  lgbtq?: boolean;\n',
        '  cj?: boolean;\n  bipoc?: boolean | null;\n  lgbtq?: boolean;\n',
        label="Book.bipoc type",
    )


def patch_builder(text: str) -> str:
    optional_bool_function = (
        'def checkbox_to_optional_bool(value: Any) -> bool | None:\n'
        '    # True/False are explicit workbook decisions. None means the app\n'
        '    # may fall back to author-specific Supabase metadata.\n'
        '    if value is None:\n'
        '        return None\n\n'
        '    if isinstance(value, bool):\n'
        '        return value\n\n'
        '    text = clean(value).lower()\n\n'
        '    if not text:\n'
        '        return None\n\n'
        '    if text in {"true", "yes", "y", "1", "checked", "x"}:\n'
        '        return True\n\n'
        '    if text in {"false", "no", "n", "0", "unchecked"}:\n'
        '        return False\n\n'
        '    raise ValueError(\n'
        '        f"Unrecognized optional checkbox value: {value!r}"\n'
        '    )\n\n'
    )

    marker = 'def load_bookcase_rooms(workbook) -> dict[str, str]:\n'

    if optional_bool_function not in text:
        text = replace_once(
            text,
            marker,
            optional_bool_function + marker,
            label="optional checkbox parser",
        )

    text = replace_once(
        text,
        '            "cj",\n            "jc",\n            "lgbtq+",\n',
        '            "cj",\n            "jc",\n            "bipoc",\n            "lgbtq+",\n',
        label="List View sheet-detection headers",
    )

    text = replace_once(
        text,
        '        "cj",\n        "jc",\n        "lgbtq+",\n',
        '        "cj",\n        "jc",\n        "bipoc",\n        "lgbtq+",\n',
        label="List View required headers",
    )

    text = replace_once(
        text,
        '        lgbtq = checkbox_to_bool(\n'
        '            get("lgbtq+")\n'
        '        )\n\n'
        '        if catalog_match:\n',
        '        bipoc = checkbox_to_optional_bool(\n'
        '            get("bipoc")\n'
        '        )\n\n'
        '        lgbtq = checkbox_to_bool(\n'
        '            get("lgbtq+")\n'
        '        )\n\n'
        '        if catalog_match:\n',
        label="List View BIPOC parsing",
    )

    text = replace_once(
        text,
        '            "jc": jc,\n'
        '            "cj": cj,\n'
        '            "lgbtq": lgbtq,\n'
        '            "coverImage": (\n',
        '            "jc": jc,\n'
        '            "cj": cj,\n'
        '            "bipoc": bipoc,\n'
        '            "lgbtq": lgbtq,\n'
        '            "coverImage": (\n',
        label="generated book BIPOC field",
    )

    return text


def patch_app(text: str) -> str:
    helper = (
        'function getBookBipocStatus(\n'
        '  book: Book,\n'
        '  resolvedAuthors:\n'
        '    ResolvedBookAuthor[]\n'
        '): boolean | null {\n'
        '  /*\n'
        '   * Workbook BIPOC is a book-level decision. Never copy it onto\n'
        '   * every credited author, especially for mixed-author books.\n'
        '   */\n'
        '  if (\n'
        '    book.bipoc !== null &&\n'
        '    book.bipoc !== undefined\n'
        '  ) {\n'
        '    return book.bipoc;\n'
        '  }\n\n'
        '  if (\n'
        '    resolvedAuthors.some(\n'
        '      ({ metadata }) =>\n'
        '        metadata?.bipoc === true\n'
        '    )\n'
        '  ) {\n'
        '    return true;\n'
        '  }\n\n'
        '  /*\n'
        '   * Resolve Not BIPOC only when every credited author has been\n'
        '   * explicitly reviewed as not BIPOC. False + unreviewed remains\n'
        '   * unreviewed.\n'
        '   */\n'
        '  if (\n'
        '    resolvedAuthors.length > 0 &&\n'
        '    resolvedAuthors.every(\n'
        '      ({ metadata }) =>\n'
        '        metadata?.bipoc === false\n'
        '    )\n'
        '  ) {\n'
        '    return false;\n'
        '  }\n\n'
        '  return null;\n'
        '}\n\n'
    )

    helper_marker = 'function getWantedSearchText(item: WantedBook): string {\n'

    if helper not in text:
        text = replace_once(
            text,
            helper_marker,
            helper + helper_marker,
            label="book-level BIPOC resolver",
        )

    text = replace_once(
        text,
        '            if (\n'
        '              searchFilters\n'
        '                .bipocOnly\n'
        '            ) {\n'
        '              const bookAuthors =\n'
        '                resolvedAuthorsByBookId.get(\n'
        '                  book.bookId\n'
        '                ) ?? [];\n\n'
        '              const hasBipocAuthor =\n'
        '                bookAuthors.some(\n'
        '                  ({\n'
        '                    metadata,\n'
        '                  }) =>\n'
        '                    metadata?.bipoc ===\n'
        '                    true\n'
        '                );\n\n'
        '              if (\n'
        '                !hasBipocAuthor\n'
        '              ) {\n'
        '                return false;\n'
        '              }\n'
        '            }\n',
        '            if (\n'
        '              searchFilters\n'
        '                .bipocOnly\n'
        '            ) {\n'
        '              const bookAuthors =\n'
        '                resolvedAuthorsByBookId.get(\n'
        '                  book.bookId\n'
        '                ) ?? [];\n\n'
        '              if (\n'
        '                getBookBipocStatus(\n'
        '                  book,\n'
        '                  bookAuthors\n'
        '                ) !== true\n'
        '              ) {\n'
        '                return false;\n'
        '              }\n'
        '            }\n',
        label="BIPOC search filter resolution",
    )

    text = replace_once(
        text,
        '    const selectedBookHasBipocAuthor =\n'
        '      selectedBookAuthors.some(\n'
        '        ({ metadata }) =>\n'
        '          metadata?.bipoc === true\n'
        '      );\n\n'
        '    const selectedBookBipocAuthorCount =\n',
        '    const selectedBookBipocStatus =\n'
        '      getBookBipocStatus(\n'
        '        selectedBook,\n'
        '        selectedBookAuthors\n'
        '      );\n\n'
        '    const selectedBookBipocAuthorCount =\n',
        label="book detail BIPOC resolution",
    )

    text = replace_once(
        text,
        '                {selectedBookHasBipocAuthor ? (\n',
        '                {selectedBookBipocStatus === true ? (\n',
        label="book detail BIPOC chip",
    )

    text = replace_once(
        text,
        '              <div className="authorMetadataDisclosureContent">\n'
        '                {authorMetadataLoadStatus ===\n',
        '              <div className="authorMetadataDisclosureContent">\n'
        '                {selectedBook.bipoc !== null &&\n'
        '                selectedBook.bipoc !== undefined ? (\n'
        '                  <p className="authorMetadataStatus">\n'
        '                    Workbook book tag:{" "}\n'
        '                    <strong>\n'
        '                      {selectedBook.bipoc\n'
        '                        ? "BIPOC"\n'
        '                        : "Not BIPOC"}\n'
        '                    </strong>\n'
        '                    . Author choices below remain\n'
        '                    author-specific and do not\n'
        '                    inherit this book-level value.\n'
        '                  </p>\n'
        '                ) : null}\n\n'
        '                {authorMetadataLoadStatus ===\n',
        label="book-versus-author BIPOC explanation",
    )

    old_filter = (
        '                      <label\n'
        '                        className={\n'
        '                          authorMetadataLoadStatus ===\n'
        '                          "ready"\n'
        '                            ? "searchFilterBoolean"\n'
        '                            : "searchFilterBoolean searchFilterBooleanDisabled"\n'
        '                        }\n'
        '                      >\n'
        '                        <input\n'
        '                          type="checkbox"\n'
        '                          checked={\n'
        '                            searchFilters\n'
        '                              .bipocOnly\n'
        '                          }\n'
        '                          disabled={\n'
        '                            authorMetadataLoadStatus !==\n'
        '                            "ready"\n'
        '                          }\n'
        '                          onChange={(\n'
        '                            event\n'
        '                          ) => {\n'
        '                            updateSearchFilter(\n'
        '                              "bipocOnly",\n'
        '                              event.target\n'
        '                                .checked\n'
        '                            );\n'
        '                          }}\n'
        '                        />\n\n'
        '                        <span className="searchFilterBooleanCopy">\n'
        '                          <strong>\n'
        '                            BIPOC authors\n'
        '                          </strong>\n\n'
        '                          <span>\n'
        '                            {authorMetadataLoadStatus ===\n'
        '                            "ready"\n'
        '                              ? "At least one credited author is marked BIPOC."\n'
        '                              : "Available after shared author metadata loads."}\n'
        '                          </span>\n'
        '                        </span>\n'
        '                      </label>\n'
    )

    new_filter = (
        '                      <label className="searchFilterBoolean">\n'
        '                        <input\n'
        '                          type="checkbox"\n'
        '                          checked={\n'
        '                            searchFilters\n'
        '                              .bipocOnly\n'
        '                          }\n'
        '                          onChange={(\n'
        '                            event\n'
        '                          ) => {\n'
        '                            updateSearchFilter(\n'
        '                              "bipocOnly",\n'
        '                              event.target\n'
        '                                .checked\n'
        '                            );\n'
        '                          }}\n'
        '                        />\n\n'
        '                        <span className="searchFilterBooleanCopy">\n'
        '                          <strong>\n'
        '                            BIPOC books\n'
        '                          </strong>\n\n'
        '                          <span>\n'
        '                            Workbook book tag wins;\n'
        '                            blank rows fall back to\n'
        '                            reviewed author metadata.\n'
        '                          </span>\n'
        '                        </span>\n'
        '                      </label>\n'
    )

    text = replace_once(
        text,
        old_filter,
        new_filter,
        label="always-available BIPOC search control",
    )

    text = text.replace(
        'aria-label="Remove BIPOC author filter"',
        'aria-label="Remove BIPOC book filter"',
    )

    text = text.replace(
        '                        BIPOC authors\n'
        '                        <span aria-hidden="true">\n',
        '                        BIPOC books\n'
        '                        <span aria-hidden="true">\n',
    )

    return text


def read_utf8(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except OSError as error:
        raise PatchError(f"Could not read {path}: {error}") from error


def plan_patch(repo: Path) -> list[PlannedWrite]:
    targets = [
        (repo / "tools" / "inspect_library_workbook.py", patch_inspector),
        (repo / "tools" / "build_library_data.py", patch_builder),
        (repo / "src" / "data" / "libraryTypes.ts", patch_library_types),
        (repo / "src" / "App.tsx", patch_app),
    ]

    missing = [str(path) for path, _ in targets if not path.exists()]
    if missing:
        raise PatchError(
            "Could not find the expected MyLibrary files:\n- "
            + "\n- ".join(missing)
        )

    planned: list[PlannedWrite] = []
    for path, patcher in targets:
        original = read_utf8(path)
        updated = patcher(original)
        planned.append(PlannedWrite(path, original, updated))

    return planned


def write_atomically(path: Path, content: str) -> None:
    temporary = path.with_suffix(path.suffix + ".bipoc-patch.tmp")
    temporary.write_text(content, encoding="utf-8", newline="")
    temporary.replace(path)


def validate_python(repo: Path) -> None:
    for relative_path in [
        Path("tools/inspect_library_workbook.py"),
        Path("tools/build_library_data.py"),
    ]:
        py_compile.compile(str(repo / relative_path), doraise=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Patch MyLibrary for book-level workbook BIPOC metadata."
    )
    parser.add_argument(
        "--repo",
        type=Path,
        default=DEFAULT_REPO,
        help=f"MyLibrary repo root (default: {DEFAULT_REPO})",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate the patch without writing files.",
    )
    args = parser.parse_args()
    repo = args.repo.expanduser().resolve()

    try:
        planned = plan_patch(repo)
    except PatchError as error:
        print(f"\nBIPOC PATCH STOPPED SAFELY\n{error}\n", file=sys.stderr)
        return 1

    changed = [item for item in planned if item.updated != item.original]

    if args.check:
        print("BIPOC patch validation: PASS")
        print(f"Files that would change: {len(changed)}")
        for item in changed:
            print(f"  - {item.path.relative_to(repo)}")
        return 0

    try:
        for item in changed:
            write_atomically(item.path, item.updated)
        validate_python(repo)
    except Exception as error:
        for item in planned:
            try:
                write_atomically(item.path, item.original)
            except OSError:
                pass

        print(
            "\nBIPOC PATCH ROLLED BACK SAFELY\n"
            f"{error}\n",
            file=sys.stderr,
        )
        return 1

    if not changed:
        print("MyLibrary already has the BIPOC workbook support patch.")
        return 0

    print("\nBIPOC workbook support added:")
    for item in changed:
        print(f"  - {item.path.relative_to(repo)}")

    print(
        "\nResolution rules now are:\n"
        "  1. Explicit workbook book-level BIPOC value wins.\n"
        "  2. Blank workbook value falls back to author-specific Supabase data.\n"
        "  3. Mixed reviewed/unreviewed authors remain unreviewed.\n"
        "  4. A book-level workbook tag never labels every coauthor.\n"
        "\nNext command:\n"
        "  update mylibrary\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
