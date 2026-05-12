/** Parse `HostMinioOptions.endpoint` into Minio `Client` fields (hostname, port, TLS). */
export function parseHostMinioEndpoint(host) {
    const raw = host.endpoint.trim();
    if (!raw)
        throw new Error('hostMinio.endpoint is required');
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
    let u;
    try {
        u = new URL(withScheme);
    }
    catch {
        throw new Error(`hostMinio.endpoint is not a valid URL or host:port: ${raw}`);
    }
    const port = u.port !== ''
        ? Number(u.port)
        : u.protocol === 'https:'
            ? 443
            : u.protocol === 'http:'
                ? 80
                : 9000;
    const useSSL = u.protocol === 'https:';
    const endPoint = u.hostname;
    if (!endPoint)
        throw new Error('hostMinio.endpoint must include a hostname');
    return {
        endPoint,
        port,
        useSSL,
        accessKey: host.accessKeyId,
        secretKey: host.secretAccessKey,
        region: host.region,
        pathStyle: host.forcePathStyle ?? false,
    };
}
/**
 * `putObject` then `presignedGetObject`. Uses dynamic `import('minio')` so consumers can keep `minio` as optional peer.
 */
export async function putBufferAndPresignGetUrl(host, input) {
    const cfg = parseHostMinioEndpoint(host);
    const Minio = await import('minio');
    const client = new Minio.Client({
        endPoint: cfg.endPoint,
        port: cfg.port,
        useSSL: cfg.useSSL,
        accessKey: cfg.accessKey,
        secretKey: cfg.secretKey,
        ...(cfg.region ? { region: cfg.region } : {}),
        pathStyle: cfg.pathStyle,
    });
    const meta = { 'Content-Type': input.contentType };
    await client.putObject(host.bucket, input.objectKey, input.buffer, input.buffer.length, meta);
    const getExpiry = input.getExpirySeconds ?? 24 * 60 * 60;
    const getUrl = await client.presignedGetObject(host.bucket, input.objectKey, getExpiry);
    return { getUrl, objectKey: input.objectKey };
}
//# sourceMappingURL=host-minio-client.js.map