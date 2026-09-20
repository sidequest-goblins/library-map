import unittest
from check_library_catalog import classify, compare
from build_library_data import make_catalog_key


def book(title, author="Jane Doe", sort="Doe, Jane", row=2):
    return dict(title=title, rawTitle=title, author=author, authorSort=sort, row=row)


def catalog(*books):
    return {make_catalog_key(b['title'], b['authorSort']): b for b in books}


class CatalogCheckTests(unittest.TestCase):
    def test_exact_and_missing(self):
        rows = compare([book('Present'), book('Absent')], catalog(book('Present')), {})
        self.assertEqual([r['status'] for r in rows], ['missing', 'matched'])

    def test_subtitle_is_review_not_missing(self):
        self.assertEqual(classify(book('History'), catalog(book('History: A Study')), {})[0], 'review')

    def test_volumes_do_not_collapse(self):
        self.assertEqual(classify(book('Story Vol. 1'), catalog(book('Story Vol. 10')), {})[0], 'missing')

    def test_duplicate_key_requires_review(self):
        b = book('Title')
        self.assertEqual(classify(b, catalog(b), {make_catalog_key('Title', 'Doe, Jane'): [b, b]})[0], 'review')

    def test_different_author_requires_review(self):
        self.assertEqual(classify(book('Title'), catalog(book('Title', 'Jan Doe', 'Doe, Jan')), {})[0], 'review')

    def test_extra_contributor_requires_review(self):
        self.assertEqual(classify(book('Title', 'Jane Doe; John Roe'), catalog(book('Title')), {})[0], 'review')

    def test_missing_author_requires_review(self):
        self.assertEqual(classify(book('Title', '', ''), {}, {})[0], 'review')

    def test_typo_is_suggested_not_accepted(self):
        self.assertEqual(classify(book('The Enchanted Greenhous'), catalog(book('The Enchanted Greenhouse')), {})[0], 'review')

    def test_unrelated_title_is_missing(self):
        self.assertEqual(classify(book('The Enchanted Greenhouse'), catalog(book('The Spellshop')), {})[0], 'missing')


if __name__ == '__main__':
    unittest.main()
