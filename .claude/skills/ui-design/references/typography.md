# Typography

Typography carries hierarchy, information, and voice. Use the fewest roles and
families that make those jobs unmistakable.

## Define roles

Name roles by purpose: display, page title, section heading, body, control,
label, metadata, code, and numeric data. Not every project needs every role.
Combine size, weight, spacing, and tone rather than asking size alone to carry
hierarchy.

For operating interfaces:

- one capable sans family is often enough;
- use a fixed role scale, commonly with a 1.125–1.2 ratio;
- keep headings compact and labels stable across containers;
- reserve monospace for code, paths, identifiers, commands, and aligned numeric
  data;
- use tabular numerals where values must scan vertically.

Persuasive and experiential surfaces may use a display face or fluid scale when
it supports the direction. Do not import that treatment into controls or data.

## Reading quality

- Use 1rem/16px as the ordinary body floor. Dense secondary roles may be
  smaller when contrast, line height, and context remain readable.
- Keep prose around 45–75 characters per line. Wider lines generally need more
  leading.
- Dark surfaces may need slightly more weight, tracking, or line height.
- Keep paragraph rhythm consistent. Use spacing or indentation as the primary
  paragraph separator, not both by default.
- Avoid arbitrary adjacent sizes that look equivalent but imply different roles.
- Let headings wrap naturally. Balance short display headings only where browser
  support and content justify it.

## Delivery

- Self-host fonts when the product requires offline or controlled delivery.
- Load only used families, scripts, axes, and weights.
- Use variable fonts intentionally rather than loading an entire range without
  using it.
- Supply suitable fallbacks and avoid invisible text during loading.
- Preserve browser zoom, user font settings, and platform text scaling.

## Stress test

Check long headings, 30–40% localization expansion, missing font weights, CJK,
RTL, emoji, narrow containers, and 200% zoom. Ensure labels do not depend on a
single English line and controls can grow without clipping.

## Verify

Primary, secondary, body, control, metadata, code, and data roles should be
recognizable before the copy is read. Repeated roles must remain identical
across screens and states.
