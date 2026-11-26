import unittest

from testflight_distribute import ApiError, distribute, external_groups, wait_for_build


def group(gid, name, internal):
    return {'id': gid, 'attributes': {'name': name, 'isInternalGroup': internal}}


class FakeApi:
    def __init__(self, builds=None, submissions=None, submit_error=None, localizations=None):
        self.builds = list(builds or [])
        self.submissions = submissions or []
        self.submit_error = submit_error
        self.localizations = localizations or []
        self.calls = []

    def __call__(self, method, path, payload=None):
        self.calls.append((method, path.split('?')[0], payload))
        if path.startswith('/builds?'):
            state = self.builds.pop(0) if self.builds else 'VALID'
            return {'data': [] if state is None else [{'id': 'b1', 'attributes': {'version': '7001', 'processingState': state}}]}
        if path.endswith('/betaBuildLocalizations'):
            return {'data': self.localizations}
        if path.startswith('/betaAppReviewSubmissions?'):
            return {'data': self.submissions}
        if method == 'POST' and path == '/betaAppReviewSubmissions':
            if self.submit_error:
                raise self.submit_error
            return {'data': {'attributes': {'betaReviewState': 'WAITING_FOR_REVIEW'}}}
        return {}


class DistributeTests(unittest.TestCase):
    def test_only_external_groups_are_targeted(self):
        groups = [group('i', '内测', True), group('e', '公开测试', False)]
        self.assertEqual([g['id'] for g in external_groups(groups)], ['e'])

    def test_waits_until_processing_finishes(self):
        api, naps = FakeApi(builds=[None, 'PROCESSING', 'VALID']), []
        build = wait_for_build(api, 'app', '7001', timeout=600, sleep=naps.append, clock=lambda: 0)
        self.assertEqual(build['id'], 'b1')
        self.assertEqual(len(naps), 2)

    def test_failed_processing_and_timeout_stop_the_job(self):
        with self.assertRaises(SystemExit):
            wait_for_build(FakeApi(builds=['FAILED']), 'app', '7001', timeout=600, sleep=lambda _: None, clock=lambda: 0)
        ticks = iter([0, 700])
        with self.assertRaises(SystemExit):
            wait_for_build(FakeApi(builds=['PROCESSING']), 'app', '7001', timeout=600, sleep=lambda _: None, clock=lambda: next(ticks))

    def test_adds_build_to_external_group_and_submits_review(self):
        api = FakeApi()
        state = distribute(api, {'id': 'b1'}, [group('i', '内测', True), group('e', '公开测试', False)], '测试')
        self.assertEqual(state, 'WAITING_FOR_REVIEW')
        paths = [(m, p) for m, p, _ in api.calls]
        self.assertIn(('POST', '/betaGroups/e/relationships/builds'), paths)
        self.assertNotIn(('POST', '/betaGroups/i/relationships/builds'), paths)
        self.assertIn(('POST', '/betaBuildLocalizations'), paths)
        self.assertIn(('POST', '/betaAppReviewSubmissions'), paths)

    def test_existing_submission_is_not_duplicated_and_what_to_test_is_updated(self):
        api = FakeApi(submissions=[{'attributes': {'betaReviewState': 'APPROVED'}}],
                      localizations=[{'id': 'l1', 'attributes': {'locale': 'zh-Hans', 'whatsNew': 'old'}}])
        self.assertEqual(distribute(api, {'id': 'b1'}, [group('e', '公开测试', False)], 'new'), 'APPROVED')
        self.assertNotIn('/betaAppReviewSubmissions', [p for m, p, _ in api.calls if m == 'POST'])
        self.assertIn(('PATCH', '/betaBuildLocalizations/l1'), [(m, p) for m, p, _ in api.calls])

    def test_review_blocked_by_an_earlier_build_does_not_fail_the_job(self):
        api = FakeApi(submit_error=ApiError(409, 'Another build is already in review'))
        self.assertEqual(distribute(api, {'id': 'b1'}, [group('e', '公开测试', False)], 'x'), 'PENDING_EARLIER_REVIEW')
        with self.assertRaises(ApiError):
            distribute(FakeApi(submit_error=ApiError(500, 'boom')), {'id': 'b1'}, [group('e', '公开测试', False)], 'x')

    def test_no_external_group_skips_quietly(self):
        api = FakeApi()
        self.assertIsNone(distribute(api, {'id': 'b1'}, [group('i', '内测', True)], 'x'))
        self.assertNotIn('/betaAppReviewSubmissions', [p for m, p, _ in api.calls if m == 'POST'])


if __name__ == '__main__':
    unittest.main()
