declare module '*.css';

declare module '*.png' {
  const path: string;
  export default path;
}

declare module '*.svg' {
  const path: string;
  export default path;
}

declare module '*.webmanifest' {
  const source: string;
  export default source;
}

declare module '*.js' {
  const source: string;
  export default source;
}
