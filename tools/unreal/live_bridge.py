"""Keep the open Unreal level in step with the planner. Run it with Windows Python, next to an open Unreal Editor:

    python live_bridge.py

then open the planner with ?live (https://davidebarto.github.io/casa-ams/?live). Every change in the planner comes
here and goes on to the editor through Python Remote Execution (tick Enable Remote Execution in the project's
Python settings). casa_live.bat starts the editor, this and the planner in one go.
"""
import json
import math
import os
import re
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from remote import rx             # the engine's remote_execution module

PORT = 8766
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(tempfile.gettempdir(), 'casa-live')      # the planner's pieces as .glb, and the latest layout
ORIGINS = re.compile(r'https://davidebarto\.github\.io|http://(localhost|127\.0\.0\.1)(:\d+)?')
KEY = re.compile(r'[0-9a-f]{16}')
IMPORT = f'''import sys, importlib
if {HERE!r} not in sys.path: sys.path.insert(0, {HERE!r})
import casa_live; importlib.reload(casa_live)
'''

state = {'unreal': False, 'got': 0, 'done': 0, 'error': None, 'note': ''}   # got/done: the planner's change numbers
pending = None                    # the newest layout Unreal hasn't had yet
wake = threading.Condition()


def num(value):
    n = float(value)
    if not math.isfinite(n):
        raise ValueError(value)
    return n


def clean(job):
    """Only numbers, short names and known keys reach Unreal."""
    def item(i):
        light = i.get('light')
        if light is not None and len(light) != 3:
            raise ValueError(light)
        return {'uid': str(i['uid'])[:40], 'name': str(i['name'])[:80], 'key': KEY.fullmatch(i['key'])[0],
                'x': num(i['x']), 'y': num(i['y']), 'rot': num(i.get('rot') or 0),
                'light': [num(c) for c in light] if light else None}
    return {'v': int(job['v']), 'items': [item(i) for i in job['items'][:300]]}


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'   # HTTP/1.0 replies lose their end over localhost on some Windows machines

    def reply(self, code, data=None):
        body = json.dumps(data).encode() if data is not None else b''
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
        self.send_header('Access-Control-Allow-Methods', 'GET, POST')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')   # Chrome: a website may talk to this computer
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def allowed(self):
        """Only the planner: any other website open in the browser could otherwise send things into Unreal."""
        if ORIGINS.fullmatch(self.headers.get('Origin') or ''):
            return True
        self.send_error(403)
        return False

    def do_OPTIONS(self):
        if self.allowed():
            self.reply(204)

    def do_GET(self):
        if self.allowed():
            self.reply(200, state) if self.path == '/status' else self.send_error(404)

    def do_POST(self):
        global pending
        if not self.allowed():
            return
        size = int(self.headers.get('Content-Length') or 0)
        if not 0 <= size <= 64 << 20:
            return self.send_error(413)
        body = self.rfile.read(size)
        mesh = re.fullmatch(r'/mesh/([0-9a-f]{16})', self.path)
        if mesh and body[:4] == b'glTF':
            tmp = os.path.join(CACHE, f'{mesh[1]}.part')
            with open(tmp, 'wb') as f:
                f.write(body)
            os.replace(tmp, os.path.join(CACHE, f'{mesh[1]}.glb'))
            return self.reply(204)
        if self.path != '/layout':
            return self.send_error(404)
        try:
            job = clean(json.loads(body))
        except (ValueError, KeyError, TypeError, AttributeError):
            return self.send_error(400)
        missing = sorted({i['key'] for i in job['items'] if not os.path.exists(os.path.join(CACHE, i['key'] + '.glb'))})
        if missing:
            return self.reply(409, {'missing': missing})
        with wake:
            pending = job
            state['got'] = job['v']
            wake.notify()
        self.reply(202, {})

    def log_message(self, *args):
        pass


def run(rex, node, code):
    """Runs casa_live code in the editor; returns what it printed, or its error."""
    rex.open_command_connection(node)
    try:
        result = rex.run_command(IMPORT + code)
    finally:
        rex.close_command_connection()
    note = ' '.join(line['output'].strip() for line in result['output'])
    return note, None if result['success'] else result['result'].strip().splitlines()[-1]


def worker():
    """One change at a time; changes made meanwhile collapse into the newest layout. Saves 10 s after the last change."""
    global pending
    rex = rx.RemoteExecution()
    rex.start()
    last, last_node, unsaved, save_at = None, None, False, 0
    while True:
        with wake:
            if pending is None:                       # a change may have come in during the last sync
                wake.wait(timeout=2)
            job, nodes = pending, rex.remote_nodes
            state['unreal'] = bool(nodes)
            if not nodes:
                continue
            node = nodes[0]['node_id']
            if job is None and node != last_node:     # the editor was restarted: send it the layout again
                job = last
            pending = None
        try:
            if job:
                with open(os.path.join(CACHE, 'layout.json'), 'w', encoding='utf-8') as f:
                    json.dump(job, f)
                note, error = run(rex, node, f'casa_live.sync({CACHE!r})')
                state.update(done=job['v'], note=note, error=error)
                print(f"v{job['v']}: {error or note}", flush=True)
                last, last_node, unsaved = job, node, True
                save_at = time.monotonic() + 10       # once you stop arranging for a while
            elif unsaved and time.monotonic() > save_at:
                unsaved = run(rex, node, 'casa_live.save()')[0] != 'saved'
                save_at = time.monotonic() + 30       # in Play, or it failed: try again later
        except Exception as e:                        # the editor closed or is busy: try again in a moment
            state['error'] = f'Unreal did not answer ({e})'
            print(state['error'], flush=True)
            with wake:
                pending = pending or job


class Server(ThreadingHTTPServer):
    allow_reuse_address = False   # on Windows it would let a second copy share the port


def main():
    os.makedirs(CACHE, exist_ok=True)
    try:
        server = Server(('127.0.0.1', PORT), Handler)
    except OSError:
        sys.exit(f'Casa Live is already running (port {PORT} is taken).')
    threading.Thread(target=worker, daemon=True).start()
    print(f'Casa Live: waiting for the planner on http://127.0.0.1:{PORT}. Leave this window open; close it to stop.', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
