import { useState } from "react";
import Login from "./auth/Login";
import ProjectDashboard from "./project/ProjectDashboard";
import { User } from "../type";

const App = () => {
  const [teacher, setTeacher] = useState<User | null>(null);

  if (!teacher) {
    return <Login onLogin={setTeacher} />;
  }

  return <ProjectDashboard teacher={teacher} />;
};

export default App;
