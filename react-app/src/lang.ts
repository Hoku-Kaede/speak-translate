export const LANGS: [string, string][] = [
  ['en', 'English'], ['hi', 'Hindi'], ['ml', 'Malayalam'], ['ta', 'Tamil'], ['te', 'Telugu'],
  ['kn', 'Kannada'], ['mr', 'Marathi'], ['gu', 'Gujarati'], ['bn', 'Bengali'], ['pa', 'Punjabi'],
  ['ur', 'Urdu'], ['ne', 'Nepali'], ['si', 'Sinhala'], ['es', 'Spanish'], ['fr', 'French'],
  ['de', 'German'], ['pt', 'Portuguese'], ['it', 'Italian'], ['nl', 'Dutch'], ['ru', 'Russian'],
  ['uk', 'Ukrainian'], ['pl', 'Polish'], ['sv', 'Swedish'], ['no', 'Norwegian'], ['da', 'Danish'],
  ['fi', 'Finnish'], ['cs', 'Czech'], ['sk', 'Slovak'], ['sl', 'Slovenian'], ['hr', 'Croatian'],
  ['sr', 'Serbian'], ['bg', 'Bulgarian'], ['ro', 'Romanian'], ['el', 'Greek'], ['tr', 'Turkish'],
  ['ar', 'Arabic'], ['he', 'Hebrew'], ['fa', 'Persian'], ['zh-CN', 'Chinese (Simplified)'],
  ['zh-TW', 'Chinese (Traditional)'], ['ja', 'Japanese'], ['ko', 'Korean'], ['vi', 'Vietnamese'],
  ['th', 'Thai'], ['id', 'Indonesian'], ['ms', 'Malay'], ['tl', 'Filipino'],
]

export const LANG_NAMES: Record<string, string> = Object.fromEntries(LANGS.map(([c, n]) => [c, n]))
