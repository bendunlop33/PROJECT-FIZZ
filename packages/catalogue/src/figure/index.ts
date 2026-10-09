/**
 * Figure rig and guide tooling (ADR 0010). Pure TypeScript with no React or
 * native imports: the Linux renderer and checks use it now, and the in-app
 * player (a later slice) will draw the same poses.
 */
export * from './math';
export * from './rig';
export * from './guide-schema';
export * from './ik';
export * from './keyframes';
export * from './props';
export * from './pose';
export * from './style';
export * from './svg';
export * from './checks';
