"""Debug endpoint — returns import errors as JSON. Remove before production."""
import sys
import os
import traceback
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        errors = []
        try:
            _here = os.path.dirname(os.path.abspath(__file__))
            sys.path.insert(0, os.path.join(_here, "..", "backend"))
            import app  # noqa
        except Exception:
            errors.append(traceback.format_exc())

        body = "\n\n".join(errors) if errors else "OK — no import errors"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(body.encode())
