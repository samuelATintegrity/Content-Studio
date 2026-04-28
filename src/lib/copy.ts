import type { ContentType, Language } from "./types";

// Language-matched landing pages.
export const QUIZ_URLS: Record<Language, string> = {
  en: "http://agentxmatch.com/quiz",
  tl: "http://agentxmatch.com/tagalog",
  es: "http://agentxmatch.com/spanish",
  zh: "http://agentxmatch.com/mandarin",
};

// Localized bottom-band CTA. Hardcoded so it's identical on every image, every batch.
export const CTA_TEXT: Record<Language, string> = {
  en: "CONNECT WITH AN AGENT",
  tl: "MAKIPAG-UGNAYAN SA AHENTE",
  es: "CONECTA CON UN AGENTE",
  zh: "联系经纪人",
};

// "Fill out the form..." line that sits between the URL and the post body.
// Tuned per content type so it actually matches the topic.
export const FORM_LINE: Record<ContentType, Record<Language, string>> = {
  zero_down_generic: {
    en: "Fill out the form to connect with an agent and lender who can help you navigate $0 down programs.",
    tl: "Punan ang form para makipag-ugnayan sa isang ahente at lender na makakatulong sa iyo sa mga $0 down na programa.",
    es: "Llena el formulario para conectarte con un agente y prestamista que pueden ayudarte con los programas de $0 de enganche.",
    zh: "填写表格，与可以帮助您了解 $0 首付项目的经纪人和贷款专员联系。",
  },
  edu_zero_down_usda_local: {
    en: "Fill out the form to connect with an agent and lender who can help you navigate USDA and local $0 down programs.",
    tl: "Punan ang form para makipag-ugnayan sa isang ahente at lender na makakatulong sa USDA at lokal na $0 down na programa.",
    es: "Llena el formulario para conectarte con un agente y prestamista que pueden ayudarte con USDA y los programas locales de $0 de enganche.",
    zh: "填写表格，与可以帮助您了解 USDA 和本地 $0 首付项目的经纪人和贷款专员联系。",
  },
  edu_dpa_local: {
    en: "Fill out the form to connect with an agent and lender who can help you navigate down payment assistance programs.",
    tl: "Punan ang form para makipag-ugnayan sa isang ahente at lender na makakatulong sa mga down payment assistance na programa.",
    es: "Llena el formulario para conectarte con un agente y prestamista que pueden ayudarte con los programas de asistencia para el enganche.",
    zh: "填写表格，与可以帮助您了解首付援助项目的经纪人和贷款专员联系。",
  },
  language_match: {
    en: "Fill out the form to connect with an agent and lender who speaks your language and can help you navigate first-time-buyer programs.",
    tl: "Punan ang form para makipag-ugnayan sa isang ahente at lender na nagsasalita ng iyong wika at makakatulong sa first-time-buyer na programa.",
    es: "Llena el formulario para conectarte con un agente y prestamista que hable tu idioma y pueda ayudarte con los programas para compradores por primera vez.",
    zh: "填写表格，与会说您的语言并可以帮助您了解首次购房者项目的经纪人和贷款专员联系。",
  },
  good_agents: {
    en: "Fill out the form to be matched with a vetted top-performing agent who specializes in your situation, price range, and goals.",
    tl: "Punan ang form para ma-match sa isang vetted at top-performing na ahente na espesyalista sa iyong sitwasyon, price range, at goals.",
    es: "Llena el formulario para ser conectado con un agente verificado de alto rendimiento que se especializa en tu situación, rango de precios y metas.",
    zh: "填写表格，与符合您情况、价格范围和目标的经过认证的顶级经纪人配对。",
  },
};

// Em dashes and en dashes get replaced with commas. Keep punctuation grammatical.
export function stripDashes(s: string): string {
  return s
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/[—–]/g, ", ")
    .replace(/, ,/g, ",")
    .replace(/,\s+\./g, ".");
}

// Build the full caption that the operator pastes into Instagram:
// link + blank line + form line + blank line + cleaned body.
export function buildCaption(
  language: Language,
  contentType: ContentType,
  body: string,
): string {
  const url = QUIZ_URLS[language];
  const formLine = FORM_LINE[contentType][language];
  const cleanBody = stripDashes(body).trim();
  return `${url}\n\n${formLine}\n\n${cleanBody}`;
}
