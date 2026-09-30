export type SpeechCharacter = {text: string; start: number; end: number};
export type CaptionWord = {text: string; from: number; to: number; start: number; end: number};
type CaptionInput = {text: string; spoken: string; spokenWords?: readonly string[]};
const normalize = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '');

// Keep display text offsets separate from phonetic character offsets.
export const alignCaptionWords = (cues: readonly CaptionInput[], characters: readonly SpeechCharacter[]): CaptionWord[][] => {
  const letters = characters.flatMap(segment => [...normalize(segment.text)].map(letter => ({...segment, letter})));
  if (letters.map(({letter}) => letter).join('') !== normalize(cues.map(c => c.spoken).join(' '))) {
    throw new Error('Caption alignment differs from the spoken text.');
  }
  if (characters.some(c => !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end < c.start)) {
    throw new Error('Invalid speech character timestamps.');
  }
  let offset = 0;
  let previousEnd = 0;
  return cues.map(cue => {
    const displayed = [...cue.text.matchAll(/\S+/gu)];
    const spoken = cue.spokenWords ?? cue.spoken.trim().split(/\s+/u);
    if (displayed.length !== spoken.length || normalize(spoken.join(' ')) !== normalize(cue.spoken)) {
      throw new Error('Provide one spokenWords entry per display word when pronunciation changes word boundaries.');
    }
    return displayed.map((match, index) => {
      const count = [...normalize(spoken[index])].length;
      if (!count) throw new Error('Each highlighted word must contain speech. Attach standalone punctuation to a spoken word.');
      const first = letters[offset];
      const last = letters[offset + count - 1];
      offset += count;
      if (!first || !last || last.end <= first.start || first.start < previousEnd) {
        throw new Error('Caption words must have positive, non-overlapping speech intervals.');
      }
      previousEnd = last.end;
      return {text: match[0], from: match.index, to: match.index + match[0].length, start: first.start, end: last.end};
    });
  });
};

export const activeCaptionWord = (words: readonly CaptionWord[], seconds: number) =>
  words.findIndex(word => seconds >= word.start && seconds < word.end);
