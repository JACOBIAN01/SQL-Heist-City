import type { MessageKey } from './en';

/**
 * Hindi: a DRAFT for a native speaker to review before it is relied on (docs/inputs-needed.md #8).
 * A key left out falls back to English, so a gap never shows a blank. Unlike English it may be partial.
 */
export const hi: Partial<Record<MessageKey, string>> = {
  'menu.checking': 'आपका खाता जाँचा जा रहा है…',
  'menu.signInPrompt': 'खेलने के लिए अपने स्कूल के Google खाते से साइन इन करें।',
  'menu.signIn': 'Google से साइन इन करें',
  'menu.tutorial': 'ट्यूटोरियल',
  'menu.signedInAs': 'साइन इन:',
  'menu.displayName': 'दिखाने वाला नाम',
  'menu.saveName': 'नाम सहेजें',
  'menu.saved': 'सहेजा गया',
  'menu.classCode': 'क्लास कोड',
  'menu.joinClass': 'क्लास में जुड़ें',
  'menu.practice': 'SQL अभ्यास (अकेले)',
  'menu.settings': 'सेटिंग्स',
  'menu.downloadData': 'मेरा डेटा डाउनलोड करें',
  'menu.deleteAccount': 'मेरा खाता हटाएँ',
  'menu.signOut': 'साइन आउट',
  'menu.waiting': 'आपके शिक्षक के शुरू करने का इंतज़ार…',
  'menu.leave': 'छोड़ें',
  'legal.privacy': 'गोपनीयता',
  'legal.terms': 'शर्तें',
  'age.continue': 'आगे बढ़ें',
  'settings.title': 'सेटिंग्स',
  'settings.close': 'बंद करें',
  'settings.tab.controls': 'नियंत्रण',
  'settings.tab.audio': 'आवाज़',
  'settings.tab.graphics': 'ग्राफ़िक्स',
  'settings.tab.access': 'सुलभता',
  'settings.tab.language': 'भाषा',
  'settings.language': 'भाषा',
  'settings.master': 'कुल आवाज़',
  'settings.textScale': 'अक्षरों का आकार',
  'action.fire': 'गोली चलाएँ',
  'action.jump': 'कूदें',
};
