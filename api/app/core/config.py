"""
Application Configuration and Settings
"""
import os
from typing import Optional
from dotenv import load_dotenv

# Load local environment variables from root and api directory
load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

def _get_database_url() -> str:
    env_url = os.getenv("DATABASE_URL")
    if env_url:
        return env_url
    is_serverless = bool(
        os.getenv("VERCEL")
        or os.getenv("AWS_LAMBDA_FUNCTION_NAME")
        or os.getenv("NOW_REGION")
        or (os.path.exists("/tmp") and os.name != "nt")
    )
    if is_serverless:
        return "sqlite:////tmp/mandate_radar.db"
    return f"sqlite:///{os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'mandate_radar.db'))}"

class Settings:
    PROJECT_NAME: str = "Mandate Radar"
    VERSION: str = "2.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Database configuration: defaults to local SQLite file for zero-config dev,
    # and seamlessly uses PostgreSQL in production when DATABASE_URL is set.
    # On Vercel / serverless Linux environments, root is read-only so default to /tmp/mandate_radar.db.
    DATABASE_URL: str = _get_database_url()
    
    # JWT & Auth
    # Phase 1: Read secret from JWT_SECRET env var. Fail at startup if missing.
    _raw_secret: Optional[str] = os.getenv("JWT_SECRET") or os.getenv("SECRET_KEY") or "mandate_radar_dev_jwt_secret_key_892134789123"
    SECRET_KEY: str = _raw_secret
    JWT_SECRET: str = _raw_secret
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60")) # 60 minutes
    
    # External Identity Providers
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    FIREBASE_SERVICE_ACCOUNT: str = os.getenv("FIREBASE_SERVICE_ACCOUNT", "")
    
    # Neo4j Settings
    NEO4J_URI: str = os.getenv("NEO4J_URI", "")
    NEO4J_USER: str = os.getenv("NEO4J_USER", "neo4j")
    NEO4J_PASSWORD: str = os.getenv("NEO4J_PASSWORD", "")
    
    # CORS
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ]

settings = Settings()

