"""Vercel entrypoint: exposes the Flask app in ../server.py as the WSGI `app`.
vercel.json rewrites every path here, and Flask serves static/ itself."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import app  # noqa: E402,F401
