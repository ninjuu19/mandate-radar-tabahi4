"""
Authentication dependency for Mandate Radar API.
Strictly verifies JWT Bearer token signature and expiry (60 min),
loading the user identity from the verified 'sub' claim.
Never trusts client-supplied identity parameters (user_id, email, phone).
"""
from fastapi import Header, HTTPException, status, Depends
from sqlalchemy.orm import Session
from typing import Optional

from app.core.db import get_db
from app.models.user import User
from app.services.auth_service import decode_access_token

def get_current_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
) -> User:
    """
    Enforces JWT authentication on protected routes.
    Decodes and verifies HS256 JWT, checks expiration, and retrieves user.
    Returns 401 on missing, tampered, expired, or invalid tokens.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization token required. Missing Bearer token in Authorization header.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    token = authorization.split(" ", 1)[1].strip()
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is invalid or has expired. Please authenticate again.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    user_id = str(payload["sub"])
    user = db.query(User).filter(User.id == user_id).first()
    
    # If not found directly by ID, check email claim
    if not user:
        email = payload.get("email")
        if email:
            user = db.query(User).filter(User.email == email).first()
            
    if not user:
        # Auto-provision authenticated user record from valid signed JWT claims
        email = payload.get("email") or f"{user_id}@mandateradar.in"
        full_name = payload.get("full_name") or f"User {user_id}"
        user = User(
            id=user_id,
            email=email,
            full_name=full_name,
            password_hash="JWT_VERIFIED",
            is_active=True
        )
        try:
            db.add(user)
            db.commit()
            db.refresh(user)
        except Exception:
            db.rollback()
            user = db.query(User).filter((User.id == user_id) | (User.email == email)).first()
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authenticated user record not found. Please re-authenticate.",
                    headers={"WWW-Authenticate": "Bearer"}
                )

    return user
