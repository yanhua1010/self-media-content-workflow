#!/usr/bin/env python3
"""Entry point for overseas comparison mode: python3 overseas_compare.py {quote,run,replay}"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from radar.__main__ import main  # noqa: E402

if __name__ == "__main__":
    main()
