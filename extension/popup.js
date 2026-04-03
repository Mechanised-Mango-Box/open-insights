const API_BASE = "http://127.0.0.1:8000";

document.getElementById("saveStudent").addEventListener("click", async () => {
  const studentId = document.getElementById("studentId").value;
  await chrome.storage.local.set({ studentId });
  document.getElementById("status").textContent = `Saved student ${studentId}`;
});

document.getElementById("joinClass").addEventListener("click", async () => {
  const joinCode = document.getElementById("joinCode").value;
  const { studentId } = await chrome.storage.local.get("studentId");

  const res = await fetch(`${API_BASE}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      student_id: Number(studentId),
      join_code: joinCode
    }),
  });

  const data = await res.json();
  document.getElementById("status").textContent = JSON.stringify(data);
});
