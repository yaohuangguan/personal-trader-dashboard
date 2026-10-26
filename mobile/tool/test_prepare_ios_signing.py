import datetime as dt
import unittest
from prepare_ios_signing import BUNDLE_ID, validate_profile, export_options

class SigningTests(unittest.TestCase):
    def profile(self):
        return {'TeamIdentifier': ['TESTTEAM01'], 'UUID': 'profile-id', 'ExpirationDate': dt.datetime.now()+dt.timedelta(days=10), 'Entitlements': {'application-identifier': 'TESTTEAM01.'+BUNDLE_ID, 'get-task-allow': False}}
    def test_app_store_export_is_bound_to_the_matching_profile(self):
        team, uuid=validate_profile(self.profile())
        self.assertEqual(export_options(team,uuid)['provisioningProfiles'],{BUNDLE_ID:'profile-id'})
        self.assertEqual(export_options(team,uuid)['method'],'app-store-connect')
    def test_wrong_bundle_development_adhoc_enterprise_and_expired_are_rejected(self):
        for patch in [{'Entitlements': {'application-identifier':'TESTTEAM01.other'}},{'Entitlements':{'application-identifier':'TESTTEAM01.'+BUNDLE_ID,'get-task-allow':True}},{'ProvisionedDevices':['device']},{'ProvisionsAllDevices':True},{'ExpirationDate':dt.datetime(2020,1,1)}]:
            with self.subTest(patch=patch),self.assertRaises(ValueError):validate_profile({**self.profile(),**patch})
if __name__=='__main__':unittest.main()
