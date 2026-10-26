"""Prepare an ephemeral CI checkout for a manually signed App Store archive."""
import base64
import datetime as dt
import os
from pathlib import Path
import plistlib
import shutil
import subprocess

BUNDLE_ID = 'space.ps6.marketAtlas'


def validate_profile(profile, bundle_id=BUNDLE_ID):
    teams = profile.get('TeamIdentifier', [])
    entitlements = profile.get('Entitlements', {})
    if not teams or not profile.get('UUID'):
        raise ValueError('Provisioning profile is missing team or UUID')
    if entitlements.get('application-identifier') != teams[0] + '.' + bundle_id:
        raise ValueError('Profile bundle identifier does not match ' + bundle_id)
    if entitlements.get('get-task-allow') or profile.get('ProvisionedDevices') or profile.get('ProvisionsAllDevices'):
        raise ValueError('An App Store distribution profile is required')
    expires = profile.get('ExpirationDate')
    if not isinstance(expires, dt.datetime) or expires.replace(tzinfo=dt.timezone.utc) <= dt.datetime.now(dt.timezone.utc):
        raise ValueError('Provisioning profile has expired')
    return teams[0], profile['UUID']


def export_options(team, uuid):
    return {'method': 'app-store-connect', 'signingStyle': 'manual', 'teamID': team,
            'signingCertificate': 'Apple Distribution', 'provisioningProfiles': {BUNDLE_ID: uuid},
            'manageAppVersionAndBuildNumber': False, 'stripSwiftSymbols': True}


def main():
    root = Path(__file__).resolve().parent.parent
    temp = Path(os.environ['RUNNER_TEMP'])
    source = temp / 'atlas.mobileprovision'
    source.write_bytes(base64.b64decode(os.environ['IOS_PROVISION_PROFILE_BASE64'], validate=True))
    source.chmod(0o600)
    decoded = subprocess.run(['security', 'cms', '-D', '-i', str(source)], capture_output=True, check=True).stdout
    team, uuid = validate_profile(plistlib.loads(decoded))
    for directory in ['Library/MobileDevice/Provisioning Profiles', 'Library/Developer/Xcode/UserData/Provisioning Profiles']:
        destination = Path.home() / directory
        destination.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination / (uuid + '.mobileprovision'))
    project = root / 'ios/Runner.xcodeproj/project.pbxproj'
    contents = project.read_text()
    marker = 'PRODUCT_BUNDLE_IDENTIFIER = ' + BUNDLE_ID + ';'
    if contents.count(marker) != 3:
        raise ValueError('Unexpected Runner project settings; signing was not changed')
    settings = '\n'.join([marker, f'DEVELOPMENT_TEAM = {team};', 'CODE_SIGN_STYLE = Manual;',
                          'CODE_SIGN_IDENTITY = "Apple Distribution";', f'PROVISIONING_PROFILE_SPECIFIER = "{uuid}";'])
    project.write_text(contents.replace(marker, settings))
    with (root / 'ios/ExportOptions.generated.plist').open('wb') as stream:
        plistlib.dump(export_options(team, uuid), stream)
    print('App Store signing prepared for ' + BUNDLE_ID)


if __name__ == '__main__':
    main()
