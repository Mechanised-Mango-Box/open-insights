import os
import time
import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from db import get_db
from dbmodel import User

router = APIRouter()

# In-memory storage for oauth sessions
# Key: session_id, Value: {"token": "jwt_string", "user": dict, "expires_at": timestamp}
oauth_sessions = {}
SESSION_EXPIRATION_SECONDS = 180  # 3 minutes

def get_google_client_id():
    return os.getenv("GOOGLE_CLIENT_ID")

def get_google_client_secret():
    return os.getenv("GOOGLE_CLIENT_SECRET")

def get_jwt_secret():
    return os.getenv("JWT_SECRET")

REDIRECT_URI = "http://localhost:8000/auth/google/callback"


@router.get("/auth/google/login")
def login(session_id: str):
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id")
    
    client_id = get_google_client_id()
    if not client_id:
        raise HTTPException(status_code=500, detail="Google Client ID not configured")
        
    auth_url = (
        "https://accounts.google.com/o/oauth2/v2/auth?"
        "response_type=code&"
        f"client_id={client_id}&"
        f"redirect_uri={REDIRECT_URI}&"
        "scope=openid%20email%20profile&"
        f"state={session_id}&"
        "access_type=offline&"
        "prompt=consent"
    )
    return RedirectResponse(auth_url)

@router.get("/auth/google/callback")
async def callback(code: str, state: str, db: Session = Depends(get_db)):
    session_id = state
    
    # Simple garbage collection for expired sessions
    current_time = time.time()
    expired_keys = [k for k, v in oauth_sessions.items() if current_time > v.get("expires_at", 0)]
    for k in expired_keys:
        del oauth_sessions[k]

    if not code:
        return JSONResponse({"error": "Missing authorization code"}, status_code=400)

    client_id = get_google_client_id()
    client_secret = get_google_client_secret()
    
    if not client_id or not client_secret:
        return JSONResponse({"error": "Google credentials not configured"}, status_code=500)

    # 1. User fetch (via Google API)
    token_url = "https://oauth2.googleapis.com/token"
    token_data = {
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
    }
    
    async with httpx.AsyncClient() as client:
        token_res = await client.post(token_url, data=token_data)
        if token_res.status_code != 200:
            return JSONResponse({"error": "Failed to exchange authorization code"}, status_code=400)
            
        token_json = token_res.json()
        access_token = token_json.get("access_token")
        
        userinfo_res = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        if userinfo_res.status_code != 200:
            return JSONResponse({"error": "Failed to fetch user info"}, status_code=400)
            
        user_info = userinfo_res.json()
        
    email = user_info.get("email")
    full_name = user_info.get("name")
    
    if not email:
        return JSONResponse({"error": "No email returned from Google"}, status_code=400)

    # 2. User creation/retrieval in DB (role="teacher")
    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(email=email, full_name=full_name, role="teacher")
        db.add(user)
        db.commit()
        db.refresh(user)
    elif user.role != "teacher":
        return JSONResponse({"error": "User is not a teacher"}, status_code=403)
        
    # 3. JWT generation
    jwt_secret = get_jwt_secret()
    if not jwt_secret:
        return JSONResponse({"error": "JWT secret not configured"}, status_code=500)
        
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "exp": datetime.utcnow() + timedelta(days=7)
    }
    encoded_jwt = jwt.encode(payload, jwt_secret, algorithm="HS256")
    
    # 4. Session storage
    oauth_sessions[session_id] = {
        "token": encoded_jwt,
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role
        },
        "expires_at": time.time() + SESSION_EXPIRATION_SECONDS
    }
    
    # 5. Response: JSON/200 OK (no HTML)
    return JSONResponse({"message": "Login successful. You can close this window."})

@router.get("/auth/session/{session_id}")
def get_session(session_id: str):
    current_time = time.time()
    session_data = oauth_sessions.get(session_id)
    
    if not session_data:
        return JSONResponse({"status": "pending"})
        
    if current_time > session_data["expires_at"]:
        del oauth_sessions[session_id]
        return JSONResponse({"status": "expired"})
        
    # Valid session found: immediately delete it and return
    token = session_data["token"]
    user_data = session_data["user"]
    del oauth_sessions[session_id]
    
    return JSONResponse({
        "status": "success",
        "token": token,
        "user": user_data
    })
