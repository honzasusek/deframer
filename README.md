# deframer

A TypeScript CLI that converts a **Framer-generated component** (`component.js`)
into a clean, readable React + CSS component.

## Usage

```bash
npm install
npm run deframe -- component.js --out out
# or, after `npm run build`:
node dist/cli.js component.js --out out
```

This writes, into the output directory:

- `<ComponentName>.tsx` — the converted, de-obfuscated component.
- `<ComponentName>.css` — the static CSS rules, extracted from Framer's inline `css` array.
- `framer-modules/*.ts(x)` — local stubs for the remote `framerusercontent.com`
  child components and shared-style modules the original imported.

The component name is derived from the Framer `displayName`
(e.g. `"retail / how card"` → `RetailHowCard`).

## What it does

The input is minified, single-line, machine-generated Framer output. deframer
parses it with Babel and applies these transforms:

- **De-minifies** the whole module into readable, multi-line code.
- **De-obfuscates prop identifiers** — Framer's random IDs (`J7pc1qCaI`,
  `bZPNCtkW7`, …) are renamed to their human names (`title`, `content`, …) using
  the `@framerVariables` annotation. This applies everywhere: the `getProps`
  mapping, the destructuring, JSX `text:`/`href:` props, and property controls.
- **De-obfuscates variants** — variant IDs (`J6zU0Da47`, `mp6L0Nddv`, …) become
  identifier-safe names from the human variant titles (`Closed`, `Variant3`, …),
  consistently across `variantClassNames`, `cycleOrder`, `enabledGestures`,
  `setVariant(...)`, `baseVariant === ...` comparisons, gesture-suffixed strings
  (`"mp6L0Nddv-hover"` → `"Variant3-hover"`), and `addPropertyOverrides` keys.
- **Generates a typed `Props` interface** from `addPropertyControls`, mapping each
  `ControlType` to a TS type (Enum → a string-literal union of the option titles,
  Border → a `FramerBorder` object type, etc.), and types the `forwardRef` render
  function's params.
- **Extracts static CSS** from the inline `css` array into a real stylesheet and
  adds a side-effect `import "./<ComponentName>.css"`.
- **Rewrites remote imports** (`https://framerusercontent.com/modules/...`) to
  local `./framer-modules/...` modules and generates typed stubs for them.
- Strips Framer's `const X = undefined` placeholders and the `__FramerMetadata__`
  export.

## Design choices (per the requested scope)

- **framer-motion is kept.** `motion.*` elements and animation props are
  preserved; only the variant/identifier obfuscation is resolved.
- **Output structure: TSX + separate CSS.**
- **Remote children are stubbed**, so the output tree is self-contained.

## Limitations

- The output still imports from the `framer` runtime package (`withCSS`,
  `useVariantState`, `RichText`, `Link`, `ControlType`, …) and from
  `framer-motion`. These are inherent to keeping the Framer behavior; the result
  is meant to drop into a project where those are available.
- Only **static** CSS string literals are extracted. Framer's shared-style
  spreads (`...sharedStyle.css`) are dynamic and are left in the `withCSS(...)`
  call; the CLI prints a note when this happens.
- Generated child stubs render a plain `<div>` — replace them with real
  implementations as needed.

## Project layout

```
src/
  cli.ts       # argument parsing + file output
  deframe.ts   # AST parse + transforms + code generation
  props.ts     # Props interface generation from property controls
  naming.ts    # name/identifier helpers
```
