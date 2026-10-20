#!/usr/bin/env python3
"""Compatibility entry point. Pass the explicit isolated GNOME session directory."""
from pathlib import Path
import os
import sys
script = Path(__file__).resolve().parent/'dev/demo.py'
os.execv(sys.executable, [sys.executable, str(script), *sys.argv[1:]])
