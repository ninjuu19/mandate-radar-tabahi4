"""
Vercel serverless entrypoint for Mandate Radar FastAPI backend.
Vercel Python runtime natively handles ASGI applications when `app` is exposed.
"""
import sys
import os
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from main import app
except Exception as e:
    err_tb = traceback.format_exc()
    print("FATAL ERROR IN API INITIALIZATION:\n", err_tb)
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse
    app = FastAPI()
    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"])
    def error_handler(path: str):
        return JSONResponse(status_code=500, content={"error": "FastAPI initialization failed", "detail": str(e), "traceback": err_tb})
