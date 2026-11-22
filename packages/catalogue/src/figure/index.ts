/**
 * Figure rig and guide tooling (ADR 0011, ADR 0013). Pure TypeScript with no
 * React, native or Node imports: the Linux renderer and checks use it, and
 * the in-app Skia player draws the same `frameOps`.
 */
export * from './math';
export * from './rig';
export * from './profiles';
export * from './paths';
export * from './body';
export * from './muscle-map';
export * from './regions';
export * from './guide-schema';
export * from './ik';
export * from './keyframes';
export * from './drive';
export * from './props';
export * from './pose';
export * from './style';
export * from './draw';
export * from './svg';
export * from './checks';
export * from './playback';
export * from './motion-metrics';
