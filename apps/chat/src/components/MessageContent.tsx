"use client";

import type { ReactNode } from "react";
import { safeHttpUrl } from "./ListingDetailOverlay";

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp)(\?\S*)?$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov)(\?\S*)?$/i;

const UL_LINE = /^(\s*)[-*+]\s+(.*)$/;
const OL_LINE = /^(\s*)\d+\.\s+(.*)$/;
const HEADING_LINE = /^(\s*)#{1,6}\s+(.*)$/;

type LineKind = "ul" | "ol" | "heading" | "paragraph";

interface ParsedLine {
  kind: LineKind;
  indent: number;
  content: string;
}

function parseLine(line: string): ParsedLine {
  const headingMatch = HEADING_LINE.exec(line);
  if (headingMatch) {
    return { kind: "heading", indent: 0, content: headingMatch[2] };
  }
  const ulMatch = UL_LINE.exec(line);
  if (ulMatch) {
    return { kind: "ul", indent: indentDepth(ulMatch[1]), content: ulMatch[2] };
  }
  const olMatch = OL_LINE.exec(line);
  if (olMatch) {
    return { kind: "ol", indent: indentDepth(olMatch[1]), content: olMatch[2] };
  }
  return { kind: "paragraph", indent: 0, content: line };
}

// Caps nesting depth at 2 levels (0/1) — anything deeper flattens to level 1 rather than
// growing indefinitely, since chat bubbles have limited width.
function indentDepth(indent: string): number {
  const depth = Math.floor(indent.length / 2);
  return Math.min(depth, 1);
}

// Builds nested <ul>/<ol> from a flat run of same-kind list lines, respecting indent depth.
function renderList(kind: "ul" | "ol", lines: ParsedLine[], key: string): ReactNode {
  const Tag = kind === "ul" ? "ul" : "ol";
  const className = kind === "ul" ? "list-disc pl-4 space-y-0.5" : "list-decimal pl-4 space-y-0.5";

  // Group into top-level items, each possibly followed by nested (indent > 0) sub-items.
  const items: { line: ParsedLine; children: ParsedLine[] }[] = [];
  for (const line of lines) {
    if (line.indent === 0 || items.length === 0) {
      items.push({ line, children: [] });
    } else {
      items[items.length - 1].children.push(line);
    }
  }

  return (
    <Tag key={key} className={className}>
      {items.map((item, i) => (
        <li key={i}>
          {renderInline(item.line.content)}
          {item.children.length > 0 ? renderList(kind, item.children, `${key}-${i}`) : null}
        </li>
      ))}
    </Tag>
  );
}

// Inline markdown tokenizer — left-to-right scan, precedence: `code` > [label](url) > **bold**/
// __bold__ > single *italic*/_italic_ (flanked-by-non-space only, to avoid misfiring on things
// like "R$ 3.100,00 / mês" or "120.72m2") > bare URL. An opening delimiter with no matching
// closer later in the string renders as literal text — critical since partial/streamed text
// routinely has unterminated delimiters mid-stream.
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let key = 0;

  while (rest.length > 0) {
    const codeMatch = /^`([^`]+)`/.exec(rest);
    if (codeMatch) {
      nodes.push(
        <code key={key++} className="rounded bg-border/40 px-1 py-0.5 text-[0.8em]">
          {codeMatch[1]}
        </code>,
      );
      rest = rest.slice(codeMatch[0].length);
      continue;
    }

    const linkMatch = /^\[([^\]]*)\]\(([^)]+)\)/.exec(rest);
    if (linkMatch) {
      const [, label, rawUrl] = linkMatch;
      const href = safeHttpUrl(rawUrl);
      nodes.push(
        href ? (
          <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="underline">
            {label}
          </a>
        ) : (
          <span key={key++}>{label}</span>
        ),
      );
      rest = rest.slice(linkMatch[0].length);
      continue;
    }

    const boldMatch = /^(\*\*|__)([^]*?)\1/.exec(rest);
    if (boldMatch) {
      nodes.push(
        <strong key={key++} className="font-semibold">
          {renderInline(boldMatch[2])}
        </strong>,
      );
      rest = rest.slice(boldMatch[0].length);
      continue;
    }

    // Single-char emphasis: delimiter must be immediately followed by a non-space char and the
    // matching closer must be immediately preceded by a non-space char — this is what keeps
    // "3.100,00 / mês" (space-flanked slashes/periods) and "120.72m2" from being mistaken for
    // italics.
    const italicMatch = /^([*_])(\S(?:[^]*?\S)?)\1/.exec(rest);
    if (italicMatch) {
      nodes.push(<em key={key++}>{renderInline(italicMatch[2])}</em>);
      rest = rest.slice(italicMatch[0].length);
      continue;
    }

    const urlMatch = /^(https?:\/\/[^\s]+)/.exec(rest);
    if (urlMatch) {
      const raw = urlMatch[1];
      const href = safeHttpUrl(raw);
      if (href) {
        if (IMAGE_EXTENSIONS.test(raw)) {
          nodes.push(<img key={key++} src={href} alt="" className="mt-2 max-h-56 w-full rounded-xl object-cover" />);
        } else if (VIDEO_EXTENSIONS.test(raw)) {
          nodes.push(<video key={key++} src={href} controls className="mt-2 max-h-56 w-full rounded-xl" />);
        } else {
          nodes.push(
            <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="underline">
              {raw}
            </a>,
          );
        }
      } else {
        nodes.push(<span key={key++}>{raw}</span>);
      }
      rest = rest.slice(raw.length);
      continue;
    }

    // No markdown token matches at the current position — consume one literal char at a time up
    // to the next position that could plausibly start a token, so an unterminated opening
    // delimiter (e.g. "**bold" with no closer) just falls through character-by-character as
    // plain text instead of being swallowed or breaking the scan.
    const nextTokenStart = rest.slice(1).search(/[`[*_]|https?:\/\//);
    const chunkEnd = nextTokenStart === -1 ? rest.length : nextTokenStart + 1;
    nodes.push(<span key={key++}>{rest.slice(0, chunkEnd)}</span>);
    rest = rest.slice(chunkEnd);
  }

  return nodes;
}

// `white-space: pre-line` on paragraph lines so the dense plain-text fallback (no structured
// listings available) still renders real paragraph breaks between distinct property/vehicle
// mentions, without collapsing every "\n" into a single run-on block of prose. List items must
// NOT inherit this class, which would otherwise double the spacing on top of the list's own
// `space-y-*`.
export function MessageContent({ text }: { text: string }) {
  const lines = text.split("\n").map(parseLine);

  const blocks: ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === "ul" || line.kind === "ol") {
      const group: ParsedLine[] = [];
      while (i < lines.length && lines[i].kind === line.kind) {
        group.push(lines[i]);
        i++;
      }
      blocks.push(renderList(line.kind, group, `block-${blockKey++}`));
      continue;
    }
    if (line.kind === "heading") {
      blocks.push(
        <div key={`block-${blockKey++}`} className="font-semibold">
          {renderInline(line.content)}
        </div>,
      );
      i++;
      continue;
    }
    blocks.push(
      <span key={`block-${blockKey++}`} className="whitespace-pre-line">
        {renderInline(line.content)}
        {i < lines.length - 1 ? "\n" : null}
      </span>,
    );
    i++;
  }

  return <span>{blocks}</span>;
}
