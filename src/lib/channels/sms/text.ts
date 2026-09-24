/** SMS text helpers — no server imports, so the template editor can use them too. */

/** "+44 20 7946-0958" → "+442079460958"; null unless it's a plausible E.164 number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const p = raw.replace(/[\s().-]/g, "").replace(/^00/, "+");
  return /^\+[1-9]\d{6,14}$/.test(p) ? p : null;
}

/** SMS segments (GSM-7: 160 / 153 per part; anything else UCS-2: 70 / 67) — what the carrier bills. */
const GSM7 = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;
export function smsSegments(text: string): { encoding: "GSM-7" | "UCS-2"; length: number; segments: number } {
  const gsm = GSM7.test(text);
  // ^{}\[~]|€ take two GSM-7 characters
  // UCS-2 counts UTF-16 code units, so an emoji takes two
  const length = gsm ? [...text].reduce((n, ch) => n + ("^{}\\[~]|€".includes(ch) ? 2 : 1), 0) : text.length;
  const [single, multi] = gsm ? [160, 153] : [70, 67];
  return { encoding: gsm ? "GSM-7" : "UCS-2", length, segments: length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / multi) };
}
