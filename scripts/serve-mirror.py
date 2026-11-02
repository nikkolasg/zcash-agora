#!/usr/bin/env python3
"""Serves a mirror directory for a local trial with the CORS and no-cache
headers jsDelivr sends in production. Usage: serve-mirror.py DIR PORT"""
import http.server, sys, functools
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a): pass
d, port = sys.argv[1], int(sys.argv[2])
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(H, directory=d)).serve_forever()
