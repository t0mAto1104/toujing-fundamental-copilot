// Length is a ceiling, not a target. Reserve the last character for a sentence
// terminator in structured output; URLs and evidence identifiers use other rules.
export function researchProsePattern(limit: number) {
  return `^([\\s\\S]{0,${limit - 1}}[。！？.!?]|[\\s\\S]{0,${limit - 2}}[。！？.!?][”’」』）)])$`;
}

export const INCOMPLETE_RESEARCH_PROSE = '本段未形成完整表述，暂不采用。';

export function completeResearchProse(value: string, limit: number) {
  const text = value.trim();
  const characters = Array.from(text);
  let lastEnd = 0;
  // ponytail: this checks sentence boundaries, not semantic truth. Evidence and
  // cross-chapter checks remain separate; never invent words to finish a claim.
  for (let index = 0; index < characters.length; index++) {
    const char = characters[index];
    if (!/[。！？.!?]/.test(char)) continue;
    if (char === '.') {
      const before = characters.slice(0, index + 1).join('');
      const next = characters[index + 1] || '';
      if (
        characters[index - 1] === '.' ||
        // A final period after a bare number may be a cut decimal or a list
        // marker, not a sentence. Do not turn either into a finished claim.
        /\d\.$/.test(before) ||
        (next && !/[\s”’」』）)]/.test(next)) ||
        /(?:[A-Za-z]\.){2,}$/.test(before) ||
        /\b(?:Mr|Mrs|Ms|Dr|Prof|vs|etc)\.$/i.test(before) ||
        /(?:^|[。！？.!?\n])\s*(?:[-*]\s*)?(?:[A-Za-z]|[A-Z]{2,5})\.$/.test(
          before,
        )
      )
        continue;
    }
    let end = index + 1;
    while (end < characters.length && /[”’」』）)]/.test(characters[end]))
      end++;
    const sentence = characters.slice(lastEnd, end).join('');
    // A constrained decoder can append punctuation after an unfinished number
    // or word. Punctuation alone must not make those observed stubs valid.
    if (
      /\d\.[”’」』）)]*[。！？!?]/.test(sentence) ||
      /(?:资管份|主要包括|以及|并且|分别为)[。！？!?]$/.test(sentence)
    )
      break;
    const prefix = characters.slice(0, end);
    const quoteBalance = [
      ['“', '”'],
      ['「', '」'],
      ['『', '』'],
    ].map(
      ([open, close]) =>
        prefix.filter((c) => c === open).length -
        prefix.filter((c) => c === close).length,
    );
    if (quoteBalance.some((n) => n < 0)) break;
    if (quoteBalance.some((n) => n > 0)) continue;
    if (end <= limit) lastEnd = end;
  }
  if (lastEnd === characters.length && lastEnd > 0)
    return { text, recovered: false };
  return {
    text: lastEnd
      ? characters.slice(0, lastEnd).join('').trim()
      : INCOMPLETE_RESEARCH_PROSE,
    recovered: true,
  };
}
