export enum Language {
  None,
  Japanese,
  English,
  German,
  French,
  ChineseSimplified,
  ChineseTraditional,
  Korean,
  ChineseTraditional2,
}

export const languageMap = {
  ja: Language.Japanese,
  en: Language.English,
  de: Language.German,
  fr: Language.French,
  chs: Language.ChineseSimplified,
  cht: Language.ChineseTraditional,
  ko: Language.Korean,
  tc: Language.ChineseTraditional2,
}

export const languageToCodeMap: Record<Language, string> = {
  [Language.None]: '',
  [Language.Japanese]: 'ja',
  [Language.English]: 'en',
  [Language.German]: 'de',
  [Language.French]: 'fr',
  [Language.ChineseSimplified]: 'chs',
  [Language.ChineseTraditional]: 'cht',
  [Language.Korean]: 'ko',
  [Language.ChineseTraditional2]: 'tc',
}
