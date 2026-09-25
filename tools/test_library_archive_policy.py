import unittest
from library_archive_policy import archive_conflicts, canonical_isbn


def book(book_id, isbn, key="cantero-edgar-meddling-kids"):
    return dict(bookId=book_id, isbn=isbn, catalogKey=key, title="Meddling Kids")


class ArchivePolicyTests(unittest.TestCase):
    def test_new_edition_can_coexist(self):
        self.assertEqual(archive_conflicts(
            [book("new", "9781101974445")], [book("old", "9780385541992")]), [])

    def test_same_physical_id_blocks_even_with_different_isbn(self):
        self.assertIn("Book ID", archive_conflicts(
            [book("old", "9781101974445")], [book("old", "9780385541992")])[0])

    def test_same_edition_with_new_id_needs_review(self):
        self.assertTrue(archive_conflicts(
            [book("new", "9780316013697")], [book("old", "9780316013697")]))

    def test_missing_and_invalid_isbns_do_not_bypass_review(self):
        for isbn in (None, "", "unknown", "9780385541993"):
            with self.subTest(isbn=isbn):
                self.assertTrue(archive_conflicts(
                    [book("new", "9781101974445")], [book("old", isbn)]))

    def test_isbn10_and_isbn13_are_same_edition(self):
        self.assertEqual(canonical_isbn("0-316-01369-2"), "9780316013697")
        self.assertTrue(archive_conflicts(
            [book("new", "9780316013697")], [book("old", "0-316-01369-2")]))

    def test_checks_every_archived_copy_with_same_key(self):
        self.assertTrue(archive_conflicts([book("new", "9781101974445")], [
            book("old1", "9781101974445"), book("old2", "9780385541992")]))

    def test_unrelated_title_does_not_conflict(self):
        self.assertEqual(archive_conflicts(
            [book("new", "", "another-key")], [book("old", "")]), [])


if __name__ == "__main__":
    unittest.main()
