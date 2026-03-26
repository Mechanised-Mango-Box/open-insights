import { useEffect, useState } from "react";
import { getTeacherClasses } from "../../api";
import CreateProject from "./CreateProject";
import ProjectDetails from "./ProjectDetails";
import { Project, User } from "../../type";

type Props = {
  teacher: User;
};

const ProjectDashboard = ({ teacher }: Props) => {
  const [classes, setClasses] = useState<Project[]>([]);
  const [selectedClass, setSelectedClass] = useState<Project | null>(null);

  const loadClasses = async () => {
    const data = await getTeacherClasses(teacher.id);
    setClasses(data);
    if (!selectedClass && data.length > 0) {
      setSelectedClass(data[0]);
    }
  };

  useEffect(() => {
    loadClasses();
  }, []);

  return (
    <div>
      <h1>Welcome, {teacher.full_name}</h1>
      <p>{teacher.email}</p>

      <CreateProject teacherId={teacher.id} onCreated={loadClasses} />

      <h2>Your Classes</h2>
      {classes.map((c) => (
        <div key={c.id}>
          <button onClick={() => setSelectedClass(c)}>
            {c.name}
          </button>
          <span> join code: {c.join_code}</span>
        </div>
      ))}

      {selectedClass && (
        <ProjectDetails
          classId={selectedClass.id}
          joinCode={selectedClass.join_code}
        />
      )}
    </div>
  );
};

export default ProjectDashboard;
