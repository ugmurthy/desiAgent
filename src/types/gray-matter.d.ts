declare module 'gray-matter' {
  interface GrayMatterFile {
    data: Record<string, any>;
    content: string;
    excerpt?: string;
    orig: string | Buffer;
  }

  function matter(input: string | Buffer): GrayMatterFile;
  export = matter;
}
