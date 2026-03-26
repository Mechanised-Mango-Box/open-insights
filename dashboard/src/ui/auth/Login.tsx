//this file is meant to mock a google login
type Props = {
  onLogin: (user: {
    id: number;
    email: string;
    full_name: string;
    role: "teacher";
  }) => void;
};

import { createUser } from "../../api";

const Login = ({ onLogin }: Props) => {
  const handleMockGoogleLogin = async () => {
    const teacher = await createUser({
      email: "teacher@monash.edu",
      full_name: "Prototype Teacher",
      role: "teacher",
    });
    onLogin(teacher);
  };

  return (
    <div>
      <h1>Teacher Login</h1>
      <button onClick={handleMockGoogleLogin}>
        Sign in with Google
      </button>
    </div>
  );
};

export default Login;
