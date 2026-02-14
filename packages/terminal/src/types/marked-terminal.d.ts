declare module 'marked-terminal' {
  import { Renderer } from 'marked';

  interface TerminalRendererOptions {
    code?: (code: string, language?: string) => string;
    codespan?: (code: string) => string;
    blockquote?: (text: string) => string;
    html?: (html: string) => string;
    heading?: (text: string, level: number) => string;
    hr?: () => string;
    list?: (body: string, ordered: boolean) => string;
    listitem?: (text: string) => string;
    paragraph?: (text: string) => string;
    table?: (header: string, body: string) => string;
    tablerow?: (content: string) => string;
    tablecell?: (content: string, flags: object) => string;
    strong?: (text: string) => string;
    em?: (text: string) => string;
    del?: (text: string) => string;
    link?: (href: string, title: string, text: string) => string;
    image?: (href: string, title: string, text: string) => string;
  }

  class TerminalRenderer extends Renderer {
    constructor(options?: TerminalRendererOptions);
  }

  export default TerminalRenderer;
}
