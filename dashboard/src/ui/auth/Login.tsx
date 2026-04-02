type Props = {
  onLogin: (user: {
    id: number;
    email: string;
    full_name: string;
    role: "teacher";
  }) => void;
};

const Login = ({ onLogin }: Props) => {
  const handleGoogleLogin = () => {
    window.electronAPI.openGoogleAuth();
  };

  return (
    <div>
      <h1>Login</h1>
      <button onClick={handleGoogleLogin}>
        Sign in with Google
      </button>
    </div>
  );
};

export default Login;