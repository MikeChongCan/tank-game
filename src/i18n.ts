import enPo from "./locales/en.po?raw";
import zhCnPo from "./locales/zh-CN.po?raw";

export type Locale = "en" | "zh-CN";
export type Translate = (key: string, values?: Record<string, string | number>) => string;

interface I18n {
  locale: Locale;
  t: Translate;
}

const DEFAULT_LOCALE: Locale = "en";
const CATALOGS: Record<Locale, Record<string, string>> = {
  en: parsePo(enPo),
  "zh-CN": parsePo(zhCnPo),
};

export function createI18n(): I18n {
  const locale = detectLocale();
  return {
    locale,
    t: (key, values) => interpolate(CATALOGS[locale][key] ?? CATALOGS[DEFAULT_LOCALE][key] ?? key, values),
  };
}

function detectLocale(): Locale {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("lang");
  const languages = requested ? [requested] : navigator.languages.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh-CN" : DEFAULT_LOCALE;
}

function parsePo(source: string): Record<string, string> {
  const catalog: Record<string, string> = {};
  const entries = source.split(/\n\s*\n/);
  for (const entry of entries) {
    const msgid = readPoField(entry, "msgid");
    const msgstr = readPoField(entry, "msgstr");
    if (msgid) {
      catalog[msgid] = msgstr;
    }
  }
  return catalog;
}

function readPoField(entry: string, field: "msgid" | "msgstr"): string {
  const lines = entry.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${field} `));
  if (start === -1) return "";

  const parts: string[] = [lines[start]!.slice(field.length).trim()];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (!line.startsWith('"')) break;
    parts.push(line);
  }

  return parts.map((part) => JSON.parse(part) as string).join("");
}

function interpolate(text: string, values?: Record<string, string | number>): string {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}
