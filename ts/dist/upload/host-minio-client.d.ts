/**
 * Host-held Minio/S3: parse {@link HostMinioOptions} and upload bytes + presign GET (never on catalog wire).
 */
import type { HostMinioOptions } from '../bootstrap.js';
export type ParsedHostMinioClientConfig = {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    region?: string;
    pathStyle: boolean;
};
/** Parse `HostMinioOptions.endpoint` into Minio `Client` fields (hostname, port, TLS). */
export declare function parseHostMinioEndpoint(host: HostMinioOptions): ParsedHostMinioClientConfig;
export type PutBufferAndPresignGetInput = {
    objectKey: string;
    buffer: Buffer;
    contentType: string;
    /** Default 24h */
    getExpirySeconds?: number;
};
/**
 * `putObject` then `presignedGetObject`. Uses dynamic `import('minio')` so consumers can keep `minio` as optional peer.
 */
export declare function putBufferAndPresignGetUrl(host: HostMinioOptions, input: PutBufferAndPresignGetInput): Promise<{
    getUrl: string;
    objectKey: string;
}>;
//# sourceMappingURL=host-minio-client.d.ts.map