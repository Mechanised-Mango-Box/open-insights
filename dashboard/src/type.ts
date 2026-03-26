export type User = {
  id: number;
  email: string;
  full_name: string;
  role: "teacher" | "student";

};

export type Class = {
  id: number;
  name: string;
  teacher_id: number;
  join_code: string;
};

export type Video = {
  id: number;
  title: string;
  url: string;
  youtube_video_id: string;
};

export type ClassVideo = {
  class_video_id: number;
  video_id: number;
  title: string;
  url: string;
  youtube_video_id: string;
};

