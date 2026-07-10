"""
Educational Video Feature Extractor
Task 1 starter code — extracts key features from YouTube videos:
  - Duration (minutes)
  - Word count (from transcript)
  - Speaking speed (words per minute)
  - Scene transition count
  - Scene transition rate (per minute)

Dependencies:
    pip install yt-dlp openai-whisper opencv-python pandas
    pip install yt-dlp openai-whisper opencv-python-headless pandas  # (headless for servers)
"""

import os
import subprocess
import csv
import whisper
import cv2
import pandas as pd




DOWNLOAD_DIR = "downloads"          # where video/audio files go
OUTPUT_CSV   = "video_features.csv" # where results are saved
SCENE_THRESHOLD = 30.0              # pixel diff threshold for scene change detection
WHISPER_MODEL   = "base"            # whisper model size: tiny, base, small, medium, large


# function to download YT Video into mp4


def download_video(youtube_url: str, output_dir: str) -> str:
    """
    Downloads a YouTube video using yt-dlp.
    Returns the path to the downloaded file.
    """
    os.makedirs(output_dir, exist_ok=True)

    # Output template: saves as downloads/<video_id>.mp4
    output_template = os.path.join(output_dir, "%(id)s.%(ext)s")

    subprocess.run([
        "yt-dlp",
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4",  # prefer mp4
        "-o", output_template,
        "--merge-output-format", "mp4",
        youtube_url
    ], check=True)

    # Find the downloaded file
    for f in os.listdir(output_dir):
        if f.endswith(".mp4"):
            return os.path.join(output_dir, f)

    raise FileNotFoundError("Download failed — no .mp4 found in output dir.")



# STEP 2: Extract duration using OpenCV

def get_duration_minutes(video_path: str) -> float:
    """
    Returns video duration in minutes using OpenCV.
    Same approach as the EduVideo Insights paper.
    """
    cap = cv2.VideoCapture(video_path)
    fps         = cap.get(cv2.CAP_PROP_FPS)
    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    cap.release()

    if fps == 0:
        return 0.0

    duration_seconds = frame_count / fps
    return round(duration_seconds / 60, 4)



# STEP 3: Count scene transitions using OpenCV

def count_scene_transitions(video_path: str, threshold: float = SCENE_THRESHOLD) -> int:
    """
    Counts scene/slide transitions by comparing pixel-level differences
    between consecutive frames. Matches the EduVideo Insights method.
    """
    cap = cv2.VideoCapture(video_path)
    transitions = 0
    prev_frame  = None

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        if prev_frame is not None:
            diff = cv2.absdiff(gray, prev_frame)
            mean_diff = diff.mean()
            if mean_diff > threshold:
                transitions += 1

        prev_frame = gray

    cap.release()
    return transitions


# ─────────────────────────────────────────────
# STEP 4: Transcribe audio and get word count
# ─────────────────────────────────────────────

def transcribe_and_count(video_path: str, model_size: str = WHISPER_MODEL) -> tuple[int, str]:
    """
    Uses OpenAI Whisper to transcribe audio from the video.
    Returns (word_count, transcript_text).
    """
    print(f"  Transcribing with Whisper ({model_size})...")
    model  = whisper.load_model(model_size)
    result = model.transcribe(video_path)

    transcript = result["text"].strip()
    word_count = len(transcript.split())

    return word_count, transcript


# ─────────────────────────────────────────────
# STEP 5: Derive calculated features
# ─────────────────────────────────────────────

def derive_features(duration_min: float, word_count: int, scene_count: int) -> dict:
    """
    Derives speaking speed (wpm) and scene change rate (spm)
    from raw extracted values.
    """
    speaking_speed_wpm = round(word_count / duration_min, 2) if duration_min > 0 else 0
    scene_rate_spm     = round(scene_count / duration_min, 2) if duration_min > 0 else 0

    return {
        "speaking_speed_wpm": speaking_speed_wpm,
        "scene_rate_spm":     scene_rate_spm,
    }


# ─────────────────────────────────────────────
# MAIN: Process a list of YouTube URLs
# ─────────────────────────────────────────────

def process_videos(youtube_urls: list[str], output_csv: str = OUTPUT_CSV):
    """
    Full pipeline: download → extract features → save to CSV.
    """
    results = []

    for url in youtube_urls:
        print(f"\n{'='*50}")
        print(f"Processing: {url}")

        try:
            # 1. Download
            print("  Downloading video...")
            video_path = download_video(url, DOWNLOAD_DIR)
            print(f"  Saved to: {video_path}")

            # 2. Duration
            duration_min = get_duration_minutes(video_path)
            print(f"  Duration: {duration_min} minutes")

            # 3. Scene transitions
            print("  Counting scene transitions...")
            scene_count = count_scene_transitions(video_path)
            print(f"  Scene transitions: {scene_count}")

            # 4. Transcription + word count
            word_count, transcript = transcribe_and_count(video_path)
            print(f"  Word count: {word_count}")

            # 5. Derived features
            derived = derive_features(duration_min, word_count, scene_count)

            # 6. Collect result
            video_id = os.path.splitext(os.path.basename(video_path))[0]
            row = {
                "video_id":            video_id,
                "youtube_url":         url,
                "duration_min":        duration_min,
                "word_count":          word_count,
                "speaking_speed_wpm":  derived["speaking_speed_wpm"],
                "scene_count":         scene_count,
                "scene_rate_spm":      derived["scene_rate_spm"],
                "transcript_preview":  transcript[:200] + "..." if len(transcript) > 200 else transcript,
            }
            results.append(row)
            print(f"  ✓ Done: {row}")

        except Exception as e:
            print(f"  ✗ Error processing {url}: {e}")
            results.append({"youtube_url": url, "error": str(e)})

    # Save to CSV
    df = pd.DataFrame(results)
    df.to_csv(output_csv, index=False)
    print(f"\n✓ Features saved to: {output_csv}")
    return df


# ─────────────────────────────────────────────
# ENTRY POINT — add your YouTube URLs here
# ─────────────────────────────────────────────

if __name__ == "__main__":

    # TODO: Replace with your actual YouTube video URLs
    VIDEO_URLS = [
        "https://www.youtube.com/watch?v=EXAMPLE_ID_1",
        "https://www.youtube.com/watch?v=EXAMPLE_ID_2",
    ]

    df = process_videos(VIDEO_URLS)
    print("\nFinal dataset preview:")
    print(df.to_string())