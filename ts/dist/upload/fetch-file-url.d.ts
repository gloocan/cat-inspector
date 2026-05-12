/**
 * HTTPS fetch for __qaFileUrl materialization (SSRF-safe allowlist, size cap, timeout).
 */
export type FetchFileUrlOptions = {
    /** Hostnames allowed (exact match, case-insensitive). Entry starting with `.` matches hostname suffix (e.g. `.amazonaws.com`). */
    allowedHosts: string[];
    maxDownloadBytes: number;
    timeoutMs: number;
    /** Default 3 */
    maxRedirects?: number;
    /** When true, allow http: URLs (dev only). Default false. */
    allowHttp?: boolean;
};
export declare function isHostnameAllowed(hostname: string, allowedHosts: string[]): boolean;
export type FetchedFileBytes = {
    buffer: Buffer;
    contentType: string;
    filename: string;
};
/**
 * GET url, enforce allowlist + max bytes + timeout. Follows redirects up to maxRedirects.
 */
export declare function fetchFileUrl(urlString: string, options: FetchFileUrlOptions): Promise<FetchedFileBytes>;
//# sourceMappingURL=fetch-file-url.d.ts.map