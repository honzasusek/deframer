import { parse } from "@babel/parser";
import _traverse, { type NodePath } from "@babel/traverse";
import _generate from "@babel/generator";
import * as t from "@babel/types";
import { moduleBasename, sanitizeVariant, toPascalCase } from "./naming.js";
import { generatePropsBlock, type PropertyControl } from "./props.js";

// @babel/traverse and @babel/generator ship as CJS; interop under ESM.
const traverse = (_traverse as unknown as { default: typeof _traverse }).default ?? _traverse;
const generate = (_generate as unknown as { default: typeof _generate }).default ?? _generate;

export interface StubFile {
  /** Path relative to the output directory, e.g. "framer-modules/Pill.tsx". */
  path: string;
  content: string;
}

export interface DeframeResult {
  componentName: string;
  tsx: string;
  css: string;
  cssFileName: string;
  stubs: StubFile[];
  /** Diagnostics worth surfacing to the user. */
  notes: string[];
}

const REMOTE_PREFIX = "https://framerusercontent.com/modules/";

/** Extract the ID -> human-name map from the `@framerVariables` JSDoc annotation. */
function parseFramerVariables(source: string): Record<string, string> {
  const m = source.match(/@framerVariables\s+(\{[^}]*\})/);
  if (!m) return {};
  try {
    return JSON.parse(m[1]);
  } catch {
    return {};
  }
}

/** Read a string-keyed/string-valued object literal into a JS record. */
function objectExpressionToStringRecord(
  obj: t.ObjectExpression,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const prop of obj.properties) {
    if (!t.isObjectProperty(prop)) continue;
    const key = t.isIdentifier(prop.key)
      ? prop.key.name
      : t.isStringLiteral(prop.key)
        ? prop.key.value
        : null;
    if (key == null) continue;
    if (t.isStringLiteral(prop.value)) out[key] = prop.value.value;
  }
  return out;
}

interface CollectedInfo {
  /** value(ID) -> human title, from humanReadableVariantMap. */
  variantIdToTitle: Record<string, string>;
  /** Original human variant titles in declaration order. */
  variantTitles: string[];
  controls: PropertyControl[];
  /** The original exported wrapper name, e.g. "FramerSLM1o8w8a". */
  exportedName: string | null;
  displayName: string | null;
}

function collect(ast: t.File, propIdToName: Record<string, string>): CollectedInfo {
  const info: CollectedInfo = {
    variantIdToTitle: {},
    variantTitles: [],
    controls: [],
    exportedName: null,
    displayName: null,
  };

  traverse(ast, {
    VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
      const id = path.node.id;
      if (!t.isIdentifier(id)) return;

      if (id.name === "humanReadableVariantMap" && t.isObjectExpression(path.node.init)) {
        const titleToId = objectExpressionToStringRecord(path.node.init);
        for (const [title, variantId] of Object.entries(titleToId)) {
          info.variantIdToTitle[variantId] = title;
        }
      }
    },

    CallExpression(path: NodePath<t.CallExpression>) {
      const callee = path.node.callee;

      // FramerXXX.displayName = "..."  via AssignmentExpression handled separately.
      if (t.isIdentifier(callee, { name: "withCSS" })) {
        const first = path.node.arguments[0];
        if (t.isIdentifier(first, { name: "Component" })) {
          // The result is assigned to the exported const; record its name.
          const parentDecl = path.findParent((p) => p.isVariableDeclarator());
          if (parentDecl?.isVariableDeclarator() && t.isIdentifier(parentDecl.node.id)) {
            info.exportedName = parentDecl.node.id.name;
          }
        }
      }

      if (t.isIdentifier(callee, { name: "addPropertyControls" })) {
        const controlsArg = path.node.arguments[1];
        if (t.isObjectExpression(controlsArg)) {
          for (const prop of controlsArg.properties) {
            if (!t.isObjectProperty(prop)) continue;
            const rawKey = t.isIdentifier(prop.key)
              ? prop.key.name
              : t.isStringLiteral(prop.key)
                ? prop.key.value
                : null;
            if (rawKey == null || !t.isObjectExpression(prop.value)) continue;

            const name = rawKey === "variant" ? "variant" : (propIdToName[rawKey] ?? rawKey);
            const control: PropertyControl = { name, controlType: null };

            for (const field of prop.value.properties) {
              if (!t.isObjectProperty(field) || !t.isIdentifier(field.key)) continue;
              if (field.key.name === "type" && t.isMemberExpression(field.value)) {
                const member = field.value.property;
                if (t.isIdentifier(member)) control.controlType = member.name;
              }
              if (field.key.name === "title" && t.isStringLiteral(field.value)) {
                control.title = field.value.value;
              }
              if (field.key.name === "optionTitles" && t.isArrayExpression(field.value)) {
                control.optionTitles = field.value.elements
                  .filter((e): e is t.StringLiteral => t.isStringLiteral(e))
                  .map((e) => e.value);
              }
            }
            info.controls.push(control);
          }
        }
      }
    },

    AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
      const left = path.node.left;
      if (
        t.isMemberExpression(left) &&
        t.isIdentifier(left.property, { name: "displayName" }) &&
        t.isStringLiteral(path.node.right)
      ) {
        info.displayName = path.node.right.value;
      }
    },
  });

  // Preserve declaration order of variant titles for the union type.
  info.variantTitles = Object.values(info.variantIdToTitle);
  return info;
}

export function deframe(source: string): DeframeResult {
  const notes: string[] = [];
  const propIdToName = parseFramerVariables(source);

  const ast = parse(source, {
    sourceType: "module",
    plugins: ["jsx"],
  });

  const info = collect(ast, propIdToName);

  const componentName = toPascalCase(info.displayName ?? "FramerComponent");
  const cssFileName = `${componentName}.css`;

  // Build the identifier rename map: obfuscated prop IDs -> human names,
  // plus the exported wrapper -> a clean PascalCase name.
  const idRename: Record<string, string> = { ...propIdToName };
  if (info.exportedName) idRename[info.exportedName] = componentName;

  // variant ID -> sanitized internal key (identifier-safe).
  const variantIdToKey: Record<string, string> = {};
  for (const [variantId, title] of Object.entries(info.variantIdToTitle)) {
    variantIdToKey[variantId] = sanitizeVariant(title);
  }
  const variantIds = Object.keys(variantIdToKey);

  // ---- Structural edits on the Program body ----
  const body = ast.program.body;

  // Drop Framer's `const <id> = undefined;` placeholder declarations and the
  // trailing `export const __FramerMetadata__ = ...`.
  ast.program.body = body.filter((node) => {
    if (
      t.isVariableDeclaration(node) &&
      node.declarations.every(
        (d) =>
          t.isIdentifier(d.id) &&
          (d.init == null || t.isIdentifier(d.init, { name: "undefined" })) &&
          (d.id.name in propIdToName),
      )
    ) {
      return false;
    }
    if (
      t.isExportNamedDeclaration(node) &&
      t.isVariableDeclaration(node.declaration) &&
      node.declaration.declarations.some(
        (d) => t.isIdentifier(d.id, { name: "__FramerMetadata__" }),
      )
    ) {
      return false;
    }
    return true;
  });

  // ---- CSS extraction ----
  let extractedCss = "";
  for (const node of ast.program.body) {
    if (!t.isVariableDeclaration(node)) continue;
    for (const decl of node.declarations) {
      if (
        t.isIdentifier(decl.id, { name: "css" }) &&
        t.isArrayExpression(decl.init)
      ) {
        const staticParts: string[] = [];
        const residual: (t.Expression | t.SpreadElement | null)[] = [];
        for (const el of decl.init.elements) {
          if (t.isStringLiteral(el)) staticParts.push(el.value);
          else residual.push(el);
        }
        extractedCss = staticParts.join("\n");
        decl.init.elements = residual as t.ArrayExpression["elements"];
        if (residual.length > 0) {
          notes.push(
            `${residual.length} dynamic CSS entr${residual.length === 1 ? "y" : "ies"} (shared styles) left in the withCSS() call; only static rules were extracted to ${cssFileName}.`,
          );
        }
      }
    }
  }

  // ---- Stub generation + transforms ----
  const stubs: StubFile[] = [];
  const seenStub = new Set<string>();

  traverse(ast, {
    ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
      const src = path.node.source.value;
      if (!src.startsWith(REMOTE_PREFIX)) return;

      const isNamespace = path.node.specifiers.some((s) =>
        t.isImportNamespaceSpecifier(s),
      );
      const defaultSpec = path.node.specifiers.find((s) =>
        t.isImportDefaultSpecifier(s),
      );
      const localName =
        defaultSpec?.local.name ??
        path.node.specifiers[0]?.local.name ??
        moduleBasename(src);

      const ext = isNamespace ? "ts" : "tsx";
      const stubPath = `framer-modules/${localName}.${ext}`;
      path.node.source = t.stringLiteral(`./framer-modules/${localName}`);

      if (!seenStub.has(stubPath)) {
        seenStub.add(stubPath);
        stubs.push({
          path: stubPath,
          content: isNamespace
            ? sharedStyleStub(localName, src)
            : componentStub(localName, src),
        });
      }
    },

    Identifier(path: NodePath<t.Identifier>) {
      const next = idRename[path.node.name];
      if (next && next !== path.node.name) {
        // Don't touch identifiers that are part of an import binding rename —
        // imports here are framer/react and never collide with prop IDs.
        path.node.name = next;
      }
    },

    StringLiteral(path: NodePath<t.StringLiteral>) {
      const value = path.node.value;
      if (variantIdToKey[value]) {
        path.node.value = variantIdToKey[value];
        return;
      }
      // Gesture-suffixed variant strings, e.g. "mp6L0Nddv-hover".
      for (const id of variantIds) {
        if (value.startsWith(id + "-")) {
          path.node.value = variantIdToKey[id] + value.slice(id.length);
          return;
        }
      }
    },

    ObjectProperty(path: NodePath<t.ObjectProperty>) {
      const key = path.node.key;
      if (
        !path.node.computed &&
        t.isIdentifier(key) &&
        variantIdToKey[key.name]
      ) {
        path.node.key = t.identifier(variantIdToKey[key.name]);
      }
    },

    // Type the forwardRef render function's params.
    CallExpression(path: NodePath<t.CallExpression>) {
      const callee = path.node.callee;
      const isForwardRef =
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: "React" }) &&
        t.isIdentifier(callee.property, { name: "forwardRef" });
      if (!isForwardRef) return;
      const fn = path.node.arguments[0];
      if (!t.isFunctionExpression(fn) && !t.isArrowFunctionExpression(fn)) return;
      const [propsParam, refParam] = fn.params;
      if (t.isIdentifier(propsParam)) {
        propsParam.typeAnnotation = t.tsTypeAnnotation(
          t.tsTypeReference(t.identifier("Props")),
        );
      }
      if (refParam && t.isIdentifier(refParam)) {
        refParam.typeAnnotation = t.tsTypeAnnotation(
          t.tsTypeReference(
            t.identifier("React.Ref"),
            t.tsTypeParameterInstantiation([
              t.tsTypeReference(t.identifier("HTMLAnchorElement")),
            ]),
          ),
        );
      }
    },
  });

  // ---- Inject the CSS side-effect import at the top ----
  ast.program.body.unshift(
    t.importDeclaration([], t.stringLiteral(`./${cssFileName}`)),
  );

  // ---- Inject the Props interface just before the Component declaration ----
  const propsBlock = generatePropsBlock(componentName, info.controls);
  const propsAst = parse(propsBlock, {
    sourceType: "module",
    plugins: ["typescript"],
  });
  const componentIdx = ast.program.body.findIndex(
    (n) =>
      t.isVariableDeclaration(n) &&
      n.declarations.some((d) => t.isIdentifier(d.id, { name: "Component" })),
  );
  const insertAt = componentIdx === -1 ? ast.program.body.length : componentIdx;
  ast.program.body.splice(insertAt, 0, ...propsAst.program.body);

  const generated = generate(ast, {
    comments: false,
    jsescOption: { minimal: true },
  });

  const header = `// Converted from a Framer-generated component by deframer.\n// Original Framer display name: ${info.displayName ?? "(unknown)"}\n// Requires: react, framer, framer-motion.\n\n`;

  return {
    componentName,
    tsx: header + generated.code + "\n",
    css: extractedCss + "\n",
    cssFileName,
    stubs,
    notes,
  };
}

function componentStub(name: string, originalUrl: string): string {
  return `import * as React from "react";

// Local stub for a Framer remote child component.
// Originally imported from:
//   ${originalUrl}
// Replace this with the real implementation or your own component.
const ${name} = React.forwardRef<HTMLDivElement, any>(function ${name}(props, ref) {
  const { style, className, children } = props;
  return (
    <div ref={ref} data-framer-stub="${name}" className={className} style={style}>
      {children}
    </div>
  );
});
${name}.displayName = ${JSON.stringify(name)};

export default ${name};
`;
}

function sharedStyleStub(name: string, originalUrl: string): string {
  return `// Local stub for a Framer shared-style module.
// Originally imported from:
//   ${originalUrl}
// Replace with the real exported styles if you need them.
export const className = "";
export const css: string[] = [];
export const fonts: unknown[] = [];
`;
}
