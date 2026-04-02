from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from authlib.integrations.httpx_client import AsyncOAuth2Client
from db import get_db
from dbmodel import User
from jose import jwt
import os
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
JWT_SECRET = os.getenv("JWT_SECRET")
REDIRECT_URI = "http://localhost:8000/auth/google/callback"
FRONTEND_URL = "http://localhost:5173"


@router.get("/auth/google/login")
async def google_login():
    async with AsyncOAuth2Client(
        client_id=GOOGLE_CLIENT_ID,
        redirect_uri=REDIRECT_URI,
    ) as client:
        uri, _ = client.create_authorization_url(
            "https://accounts.google.com/o/oauth2/auth",
            scope="openid email profile",
        )
    return RedirectResponse(uri)


@router.get("/auth/google/callback")
async def google_callback(code: str, db: Session = Depends(get_db)):
    async with AsyncOAuth2Client(
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        redirect_uri=REDIRECT_URI,
    ) as client:
        # Exchange code for tokens
        token = await client.fetch_token(
            "https://oauth2.googleapis.com/token",
            code=code,
        )
        # Get user info from Google
        resp = await client.get("https://www.googleapis.com/oauth2/v3/userinfo")
        google_user = resp.json()

    # Find or create user in DB
    user = db.query(User).filter(User.google_id == google_user["sub"]).first()
    if not user:
        # Check if email already exists (e.g. from mock login era)
        user = db.query(User).filter(User.email == google_user["email"]).first()
        if user:
            user.google_id = google_user["sub"]
        else:
            user = User(
                email=google_user["email"],
                full_name=google_user["name"],
                role="teacher",  # default for now, you can add role selection later
                google_id=google_user["sub"],
            )
            db.add(user)
        db.commit()
        db.refresh(user)

    # Issue your own JWT
    token_data = {
        "sub": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
    }
    jwt_token = jwt.encode(token_data, JWT_SECRET, algorithm="HS256")

    # Redirect back to React with token in URL
    return RedirectResponse(f"{FRONTEND_URL}?token={jwt_token}")