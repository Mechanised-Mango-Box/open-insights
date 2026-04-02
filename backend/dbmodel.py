from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, DateTime, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False)
    full_name = Column(String, nullable=False)
    role = Column(String, nullable=False)  # teacher or student
    google_id = Column(String, unique=True, nullable=True)


class ClassRoom(Base):
    __tablename__ = "classes"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    join_code = Column(String, unique=True, nullable=False)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)


class ClassMember(Base):
    __tablename__ = "class_members"

    id = Column(Integer, primary_key=True, index=True)
    class_id = Column(Integer, ForeignKey("classes.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)


class Video(Base):
    __tablename__ = "videos"

    id = Column(Integer, primary_key=True, index=True)
    youtube_video_id = Column(String, index=True, nullable=False)
    url = Column(String, nullable=False)
    title = Column(String, nullable=False)


class ClassVideo(Base):
    __tablename__ = "class_videos"

    id = Column(Integer, primary_key=True, index=True)
    class_id = Column(Integer, ForeignKey("classes.id"), nullable=False)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False)


class QuizCheckpoint(Base):
    __tablename__ = "quiz_checkpoints"

    id = Column(Integer, primary_key=True, index=True)
    class_video_id = Column(Integer, ForeignKey("class_videos.id"), nullable=False)
    timestamp_seconds = Column(Integer, nullable=False)
    question_text = Column(Text, nullable=False)
    question_type = Column(String, default="mcq")
    is_active = Column(Boolean, default=True)


class QuizOption(Base):
    __tablename__ = "quiz_options"

    id = Column(Integer, primary_key=True, index=True)
    checkpoint_id = Column(Integer, ForeignKey("quiz_checkpoints.id"), nullable=False)
    option_text = Column(String, nullable=False)
    is_correct = Column(Boolean, default=False)


class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"

    id = Column(Integer, primary_key=True, index=True)
    checkpoint_id = Column(Integer, ForeignKey("quiz_checkpoints.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    selected_option_id = Column(Integer, ForeignKey("quiz_options.id"), nullable=True)
    is_correct = Column(Boolean, default=False)
    answered_at = Column(DateTime, default=datetime.utcnow)
