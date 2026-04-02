export {};

declare global {
  interface Window {
    electronAPI: {
      openGoogleAuth: () => void;
    };
  }
}