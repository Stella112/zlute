import React from 'react';
import { AbsoluteFill, Composition, Sequence } from 'remotion';
import captions from './captions.json';
import { Caption, FontFaces } from './components';
import { EndCard, Proof } from './scenes';
import { AgentLimit, AgentRun, Dashboard, McpTools, Opening2, Payroll2, Received, SellApi, Streams, Subscriptions } from './scenes2';
import { FPS, s } from './theme';

const TOTAL = s(119);
const SCENES: [number, number, React.FC<any>][] = [
  [0, 5, Opening2],
  [5, 15.2, Dashboard],
  [15.2, 20.3, Received],
  [20.3, 30.6, McpTools],
  [30.6, 52.2, AgentRun],
  [52.2, 65, AgentLimit],
  [65, 73, SellApi],
  [73, 86, Streams],
  [86, 96.5, Subscriptions],
  [96.5, 104, Payroll2],
  [104, 117, Proof],
  [117, 119, EndCard],
];

const LuteDemo: React.FC = () => (
  <AbsoluteFill style={{ background: '#0a0a0b' }}>
    <FontFaces />
    {SCENES.map(([a, b, Scene]) => (
      <Sequence key={a} from={s(a)} durationInFrames={s(b - a)}>
        <Scene paid={false} />
      </Sequence>
    ))}
    {/* Sound is mixed outside Remotion (mix.sh): polished voice + music ducked under it. */}
    {captions.cues.map((c, i) => (
      <Caption key={i} text={c.text} start={s(c.start)} end={s(c.end)} />
    ))}
  </AbsoluteFill>
);

export const Root: React.FC = () => <Composition id="LuteDemo" component={LuteDemo} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />;
