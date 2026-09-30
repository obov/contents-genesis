import {Fragment} from 'react';
import {activeCaptionWord, type CaptionWord} from './caption-alignment';

export const WordHighlightedCaption = ({text, words, seconds, activeColor = '#89d5c4'}: {
  text: string; words: readonly CaptionWord[]; seconds: number; activeColor?: string;
}) => {
  const active = activeCaptionWord(words, seconds);
  return <>{words.map((word, index) => <Fragment key={word.from}>
    {text.slice(index ? words[index - 1].to : 0, word.from)}
    <span style={{color: index === active ? activeColor : 'inherit'}}>{word.text}</span>
  </Fragment>)}{text.slice(words.at(-1)?.to ?? 0)}</>;
};
