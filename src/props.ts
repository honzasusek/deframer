/**
 * Generates a TypeScript `Props` interface from Framer's `addPropertyControls`
 * definitions, mapping each ControlType to an idiomatic TS type.
 */

export interface PropertyControl {
  /** The public prop name (already de-obfuscated), or "variant". */
  name: string;
  /** The ControlType.* member name, e.g. "String", "Enum", "Border". */
  controlType: string | null;
  /** For Enum controls: the human-readable option titles. */
  optionTitles?: string[];
  title?: string;
}

const NEEDS_BORDER_TYPE = "FramerBorder";

function controlTypeToTs(c: PropertyControl): string {
  switch (c.controlType) {
    case "String":
    case "Color":
    case "Link":
    case "Image":
    case "File":
    case "RichText":
    case "Padding":
    case "BorderRadius":
    case "FontSize":
      return "string";
    case "Number":
      return "number";
    case "Boolean":
      return "boolean";
    case "Enum": {
      const titles = c.optionTitles ?? [];
      if (titles.length === 0) return "string";
      return titles.map((t) => JSON.stringify(t)).join(" | ");
    }
    case "Border":
      return NEEDS_BORDER_TYPE;
    case "Object":
      return "Record<string, unknown>";
    case "Array":
      return "unknown[]";
    case "ComponentInstance":
      return "React.ReactNode";
    default:
      return "unknown";
  }
}

/** Returns the `export interface Props { ... }` block as source text. */
export function generatePropsBlock(
  componentName: string,
  controls: PropertyControl[],
): string {
  const usesBorder = controls.some((c) => c.controlType === "Border");

  const lines: string[] = [];
  if (usesBorder) {
    lines.push(
      `export type ${NEEDS_BORDER_TYPE} = {`,
      "  borderWidth?: number;",
      "  borderTopWidth?: number;",
      "  borderRightWidth?: number;",
      "  borderBottomWidth?: number;",
      "  borderLeftWidth?: number;",
      "  borderColor?: string;",
      "  borderStyle?: string;",
      "};",
      "",
    );
  }

  lines.push(`/** Props for the \`${componentName}\` component (converted from Framer). */`);
  lines.push("export interface Props {");
  // Standard Framer/React surface props.
  lines.push("  style?: React.CSSProperties;");
  lines.push("  className?: string;");
  lines.push("  id?: string;");
  lines.push("  width?: number;");
  lines.push("  height?: number;");
  lines.push("  layoutId?: string;");

  for (const c of controls) {
    const ts = controlTypeToTs(c);
    const comment = c.title ? ` // ${c.title}` : "";
    lines.push(`  ${c.name}?: ${ts};${comment}`);
  }
  lines.push("}");
  return lines.join("\n");
}
