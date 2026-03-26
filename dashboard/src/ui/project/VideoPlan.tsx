import { useState } from "react";
import { createVideo, addVideoToClass } from "../../api";

type Props = {
  classId: number;
  onAdded: () => void;
};

function extractYoutubeVideoId(input: string) {
  try {
    const url = new URL(input);
    return url.searchParams.get("v") || input;
  } catch {
    return input;
  }
}

const AddVideoForm = ({ classId, onAdded }: Props) => {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  const handleAdd = async () => {
    const youtube_video_id = extractYoutubeVideoId(url);
    const video = await createVideo({ url, title, youtube_video_id });
    await addVideoToClass({ class_id: classId, video_id: video.id });
    setUrl("");
    setTitle("");
    onAdded();
  };

  return (
    <div>
      <h4>Add YouTube Video</h4>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Video title"
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://youtube.com/watch?v=..."
      />
      <button onClick={handleAdd}>Add Video</button>
    </div>
  );
};

export default AddVideoForm;
