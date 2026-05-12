import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { getAllTsFiles } from '../ast/get-all-ts-files.js';
import { scanExpressCandidates, } from './scan-express-candidates.js';
function isImportOrExportDeclaration(decl) {
    return (ts.isImportSpecifier(decl) ||
        ts.isNamespaceImport(decl) ||
        ts.isImportClause(decl) ||
        ts.isNamespaceExport(decl) ||
        ts.isExportSpecifier(decl) ||
        ts.isExportAssignment(decl));
}
function bestCallableDeclaration(decls) {
    for (const d of decls) {
        if (ts.isFunctionDeclaration(d))
            return d;
        if (ts.isMethodDeclaration(d))
            return d;
        if (ts.isFunctionExpression(d))
            return d;
        if (ts.isArrowFunction(d))
            return d;
        if (ts.isVariableDeclaration(d) && d.initializer)
            return d;
    }
    return decls[0] ?? null;
}
function resolveSymbolToCallableDeclaration(checker, program, sym) {
    let cur = sym;
    // Safety bound; alias chains can get weird in complex projects.
    for (let i = 0; i < 10 && cur; i++) {
        if (cur.flags & ts.SymbolFlags.Alias) {
            cur = checker.getAliasedSymbol(cur);
            continue;
        }
        const decls = cur.getDeclarations?.() ?? [];
        const best = bestCallableDeclaration(decls);
        if (!best)
            return null;
        // If the only thing we can see is an import/export declaration, try once more:
        // TypeScript usually marks these as Alias symbols; but in some cases the decl list
        // still contains import/export nodes as the first entry. Fall back to resolving
        // a symbol at the declaration name site.
        if (isImportOrExportDeclaration(best)) {
            // Special-case: for some NodeNext setups (notably when TS source imports use `.js`
            // specifiers), the checker may not fully resolve the alias. Try a best-effort
            // manual resolution from ImportSpecifier -> exported declaration in the module.
            if (ts.isImportSpecifier(best)) {
                const imp = best;
                const namedImport = imp.propertyName?.text ?? imp.name.text;
                const importDecl = imp.parent?.parent?.parent;
                if (importDecl && ts.isImportDeclaration(importDecl)) {
                    const mod = importDecl.moduleSpecifier;
                    if (ts.isStringLiteral(mod) || ts.isNoSubstitutionTemplateLiteral(mod)) {
                        const fromFile = importDecl.getSourceFile().fileName;
                        const fromDir = path.dirname(fromFile);
                        const spec = mod.text;
                        const candidates = [];
                        // Common case: TS file imports with `.js` extension.
                        if (spec.endsWith('.js'))
                            candidates.push(spec.slice(0, -3) + '.ts');
                        candidates.push(spec);
                        // Resolve to absolute paths and try to find a source file in the current program.
                        for (const rel of candidates) {
                            const abs = path.resolve(fromDir, rel);
                            const sf = program.getSourceFile(abs);
                            if (!sf)
                                continue;
                            // Find `export function namedImport` or `export const namedImport = ...`
                            for (const st of sf.statements) {
                                if (ts.isFunctionDeclaration(st) &&
                                    st.name &&
                                    st.name.text === namedImport &&
                                    (st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)) {
                                    return st;
                                }
                                if (ts.isVariableStatement(st)) {
                                    const isExported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
                                    if (!isExported)
                                        continue;
                                    for (const decl of st.declarationList.declarations) {
                                        if (ts.isIdentifier(decl.name) && decl.name.text === namedImport) {
                                            return decl;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            const nameNode = (ts.isImportSpecifier(best) || ts.isExportSpecifier(best)) && best.name
                ? best.name
                : ts.isNamespaceImport(best)
                    ? best.name
                    : ts.isImportClause(best) && best.name
                        ? best.name
                        : null;
            if (nameNode) {
                const next = checker.getSymbolAtLocation(nameNode) ?? null;
                if (next && next !== cur) {
                    cur = next;
                    continue;
                }
            }
        }
        return best;
    }
    return null;
}
function loadCompilerOptions(rootDir, extra) {
    const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.json');
    if (!configPath) {
        return {
            ...(extra ?? {}),
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.NodeNext,
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            strict: true,
        };
    }
    const read = ts.readConfigFile(configPath, (p) => fs.readFileSync(p, 'utf8'));
    if (read.error) {
        throw new Error(ts.formatDiagnostic(read.error, ts.createCompilerHost({})));
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath), undefined, configPath);
    return { ...parsed.options, ...extra };
}
function posOf(source, node) {
    const lc = source.getLineAndCharacterOfPosition(node.getStart(source, false));
    return {
        file: source.fileName,
        line: lc.line + 1,
        col: lc.character + 1,
    };
}
function declarationId(source, node) {
    const p = posOf(source, node);
    return `${p.file}:${p.line}:${p.col}:${node.kind}`;
}
function isDeclWithBody(node) {
    return (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isVariableDeclaration(node));
}
function bestServiceName(checker, decl) {
    if (ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name)) {
        return decl.name.text;
    }
    if (ts.isMethodDeclaration(decl) && ts.isIdentifier(decl.name)) {
        // catModule('X', { method(){...} }) methods live in an object literal, not a class.
        // Try to recover `X.method` by walking up the AST.
        const p1 = decl.parent;
        const p2 = p1 && ts.isObjectLiteralExpression(p1) ? p1.parent : null;
        if (p2 && ts.isCallExpression(p2) && ts.isIdentifier(p2.expression) && p2.expression.text === 'catModule') {
            const modArg = p2.arguments[0];
            if (modArg && (ts.isStringLiteral(modArg) || ts.isNoSubstitutionTemplateLiteral(modArg))) {
                return `${modArg.text}.${decl.name.text}`;
            }
        }
        const cls = decl.parent;
        if (ts.isClassDeclaration(cls) && cls.name)
            return `${cls.name.text}.${decl.name.text}`;
        return decl.name.text;
    }
    if (ts.isFunctionDeclaration(decl) && decl.name)
        return decl.name.text;
    const sym = checker.getSymbolAtLocation(decl.name ?? decl);
    return sym?.getName?.() ?? 'anonymous';
}
function isOwnedSourceFile(fileName, ownedRoots) {
    const norm = fileName.split(path.sep).join('/');
    if (norm.includes('/node_modules/'))
        return false;
    if (ownedRoots.length === 0)
        return true;
    const abs = path.resolve(fileName);
    return ownedRoots.some((r) => abs === r || abs.startsWith(r + path.sep));
}
function unwrapCatInitializerToCallableBody(init) {
    // cat('X.Y', fn)
    if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'cat') {
        const fnArg = init.arguments[1];
        if (fnArg && (ts.isFunctionExpression(fnArg) || ts.isArrowFunction(fnArg)))
            return fnArg;
        return null;
    }
    // inline: const f = () => {} or function(){}
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        return init;
    return null;
}
function buildCatModuleMethodMap(varDecl) {
    // const pricing = catModule('PricingService', { applyTax(){...}, quoteTotal(){...} })
    if (!varDecl.initializer)
        return null;
    const init = varDecl.initializer;
    if (!ts.isCallExpression(init))
        return null;
    if (!ts.isIdentifier(init.expression) || init.expression.text !== 'catModule')
        return null;
    const moduleArg = init.arguments[0];
    const objArg = init.arguments[1];
    if (!moduleArg || !objArg)
        return null;
    if (!ts.isStringLiteral(moduleArg) && !ts.isNoSubstitutionTemplateLiteral(moduleArg))
        return null;
    if (!ts.isObjectLiteralExpression(objArg))
        return null;
    const moduleName = moduleArg.text;
    const methods = new Map();
    for (const prop of objArg.properties) {
        if (ts.isMethodDeclaration(prop) && prop.name && prop.body) {
            const name = ts.isIdentifier(prop.name)
                ? prop.name.text
                : ts.isStringLiteral(prop.name)
                    ? prop.name.text
                    : null;
            if (name)
                methods.set(name, prop);
        }
        if (ts.isPropertyAssignment(prop) && prop.name) {
            const name = ts.isIdentifier(prop.name)
                ? prop.name.text
                : ts.isStringLiteral(prop.name)
                    ? prop.name.text
                    : null;
            if (!name)
                continue;
            const rhs = prop.initializer;
            if (ts.isArrowFunction(rhs) || ts.isFunctionExpression(rhs)) {
                methods.set(name, rhs);
            }
        }
    }
    return { moduleName, methods };
}
function resolveCalledDeclaration(checker, program, call) {
    // Resolve `foo()` or `obj.method()`.
    let target = call.expression;
    if (ts.isPropertyAccessExpression(call.expression)) {
        target = call.expression.name;
    }
    const sym = checker.getSymbolAtLocation(target);
    if (!sym)
        return null;
    return resolveSymbolToCallableDeclaration(checker, program, sym);
}
function resolveHandlerToDeclaration(checker, program, expr) {
    // Inline functions are their own declarations.
    if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr))
        return expr;
    // `ctrl.create` -> resolve the symbol on `create`.
    if (ts.isPropertyAccessExpression(expr)) {
        const sym = checker.getSymbolAtLocation(expr.name);
        if (!sym)
            return null;
        return resolveSymbolToCallableDeclaration(checker, program, sym);
    }
    // `createOrder` -> resolve identifier.
    if (ts.isIdentifier(expr)) {
        const sym = checker.getSymbolAtLocation(expr);
        if (!sym)
            return null;
        return resolveSymbolToCallableDeclaration(checker, program, sym);
    }
    // Factories / higher-order handlers: `makeMw()` are not safely resolvable.
    return null;
}
function collectCalls(body) {
    const out = [];
    const visit = (n) => {
        if (ts.isCallExpression(n))
            out.push(n);
        ts.forEachChild(n, visit);
    };
    visit(body);
    return out;
}
export function scanReachableServices(rootDir, options = {}) {
    // Reuse express candidate scanning to find entrypoints (controllers + middleware).
    const httpCandidates = scanExpressCandidates(rootDir, options);
    const files = options.files ?? getAllTsFiles(rootDir, options.getAllTsFilesOptions);
    const compilerOptions = loadCompilerOptions(rootDir, options.compilerOptions);
    const program = ts.createProgram(files, compilerOptions);
    const checker = program.getTypeChecker();
    const ownedRoots = (options.ownedRoots ?? []).map((p) => path.resolve(p));
    const maxNodes = options.maxNodes ?? 5_000;
    let nodesVisited = 0;
    const services = [];
    const seenDecl = new Set();
    // For resolving pricing.applyTax() where pricing is catModule(...)
    const catModuleBindings = new Map();
    // Pre-scan for catModule bindings in owned files.
    for (const sf of program.getSourceFiles()) {
        if (!isOwnedSourceFile(sf.fileName, ownedRoots))
            continue;
        const visit = (n) => {
            if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
                const map = buildCatModuleMethodMap(n);
                if (map) {
                    catModuleBindings.set(n.name.text, map);
                }
            }
            ts.forEachChild(n, visit);
        };
        visit(sf);
    }
    function enqueueServiceDecl(decl) {
        const src = decl.getSourceFile();
        const id = declarationId(src, decl);
        if (seenDecl.has(id))
            return;
        seenDecl.add(id);
    }
    function addServiceCandidate(decl) {
        const src = decl.getSourceFile();
        if (!isOwnedSourceFile(src.fileName, ownedRoots))
            return;
        const callable = resolveToCallable(decl);
        if (!callable)
            return;
        const body = callable.body;
        if (!body)
            return;
        const id = declarationId(src, decl);
        if (seenDecl.has(id))
            return;
        seenDecl.add(id);
        services.push({
            kind: 'service',
            name: bestServiceName(checker, decl),
            source: posOf(src, decl),
            resolvedFnKey: ts.isMethodDeclaration(callable) || ts.isFunctionDeclaration(callable)
                ? bestServiceName(checker, callable)
                : null,
            _nodeKind: decl.kind,
        });
    }
    function resolveToCallable(decl) {
        if (ts.isFunctionDeclaration(decl) || ts.isFunctionExpression(decl) || ts.isArrowFunction(decl)) {
            return decl;
        }
        if (ts.isMethodDeclaration(decl))
            return decl;
        if (ts.isVariableDeclaration(decl) && decl.initializer) {
            const unwrapped = unwrapCatInitializerToCallableBody(decl.initializer);
            if (unwrapped)
                return unwrapped;
        }
        return null;
    }
    function walkFromDecl(decl) {
        if (nodesVisited >= maxNodes)
            return;
        nodesVisited++;
        const callable = resolveToCallable(decl);
        if (!callable || !callable.body)
            return;
        const body = callable.body;
        for (const call of collectCalls(body)) {
            let calledDecl = resolveCalledDeclaration(checker, program, call);
            // If the checker resolves to a signature/type-only declaration (no body),
            // treat it as unresolved so we can fall back to catModule bindings.
            if (calledDecl && !isDeclWithBody(calledDecl)) {
                calledDecl = null;
            }
            // Fallback for catModule objects: pricing.applyTax(...)
            if (!calledDecl && ts.isPropertyAccessExpression(call.expression)) {
                const recv = call.expression.expression;
                const method = call.expression.name.text;
                if (ts.isIdentifier(recv)) {
                    const binding = catModuleBindings.get(recv.text);
                    const fn = binding?.methods.get(method) ?? null;
                    if (binding && fn) {
                        // Record as a service candidate with a stable fnKey and recurse into the body.
                        const src = fn.getSourceFile();
                        if (isOwnedSourceFile(src.fileName, ownedRoots)) {
                            const id = declarationId(src, fn);
                            if (!seenDecl.has(id)) {
                                seenDecl.add(id);
                                services.push({
                                    kind: 'service',
                                    name: `${binding.moduleName}.${method}`,
                                    source: posOf(src, fn),
                                    resolvedFnKey: `${binding.moduleName}.${method}`,
                                    _nodeKind: fn.kind,
                                });
                            }
                        }
                        // Recurse into the method body even if it was already seen.
                        walkFromDecl(fn);
                        continue;
                    }
                }
            }
            if (!calledDecl)
                continue;
            // Only treat function/method-like declarations as service candidates.
            if (!isDeclWithBody(calledDecl))
                continue;
            addServiceCandidate(calledDecl);
            walkFromDecl(calledDecl);
            if (nodesVisited >= maxNodes)
                return;
        }
    }
    // Roots: handler expressions discovered earlier. We don’t have AST nodes here, so re-parse
    // the handler by using the recorded file+line (best-effort). Instead, resolve by rescanning
    // each candidate’s file and finding the first node at/after that position.
    //
    // This is intentionally best-effort; it favors correctness when it can resolve, and otherwise
    // gracefully undercounts nested services rather than producing incorrect links.
    function tryResolveCandidateDecl(c) {
        const src = program.getSourceFile(c.source.file) ??
            program.getSourceFile(path.resolve(c.source.file));
        if (!src)
            return null;
        const pos = ts.getPositionOfLineAndCharacter(src, c.source.line - 1, c.source.col - 1);
        let found = null;
        const visit = (n) => {
            const start = n.getStart(src, false);
            const end = n.getEnd();
            if (pos < start || pos > end)
                return;
            found = n;
            ts.forEachChild(n, visit);
        };
        visit(src);
        if (!found)
            return null;
        const f = found;
        // Candidate positions point at the handler expression, not necessarily a declaration.
        // Try resolving common shapes.
        if (ts.isIdentifier(f))
            return resolveHandlerToDeclaration(checker, program, f);
        if (ts.isPropertyAccessExpression(f))
            return resolveHandlerToDeclaration(checker, program, f);
        if (ts.isCallExpression(f)) {
            const call = f;
            // If position points to `.bind(...)` call, unwrap to expression.
            const callee = call.expression;
            if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'bind') {
                const inner = callee.expression;
                if (ts.isPropertyAccessExpression(inner) || ts.isIdentifier(inner)) {
                    return resolveHandlerToDeclaration(checker, program, inner);
                }
            }
            return null;
        }
        if (ts.isArrowFunction(f) || ts.isFunctionExpression(f))
            return f;
        return null;
    }
    for (const c of [...httpCandidates.middleware, ...httpCandidates.controllers]) {
        const decl = tryResolveCandidateDecl(c);
        if (!decl)
            continue;
        enqueueServiceDecl(decl);
        walkFromDecl(decl);
        if (nodesVisited >= maxNodes)
            break;
    }
    return { services, meta: { nodesVisited } };
}
//# sourceMappingURL=scan-reachable-services.js.map