"""Read-only network preflight. Run on the proposed worker server, not on the Mac."""
import concurrent.futures
import socket
import urllib.error
import urllib.request

TARGETS = [
    ('OpenSIPS Collection', '10.10.99.153', 80, '/cp/main.php'),
    ('OpenSIPS Sale', '10.10.99.155', 80, '/cp/main.php'),
    ('FreeSWITCH', '10.10.101.67', 5003, '/'),
    ('Grafana', '10.10.101.126', 3000, '/'),
]

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def check(target):
    label, host, port, path = target
    try:
        with socket.create_connection((host, port), timeout=5):
            pass
    except OSError as error:
        return label, False, 'Cannot connect TCP: ' + str(error)
    url = f'http://{host}:{port}{path}'
    # Avoid system proxies and never submit credentials or follow external redirects.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(url, timeout=8) as response:
            code = response.status
    except urllib.error.HTTPError as error:
        code = error.code
    except OSError as error:
        return label, False, 'TCP connected, HTTP failed: ' + str(error)
    if code in (200, 301, 302, 303, 307, 308, 401, 403):
        return label, True, f'HTTP {code}; still requires browser login and page verification'
    return label, False, f'Unexpected HTTP {code}; inspect target URL'

if __name__ == '__main__':
    print('READ-ONLY SERVER PREFLIGHT — no login, status changes or worker launch')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(check, TARGETS))
    for label, okay, detail in results:
        print(('REACHABLE' if okay else 'CHECK FAILED') + ' | ' + label + ' | ' + detail)
    raise SystemExit(0 if all(okay for _, okay, _ in results) else 1)
