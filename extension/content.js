const API_BASE = "http://127.0.0.1:8000";
let checkpoints = [];
let shownCheckpointIds = new Set();
let videoEl = null;

function getYoutubeVideoId() {
  const url = new URL(window.location.href);
  return url.searchParams.get("v");
}

async function loadCheckpoints() {
  const { studentId } = await chrome.storage.local.get("studentId");
  if (!studentId) return;

  const youtubeVideoId = getYoutubeVideoId();
  if (!youtubeVideoId) return;

  const res = await fetch(`${API_BASE}/students/${studentId}/video-context/${youtubeVideoId}`);
  const data = await res.json();

  checkpoints = data.flatMap(item => item.checkpoints).sort(
    (a, b) => a.timestamp_seconds - b.timestamp_seconds
  );
}

function createOverlay(checkpoint) {
  const overlay = document.createElement("div");
  overlay.id = "open-insights-quiz-overlay";

  const box = document.createElement("div");
  box.id = "open-insights-quiz-box";

  const title = document.createElement("h3");
  title.textContent = checkpoint.question_text;
  box.appendChild(title);

  checkpoint.options.forEach((option) => {
    const btn = document.createElement("button");
    btn.textContent = option.option_text;
    btn.style.display = "block";
    btn.style.marginBottom = "8px";
    btn.onclick = async () => {
      const { studentId } = await chrome.storage.local.get("studentId");

      await fetch(`${API_BASE}/attempts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkpoint_id: checkpoint.checkpoint_id,
          student_id: Number(studentId),
          selected_option_id: option.id
        }),
      });

      shownCheckpointIds.add(checkpoint.checkpoint_id);
      overlay.remove();
      if (videoEl) videoEl.play();
    };
    box.appendChild(btn);
  });

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function monitorPlayback() {
  if (!videoEl) return;

  setInterval(() => {
    if (!videoEl) return;

    const currentTime = Math.floor(videoEl.currentTime);
    const nextCheckpoint = checkpoints.find(
      (cp) =>
        !shownCheckpointIds.has(cp.checkpoint_id) &&
        currentTime >= cp.timestamp_seconds
    );

    if (nextCheckpoint) {
      videoEl.pause();
      createOverlay(nextCheckpoint);
    }
  }, 1000);
}

async function init() {
  videoEl = document.querySelector("video");
  if (!videoEl) return;

  await loadCheckpoints();
  monitorPlayback();
}

window.addEventListener("load", () => {
  setTimeout(init, 2000);
});
