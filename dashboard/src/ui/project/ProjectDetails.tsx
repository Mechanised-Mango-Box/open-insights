import { useEffect, useState } from "react";
import { getClassVideos } from "../../api";
import AddVideoForm from "./VideoPlan";
import QuizEditor from "./QuizEditor";
import { ClassVideo } from "../../type";

type Props = {
  classId: number;
  joinCode: string;
};

const ProjectDetail = ({ classId, joinCode }: Props) => {
  const [videos, setVideos] = useState<ClassVideo[]>([]);

  const loadVideos = async () => {
    const data = await getClassVideos(classId);
    setVideos(data);
  };

  useEffect(() => {
    loadVideos();
  }, [classId]);

  return (
    <div>
      <h2>Class Detail</h2>
      <p>Join code: {joinCode}</p>

      <AddVideoForm classId={classId} onAdded={loadVideos} />

      <hr />

      {videos.map((video) => (
        <div key={video.class_video_id}>
          <h3>{video.title}</h3>
          <p>{video.url}</p>
          <QuizEditor classVideoId={video.class_video_id} />
          <hr />
        </div>
      ))}
    </div>
  );
};

export default ProjectDetail;
