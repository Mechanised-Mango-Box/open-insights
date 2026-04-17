//this file handles Google login via IPC
type Props = {
  onLogin: (user: {
    id: number;
    email: string;
    full_name: string;
    role: "teacher";
  }) => void;
};

const Login = ({ onLogin }: Props) => {
  const handleGoogleLogin = async () => {
    try {
      const response = await window.api.loginWithGoogle();
      if (response && response.user) {
        onLogin(response.user as any);
      }
    } catch (err) {
      console.error("Login failed:", err);
      alert("Login failed. Please try again.");
    }
  };

  return (
    <div>
      <h1>Teacher Login</h1>
      <button onClick={handleGoogleLogin}>
        Sign in with Google
      </button>
    </div>
  );
};

export default Login;
