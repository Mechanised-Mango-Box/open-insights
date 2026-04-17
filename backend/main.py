from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from db import Base, engine, get_db
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
import jwt
import os
from auth import router as auth_router

load_dotenv()

security = HTTPBearer()

def get_current_teacher(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)):
    token = credentials.credentials
    secret = os.getenv("JWT_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="JWT secret not configured")
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        role = payload.get("role")
        if role != "teacher":
            raise HTTPException(status_code=403, detail="Not authorized as teacher")
        email = payload.get("email")
        if email is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
        
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user

from dbmodel import (
    User,
    ClassRoom,
    ClassMember,
    Video,
    ClassVideo,
    QuizCheckpoint,
    QuizOption,
    QuizAttempt,
)
from dbschema import (
    UserCreate,
    ClassCreate,
    VideoCreate,
    AddVideoToClass,
    QuizCheckpointCreate,
    JoinClassRequest,
    AttemptCreate,
)
import random
import string

# in the interest of writing a quick prototype, this file has been written by ChatGPT
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)

Base.metadata.create_all(bind=engine)


def generate_join_code(length=6):
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))


@app.post("/users")
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        return existing
    user = User(email=payload.email, full_name=payload.full_name, role=payload.role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.post("/classes")
def create_class(payload: ClassCreate, db: Session = Depends(get_db), current_teacher: User = Depends(get_current_teacher)):
    classroom = ClassRoom(
        name=payload.name, teacher_id=payload.teacher_id, join_code=generate_join_code()
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)
    return classroom


@app.get("/teachers/{teacher_id}/classes")
def get_teacher_classes(teacher_id: int, db: Session = Depends(get_db), current_teacher: User = Depends(get_current_teacher)):
    return db.query(ClassRoom).filter(ClassRoom.teacher_id == teacher_id).all()


@app.post("/videos")
def create_video(payload: VideoCreate, db: Session = Depends(get_db), current_teacher: User = Depends(get_current_teacher)):
    video = Video(
        url=payload.url, youtube_video_id=payload.youtube_video_id, title=payload.title
    )
    db.add(video)
    db.commit()
    db.refresh(video)
    return video


@app.post("/class-videos")
def add_video_to_class(payload: AddVideoToClass, db: Session = Depends(get_db), current_teacher: User = Depends(get_current_teacher)):
    class_video = ClassVideo(class_id=payload.class_id, video_id=payload.video_id)
    db.add(class_video)
    db.commit()
    db.refresh(class_video)
    return class_video


@app.get("/classes/{class_id}/videos")
def get_class_videos(class_id: int, db: Session = Depends(get_db), current_teacher: User = Depends(get_current_teacher)):
    class_videos = db.query(ClassVideo).filter(ClassVideo.class_id == class_id).all()
    result = []
    for cv in class_videos:
        video = db.query(Video).filter(Video.id == cv.video_id).first()
        result.append(
            {
                "class_video_id": cv.id,
                "video_id": video.id,
                "youtube_video_id": video.youtube_video_id,
                "title": video.title,
                "url": video.url,
            }
        )
    return result


@app.post("/quiz-checkpoints")
def create_checkpoint(payload: QuizCheckpointCreate, db: Session = Depends(get_db), current_teacher: User = Depends(get_current_teacher)):
    checkpoint = QuizCheckpoint(
        class_video_id=payload.class_video_id,
        timestamp_seconds=payload.timestamp_seconds,
        question_text=payload.question_text,
    )
    db.add(checkpoint)
    db.commit()
    db.refresh(checkpoint)

    for opt in payload.options:
        db.add(
            QuizOption(
                checkpoint_id=checkpoint.id,
                option_text=opt.option_text,
                is_correct=opt.is_correct,
            )
        )
    db.commit()

    return {"checkpoint_id": checkpoint.id, "message": "created"}


@app.post("/join")
def join_class(payload: JoinClassRequest, db: Session = Depends(get_db)):
    classroom = (
        db.query(ClassRoom).filter(ClassRoom.join_code == payload.join_code).first()
    )
    if not classroom:
        raise HTTPException(status_code=404, detail="Invalid join code")

    existing = (
        db.query(ClassMember)
        .filter(
            ClassMember.class_id == classroom.id,
            ClassMember.student_id == payload.student_id,
        )
        .first()
    )

    if existing:
        return {"message": "Already joined", "class_id": classroom.id}

    membership = ClassMember(class_id=classroom.id, student_id=payload.student_id)
    db.add(membership)
    db.commit()
    return {"message": "Joined", "class_id": classroom.id, "class_name": classroom.name}


@app.get("/students/{student_id}/video-context/{youtube_video_id}")
def get_video_context(
    student_id: int, youtube_video_id: str, db: Session = Depends(get_db)
):
    memberships = (
        db.query(ClassMember).filter(ClassMember.student_id == student_id).all()
    )
    class_ids = [m.class_id for m in memberships]

    matches = []
    for class_id in class_ids:
        class_videos = (
            db.query(ClassVideo).filter(ClassVideo.class_id == class_id).all()
        )
        for cv in class_videos:
            video = db.query(Video).filter(Video.id == cv.video_id).first()
            if video and video.youtube_video_id == youtube_video_id:
                checkpoints = (
                    db.query(QuizCheckpoint)
                    .filter(
                        QuizCheckpoint.class_video_id == cv.id,
                        QuizCheckpoint.is_active == True,
                    )
                    .all()
                )

                checkpoint_data = []
                for cp in checkpoints:
                    options = (
                        db.query(QuizOption)
                        .filter(QuizOption.checkpoint_id == cp.id)
                        .all()
                    )
                    checkpoint_data.append(
                        {
                            "checkpoint_id": cp.id,
                            "timestamp_seconds": cp.timestamp_seconds,
                            "question_text": cp.question_text,
                            "options": [
                                {"id": o.id, "option_text": o.option_text}
                                for o in options
                            ],
                        }
                    )

                matches.append(
                    {
                        "class_id": class_id,
                        "class_video_id": cv.id,
                        "checkpoints": checkpoint_data,
                    }
                )

    return matches


@app.post("/attempts")
def submit_attempt(payload: AttemptCreate, db: Session = Depends(get_db)):
    option = (
        db.query(QuizOption).filter(QuizOption.id == payload.selected_option_id).first()
    )
    if not option:
        raise HTTPException(status_code=404, detail="Option not found")

    attempt = QuizAttempt(
        checkpoint_id=payload.checkpoint_id,
        student_id=payload.student_id,
        selected_option_id=payload.selected_option_id,
        is_correct=option.is_correct,
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)

    return {"attempt_id": attempt.id, "is_correct": attempt.is_correct}
