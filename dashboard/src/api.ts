//used for calling on the backend
const API_BASE = "http://127.0.0.1:8000";

async function getAuthHeaders() {
  const auth = await window.api.getAuthToken();
  if (auth.error || !auth.token) {
    throw new Error(auth.error || "Missing authentication token");
  }
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${auth.token}`,
  };
}

export async function createUser(payload: {
  email: string;
  full_name: string;
  role: string;
}) {
  const res = await fetch(`${API_BASE}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function createClass(payload: {
  name: string;
  teacher_id: number;
}) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/classes`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function getTeacherClasses(teacherId: number) {
  const headers = await getAuthHeaders();
  // Remove Content-Type for GET
  const { "Content-Type": _, ...getHeaders } = headers;
  const res = await fetch(`${API_BASE}/teachers/${teacherId}/classes`, {
    headers: getHeaders,
  });
  return res.json();
}

export async function createVideo(payload: {
  title: string;
  url: string;
  youtube_video_id: string;
}) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/videos`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function addVideoToClass(payload: {
  class_id: number;
  video_id: number;
}) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/class-videos`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function getClassVideos(classId: number) {
  const headers = await getAuthHeaders();
  const { "Content-Type": _, ...getHeaders } = headers;
  const res = await fetch(`${API_BASE}/classes/${classId}/videos`, {
    headers: getHeaders,
  });
  return res.json();
}

export async function createCheckpoint(payload: {
  class_video_id: number;
  timestamp_seconds: number;
  question_text: string;
  options: { option_text: string; is_correct: boolean }[];
}) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/quiz-checkpoints`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return res.json();
}
