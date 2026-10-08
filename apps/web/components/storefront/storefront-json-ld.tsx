/**
 * Serialise structured data for a <script type="application/ld+json"> block.
 *
 * JSON.stringify alone is not safe inside a script element: a seller-controlled
 * string containing `</script>` would end the block and start running HTML.
 * Escaping `<`, `>`, `&` and the two line separators as JSON \u sequences keeps
 * the output valid JSON-LD for crawlers and inert for browsers (GK-1).
 */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(new RegExp("[\\u003c\\u003e&\\u2028\\u2029]", "g"), (ch) => {
    switch (ch) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case " ":
        return "\\u2028";
      default:
        return "\\u2029";
    }
  });
}

export function StorefrontJsonLd({ blocks }: { blocks: Record<string, unknown>[] }) {
  return (
    <>
      {blocks.map((block, index) => (
        <script
          // eslint-disable-next-line react/no-danger
          key={`jsonld-${index}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(block) }}
        />
      ))}
    </>
  );
}
