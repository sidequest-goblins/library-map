import unittest
from scan_library_archive import classify


ID1 = 'book-11111111-1111-4111-8111-111111111111'
ID2 = 'book-22222222-2222-4222-8222-222222222222'


def row(title='Example', book_id=ID1, isbn='123'):
    return {'Title': title, 'First': 'Jane', 'Last': 'Doe', 'Book ID': book_id, 'ISBN': isbn}


def obs(value, raw=True, date='2026-08-01T12:00:00'):
    return dict(values=value, source='test', sheet='List View', row=2, raw=raw, date=date)


class RecoveryTests(unittest.TestCase):
    def test_current_id_excluded_despite_title_correction(self):
        self.assertEqual(classify([obs(row('Wrong title'))], [row('Correct title')]), [])

    def test_repeated_backups_one_missing_record(self):
        found = classify([obs(row()), obs(row(), date='2026-09-01T12:00:00')], [])
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]['status'], 'Missing from current list')
        self.assertEqual(len(found[0]['versions']), 2)

    def test_changed_id_is_review_not_removed(self):
        result = classify([obs(row())], [row(book_id=ID2)])
        self.assertEqual(result[0]['status'], 'Possible current match')

    def test_different_edition_is_preserved(self):
        result = classify([obs(row()), obs(row(isbn=''), raw=False)], [row(book_id=ID2, isbn='456')])
        self.assertEqual(next(r for r in result if r['key'] == ID1)['status'], 'Missing from current list')

    def test_pre_id_snapshot_links_to_unique_exact_title_author(self):
        self.assertEqual(classify([obs(row(book_id='old-slug', isbn=''), raw=False)], [row()]), [])

    def test_ambiguous_legacy_name_is_not_merged(self):
        result = classify([obs(row(book_id='', isbn=''), raw=False)], [row(), row(book_id=ID2, isbn='456')])
        self.assertEqual(result[0]['status'], 'Possible current match')
        self.assertTrue(result[0]['key'].startswith('legacy-'))

    def test_raw_columns_and_old_versions_preserved(self):
        old = row(); old['Needs Review'] = False; old['Position'] = 0
        new = row(); new['Position'] = None
        result = classify([obs(old), obs(new, date='2026-09-01T12:00:00'),
                           obs({'Title': 'Example', 'Book ID': ID1, 'Position': 8}, raw=False,
                               date='2026-09-25T12:00:00')], [row('Other', ID2, '456')])
        self.assertIsNone(result[0]['values']['Position'])
        self.assertIs(result[0]['values']['Needs Review'], False)
        self.assertEqual(len(result[0]['versions']), 3)


if __name__ == '__main__':
    unittest.main()
