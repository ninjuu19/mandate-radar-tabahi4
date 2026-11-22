"""
Firebase Admin Auth Integration for Phone Authentication
Strictly verifies Firebase ID tokens emitted by Firebase Phone Auth.
"""
import os
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from typing import Optional, Dict, Any
from app.core.config import settings

_firebase_initialized = False

def ensure_firebase_initialized():
    global _firebase_initialized
    if not _firebase_initialized:
        svc_account = settings.FIREBASE_SERVICE_ACCOUNT
        if svc_account and os.path.exists(svc_account):
            cred = credentials.Certificate(svc_account)
            firebase_admin.initialize_app(cred)
        else:
            # Attempt initialize without service account or check existing
            if not firebase_admin._apps:
                try:
                    firebase_admin.initialize_app()
                except Exception:
                    pass
        _firebase_initialized = True

def verify_firebase_id_token(id_token_str: str) -> Dict[str, Any]:
    """
    Verifies Firebase ID token and extracts verified claims.
    Raises ValueError / AuthError if token is invalid or expired.
    """
    ensure_firebase_initialized()
    return firebase_auth.verify_id_token(id_token_str)
