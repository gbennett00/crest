"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const PrivacyModeContext = createContext<{
  privacyMode: boolean;
  togglePrivacyMode: () => void;
}>({ privacyMode: false, togglePrivacyMode: () => {} });

const STORAGE_KEY = "crest-privacy-mode";

export function PrivacyModeProvider({ children }: { children: React.ReactNode }) {
  const [privacyMode, setPrivacyMode] = useState(false);

  useEffect(() => {
    setPrivacyMode(localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  const togglePrivacyMode = useCallback(() => {
    setPrivacyMode((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return (
    <PrivacyModeContext.Provider value={{ privacyMode, togglePrivacyMode }}>
      {children}
    </PrivacyModeContext.Provider>
  );
}

export function usePrivacyMode() {
  return useContext(PrivacyModeContext);
}
