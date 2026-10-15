import unittest
from find_returned_books import find_candidates
from build_library_data import make_catalog_key, make_author_sort


class ReturnCandidatesTest(unittest.TestCase):
    def setUp(self):
        self.row = {'Title': 'A Woman of Substance', 'First': 'Barbara',
                    'Last': 'Bradford', 'ISBN': '9780739412503', 'Book ID': 'new-id'}
        self.old = {'title': self.row['Title'], 'isbn': self.row['ISBN'],
                    'bookId': 'old-id', 'catalogKey': make_catalog_key(
                        self.row['Title'], make_author_sort('Barbara', 'Bradford'))}

    def test_unique_return(self):
        result = find_candidates([self.row], [self.old])
        self.assertEqual(len(result), 1)
        self.assertTrue(result[0]['repairable'])
        self.assertEqual(result[0]['originalId'], 'old-id')

    def test_ambiguous_archive_requires_review(self):
        other = dict(self.old, bookId='other-old-id')
        self.assertTrue(all(not x['repairable'] for x in
                            find_candidates([self.row], [self.old, other])))

    def test_original_already_active_requires_review(self):
        rows = [self.row, dict(self.row, **{'Book ID': 'old-id'})]
        self.assertTrue(all(not x['repairable'] for x in find_candidates(rows, [self.old])))

    def test_unrelated_book_has_no_prompt(self):
        self.assertEqual(find_candidates([dict(self.row, Title='Other')], [self.old]), [])

    def test_missing_isbn_requires_review(self):
        result = find_candidates([dict(self.row, ISBN='')], [self.old])
        self.assertEqual(len(result), 1)
        self.assertFalse(result[0]['repairable'])


if __name__ == '__main__':
    unittest.main()
