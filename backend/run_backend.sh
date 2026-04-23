#!/bin/bash
export MONGODB_URI="mongodb://127.0.0.1:27017/AISCL"
poetry run uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level debug
