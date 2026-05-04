import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownComponents: Components = {
  h1: ({ node: _node, ...props }) => (
    <h1 className="text-base font-semibold text-foreground" {...props} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h2 className="text-sm font-semibold text-foreground" {...props} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h3 className="text-sm font-medium text-foreground" {...props} />
  ),
  p: ({ node: _node, ...props }) => (
    <p className="text-sm leading-relaxed text-muted-foreground" {...props} />
  ),
  ul: ({ node: _node, ...props }) => (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground" {...props} />
  ),
  li: ({ node: _node, ...props }) => <li className="pl-1" {...props} />,
  strong: ({ node: _node, ...props }) => (
    <strong className="font-medium text-foreground" {...props} />
  ),
  a: ({ node: _node, ...props }) => (
    <a
      className="font-medium text-primary underline underline-offset-4"
      {...props}
      target="_blank"
      rel="noreferrer"
    />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      className="border-l-2 border-border pl-3 text-sm text-muted-foreground"
      {...props}
    />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground" {...props} />
  ),
  code: ({ node: _node, ...props }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground" {...props} />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-muted-foreground" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => (
    <th className="border-b px-2 py-1 text-left font-medium text-foreground" {...props} />
  ),
  td: ({ node: _node, ...props }) => <td className="border-b px-2 py-1" {...props} />,
};

export function MarkdownMessage(props: { children: string }) {
  return (
    <div className="flex flex-col gap-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {props.children}
      </ReactMarkdown>
    </div>
  );
}
