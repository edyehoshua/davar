import React, { createContext, useEffect, useMemo, useRef } from "react";

import { getColors } from "@/src/theme";
import { useAppStore, type AppState } from "@/src/store/useAppStore";
import {
  type AppLanguage,
  loadBesorahTextVersion,
  loadBookmarks,
  loadCurrentVerseId,
  loadHebrewFontScale,
  loadHebrewOnly,
  loadLanguage,
  loadSeferMode,
  loadShowFullChapter,
  loadShowQumran,
  loadTranslationOnly,
  loadThemeMode,
  saveBookmarks,
  saveBesorahTextVersion,
  saveCurrentVerseId,
  saveHebrewFontScale,
  saveHebrewOnly,
  saveLanguage,
  saveSeferMode,
  saveShowFullChapter,
  saveShowQumran,
  saveTranslationOnly,
  saveThemeMode,
} from "@/src/services/storage";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { initializeDatabase } from "@/src/services/database";
import {
  getAllLocalBundleVersions,
  fetchRemoteBundleVersions,
} from "@/src/services/offlineSync";

export type AppTheme = {
  mode: "light" | "dark";
  colors: ReturnType<typeof getColors>;
};

export const AppThemeContext = createContext<AppTheme>({
  mode: "light",
  colors: getColors("light"),
});

export const AppProvider = ({ children }: { children: React.ReactNode }) => {
  const hasHydratedSettingsRef = useRef(false);
  const shouldPersistSettings = () => hasHydratedSettingsRef.current;

  // Network connectivity monitoring
  useNetworkStatus();

  const themeMode = useAppStore((state: AppState) => state.themeMode);
  const setThemeMode = useAppStore((state: AppState) => state.setThemeMode);
  const hebrewFontScale = useAppStore(
    (state: AppState) => state.hebrewFontScale,
  );
  const setHebrewFontScale = useAppStore(
    (state: AppState) => state.setHebrewFontScale,
  );
  const language = useAppStore((state: AppState) => state.language);
  const setLanguage = useAppStore((state: AppState) => state.setLanguage);
  const besorahTextVersion = useAppStore(
    (state: AppState) => state.besorahTextVersion,
  );
  const setBesorahTextVersion = useAppStore(
    (state: AppState) => state.setBesorahTextVersion,
  );
  const showQumran = useAppStore((state: AppState) => state.showQumran);
  const setShowQumran = useAppStore((state: AppState) => state.setShowQumran);
  const showFullChapter = useAppStore(
    (state: AppState) => state.showFullChapter,
  );
  const setShowFullChapter = useAppStore(
    (state: AppState) => state.setShowFullChapter,
  );
  const seferMode = useAppStore((state: AppState) => state.seferMode);
  const setSeferMode = useAppStore((state: AppState) => state.setSeferMode);
  const hebrewOnly = useAppStore((state: AppState) => state.hebrewOnly);
  const setHebrewOnly = useAppStore((state: AppState) => state.setHebrewOnly);
  const translationOnly = useAppStore(
    (state: AppState) => state.translationOnly,
  );
  const setTranslationOnly = useAppStore(
    (state: AppState) => state.setTranslationOnly,
  );
  const bookmarks = useAppStore((state: AppState) => state.bookmarks);
  const setBookmarks = useAppStore((state: AppState) => state.setBookmarks);
  const currentVerseId = useAppStore(
    (state: AppState) => state.currentVerseId,
  );
  const setCurrentVerseId = useAppStore(
    (state: AppState) => state.setCurrentVerseId,
  );
  const setLocalBundleVersions = useAppStore(
    (state: AppState) => state.setLocalBundleVersions,
  );
  const localBundleVersions = useAppStore(
    (state: AppState) => state.localBundleVersions,
  );
  const setOfflineStatus = useAppStore(
    (state: AppState) => state.setOfflineStatus,
  );
  const setOfflineUpdateAvailable = useAppStore(
    (state: AppState) => state.setOfflineUpdateAvailable,
  );
  const isConnected = useAppStore((state: AppState) => state.isConnected);

  const value = useMemo(
    () => ({
      mode: themeMode,
      colors: getColors(themeMode),
    }),
    [themeMode],
  );

  useEffect(() => {
    const hydrate = async () => {
      try {
        const [
          savedTheme,
          savedScale,
          savedBookmarks,
          savedLanguage,
          savedBesorahTextVersion,
          savedShowQumran,
          savedShowFullChapter,
          savedSeferMode,
          savedHebrewOnly,
          savedTranslationOnly,
          savedVerseId,
        ] = await Promise.all([
          loadThemeMode(),
          loadHebrewFontScale(),
          loadBookmarks(),
          loadLanguage(),
          loadBesorahTextVersion(),
          loadShowQumran(),
          loadShowFullChapter(),
          loadSeferMode(),
          loadHebrewOnly(),
          loadTranslationOnly(),
          loadCurrentVerseId(),
        ]);
        setThemeMode(savedTheme);
        setHebrewFontScale(savedScale);
        setBookmarks(savedBookmarks);
        setLanguage(savedLanguage as AppLanguage);
        setBesorahTextVersion(savedBesorahTextVersion);
        // Translation-only has cascading defaults. Restore it before the
        // explicitly saved chapter and Sefer preferences.
        setTranslationOnly(savedTranslationOnly);
        setShowQumran(savedShowQumran);
        setHebrewOnly(savedHebrewOnly);
        setShowFullChapter(savedShowFullChapter);
        setSeferMode(savedSeferMode);
        if (savedVerseId) {
          setCurrentVerseId(savedVerseId);
        }
      } finally {
        hasHydratedSettingsRef.current = true;
      }
    };

    hydrate();
  }, [
    setThemeMode,
    setHebrewFontScale,
    setBookmarks,
    setLanguage,
    setBesorahTextVersion,
    setShowQumran,
    setShowFullChapter,
    setSeferMode,
    setHebrewOnly,
    setTranslationOnly,
    setCurrentVerseId,
  ]);

  // Load offline bundle versions from SQLite and check for updates
  useEffect(() => {
    const loadOfflineState = async () => {
      try {
        await initializeDatabase();
        const versions = await getAllLocalBundleVersions();
        setLocalBundleVersions(versions);

        // Determine initial offline status based on whether any bundles are downloaded
        const hasAnyBundles = Object.keys(versions).length > 0;
        if (hasAnyBundles) {
          setOfflineStatus("ready");
        }
      } catch (error) {
        console.error("Failed to load offline state:", error);
      }
    };
    loadOfflineState();
  }, [setLocalBundleVersions, setOfflineStatus]);

  // Check for updates when connected
  useEffect(() => {
    if (!isConnected) return;

    const checkUpdates = async () => {
      try {
        const localVersions = localBundleVersions;
        if (Object.keys(localVersions).length === 0) return;

        const remoteVersions = await fetchRemoteBundleVersions();
        // Only check bundles the user actually has locally — remote may
        // contain bundles for other languages (tth vs ts2009) that the
        // user never downloaded, which would always look like an "update".
        const needsUpdate = Object.entries(localVersions).some(
          ([bundle, localV]) => (remoteVersions[bundle] ?? 0) > (localV ?? 0),
        );

        setOfflineUpdateAvailable(needsUpdate);
      } catch {
        // Silent failure — don't disrupt the user
      }
    };
    checkUpdates();
  }, [isConnected, localBundleVersions, setOfflineUpdateAvailable]);

  useEffect(() => {
    if (!shouldPersistSettings()) {
      return;
    }
    saveThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!shouldPersistSettings()) {
      return;
    }
    saveHebrewFontScale(hebrewFontScale);
  }, [hebrewFontScale]);

  useEffect(() => {
    if (!shouldPersistSettings()) {
      return;
    }
    saveLanguage(language);
  }, [language]);

  useEffect(() => {
    if (!shouldPersistSettings()) {
      return;
    }
    saveBesorahTextVersion(besorahTextVersion);
  }, [besorahTextVersion]);

  useEffect(() => {
    if (!shouldPersistSettings()) {
      return;
    }
    saveShowQumran(showQumran);
  }, [showQumran]);

  useEffect(() => {
    if (!shouldPersistSettings()) {
      return;
    }
    saveShowFullChapter(showFullChapter);
  }, [showFullChapter]);

  useEffect(() => {
    if (!shouldPersistSettings()) {
      return;
    }
    saveSeferMode(seferMode);
  }, [seferMode]);

  useEffect(() => {
    if (!shouldPersistSettings()) {
      return;
    }
    saveHebrewOnly(hebrewOnly);
  }, [hebrewOnly]);

  useEffect(() => {
    if (!shouldPersistSettings()) {
      return;
    }
    saveTranslationOnly(translationOnly);
  }, [translationOnly]);

  useEffect(() => {
    if (!shouldPersistSettings()) {
      return;
    }
    saveBookmarks(bookmarks);
  }, [bookmarks]);

  useEffect(() => {
    if (!shouldPersistSettings()) {
      return;
    }
    saveCurrentVerseId(currentVerseId);
  }, [currentVerseId]);

  return (
    <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>
  );
};
