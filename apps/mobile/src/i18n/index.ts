import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getLocales } from "expo-localization";
import { storage } from "@/lib/storage";

import en from "@/locales/en.json";
import pt from "@/locales/pt.json";
import es from "@/locales/es.json";
import fr from "@/locales/fr.json";

export const SUPPORTED_LANGUAGES = ["pt", "en", "es", "fr"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = "app_language";
const FALLBACK: AppLanguage = "en";

const resources = {
  en: { translation: en },
  pt: { translation: pt },
  es: { translation: es },
  fr: { translation: fr },
};

function deviceLanguage(): AppLanguage {
  const code = getLocales()[0]?.languageCode ?? FALLBACK;
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code)
    ? (code as AppLanguage)
    : FALLBACK;
}

// Synchronous init with the device language so the first render is already
// translated. A persisted override (if any) is applied right after, in
// loadPersistedLanguage().
i18n.use(initReactI18next).init({
  resources,
  lng: deviceLanguage(),
  fallbackLng: FALLBACK,
  supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export async function loadPersistedLanguage(): Promise<void> {
  const saved = await storage.getItem(LANGUAGE_STORAGE_KEY);
  if (saved && saved !== i18n.language && (SUPPORTED_LANGUAGES as readonly string[]).includes(saved)) {
    await i18n.changeLanguage(saved);
  }
}

export async function setLanguage(lang: AppLanguage): Promise<void> {
  await i18n.changeLanguage(lang);
  await storage.setItem(LANGUAGE_STORAGE_KEY, lang);
}

export default i18n;
