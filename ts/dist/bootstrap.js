import { pathToFileURL } from 'node:url';
import { getAllTsFiles } from './ast/get-all-ts-files.js';
import { mergeASTIntoRegistry } from './ast/merge-ast.js';
import { runASTScanner } from './ast/run-ast-scanner.js';
import { analyzeRelationships, buildTree, resolveRelationships, } from './graph/relationships.js';
import { createLogger } from './logger.js';
import { Registry } from './registry-state.js';
import { startInspectorWebSocket, } from './transport/ws-server.js';
import { configureInvokeRateLimit } from './invoke-policy.js';
import { setInvokeTimeoutMs } from './invoke-runtime-config.js';
import { resetRpcSerializationConfig, setRpcSerializationConfig, } from './serialize-rpc-result.js';
export function validateBootstrapStorage(storage) {
    if (!storage)
        return;
    const t = storage.artifactThresholdBytes;
    if (t !== undefined && t > 0 && !storage.adapter) {
        throw new Error('QA_STORAGE_NOT_CONFIGURED: artifactThresholdBytes requires bootstrap.storage.adapter');
    }
}
export function validateBootstrapFileWire(options) {
    const mode = options.qaFileWire?.mode ?? 'ref';
    if (mode === 'url') {
        const hosts = options.fileUrl?.allowedHosts;
        if (!hosts || hosts.length === 0) {
            throw new Error('bootstrap: qaFileWire.mode "url" requires fileUrl.allowedHosts (non-empty)');
        }
    }
}
function toRegistryRecord() {
    return Object.fromEntries(Registry);
}
function redactRegistryBodies(registry) {
    return Object.fromEntries(Object.entries(registry).map(([k, v]) => [k, { ...v, body: '' }]));
}
export async function bootstrap(options) {
    const log = options.logger ?? createLogger(options.logLevel ?? 'info');
    const enableWs = options.enableWebSocket ?? true;
    const redactBodies = options.redactBodies ?? true;
    validateBootstrapStorage(options.storage);
    validateBootstrapFileWire(options);
    for (const entry of options.importEntryUrls ?? []) {
        const href = entry.startsWith('file:')
            ? entry
            : pathToFileURL(entry).href;
        log.info('dynamic import', href);
        await import(href);
    }
    const roots = options.scanRoots;
    if (roots.length === 0) {
        throw new Error('bootstrap: scanRoots must include at least one directory');
    }
    const scanRoot = roots[0];
    const files = [...new Set(roots.flatMap((r) => getAllTsFiles(r, options.getAllTsFilesOptions)))];
    const runOpts = {
        files,
        getAllTsFilesOptions: options.getAllTsFilesOptions,
        compilerOptions: options.compilerOptions,
        expandParamTypes: options.expandParamTypes,
        expandParamTypesOptions: options.expandParamTypesOptions,
    };
    log.info('AST scan', files.length, 'files');
    const ast = runASTScanner(scanRoot, runOpts);
    mergeASTIntoRegistry(ast);
    await new Promise((resolve) => {
        setImmediate(() => {
            resolveRelationships();
            resolve();
        });
    });
    const { roots: rootKeys } = analyzeRelationships();
    const tree = rootKeys.map((k) => buildTree(k));
    const registryRaw = toRegistryRecord();
    const registry = redactBodies ? redactRegistryBodies(registryRaw) : registryRaw;
    log.info('registry size', Registry.size, 'roots', rootKeys.length);
    let ws;
    async function shutdown() {
        if (ws)
            await ws.close();
    }
    if (options.rpcSerialization !== undefined) {
        if (options.rpcSerialization.enabled) {
            setRpcSerializationConfig(options.rpcSerialization);
        }
        else {
            resetRpcSerializationConfig();
        }
    }
    setInvokeTimeoutMs(options.invokeTimeoutMs);
    if (enableWs) {
        configureInvokeRateLimit(options.invokeRateLimit ?? null);
        ws = await startInspectorWebSocket(registry, tree, {
            port: options.wsPort,
            host: options.wsHost,
            authToken: options.authToken,
            scanRoots: options.scanRoots,
            rpcSerialization: options.rpcSerialization,
            invokeRateLimit: options.invokeRateLimit,
            invokeTimeoutMs: options.invokeTimeoutMs,
            upload: options.upload,
            qaFileWire: options.qaFileWire,
            qaMediaUpload: options.qaMediaUpload,
            fileUrl: options.fileUrl,
            qaMediaUploadHostUploadUrl: options.qaMediaUploadHostUploadUrl,
        });
        log.info('WebSocket listening', `${options.wsHost ?? '127.0.0.1'}:${ws.port}`);
    }
    if (options.registerSignalHandlers && enableWs && ws) {
        const onSignal = () => {
            void shutdown()
                .then(() => process.exit(0))
                .catch((err) => {
                log.error('shutdown error', err);
                process.exit(1);
            });
        };
        process.once('SIGINT', onSignal);
        process.once('SIGTERM', onSignal);
    }
    return { registry, tree, ws, shutdown };
}
//# sourceMappingURL=bootstrap.js.map