"""After a TestFlight upload: wait for processing, add the build to every external
group and submit it for Beta App Review.

Environment: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY (App Store Connect API key),
BUILD_NUMBER (CFBundleVersion of the uploaded build). Optional: BUNDLE_ID,
WHAT_TO_TEST, PROCESSING_TIMEOUT (seconds). Prints identifiers and states only.
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = 'https://api.appstoreconnect.apple.com/v1'
BUNDLE_ID = 'io.github.yaohuangguan.guanlan'
WHAT_TO_TEST = '本次更新已推送给公开测试用户。欢迎通过 TestFlight 截图或反馈告诉我们问题。'


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(f'HTTP {status}: {message}')
        self.status = status


def make_token(key_id, issuer, private_key_pem, now=None):
    # Imported lazily so the pure helpers below can be unit-tested without the dependency.
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

    def b64u(data):
        return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

    now = int(now or time.time())
    head = b64u(json.dumps({'alg': 'ES256', 'kid': key_id, 'typ': 'JWT'}).encode())
    body = b64u(json.dumps({'iss': issuer, 'iat': now, 'exp': now + 1100, 'aud': 'appstoreconnect-v1'}).encode())
    key = serialization.load_pem_private_key(private_key_pem.encode(), None)
    r, s = decode_dss_signature(key.sign(f'{head}.{body}'.encode(), ec.ECDSA(hashes.SHA256())))
    return f'{head}.{body}.' + b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))


def client(token_factory):
    def call(method, path, payload=None):
        request = urllib.request.Request(
            API + path, method=method,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={'Authorization': 'Bearer ' + token_factory(), 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            errors = json.loads(error.read() or b'{}').get('errors', [])
            raise ApiError(error.code, '; '.join(e.get('detail') or e.get('title', '') for e in errors)) from None
    return call


def external_groups(groups):
    """Groups that need manual build assignment (internal groups auto-distribute)."""
    return [g for g in groups if not g['attributes'].get('isInternalGroup')]


def find_build(call, app_id, build_number):
    data = call('GET', f'/builds?filter[app]={app_id}&filter[version]={build_number}&limit=1'
                       '&fields[builds]=version,processingState')['data']
    return data[0] if data else None


def wait_for_build(call, app_id, build_number, timeout, interval=30, sleep=time.sleep, clock=time.monotonic):
    deadline = clock() + timeout
    while True:
        build = find_build(call, app_id, build_number)
        state = build['attributes']['processingState'] if build else 'NOT_YET_VISIBLE'
        print(f'build {build_number}: {state}', flush=True)
        if state == 'VALID':
            return build
        if state in ('FAILED', 'INVALID'):
            raise SystemExit(f'Build {build_number} processing ended as {state}')
        if clock() >= deadline:
            raise SystemExit(f'Build {build_number} still {state} after {timeout}s; add it to the external group in App Store Connect later')
        sleep(interval)


def set_what_to_test(call, build_id, text):
    existing = {l['attributes']['locale']: l for l in call('GET', f'/builds/{build_id}/betaBuildLocalizations')['data']}
    if 'zh-Hans' in existing:
        call('PATCH', f'/betaBuildLocalizations/{existing["zh-Hans"]["id"]}',
             {'data': {'type': 'betaBuildLocalizations', 'id': existing['zh-Hans']['id'], 'attributes': {'whatsNew': text}}})
    else:
        call('POST', '/betaBuildLocalizations', {'data': {'type': 'betaBuildLocalizations',
                                                          'attributes': {'locale': 'zh-Hans', 'whatsNew': text},
                                                          'relationships': {'build': {'data': {'type': 'builds', 'id': build_id}}}}})


def distribute(call, build, groups, what_to_test):
    build_id = build['id']
    set_what_to_test(call, build_id, what_to_test)
    targets = external_groups(groups)
    if not targets:
        print('No external TestFlight group; nothing to distribute')
        return None
    for group in targets:
        call('POST', f'/betaGroups/{group["id"]}/relationships/builds', {'data': [{'type': 'builds', 'id': build_id}]})
        print('added to external group:', group['attributes'].get('name'))
    existing = call('GET', f'/betaAppReviewSubmissions?filter[build]={build_id}')['data']
    if existing:
        state = existing[0]['attributes']['betaReviewState']
        print('beta review already:', state)
        return state
    try:
        state = call('POST', '/betaAppReviewSubmissions', {'data': {'type': 'betaAppReviewSubmissions',
                     'relationships': {'build': {'data': {'type': 'builds', 'id': build_id}}}}})['data']['attributes']['betaReviewState']
    except ApiError as error:
        # Apple rejects a second submission while an earlier build of the same version is in review;
        # the build stays attached to the group and goes out once that review clears.
        if error.status == 409 or 'already' in str(error).lower():
            print('beta review not submitted:', error)
            return 'PENDING_EARLIER_REVIEW'
        raise
    print('submitted for beta review:', state)
    return state


def main():
    env = os.environ
    missing = [k for k in ('ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_PRIVATE_KEY', 'BUILD_NUMBER') if not env.get(k)]
    if missing:
        raise SystemExit('Missing environment: ' + ', '.join(missing))
    call = client(lambda: make_token(env['ASC_KEY_ID'], env['ASC_ISSUER_ID'], env['ASC_PRIVATE_KEY']))
    bundle = env.get('BUNDLE_ID') or BUNDLE_ID
    apps = call('GET', f'/apps?filter[bundleId]={bundle}&fields[apps]=bundleId')['data']
    if not apps:
        raise SystemExit('App not found for ' + bundle)
    app_id = apps[0]['id']
    build = wait_for_build(call, app_id, env['BUILD_NUMBER'], int(env.get('PROCESSING_TIMEOUT') or 2400))
    groups = call('GET', f'/apps/{app_id}/betaGroups?fields[betaGroups]=name,isInternalGroup,publicLink')['data']
    distribute(call, build, groups, env.get('WHAT_TO_TEST') or WHAT_TO_TEST)
    for group in external_groups(groups):
        if group['attributes'].get('publicLink'):
            print('public link:', group['attributes']['publicLink'])


if __name__ == '__main__':
    sys.exit(main())
