from pydantic import BaseModel
from typing import List


class UserCreate(BaseModel):
    email: str
    full_name: str
    role: str


class ClassCreate(BaseModel):
    name: str
    teacher_id: int


class VideoCreate(BaseModel):
    url: str
    youtube_video_id: str
    title: str


class AddVideoToClass(BaseModel):
    class_id: int
    video_id: int


class QuizOptionCreate(BaseModel):
    option_text: str


class QuizCheckpointCreate(BaseModel):
    class_video_id: int
    timestamp_seconds: int
    question_text: str
    options: List[QuizOptionCreate]


class JoinClassRequest(BaseModel):
    student_id: int
    join_code: str


class AttemptCreate(BaseModel):
    checkpoint_id: int
    student_id: int
    selected_option_id: int
