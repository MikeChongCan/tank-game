/// <reference types="vite/client" />

declare module "*.po?raw" {
  const content: string;
  export default content;
}
