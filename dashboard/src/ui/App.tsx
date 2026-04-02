import { useState, useEffect } from "react";
import { User } from "src/type"; 
import Login from "../ui/auth/Login";
import ProjectDashboard from "./project/ProjectDashboard";

const App = () => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    // When Google redirects back to localhost:5173?token=xxx
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      // Decode JWT payload (middle part) 
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUser({
        id: parseInt(payload.sub),
        email: payload.email,
        full_name: payload.full_name,
        role: payload.role,
      });
      // Clean token from URL
      window.history.replaceState({}, '', '/');
      // Store for session persistence (fine for now)
      localStorage.setItem('token', token);
    } else {
      // Check if already logged in from a previous session
      const stored = localStorage.getItem('token');
      if (stored) {
        const payload = JSON.parse(atob(stored.split('.')[1]));
        setUser({
          id: parseInt(payload.sub),
          email: payload.email,
          full_name: payload.full_name,
          role: payload.role,
        });
      }
    }
  }, []);

  if (!user) return <Login onLogin={setUser} />;
  return <ProjectDashboard teacher={user} />;
};
export default App;
