/**
 * Host-held Minio/S3: parse {@link HostMinioOptions} and upload bytes + presign GET (never on catalog wire).
 */
import type { HostMinioOptions } from '../bootstrap.js'

export type ParsedHostMinioClientConfig = {
	endPoint: string
	port: number
	useSSL: boolean
	accessKey: string
	secretKey: string
	region?: string
	pathStyle: boolean
}

/** Parse `HostMinioOptions.endpoint` into Minio `Client` fields (hostname, port, TLS). */
export function parseHostMinioEndpoint(host: HostMinioOptions): ParsedHostMinioClientConfig {
	const raw = host.endpoint.trim()
	if (!raw) throw new Error('hostMinio.endpoint is required')
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
	let u: URL
	try {
		u = new URL(withScheme)
	} catch {
		throw new Error(`hostMinio.endpoint is not a valid URL or host:port: ${raw}`)
	}
	const port =
		u.port !== ''
			? Number(u.port)
			: u.protocol === 'https:'
				? 443
				: u.protocol === 'http:'
					? 80
					: 9000
	const useSSL = u.protocol === 'https:'
	const endPoint = u.hostname
	if (!endPoint) throw new Error('hostMinio.endpoint must include a hostname')
	return {
		endPoint,
		port,
		useSSL,
		accessKey: host.accessKeyId,
		secretKey: host.secretAccessKey,
		region: host.region,
		pathStyle: host.forcePathStyle ?? false,
	}
}

export type PutBufferAndPresignGetInput = {
	objectKey: string
	buffer: Buffer
	contentType: string
	/** Default 24h */
	getExpirySeconds?: number
}

/**
 * `putObject` then `presignedGetObject`. Uses dynamic `import('minio')` so consumers can keep `minio` as optional peer.
 */
export async function putBufferAndPresignGetUrl(
	host: HostMinioOptions,
	input: PutBufferAndPresignGetInput,
): Promise<{ getUrl: string; objectKey: string }> {
	const cfg = parseHostMinioEndpoint(host)
	const Minio = await import('minio')
	const client = new Minio.Client({
		endPoint: cfg.endPoint,
		port: cfg.port,
		useSSL: cfg.useSSL,
		accessKey: cfg.accessKey,
		secretKey: cfg.secretKey,
		...(cfg.region ? { region: cfg.region } : {}),
		pathStyle: cfg.pathStyle,
	})
	const meta: Record<string, string> = { 'Content-Type': input.contentType }
	await client.putObject(host.bucket, input.objectKey, input.buffer, input.buffer.length, meta)
	const getExpiry = input.getExpirySeconds ?? 24 * 60 * 60
	const getUrl = await client.presignedGetObject(host.bucket, input.objectKey, getExpiry)
	return { getUrl, objectKey: input.objectKey }
}
