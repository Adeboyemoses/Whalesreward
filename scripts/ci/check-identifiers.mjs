import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/** Conservative source guard: v4 generators need an exact, counted exception.
 * No attempt is made to infer whether a newly introduced value is persisted.
 * A reviewer must justify every non-ID use in the allowlist instead. */
export function scanSource(path, source) {
  const findings = [];
  const positions = new Set();
  const searchable = source.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, " "),
  );
  function add(position, kind) {
    if (positions.has(position)) return;
    positions.add(position);
    const line = source.slice(0, position).split("\n").length;
    findings.push({
      path,
      line,
      kind,
      source: source.split("\n")[line - 1].trim(),
    });
  }
  // A SQL line comment may sit between a function identifier and its opening
  // parenthesis. Match it only in that gap: stripping every `--` globally
  // would erase unrelated TypeScript strings and change source evidence.
  for (const match of searchable.matchAll(
    /\b(?:gen_random_uuid|uuid_generate_v4)"?(?:\s|--[^\r\n]*(?:\r\n|\r|\n|$))*\(/gi,
  )) {
    add(match.index, "SQL v4 generator");
  }
  if (path.endsWith(".sql")) {
    for (const match of searchable.matchAll(
      /\buuidv4"?(?:\s|--[^\r\n]*(?:\r\n|\r|\n|$))*\(/gi,
    ))
      add(match.index, "SQL v4 generator");
  }
  if (path.endsWith(".prisma")) {
    for (const match of source.matchAll(
      /@default\s*\(\s*uuid\s*\(\s*(?:4\s*)?\)/gi,
    ))
      add(match.index, "Prisma v4 default");
  }
  if (/\.[cm]?[jt]sx?$/.test(path)) {
    const file = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const aliases = new Set(["randomUUID"]);
    function imports(node) {
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "uuid" &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
      ) {
        for (const part of node.exportClause.elements)
          if ((part.propertyName ?? part.name).text === "v4")
            add(part.getStart(file), "Re-exported v4 generator");
      }
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const moduleName = node.moduleSpecifier.text;
        const bindings = node.importClause?.namedBindings;
        if (
          ["uuid", "crypto", "node:crypto"].includes(moduleName) &&
          bindings &&
          ts.isNamedImports(bindings)
        ) {
          for (const part of bindings.elements) {
            const name = (part.propertyName ?? part.name).text;
            if (
              name === "randomUUID" ||
              (moduleName === "uuid" && name === "v4")
            )
              aliases.add(part.name.text);
          }
        }
        if (/^uuid\/v4(?:\.js)?$/.test(moduleName))
          add(node.getStart(file), "uuid v4 module");
      }
      ts.forEachChild(node, imports);
    }
    imports(file);
    function visit(node) {
      if (
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)) &&
        /\buuidv4"?(?:\s|\/\*[\s\S]*?\*\/|--[^\r\n]*(?:\r\n|\r|\n|$))*\(/i.test(
          node.text,
        ) &&
        /\b(?:SELECT|INSERT|DEFAULT|RETURN)\b/i.test(node.text)
      )
        add(node.getStart(file), "SQL v4 generator");
      if (
        ts.isPropertyAccessExpression(node) &&
        ["randomUUID", "v4"].includes(node.name.text)
      )
        add(node.getStart(file), "TypeScript v4 generator reference");
      else if (
        ts.isElementAccessExpression(node) &&
        node.argumentExpression &&
        ts.isStringLiteral(node.argumentExpression) &&
        ["randomUUID", "v4"].includes(node.argumentExpression.text)
      )
        add(node.getStart(file), "TypeScript v4 generator reference");
      else if (
        ts.isBindingElement(node) &&
        ["randomUUID", "v4"].includes(
          (node.propertyName ?? node.name)
            .getText(file)
            .replaceAll('"', "")
            .replaceAll("'", ""),
        )
      )
        add(node.getStart(file), "Destructured v4 generator reference");
      else if (ts.isIdentifier(node) && aliases.has(node.text)) {
        const parent = node.parent;
        if (
          !ts.isImportSpecifier(parent) &&
          !ts.isBindingElement(parent) &&
          !ts.isImportClause(parent) &&
          !(ts.isPropertyAccessExpression(parent) && parent.name === node)
        )
          add(node.getStart(file), "TypeScript v4 generator reference");
      } else if (
        ts.isStringLiteral(node) &&
        /^uuid\/v4(?:\.js)?$/.test(node.text) &&
        !ts.isImportDeclaration(node.parent)
      )
        add(node.getStart(file), "uuid v4 module");
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  return findings;
}

export function applyAllowlist(findings, allowlist) {
  const remaining = [...findings];
  const errors = [];
  for (const entry of allowlist) {
    if (
      !entry.path ||
      /[?*]/.test(entry.path) ||
      !entry.source ||
      !Number.isInteger(entry.count) ||
      entry.count < 1 ||
      typeof entry.reason !== "string" ||
      entry.reason.trim().length < 15
    ) {
      errors.push(
        `Invalid identifier allowlist entry: ${entry.path ?? "missing path"}`,
      );
      continue;
    }
    const matches = remaining.filter(
      (f) => f.path === entry.path && f.source === entry.source,
    );
    if (matches.length !== entry.count) {
      errors.push(
        `Stale or expanded identifier exception: ${entry.path}; expected ${entry.count}, found ${matches.length}: ${entry.source}`,
      );
      continue;
    }
    for (const match of matches) remaining.splice(remaining.indexOf(match), 1);
  }
  return [
    ...errors,
    ...remaining.map((f) => `${f.path}:${f.line}: ${f.kind}: ${f.source}`),
  ];
}

export function checkRepository(root) {
  // Git's inventory avoids generated assets, dependencies, product-docs symlinks
  // and other worktrees while covering scripts, fixtures and new migrations.
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter((path) => /\.(?:[cm]?[jt]sx?|sql|prisma)$/.test(path));
  const allowlist = JSON.parse(
    readFileSync(resolve(root, "scripts/ci/identifier-allowlist.json"), "utf8"),
  );
  const sources = new Map(
    files.map((path) => [path, readFileSync(resolve(root, path), "utf8")]),
  );
  const findings = files.flatMap((path) => scanSource(path, sources.get(path)));
  const errors = applyAllowlist(findings, allowlist);
  for (const entry of allowlist) {
    if (entry.historical && !entry.sha256)
      errors.push(
        `Historical migration exception requires immutable file checksum: ${entry.path}`,
      );
    if (
      entry.sha256 &&
      createHash("sha256")
        .update(sources.get(entry.path) ?? "")
        .digest("hex") !== entry.sha256
    )
      errors.push(`Allowlisted immutable source changed: ${entry.path}`);
  }
  return { files: files.length, exceptions: allowlist.length, errors };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = checkRepository(process.cwd());
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    console.error(
      "Persisted/public identifiers require UUIDv7. Use newId()/v7()/whr_uuid_v7(); non-ID exceptions require an exact justified allowlist entry.",
    );
    process.exitCode = 1;
  } else
    console.log(
      `identifier-guard PASS: ${result.files} tracked source files; ${result.exceptions} exact exceptions`,
    );
}
