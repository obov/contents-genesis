import test from 'node:test';
import assert from 'node:assert/strict';
import {alignCaptionWords, activeCaptionWord} from '../src/caption-alignment.ts';

const charactersFor = text => [...text].map((text, i) => ({text, start: i, end: i + 0.5}));

test('phonetic expansions preserve displayed words, punctuation, and line breaks', () => {
  const text = 'AI의 HBM은\n4분의 1로 줄었습니다.';
  const spoken = '에이아이의 에이치비엠은 사분의 일로 줄었습니다.';
  const [words] = alignCaptionWords([{text, spoken}], charactersFor(spoken));
  assert.deepEqual(words.map(w => w.text), ['AI의', 'HBM은', '4분의', '1로', '줄었습니다.']);
  assert.equal(words[0].start, 0);
  assert.equal(words[0].end, 4.5);
  assert.equal(words[1].start, 6);
  assert.equal(text.slice(words[1].to, words[2].from), '\n');
  assert.equal(activeCaptionWord(words, 4.49), 0);
  assert.equal(activeCaptionWord(words, 4.5), -1); // Pause is not highlighted.
  assert.equal(activeCaptionWord(words, 6), 1);
  assert.equal(activeCaptionWord(words, words.at(-1).end), -1);
});

test('word-boundary changes need explicit mapping and wrong text/times fail', () => {
  const spoken = '에이 비';
  assert.throws(() => alignCaptionWords([{text: 'AB', spoken}], charactersFor(spoken)), /spokenWords/);
  assert.equal(alignCaptionWords([{text: 'AB', spoken, spokenWords: ['에이 비']}], charactersFor(spoken))[0].length, 1);
  assert.throws(() => alignCaptionWords([{text: 'AB', spoken: '다름'}], charactersFor(spoken)), /differs/);
  assert.throws(() => alignCaptionWords([{text: '가 나', spoken: '가 나'}], [{text: '가', start: 0, end: 2}, {text: '나', start: 1, end: 3}]), /non-overlapping/);
});

